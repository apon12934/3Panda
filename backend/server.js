// ============================================================
// this is the main backend file for 3 Panda
// migrated to MySQL (TiDB Serverless) + Cloudinary for images
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'threepanda_secret_key_2026';
const SALT_ROUNDS = 10;

// database setup stuff (TiDB Serverless / MySQL)

const pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: parseInt(process.env.TIDB_PORT || '4000', 10),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 5
});

// small helper wrappers so we can use async/await with mysql2
const dbRun = async (sql, params = []) => {
    const [result] = await pool.execute(sql, params);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
};

const dbGet = async (sql, params = []) => {
    const [rows] = await pool.execute(sql, params);
    return rows[0] || null;
};

const dbAll = async (sql, params = []) => {
    const [rows] = await pool.execute(sql, params);
    return rows;
};

// runtime schema compatibility for deployments that still use legacy column names
const schemaCompat = {
    checked: false,
    ordersUserColumn: 'user_username',
    ordersDeliveryColumn: 'delivery_person_username',
    reviewsUserColumn: 'user_username',
    usersHasId: false,
    ordersHasOtp: true
};

const ensureSchemaCompat = async () => {
    if (schemaCompat.checked) return schemaCompat;

    try {
        const orderCols = await dbAll('SHOW COLUMNS FROM Orders');
        const orderColNames = new Set(orderCols.map(col => col.Field));
        if (orderColNames.has('user_id')) {
            schemaCompat.ordersUserColumn = 'user_id';
        } else if (orderColNames.has('user_username')) {
            schemaCompat.ordersUserColumn = 'user_username';
        }

        if (orderColNames.has('delivery_person_id')) {
            schemaCompat.ordersDeliveryColumn = 'delivery_person_id';
        } else if (orderColNames.has('delivery_person_username')) {
            schemaCompat.ordersDeliveryColumn = 'delivery_person_username';
        }

        const reviewCols = await dbAll('SHOW COLUMNS FROM Reviews');
        const reviewColNames = new Set(reviewCols.map(col => col.Field));
        if (reviewColNames.has('user_id')) {
            schemaCompat.reviewsUserColumn = 'user_id';
        } else if (reviewColNames.has('user_username')) {
            schemaCompat.reviewsUserColumn = 'user_username';
        }

        const userCols = await dbAll('SHOW COLUMNS FROM Users');
        const userColNames = new Set(userCols.map(col => col.Field));
        schemaCompat.usersHasId = userColNames.has('id');
        schemaCompat.ordersHasOtp = orderColNames.has('delivery_otp');
    } catch (err) {
        console.warn('Schema compatibility check warning:', err.message);
    } finally {
        schemaCompat.checked = true;
    }

    return schemaCompat;
};

const resolveOrderUserValue = async (username) => {
    const compat = await ensureSchemaCompat();
    if (compat.ordersUserColumn === 'user_username') return username;

    if (!compat.usersHasId) return username;
    const userRow = await dbGet('SELECT id FROM Users WHERE username = ?', [username]);
    return userRow ? userRow.id : null;
};

const resolveDeliveryPersonValue = async (username) => {
    const compat = await ensureSchemaCompat();
    if (compat.ordersDeliveryColumn === 'delivery_person_username') return username;

    if (!compat.usersHasId) return null;
    const userRow = await dbGet('SELECT id FROM Users WHERE username = ?', [username]);
    return userRow ? userRow.id : null;
};

const resolveReviewUserValue = async (username) => {
    const compat = await ensureSchemaCompat();
    if (compat.reviewsUserColumn === 'user_username') return username;

    if (!compat.usersHasId) return null;
    const userRow = await dbGet('SELECT id FROM Users WHERE username = ?', [username]);
    return userRow ? userRow.id : null;
};

const getUserJoinKeyForOrderColumn = (orderColumn) => {
    if (orderColumn === 'user_id' || orderColumn === 'delivery_person_id') {
        return schemaCompat.usersHasId ? 'id' : 'username';
    }
    return 'username';
};

// run schema.sql when server starts (execute each statement separately)
const initDB = async () => {
    try {
        const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');

        // split by semicolons, strip comment lines, filter out empty statements
        const statements = schema
            .split(';')
            .map(s => s
                .split('\n')
                .filter(line => !line.trim().startsWith('--'))
                .join('\n')
                .trim()
            )
            .filter(s => s.length > 0);

        for (const stmt of statements) {
            try {
                await pool.query(stmt);
            } catch (err) {
                // ignore "duplicate key" for INSERT IGNORE and "index already exists"
                if (err.code === 'ER_DUP_ENTRY' || err.code === 'ER_DUP_KEYNAME') {
                    continue;
                }
                console.warn('Schema statement warning:', err.message);
            }
        }

        console.log('Database initialised.');
    } catch (err) {
        console.error('DB init error:', err.message);
    }
};

// cloudinary setup for image hosting

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// helper to upload a multer file buffer to cloudinary
const uploadToCloudinary = (fileBuffer, folder) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: `3panda/${folder}`,
                resource_type: 'image',
                transformation: [{ quality: 'auto', fetch_format: 'auto' }]
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        stream.end(fileBuffer);
    });
};

// global middlewares

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Performance: add HTTP caching headers for static assets
app.use((req, res, next) => {
    // Cache static assets for 1 hour
    if (req.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2)$/i)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    // Security header
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const CLEAN_PAGE_TO_FILE = {
    index: 'index.html',
    login: 'login.html',
    profile: 'profile.html',
    'my-orders': 'my-orders.html',
    delivery: 'delivery.html',
    admin: 'admin.html',
    vendor: 'vendor.html'
};

// Canonicalize legacy .html page URLs to clean paths.
app.get(/^\/([a-z0-9-]+)\.html$/i, (req, res, next) => {
    const page = String(req.params[0] || '').toLowerCase();
    if (!CLEAN_PAGE_TO_FILE[page]) return next();

    if (page === 'index') {
        return res.redirect(301, '/');
    }
    return res.redirect(301, '/' + page);
});

// this serves the frontend folder
app.use(express.static(FRONTEND_DIR));

// Serve known frontend pages on extensionless paths.
app.get(['/', '/login', '/profile', '/my-orders', '/delivery', '/admin', '/vendor'], (req, res) => {
    const key = req.path === '/' ? 'index' : req.path.slice(1).toLowerCase();
    const fileName = CLEAN_PAGE_TO_FILE[key] || CLEAN_PAGE_TO_FILE.index;
    return res.sendFile(path.join(FRONTEND_DIR, fileName));
});

// fast health endpoint for Render keepalive checks
app.get('/api/health', (_req, res) => {
    res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

// auth middlewares

const verifyToken = (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header) return res.status(401).json({ error: 'Token required.' });

        const token = header.split(' ')[1]; // auth header format is: Bearer <token>
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // decoded token gives us user id and role
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
};

// image upload setup (multer memory storage → cloudinary)

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // max upload size is 5 MB
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ok = allowed.test(path.extname(file.originalname).toLowerCase())
                && allowed.test(file.mimetype.split('/')[1]);
        cb(ok ? null : new Error('Only image files are allowed.'), ok);
    }
});

// auth routes

// register user
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, full_name, phone, address } = req.body;
        const trimmedUsername = (username || '').trim();
        const trimmedEmail = (email || '').trim();

        if (!trimmedUsername || !trimmedEmail || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required.' });
        }

        const allowedRoles = ['customer', 'delivery', 'vendor'];
        const userRole = allowedRoles.includes(role) ? role : 'customer';

        const existing = await dbGet(
            'SELECT username FROM Users WHERE lower(email) = lower(?) OR lower(username) = lower(?)',
            [trimmedEmail, trimmedUsername]
        );
        if (existing) {
            return res.status(409).json({ error: 'Email or username already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const result = await dbRun(
            'INSERT INTO Users (username, email, password, role, full_name, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [trimmedUsername, trimmedEmail, hashedPassword, userRole, full_name || null, phone || null, address || null]
        );

        const token = jwt.sign(
            { username: trimmedUsername, role: userRole },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.status(201).json({
            message: 'Registration successful.',
            token,
            role: userRole,
            userId: trimmedUsername,
            username: trimmedUsername
        });
    } catch (err) {
        console.error('Register error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// login user
app.post('/api/login', async (req, res) => {
    try {
        const { identifier, email, password } = req.body;
        const loginIdentifier = (identifier || email || '').trim();

        if (!loginIdentifier || !password) {
            return res.status(400).json({ error: 'Email/username and password are required.' });
        }

        const user = await dbGet(
            'SELECT * FROM Users WHERE lower(email) = lower(?) OR lower(username) = lower(?)',
            [loginIdentifier, loginIdentifier]
        );
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            message: 'Login successful.',
            token,
            role: user.role,
            userId: user.username,
            username: user.username
        });
    } catch (err) {
        console.error('Login error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin + restaurant routes

// get all restaurants (public)
app.get('/api/restaurants', async (req, res) => {
    try {
        // Show all restaurants for authenticated admins, only approved for public
        let rows;
        const authHeader = req.headers.authorization;
        let isAdmin = false;
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                if (decoded.role === 'admin') isAdmin = true;
            } catch (_e) { /* ignore invalid tokens for public access */ }
        }

        if (isAdmin) {
            rows = await dbAll(
                `SELECT r.*, u.full_name AS owner_name, u.role AS owner_role, u.phone AS owner_phone, u.email AS owner_email
                 FROM Restaurants r
                 LEFT JOIN Users u ON r.owner_username = u.username`
            );
        } else {
            rows = await dbAll(
                `SELECT r.*, u.full_name AS owner_name, u.role AS owner_role, u.phone AS owner_phone, u.email AS owner_email
                 FROM Restaurants r
                 LEFT JOIN Users u ON r.owner_username = u.username
                 WHERE r.status = 'approved'`
            );
        }
        return res.json(rows);
    } catch (err) {
        console.error('Get restaurants error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// add restaurant (admin only)
app.post('/api/restaurants', verifyToken, requireAdmin, upload.single('banner'), async (req, res) => {
    try {
        const { name, description, address, phone, owner_username } = req.body;
        if (!name) return res.status(400).json({ error: 'Restaurant name is required.' });

        // If an owner_username is provided, verify the user exists
        let assignedOwner = null;
        if (owner_username) {
            const ownerUser = await dbGet('SELECT username, role FROM Users WHERE username = ?', [owner_username]);
            if (!ownerUser) return res.status(400).json({ error: 'Specified owner user not found.' });
            if (!['vendor', 'admin'].includes(ownerUser.role)) {
                return res.status(400).json({ error: 'Restaurant owner must be a vendor or admin account.' });
            }
            assignedOwner = owner_username;
        }

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'restaurants');
        }

        const result = await dbRun(
            'INSERT INTO Restaurants (name, description, address, phone, image, owner_username, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, description || null, address || null, phone || null, image, assignedOwner, 'approved']
        );

        return res.status(201).json({ message: 'Restaurant created.', id: result.insertId });
    } catch (err) {
        console.error('Create restaurant error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update restaurant (admin only)
app.put('/api/restaurants/:id', verifyToken, requireAdmin, upload.single('banner'), async (req, res) => {
    try {
        const { name, description, address, phone, owner_username } = req.body;
        const { id } = req.params;

        const existing = await dbGet('SELECT * FROM Restaurants WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Restaurant not found.' });

        let resolvedOwner = existing.owner_username;
        if (owner_username !== undefined) {
            const trimmedOwner = String(owner_username).trim();
            if (!trimmedOwner) {
                resolvedOwner = null;
            } else {
                const ownerUser = await dbGet('SELECT username, role FROM Users WHERE username = ?', [trimmedOwner]);
                if (!ownerUser) return res.status(400).json({ error: 'Specified owner user not found.' });
                if (!['vendor', 'admin'].includes(ownerUser.role)) {
                    return res.status(400).json({ error: 'Restaurant owner must be a vendor or admin account.' });
                }
                resolvedOwner = trimmedOwner;
            }
        }

        let image = existing.image;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'restaurants');
        }

        await dbRun(
            'UPDATE Restaurants SET name = ?, description = ?, address = ?, phone = ?, image = ?, owner_username = ? WHERE id = ?',
            [name || existing.name, description !== undefined ? description : existing.description, address !== undefined ? address : existing.address, phone !== undefined ? phone : existing.phone, image, resolvedOwner, id]
        );

        return res.json({ message: 'Restaurant updated.' });
    } catch (err) {
        console.error('Update restaurant error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete restaurant (admin only)
app.delete('/api/restaurants/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await dbRun('DELETE FROM Restaurants WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Restaurant not found.' });
        return res.json({ message: 'Restaurant deleted.' });
    } catch (err) {
        console.error('Delete restaurant error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// re-assign restaurant ownership (admin only)
app.patch('/api/restaurants/:id/owner', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { owner_username } = req.body;

        if (!owner_username) {
            return res.status(400).json({ error: 'owner_username is required.' });
        }

        // verify the restaurant exists
        const restaurant = await dbGet('SELECT * FROM Restaurants WHERE id = ?', [id]);
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

        // verify the target user exists
        const targetUser = await dbGet('SELECT username, role FROM Users WHERE username = ?', [owner_username]);
        if (!targetUser) return res.status(404).json({ error: 'Target user not found.' });
        if (!['vendor', 'admin'].includes(targetUser.role)) {
            return res.status(400).json({ error: 'Restaurant owner must be a vendor or admin account.' });
        }

        await dbRun(
            'UPDATE Restaurants SET owner_username = ? WHERE id = ?',
            [owner_username, id]
        );

        return res.json({
            message: `Restaurant "${restaurant.name}" (ID: ${id}) re-assigned to user "${owner_username}".`,
            restaurant_id: parseInt(id),
            new_owner: owner_username
        });
    } catch (err) {
        console.error('Re-assign restaurant owner error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor-specific routes

// get restaurants owned by the logged-in vendor
app.get('/api/vendor/restaurants', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }
        const rows = await dbAll(
            'SELECT * FROM Restaurants WHERE owner_username = ?',
            [req.user.username]
        );
        return res.json(rows);
    } catch (err) {
        console.error('Vendor restaurants error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor: submit a new restaurant for approval
app.post('/api/vendor/restaurants', verifyToken, upload.single('banner'), async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }
        const { name, description, address, phone } = req.body;
        if (!name) return res.status(400).json({ error: 'Restaurant name is required.' });

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'restaurants');
        }

        const result = await dbRun(
            'INSERT INTO Restaurants (name, description, address, phone, image, owner_username, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, description || null, address || null, phone || null, image, req.user.username, 'pending']
        );

        return res.status(201).json({ message: 'Restaurant submitted for approval.', id: result.insertId });
    } catch (err) {
        console.error('Vendor create restaurant error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor: get menu items for a specific owned restaurant
app.get('/api/vendor/menu-items/:restaurantId', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }
        const { restaurantId } = req.params;

        // verify ownership
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [restaurantId, req.user.username]
        );
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found or not owned by you.' });
        if (restaurant.status !== 'approved') {
            return res.status(403).json({ error: 'Restaurant is not yet approved.' });
        }

        const items = await dbAll(
            'SELECT * FROM MenuItems WHERE restaurant_id = ?',
            [restaurantId]
        );
        return res.json(items);
    } catch (err) {
        console.error('Vendor menu items error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor: add menu item to an owned restaurant
app.post('/api/vendor/menu-items', verifyToken, upload.single('banner'), async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }
        const { restaurant_id, name, description, price } = req.body;
        if (!restaurant_id || !name || price == null) {
            return res.status(400).json({ error: 'restaurant_id, name, and price are required.' });
        }

        // verify ownership + approved status
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [restaurant_id, req.user.username]
        );
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found or not owned by you.' });
        if (restaurant.status !== 'approved') {
            return res.status(403).json({ error: 'Cannot add items to a non-approved restaurant.' });
        }

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        const result = await dbRun(
            'INSERT INTO MenuItems (restaurant_id, name, description, price, image) VALUES (?, ?, ?, ?, ?)',
            [restaurant_id, name, description || null, price, image]
        );

        return res.status(201).json({ message: 'Menu item created.', id: result.insertId });
    } catch (err) {
        console.error('Vendor create menu item error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor: update menu item on an owned restaurant
app.put('/api/vendor/menu-items/:id', verifyToken, upload.single('banner'), async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }
        const { id } = req.params;
        const { name, description, price } = req.body;

        const item = await dbGet('SELECT * FROM MenuItems WHERE id = ?', [id]);
        if (!item) return res.status(404).json({ error: 'Menu item not found.' });

        // verify ownership
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [item.restaurant_id, req.user.username]
        );
        if (!restaurant) return res.status(403).json({ error: 'Not authorized to edit this item.' });

        let image = item.image;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        await dbRun(
            'UPDATE MenuItems SET name = ?, description = ?, price = ?, image = ? WHERE id = ?',
            [name || item.name, description !== undefined ? description : item.description, price != null ? price : item.price, image, id]
        );

        return res.json({ message: 'Menu item updated.' });
    } catch (err) {
        console.error('Vendor update menu item error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor: delete menu item on an owned restaurant
app.delete('/api/vendor/menu-items/:id', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }
        const { id } = req.params;

        const item = await dbGet('SELECT * FROM MenuItems WHERE id = ?', [id]);
        if (!item) return res.status(404).json({ error: 'Menu item not found.' });

        // verify ownership
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [item.restaurant_id, req.user.username]
        );
        if (!restaurant) return res.status(403).json({ error: 'Not authorized to delete this item.' });

        await dbRun('DELETE FROM MenuItems WHERE id = ?', [id]);
        return res.json({ message: 'Menu item deleted.' });
    } catch (err) {
        console.error('Vendor delete menu item error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin: update restaurant status (approve/reject)
app.patch('/api/restaurants/:id/status', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'approved', 'rejected'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be pending, approved, or rejected.' });
        }

        const restaurant = await dbGet('SELECT * FROM Restaurants WHERE id = ?', [id]);
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });

        await dbRun(
            'UPDATE Restaurants SET status = ? WHERE id = ?',
            [status, id]
        );

        return res.json({
            message: `Restaurant "${restaurant.name}" status updated to "${status}".`,
            restaurant_id: parseInt(id),
            new_status: status
        });
    } catch (err) {
        console.error('Update restaurant status error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin + menu item routes

// get menu items (public, can filter by restaurant_id and/or search)
app.get('/api/menu-items', async (req, res) => {
    try {
        const { restaurant_id, search } = req.query;
        let sql = `SELECT m.*, r.name AS restaurant_name, c.name AS category_name
                   FROM MenuItems m
                   LEFT JOIN Restaurants r ON m.restaurant_id = r.id
                   LEFT JOIN Categories c ON m.category_id = c.id`;
        const conditions = [];
        const params = [];

        if (restaurant_id) {
            conditions.push('m.restaurant_id = ?');
            params.push(restaurant_id);
        }
        if (search) {
            conditions.push('(m.name LIKE ? OR m.description LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term);
        }

        if (conditions.length) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        const rows = await dbAll(sql, params);
        return res.json(rows);
    } catch (err) {
        console.error('Get menu items error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// add menu item (admin only)
app.post('/api/menu-items', verifyToken, requireAdmin, upload.single('banner'), async (req, res) => {
    try {
        const { restaurant_id, category_id, name, description, price } = req.body;
        if (!restaurant_id || !name || price == null) {
            return res.status(400).json({ error: 'restaurant_id, name, and price are required.' });
        }

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        const result = await dbRun(
            'INSERT INTO MenuItems (restaurant_id, category_id, name, description, price, image) VALUES (?, ?, ?, ?, ?, ?)',
            [restaurant_id, category_id || null, name, description || null, price, image]
        );

        return res.status(201).json({ message: 'Menu item created.', username: trimmedUsername });
    } catch (err) {
        console.error('Create menu item error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update menu item (admin only)
app.put('/api/menu-items/:id', verifyToken, requireAdmin, upload.single('banner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { restaurant_id, category_id, name, description, price } = req.body;

        const existing = await dbGet('SELECT * FROM MenuItems WHERE username = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

        let image = existing.image;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        await dbRun(
            'UPDATE MenuItems SET restaurant_id = ?, category_id = ?, name = ?, description = ?, price = ?, image = ? WHERE username = ?',
            [
                restaurant_id || existing.restaurant_id,
                category_id !== undefined ? category_id : existing.category_id,
                name || existing.name,
                description !== undefined ? description : existing.description,
                price != null ? price : existing.price,
                image,
                id
            ]
        );

        return res.json({ message: 'Menu item updated.' });
    } catch (err) {
        console.error('Update menu item error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete menu item (admin only)
app.delete('/api/menu-items/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await dbRun('DELETE FROM MenuItems WHERE username = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Menu item not found.' });
        return res.json({ message: 'Menu item deleted.' });
    } catch (err) {
        console.error('Delete menu item error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// profile routes (keep this before /api/users/:id)

// get logged in user profile
app.get('/api/users/profile', verifyToken, async (req, res) => {
    try {
        const user = await dbGet(
            'SELECT username, email, full_name, phone, address, role, profile_image FROM Users WHERE username = ?',
            [req.user.username]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        return res.json(user);
    } catch (err) {
        console.error('Get profile error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update logged in user profile
app.put('/api/users/profile', verifyToken, upload.single('profile_picture'), async (req, res) => {
    try {
        const { username, email, password, full_name, phone, address } = req.body;

        const existing = await dbGet('SELECT * FROM Users WHERE username = ?', [req.user.username]);
        if (!existing) return res.status(404).json({ error: 'User not found.' });

        let profile_image = existing.profile_image;
        if (req.file) {
            profile_image = await uploadToCloudinary(req.file.buffer, 'profiles');
        }

        let hashedPassword = existing.password;
        if (password) {
            hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        }

        await dbRun(
            'UPDATE Users SET username = ?, email = ?, password = ?, full_name = ?, phone = ?, address = ?, profile_image = ? WHERE username = ?',
            [username || existing.username, email || existing.email, hashedPassword, full_name !== undefined ? full_name : existing.full_name, phone !== undefined ? phone : existing.phone, address !== undefined ? address : existing.address, profile_image, req.user.username]
        );

        return res.json({ message: 'Profile updated.' });
    } catch (err) {
        console.error('Update profile error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin user routes

// get all users (admin only)
app.get('/api/users', verifyToken, requireAdmin, async (_req, res) => {
    try {
        const rows = await dbAll(
            'SELECT username, email, full_name, phone, address, role, profile_image, created_at FROM Users'
        );
        return res.json(rows);
    } catch (err) {
        console.error('Get users error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update any user (admin only)
app.put('/api/users/:username', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { username: targetUsername } = req.params;
        const { username, email, role } = req.body;

        const existing = await dbGet('SELECT * FROM Users WHERE username = ?', [targetUsername]);
        if (!existing) return res.status(404).json({ error: 'User not found.' });

        await dbRun(
            'UPDATE Users SET username = ?, email = ?, role = ? WHERE username = ?',
            [username || existing.username, email || existing.email, role || existing.role, targetUsername]
        );

        return res.json({ message: 'User updated.' });
    } catch (err) {
        console.error('Update user error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete user (admin only)
app.delete('/api/users/:username', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { username: targetUsername } = req.params;
        const result = await dbRun('DELETE FROM Users WHERE username = ?', [targetUsername]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });
        return res.json({ message: 'User deleted.' });
    } catch (err) {
        console.error('Delete user error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// order routes

// place a new order
app.post('/api/orders', verifyToken, async (req, res) => {
    try {
        const { items, delivery_address, payment_method, notes } = req.body;
        // items format: [{ menu_item_id, quantity }, ...]

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Order must contain at least one item.' });
        }

        // calculate total price and detect restaurant id
        let total_amount = 0;
        let restaurant_id = null;
        const itemDetails = [];
        for (const item of items) {
            const mi = await dbGet('SELECT id, price, restaurant_id FROM MenuItems WHERE id = ?', [item.menu_item_id]);
            if (!mi) return res.status(400).json({ error: 'Menu item ' + item.menu_item_id + ' not found.' });
            const subtotal = mi.price * item.quantity;
            total_amount += subtotal;
            if (!restaurant_id) restaurant_id = mi.restaurant_id;
            itemDetails.push({ menu_item_id: mi.id, quantity: item.quantity, unit_price: mi.price, subtotal });
        }

        const compat = await ensureSchemaCompat();
        const orderUserValue = await resolveOrderUserValue(req.user.username);
        if (orderUserValue === null || orderUserValue === undefined) {
            return res.status(400).json({ error: 'User account not found for order placement.' });
        }

        const deliveryOtp = String(crypto.randomInt(1000, 10000));
        const otpColumn = compat.ordersHasOtp ? ', delivery_otp' : '';
        const otpPlaceholder = compat.ordersHasOtp ? ', ?' : '';
        const otpValues = compat.ordersHasOtp ? [deliveryOtp] : [];

        const orderResult = await dbRun(
            `INSERT INTO Orders (${compat.ordersUserColumn}, restaurant_id, total_amount, status, delivery_address, payment_method, notes${otpColumn}) VALUES (?, ?, ?, ?, ?, ?, ?${otpPlaceholder})`,
            [orderUserValue, restaurant_id, total_amount, 'pending', delivery_address || null, payment_method || 'cash', notes || null, ...otpValues]
        );

        const orderId = orderResult.insertId;

        for (const item of itemDetails) {
            await dbRun(
                'INSERT INTO OrderDetails (order_id, menu_item_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.menu_item_id, item.quantity, item.unit_price, item.subtotal]
            );
        }

        return res.status(201).json({ message: 'Order placed.', orderId });
    } catch (err) {
        console.error('Create order error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// get my own orders
app.get('/api/orders/mine', verifyToken, async (req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const orderUserValue = await resolveOrderUserValue(req.user.username);
        if (orderUserValue === null || orderUserValue === undefined) {
            return res.status(400).json({ error: 'User account mapping failed.' });
        }

        const deliveryJoinKey = getUserJoinKeyForOrderColumn(compat.ordersDeliveryColumn);
        const otpSelect = compat.ordersHasOtp ? ', o.delivery_otp' : '';
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount, o.payment_method, o.notes,
                    o.created_at${otpSelect},
                    COALESCE(u.full_name, u.username, CAST(o.${compat.ordersDeliveryColumn} AS CHAR)) AS delivery_person
             FROM Orders o
             LEFT JOIN Users u ON o.${compat.ordersDeliveryColumn} = u.${deliveryJoinKey}
             WHERE o.${compat.ordersUserColumn} = ?
             ORDER BY o.id DESC`,
            [orderUserValue]
        );

        for (const order of orders) {
            order.items = await dbAll(
                `SELECT mi.name, od.unit_price AS price, od.quantity, od.subtotal
                 FROM OrderDetails od
                 JOIN MenuItems mi ON od.menu_item_id = mi.id
                 WHERE od.order_id = ?`,
                [order.id]
            );
        }

        return res.json(orders);
    } catch (err) {
        console.error('Get my orders error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delivery page: pending or assigned to me
app.get('/api/delivery/pending', verifyToken, async (req, res) => {
    try {
                const compat = await ensureSchemaCompat();
                const deliveryAssigneeValue = await resolveDeliveryPersonValue(req.user.username);
                if (deliveryAssigneeValue === null || deliveryAssigneeValue === undefined) {
                        return res.status(400).json({ error: 'Delivery account mapping failed.' });
                }

                const customerJoinKey = getUserJoinKeyForOrderColumn(compat.ordersUserColumn);
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount,
                                        COALESCE(c.full_name, c.username, CAST(o.${compat.ordersUserColumn} AS CHAR)) AS customer_name,
                                        c.profile_image AS customer_profile_image
             FROM Orders o
                         LEFT JOIN Users c ON o.${compat.ordersUserColumn} = c.${customerJoinKey}
             WHERE o.status IN ('pending', 'confirmed', 'preparing')
                             AND (o.${compat.ordersDeliveryColumn} IS NULL OR o.${compat.ordersDeliveryColumn} = ?)
             ORDER BY o.id DESC`,
                        [deliveryAssigneeValue]
        );

        for (const order of orders) {
            order.items = await dbAll(
                `SELECT mi.name, od.unit_price AS price, od.quantity, od.subtotal
                 FROM OrderDetails od
                 JOIN MenuItems mi ON od.menu_item_id = mi.id
                 WHERE od.order_id = ?`,
                [order.id]
            );
        }

        return res.json(orders);
    } catch (err) {
        console.error('Delivery pending error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delivery page: completed/cancelled history
app.get('/api/delivery/history', verifyToken, async (req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const deliveryAssigneeValue = await resolveDeliveryPersonValue(req.user.username);
        if (deliveryAssigneeValue === null || deliveryAssigneeValue === undefined) {
            return res.status(400).json({ error: 'Delivery account mapping failed.' });
        }

        const customerJoinKey = getUserJoinKeyForOrderColumn(compat.ordersUserColumn);
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount,
                                        COALESCE(c.full_name, c.username, CAST(o.${compat.ordersUserColumn} AS CHAR)) AS customer_name,
                                        c.profile_image AS customer_profile_image
             FROM Orders o
             LEFT JOIN Users c ON o.${compat.ordersUserColumn} = c.${customerJoinKey}
             WHERE o.${compat.ordersDeliveryColumn} = ?
               AND o.status IN ('delivered', 'cancelled')
             ORDER BY o.id DESC`,
            [deliveryAssigneeValue]
        );

        for (const order of orders) {
            order.items = await dbAll(
                `SELECT mi.name, od.unit_price AS price, od.quantity, od.subtotal
                 FROM OrderDetails od
                 JOIN MenuItems mi ON od.menu_item_id = mi.id
                 WHERE od.order_id = ?`,
                [order.id]
            );
        }

        return res.json(orders);
    } catch (err) {
        console.error('Delivery history error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update order status (also assign delivery person if needed)
app.put('/api/orders/:id/status', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, otp } = req.body;
        let nextStatus = status;

        const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status.' });
        }

        const compat = await ensureSchemaCompat();
        const order = await dbGet('SELECT * FROM Orders WHERE id = ?', [id]);
        if (!order) return res.status(404).json({ error: 'Order not found.' });

        const deliveryAssigneeValue = await resolveDeliveryPersonValue(req.user.username);
        if (req.user.role === 'delivery' && (deliveryAssigneeValue === null || deliveryAssigneeValue === undefined)) {
            return res.status(400).json({ error: 'Delivery account mapping failed.' });
        }

        // Authorization: only admin or the assigned delivery person can update
        if (req.user.role !== 'admin' && req.user.role !== 'delivery') {
            return res.status(403).json({ error: 'Not authorized to update this order.' });
        }
        if (req.user.role === 'delivery' && order[compat.ordersDeliveryColumn] && order[compat.ordersDeliveryColumn] !== deliveryAssigneeValue) {
            return res.status(403).json({ error: 'You can only update orders assigned to you.' });
        }

        // OTP verification: delivery riders must provide the correct OTP to mark as delivered
        if (req.user.role === 'delivery' && status === 'delivered' && compat.ordersHasOtp) {
            if (!otp) {
                return res.status(400).json({ error: 'Delivery OTP is required to mark as delivered.' });
            }
            const storedOtp = String(order.delivery_otp);
            const providedOtp = String(otp).trim();
            const storedBuf = Buffer.from(storedOtp.padEnd(4, '\0'));
            const providedBuf = Buffer.from(providedOtp.padEnd(4, '\0'));
            const match = storedBuf.length === providedBuf.length &&
                crypto.timingSafeEqual(storedBuf, providedBuf);
            if (!match) {
                return res.status(400).json({ error: 'Incorrect OTP. Please ask the customer for the correct code.' });
            }
        }

        // Rider "cancel" means releasing assignment back to pending pool.
        if (req.user.role === 'delivery' && status === 'cancelled') {
            nextStatus = 'pending';
        }

        // if a delivery user takes this order, save their id
        let deliveryPersonValue = order[compat.ordersDeliveryColumn];
        if (req.user.role === 'delivery' && !order[compat.ordersDeliveryColumn]) {
            deliveryPersonValue = deliveryAssigneeValue;
        }

        // Releasing an order clears current assignee so another rider can pick it.
        if (req.user.role === 'delivery' && nextStatus === 'pending') {
            deliveryPersonValue = null;
        }

        await dbRun(
            `UPDATE Orders SET status = ?, ${compat.ordersDeliveryColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [nextStatus, deliveryPersonValue, id]
        );

        if (req.user.role === 'delivery' && status === 'cancelled') {
            return res.json({ message: 'Order released for other riders.' });
        }

        return res.json({ message: 'Order status updated.' });
    } catch (err) {
        console.error('Update order status error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin route to see all orders

app.get('/api/orders', verifyToken, requireAdmin, async (_req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const customerJoinKey = getUserJoinKeyForOrderColumn(compat.ordersUserColumn);
        const deliveryJoinKey = getUserJoinKeyForOrderColumn(compat.ordersDeliveryColumn);
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount, o.payment_method,
                    o.notes, o.created_at, o.restaurant_id,
                    COALESCE(c.full_name, c.username, CAST(o.${compat.ordersUserColumn} AS CHAR)) AS customer_name,
                    COALESCE(d.full_name, d.username, CAST(o.${compat.ordersDeliveryColumn} AS CHAR)) AS delivery_person,
                    r.owner_username AS restaurant_owner_username
             FROM Orders o
             LEFT JOIN Users c ON o.${compat.ordersUserColumn} = c.${customerJoinKey}
             LEFT JOIN Users d ON o.${compat.ordersDeliveryColumn} = d.${deliveryJoinKey}
             LEFT JOIN Restaurants r ON o.restaurant_id = r.id
             ORDER BY o.id DESC`
        );

        for (const order of orders) {
            order.items = await dbAll(
                `SELECT mi.name, od.unit_price AS price, od.quantity, od.subtotal
                 FROM OrderDetails od
                 JOIN MenuItems mi ON od.menu_item_id = mi.id
                 WHERE od.order_id = ?`,
                [order.id]
            );
        }

        return res.json(orders);
    } catch (err) {
        console.error('Get all orders error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// category routes

// get categories (public)
app.get('/api/categories', async (_req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM Categories');
        return res.json(rows);
    } catch (err) {
        console.error('Get categories error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// add category (admin only)
app.post('/api/categories', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Category name is required.' });
        const result = await dbRun('INSERT INTO Categories (name, description) VALUES (?, ?)', [name, description || null]);
        return res.status(201).json({ message: 'Category created.', username: trimmedUsername });
    } catch (err) {
        console.error('Create category error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update category (admin only)
app.put('/api/categories/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;
        const existing = await dbGet('SELECT * FROM Categories WHERE username = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Category not found.' });
        await dbRun('UPDATE Categories SET name = ?, description = ? WHERE username = ?',
            [name || existing.name, description !== undefined ? description : existing.description, id]);
        return res.json({ message: 'Category updated.' });
    } catch (err) {
        console.error('Update category error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete category (admin only)
app.delete('/api/categories/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await dbRun('DELETE FROM Categories WHERE username = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found.' });
        return res.json({ message: 'Category deleted.' });
    } catch (err) {
        console.error('Delete category error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// review routes

// get reviews (public, can filter by restaurant_id)
app.get('/api/reviews', async (req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const reviewUserJoinKey = getUserJoinKeyForOrderColumn(compat.reviewsUserColumn);

        const { restaurant_id } = req.query;
        let rows;
        if (restaurant_id) {
            rows = await dbAll(
                `SELECT r.id,
                        COALESCE(u.username, CAST(r.${compat.reviewsUserColumn} AS CHAR)) AS user_username,
                        COALESCE(u.full_name, u.username, CAST(r.${compat.reviewsUserColumn} AS CHAR)) AS user_full_name,
                        COALESCE(ou.full_name, ou.username, rest.owner_username, 'Vendor') AS vendor_full_name,
                        r.restaurant_id, r.order_id, r.rating, r.comment,
                        r.vendor_reply, r.vendor_reply_at, r.created_at,
                        u.username, u.profile_image AS user_profile_image
                 FROM Reviews r
                 LEFT JOIN Users u ON r.${compat.reviewsUserColumn} = u.${reviewUserJoinKey}
                 LEFT JOIN Restaurants rest ON r.restaurant_id = rest.id
                 LEFT JOIN Users ou ON rest.owner_username = ou.username
                 WHERE r.restaurant_id = ?
                 ORDER BY r.created_at DESC`,
                [restaurant_id]
            );
        } else {
            rows = await dbAll(
                `SELECT r.id,
                        COALESCE(u.username, CAST(r.${compat.reviewsUserColumn} AS CHAR)) AS user_username,
                        COALESCE(u.full_name, u.username, CAST(r.${compat.reviewsUserColumn} AS CHAR)) AS user_full_name,
                        COALESCE(ou.full_name, ou.username, rest.owner_username, 'Vendor') AS vendor_full_name,
                        r.restaurant_id, r.order_id, r.rating, r.comment,
                        r.vendor_reply, r.vendor_reply_at, r.created_at,
                        u.username, u.profile_image AS user_profile_image
                 FROM Reviews r
                 LEFT JOIN Users u ON r.${compat.reviewsUserColumn} = u.${reviewUserJoinKey}
                 LEFT JOIN Restaurants rest ON r.restaurant_id = rest.id
                 LEFT JOIN Users ou ON rest.owner_username = ou.username
                 ORDER BY r.created_at DESC`
            );
        }
        return res.json(rows);
    } catch (err) {
        console.error('Get reviews error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// add review (logged in user)
app.post('/api/reviews', verifyToken, async (req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const reviewUserValue = await resolveReviewUserValue(req.user.username);
        if (reviewUserValue === null || reviewUserValue === undefined) {
            return res.status(400).json({ error: 'User account mapping failed for review.' });
        }

        const { restaurant_id, order_id, rating, comment } = req.body;
        if (req.user.role !== 'customer') {
            return res.status(403).json({ error: 'Only customers can write reviews.' });
        }

        if (!restaurant_id || !rating) {
            return res.status(400).json({ error: 'restaurant_id and rating are required.' });
        }

        const numericRating = Number(rating);
        if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
            return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
        }

        const restaurant = await dbGet('SELECT id FROM Restaurants WHERE id = ?', [restaurant_id]);
        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found.' });
        }

        const existing = await dbGet(
            `SELECT id FROM Reviews WHERE ${compat.reviewsUserColumn} = ? AND restaurant_id = ? ORDER BY id DESC LIMIT 1`,
            [reviewUserValue, restaurant_id]
        );
        if (existing) {
            return res.status(409).json({ error: 'You already reviewed this restaurant.' });
        }

        const result = await dbRun(
            `INSERT INTO Reviews (${compat.reviewsUserColumn}, restaurant_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)`,
            [reviewUserValue, restaurant_id, order_id || null, numericRating, comment || null]
        );
        return res.status(201).json({ message: 'Review submitted.', id: result.insertId });
    } catch (err) {
        console.error('Create review error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update review (rating/comment only - review owner only)
app.put('/api/reviews/:id', verifyToken, async (req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const reviewUserValue = await resolveReviewUserValue(req.user.username);
        if (reviewUserValue === null || reviewUserValue === undefined) {
            return res.status(400).json({ error: 'User account mapping failed.' });
        }

        const { id } = req.params;
        const { rating, comment } = req.body;

        const review = await dbGet('SELECT * FROM Reviews WHERE id = ?', [id]);
        if (!review) return res.status(404).json({ error: 'Review not found.' });

        // Only the review author can edit
        if (review[compat.reviewsUserColumn] !== reviewUserValue) {
            return res.status(403).json({ error: 'You can only edit your own reviews.' });
        }

        if (rating !== undefined) {
            const numericRating = Number(rating);
            if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
                return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
            }
        }

        const updates = [];
        const params = [];
        if (rating !== undefined) {
            updates.push('rating = ?');
            params.push(Number(rating));
        }
        if (comment !== undefined) {
            updates.push('comment = ?');
            params.push(comment || null);
        }

        if (!updates.length) {
            return res.status(400).json({ error: 'No fields to update.' });
        }

        params.push(id);
        await dbRun(`UPDATE Reviews SET ${updates.join(', ')} WHERE id = ?`, params);
        return res.json({ message: 'Review updated.' });
    } catch (err) {
        console.error('Update review error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// vendor reply to a review on owned restaurant
app.put('/api/reviews/:id/reply', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'vendor') {
            return res.status(403).json({ error: 'Vendor access required.' });
        }

        const { id } = req.params;
        const replyText = (req.body.reply || '').trim();
        if (!replyText) {
            return res.status(400).json({ error: 'Reply is required.' });
        }

        const review = await dbGet('SELECT id, restaurant_id FROM Reviews WHERE id = ?', [id]);
        if (!review) {
            return res.status(404).json({ error: 'Review not found.' });
        }

        const ownedRestaurant = await dbGet(
            'SELECT id FROM Restaurants WHERE id = ? AND owner_username = ?',
            [review.restaurant_id, req.user.username]
        );
        if (!ownedRestaurant) {
            return res.status(403).json({ error: 'You can only reply to reviews of your own restaurants.' });
        }

        await dbRun(
            'UPDATE Reviews SET vendor_reply = ?, vendor_reply_at = CURRENT_TIMESTAMP WHERE id = ?',
            [replyText, id]
        );

        return res.json({ message: 'Reply posted.' });
    } catch (err) {
        console.error('Reply review error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete vendor reply only (keep customer review)
app.delete('/api/reviews/:id/reply', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const review = await dbGet('SELECT id, restaurant_id, vendor_reply FROM Reviews WHERE id = ?', [id]);
        if (!review) {
            return res.status(404).json({ error: 'Review not found.' });
        }

        if (!review.vendor_reply) {
            return res.status(400).json({ error: 'No vendor reply exists for this review.' });
        }

        if (req.user.role === 'vendor') {
            const ownedRestaurant = await dbGet(
                'SELECT id FROM Restaurants WHERE id = ? AND owner_username = ?',
                [review.restaurant_id, req.user.username]
            );
            if (!ownedRestaurant) {
                return res.status(403).json({ error: 'You can only delete replies for your own restaurants.' });
            }
        } else if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        await dbRun(
            'UPDATE Reviews SET vendor_reply = NULL, vendor_reply_at = NULL WHERE id = ?',
            [id]
        );

        return res.json({ message: 'Vendor reply deleted.' });
    } catch (err) {
        console.error('Delete vendor reply error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete review (admin or review owner)
app.delete('/api/reviews/:id', verifyToken, async (req, res) => {
    try {
        const compat = await ensureSchemaCompat();
        const reviewUserValue = await resolveReviewUserValue(req.user.username);

        const { id } = req.params;
        const review = await dbGet('SELECT * FROM Reviews WHERE id = ?', [id]);
        if (!review) return res.status(404).json({ error: 'Review not found.' });

        if (req.user.role !== 'admin' && review[compat.reviewsUserColumn] !== reviewUserValue) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        await dbRun('DELETE FROM Reviews WHERE id = ?', [id]);
        return res.json({ message: 'Review deleted.' });
    } catch (err) {
        console.error('Delete review error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// start the server

initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`3 Panda server running → http://localhost:${PORT}`);
        console.log(`Using TiDB database: ${process.env.TIDB_HOST || 'not configured'}/${process.env.TIDB_DATABASE || 'not configured'}`);
        
        // Secondary fallback only; primary keepalive should be done by Render Cron.
        // In-process timers stop when a free web service is sleeping.
        const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
        if (process.env.NODE_ENV === 'production' && RENDER_EXTERNAL_URL) {
            const healthUrl = `${RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/health`;
            console.log(`Auto-ping fallback enabled for ${healthUrl}`);
            // Ping every 14 minutes (14 * 60 * 1000 = 840000 ms)
            setInterval(async () => {
                try {
                    console.log(`[Auto-ping] Pinging ${healthUrl}...`);
                    const response = await fetch(healthUrl);
                    console.log(`[Auto-ping] Status: ${response.status}`);
                } catch (err) {
                    console.error(`[Auto-ping] Error:`, err.message);
                }
            }, 840000); // 14 minutes
        }
    });
});
