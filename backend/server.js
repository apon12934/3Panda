// ============================================================
// this is the main backend file for 3 Panda
// migrated to MySQL (TiDB Serverless) + Cloudinary for images
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
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
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(64).toString('hex'));
const SALT_ROUNDS = 10;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production.');
}

app.disable('x-powered-by');

const allowedCorsOrigins = new Set(
    String(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

const isAllowedOrigin = (origin) => {
    if (!origin || origin === 'null') return true;
    if (allowedCorsOrigins.has(origin)) return true;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
    if (/^https:\/\/3panda\.ddns\.net$/i.test(origin)) return true;
    if (/^https:\/\/[^/]+\.onrender\.com$/i.test(origin)) return true;
    return false;
};

const normalizeText = (value, maxLength = 255) => {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\0/g, '').trim().slice(0, maxLength);
};

const normalizeOptionalText = (value, maxLength = 255) => {
    const text = normalizeText(value, maxLength);
    return text ? text : null;
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
const isValidUsername = (username) => {
    const value = normalizeText(username, 32);
    return value.length >= 3 && value.length <= 32 && !/\s/.test(value);
};
const parsePositiveInteger = (value) => {
    const num = Number(value);
    return Number.isInteger(num) && num > 0 ? num : null;
};
const parseMoneyValue = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : null;
};
const normalizePassword = (value) => String(value || '');
const normalizeRole = (value, allowAdmin = false) => {
    const roles = allowAdmin ? ['customer', 'delivery', 'vendor', 'admin'] : ['customer', 'delivery', 'vendor'];
    const role = normalizeText(value, 16).toLowerCase();
    return roles.includes(role) ? role : null;
};
const normalizePaymentMethod = (value) => {
    const method = normalizeText(value, 24).toLowerCase();
    return ['cash', 'card'].includes(method) ? method : null;
};
const normalizeOrderItems = (items) => {
    if (!Array.isArray(items) || !items.length || items.length > 50) return null;
    const normalized = [];
    for (const item of items) {
        if (!item || typeof item !== 'object') return null;
        const menuItemId = parsePositiveInteger(item.menu_item_id);
        const quantity = parsePositiveInteger(item.quantity);
        if (!menuItemId || !quantity || quantity > 99) return null;
        normalized.push({ menu_item_id: menuItemId, quantity });
    }
    return normalized;
};

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again later.' }
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' }
});

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
        let transformation = [{ quality: 'auto', fetch_format: 'auto' }];
        
        // Auto-crop and resize for banners and items (16:9 ratio, 960x540)
        if (folder === 'restaurants' || folder === 'items') {
            transformation.unshift({ width: 960, height: 540, crop: 'fill', gravity: 'auto' });
        } else if (folder === 'profiles') {
            // Optimize profile pictures without forced cropping (frontend already crops to 1:1)
            transformation.unshift({ width: 1024, height: 1024, crop: 'limit' });
        }

        const stream = cloudinary.uploader.upload_stream(
            {
                folder: `3panda/${folder}`,
                resource_type: 'image',
                transformation: transformation
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

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
}));
app.use(cors({
    origin(origin, callback) {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed.'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    optionsSuccessStatus: 204
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Performance: GZIP/Brotli compression for text assets
app.use(compression());

app.use((req, res, next) => {
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

// Serve SEO verification and crawl files explicitly from the site root.
app.get('/robots.txt', (_req, res) => {
    return res.type('text/plain').sendFile(path.join(FRONTEND_DIR, 'robots.txt'));
});

app.get('/sitemap.xml', (_req, res) => {
    return res.type('application/xml').sendFile(path.join(FRONTEND_DIR, 'sitemap.xml'));
});

// Canonicalize legacy .html page URLs to clean paths.
app.get(/^\/([a-z0-9-]+)\.html$/i, (req, res, next) => {
    const page = String(req.params[0] || '').toLowerCase();
    if (!CLEAN_PAGE_TO_FILE[page]) return next();

    if (page === 'index') {
        return res.redirect(301, '/');
    }
    return res.redirect(301, '/' + page);
});

// this serves the frontend folder with proper caching
app.use(express.static(FRONTEND_DIR, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, path, stat) => {
        // Only cache actual static assets aggressively, not the HTML files
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
    }
}));

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

app.use('/api', apiLimiter);
app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);

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
        const allowedExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
        const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
        const ext = path.extname(String(file.originalname || '')).toLowerCase();
        const ok = allowedExts.has(ext) && allowedMimes.has(String(file.mimetype || '').toLowerCase());
        cb(ok ? null : new Error('Only image files are allowed.'), ok);
    }
});

// ============================================================
//  Activity-log helper — fire-and-forget audit trail
// ============================================================

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || null;
};

const logActivity = (req, { action, targetType = null, targetId = null, details = null, actor = null }) => {
    const actorName = actor || (req.user ? req.user.username : null);
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null;
    const detailsJson = details ? JSON.stringify(details) : null;

    dbRun(
        `INSERT INTO ActivityLog (actor, action, target_type, target_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [actorName, action, targetType, targetId ? String(targetId) : null, detailsJson, ip, ua]
    ).catch(err => console.warn('Activity log write error:', err.message));
};

// auth routes


// register user
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, role, full_name, phone, address } = req.body;
        const trimmedUsername = normalizeText(username, 32);
        const trimmedEmail = normalizeText(email, 254).toLowerCase();
        const normalizedPassword = normalizePassword(password);
        const normalizedFullName = normalizeOptionalText(full_name, 120);
        const normalizedPhone = normalizeOptionalText(phone, 30);
        const normalizedAddress = normalizeOptionalText(address, 300);
        const normalizedRole = normalizeRole(role, false);

        if (!trimmedUsername || !trimmedEmail || !normalizedPassword) {
            return res.status(400).json({ error: 'Username, email, and password are required.' });
        }

        if (!isValidUsername(trimmedUsername)) {
            return res.status(400).json({ error: 'Username must be 3-32 characters with no spaces.' });
        }
        if (!isValidEmail(trimmedEmail)) {
            return res.status(400).json({ error: 'Enter a valid email address.' });
        }
        if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
            return res.status(400).json({ error: 'Password must be 8-128 characters long.' });
        }

        const userRole = normalizedRole || 'customer';

        const existing = await dbGet(
            'SELECT username FROM Users WHERE lower(email) = lower(?) OR lower(username) = lower(?)',
            [trimmedEmail, trimmedUsername]
        );
        if (existing) {
            return res.status(409).json({ error: 'Email or username already registered.' });
        }

        const hashedPassword = await bcrypt.hash(normalizedPassword, SALT_ROUNDS);

        const result = await dbRun(
            'INSERT INTO Users (username, email, password, role, full_name, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [trimmedUsername, trimmedEmail, hashedPassword, userRole, normalizedFullName, normalizedPhone, normalizedAddress]
        );

        const token = jwt.sign(
            { username: userRole === undefined ? user.username : trimmedUsername, role: userRole === undefined ? user.role : userRole },
            JWT_SECRET,
            { expiresIn: '15d' }
        );

        logActivity(req, { action: 'user.registered', actor: trimmedUsername, targetType: 'user', targetId: trimmedUsername, details: { role: userRole, email: trimmedEmail } });

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
        const loginIdentifier = normalizeText(identifier || email, 254);
        const normalizedPassword = normalizePassword(password);

        if (!loginIdentifier || !normalizedPassword) {
            return res.status(400).json({ error: 'Email/username and password are required.' });
        }
        if (loginIdentifier.length > 254) {
            return res.status(400).json({ error: 'Login identifier is too long.' });
        }

        const user = await dbGet(
            'SELECT * FROM Users WHERE lower(email) = lower(?) OR lower(username) = lower(?)',
            [loginIdentifier, loginIdentifier]
        );
        if (!user) {
            logActivity(req, { action: 'user.login_failed', actor: loginIdentifier, targetType: 'user', targetId: loginIdentifier, details: { reason: 'user_not_found' } });
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const match = await bcrypt.compare(normalizedPassword, user.password);
        if (!match) {
            logActivity(req, { action: 'user.login_failed', actor: loginIdentifier, targetType: 'user', targetId: user.username, details: { reason: 'wrong_password' } });
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        logActivity(req, { action: 'user.login_success', actor: user.username, targetType: 'user', targetId: user.username, details: { role: user.role } });

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
        const sanitizedName = normalizeText(name, 120);
        const sanitizedDescription = normalizeOptionalText(description, 1500);
        const sanitizedAddress = normalizeOptionalText(address, 250);
        const sanitizedPhone = normalizeOptionalText(phone, 30);
        const sanitizedOwnerUsername = normalizeOptionalText(owner_username, 32);
        if (!sanitizedName) return res.status(400).json({ error: 'Restaurant name is required.' });
        if (sanitizedName.length < 2) return res.status(400).json({ error: 'Restaurant name is too short.' });

        // If an owner_username is provided, verify the user exists
        let assignedOwner = null;
        if (sanitizedOwnerUsername) {
            const ownerUser = await dbGet('SELECT username, role FROM Users WHERE username = ?', [sanitizedOwnerUsername]);
            if (!ownerUser) return res.status(400).json({ error: 'Specified owner user not found.' });
            if (!['vendor', 'admin'].includes(ownerUser.role)) {
                return res.status(400).json({ error: 'Restaurant owner must be a vendor or admin account.' });
            }
            assignedOwner = sanitizedOwnerUsername;
        }

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'restaurants');
        }

        const result = await dbRun(
            'INSERT INTO Restaurants (name, description, address, phone, image, owner_username, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [sanitizedName, sanitizedDescription, sanitizedAddress, sanitizedPhone, image, assignedOwner, 'approved']
        );

        logActivity(req, { action: 'restaurant.created', targetType: 'restaurant', targetId: result.insertId, details: { name: sanitizedName, owner: assignedOwner } });

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

        const sanitizedName = name !== undefined ? normalizeText(name, 120) : existing.name;
        const sanitizedDescription = description !== undefined ? normalizeOptionalText(description, 1500) : existing.description;
        const sanitizedAddress = address !== undefined ? normalizeOptionalText(address, 250) : existing.address;
        const sanitizedPhone = phone !== undefined ? normalizeOptionalText(phone, 30) : existing.phone;

        let resolvedOwner = existing.owner_username;
        if (owner_username !== undefined) {
            const trimmedOwner = normalizeText(owner_username, 32);
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
            [sanitizedName || existing.name, sanitizedDescription, sanitizedAddress, sanitizedPhone, image, resolvedOwner, id]
        );

        logActivity(req, { action: 'restaurant.edited', targetType: 'restaurant', targetId: id, details: { name: sanitizedName || existing.name } });

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
        const existing = await dbGet('SELECT name FROM Restaurants WHERE id = ?', [id]);
        const result = await dbRun('DELETE FROM Restaurants WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Restaurant not found.' });

        logActivity(req, { action: 'restaurant.deleted', targetType: 'restaurant', targetId: id, details: { name: existing?.name } });

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

        logActivity(req, { action: 'restaurant.owner_changed', targetType: 'restaurant', targetId: id, details: { name: restaurant.name, old_owner: restaurant.owner_username, new_owner: owner_username } });

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
        const sanitizedName = normalizeText(name, 120);
        const sanitizedDescription = normalizeOptionalText(description, 1500);
        const sanitizedAddress = normalizeOptionalText(address, 250);
        const sanitizedPhone = normalizeOptionalText(phone, 30);
        if (!sanitizedName) return res.status(400).json({ error: 'Restaurant name is required.' });

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'restaurants');
        }

        const result = await dbRun(
            'INSERT INTO Restaurants (name, description, address, phone, image, owner_username, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [sanitizedName, sanitizedDescription, sanitizedAddress, sanitizedPhone, image, req.user.username, 'pending']
        );

        logActivity(req, { action: 'restaurant.submitted', targetType: 'restaurant', targetId: result.insertId, details: { name: sanitizedName } });

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
        const sanitizedRestaurantId = parsePositiveInteger(restaurant_id);
        const sanitizedName = normalizeText(name, 120);
        const sanitizedDescription = normalizeOptionalText(description, 1500);
        const sanitizedPrice = parseMoneyValue(price);
        if (!sanitizedRestaurantId || !sanitizedName || sanitizedPrice === null) {
            return res.status(400).json({ error: 'restaurant_id, name, and price are required.' });
        }

        // verify ownership + approved status
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [sanitizedRestaurantId, req.user.username]
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
            [sanitizedRestaurantId, sanitizedName, sanitizedDescription, sanitizedPrice, image]
        );

        logActivity(req, { action: 'menu_item.created', targetType: 'menu_item', targetId: result.insertId, details: { name: sanitizedName, restaurant: restaurant.name, price: sanitizedPrice } });

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
        const menuItemId = parsePositiveInteger(id);
        if (!menuItemId) return res.status(400).json({ error: 'Invalid menu item id.' });

        const item = await dbGet('SELECT * FROM MenuItems WHERE id = ?', [menuItemId]);
        if (!item) return res.status(404).json({ error: 'Menu item not found.' });

        // verify ownership
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [item.restaurant_id, req.user.username]
        );
        if (!restaurant) return res.status(403).json({ error: 'Not authorized to edit this item.' });

        const sanitizedName = name !== undefined ? normalizeText(name, 120) : item.name;
        const sanitizedDescription = description !== undefined ? normalizeOptionalText(description, 1500) : item.description;
        const sanitizedPrice = price !== undefined ? parseMoneyValue(price) : item.price;
        if (name !== undefined && !sanitizedName) return res.status(400).json({ error: 'Item name is required.' });
        if (price !== undefined && sanitizedPrice === null) return res.status(400).json({ error: 'Invalid price.' });

        let image = item.image;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        await dbRun(
            'UPDATE MenuItems SET name = ?, description = ?, price = ?, image = ? WHERE id = ?',
            [sanitizedName, sanitizedDescription, sanitizedPrice, image, menuItemId]
        );

        logActivity(req, { action: 'menu_item.edited', targetType: 'menu_item', targetId: menuItemId, details: { name: sanitizedName, restaurant: restaurant.name } });

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
        const menuItemId = parsePositiveInteger(id);
        if (!menuItemId) return res.status(400).json({ error: 'Invalid menu item id.' });

        const item = await dbGet('SELECT * FROM MenuItems WHERE id = ?', [menuItemId]);
        if (!item) return res.status(404).json({ error: 'Menu item not found.' });

        // verify ownership
        const restaurant = await dbGet(
            'SELECT * FROM Restaurants WHERE id = ? AND owner_username = ?',
            [item.restaurant_id, req.user.username]
        );
        if (!restaurant) return res.status(403).json({ error: 'Not authorized to delete this item.' });

        await dbRun('DELETE FROM MenuItems WHERE id = ?', [menuItemId]);

        logActivity(req, { action: 'menu_item.deleted', targetType: 'menu_item', targetId: menuItemId, details: { name: item.name, restaurant: restaurant.name } });

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

        logActivity(req, { action: 'restaurant.status_changed', targetType: 'restaurant', targetId: id, details: { name: restaurant.name, old_status: restaurant.status, new_status: status } });

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
            const sanitizedRestaurantId = parsePositiveInteger(restaurant_id);
            if (!sanitizedRestaurantId) return res.status(400).json({ error: 'Invalid restaurant_id.' });
            conditions.push('m.restaurant_id = ?');
            params.push(sanitizedRestaurantId);
        }
        if (search) {
            const sanitizedSearch = normalizeText(search, 120);
            conditions.push('(m.name LIKE ? OR m.description LIKE ?)');
            const term = `%${sanitizedSearch}%`;
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
        const sanitizedRestaurantId = parsePositiveInteger(restaurant_id);
        const sanitizedCategoryId = category_id ? parsePositiveInteger(category_id) : null;
        const sanitizedName = normalizeText(name, 120);
        const sanitizedDescription = normalizeOptionalText(description, 1500);
        const sanitizedPrice = parseMoneyValue(price);
        if (!sanitizedRestaurantId || !sanitizedName || sanitizedPrice === null) {
            return res.status(400).json({ error: 'restaurant_id, name, and price are required.' });
        }
        if (category_id && sanitizedCategoryId === null) {
            return res.status(400).json({ error: 'Invalid category_id.' });
        }

        let image = null;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        const result = await dbRun(
            'INSERT INTO MenuItems (restaurant_id, category_id, name, description, price, image) VALUES (?, ?, ?, ?, ?, ?)',
            [sanitizedRestaurantId, sanitizedCategoryId, sanitizedName, sanitizedDescription, sanitizedPrice, image]
        );

        logActivity(req, { action: 'menu_item.created', targetType: 'menu_item', targetId: result.insertId, details: { name: sanitizedName, price: sanitizedPrice } });

        return res.status(201).json({ message: 'Menu item created.', id: result.insertId });
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

        const menuItemId = parsePositiveInteger(id);
        if (!menuItemId) return res.status(400).json({ error: 'Invalid menu item id.' });

        const existing = await dbGet('SELECT * FROM MenuItems WHERE id = ?', [menuItemId]);
        if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

        const sanitizedRestaurantId = restaurant_id !== undefined ? parsePositiveInteger(restaurant_id) : existing.restaurant_id;
        const sanitizedCategoryId = category_id !== undefined ? (category_id ? parsePositiveInteger(category_id) : null) : existing.category_id;
        const sanitizedName = name !== undefined ? normalizeText(name, 120) : existing.name;
        const sanitizedDescription = description !== undefined ? normalizeOptionalText(description, 1500) : existing.description;
        const sanitizedPrice = price !== undefined ? parseMoneyValue(price) : existing.price;
        if (restaurant_id !== undefined && !sanitizedRestaurantId) return res.status(400).json({ error: 'Invalid restaurant_id.' });
        if (category_id !== undefined && category_id && sanitizedCategoryId === null) return res.status(400).json({ error: 'Invalid category_id.' });
        if (name !== undefined && !sanitizedName) return res.status(400).json({ error: 'Item name is required.' });
        if (price !== undefined && sanitizedPrice === null) return res.status(400).json({ error: 'Invalid price.' });

        let image = existing.image;
        if (req.file) {
            image = await uploadToCloudinary(req.file.buffer, 'items');
        }

        await dbRun(
            'UPDATE MenuItems SET restaurant_id = ?, category_id = ?, name = ?, description = ?, price = ?, image = ? WHERE id = ?',
            [
                sanitizedRestaurantId,
                sanitizedCategoryId,
                sanitizedName,
                sanitizedDescription,
                sanitizedPrice,
                image,
                menuItemId
            ]
        );

        logActivity(req, { action: 'menu_item.edited', targetType: 'menu_item', targetId: menuItemId, details: { name: sanitizedName } });

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
        const menuItemId = parsePositiveInteger(id);
        if (!menuItemId) return res.status(400).json({ error: 'Invalid menu item id.' });
        const existing = await dbGet('SELECT name FROM MenuItems WHERE id = ?', [menuItemId]);
        const result = await dbRun('DELETE FROM MenuItems WHERE id = ?', [menuItemId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Menu item not found.' });

        logActivity(req, { action: 'menu_item.deleted', targetType: 'menu_item', targetId: menuItemId, details: { name: existing?.name } });

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
        const sanitizedUsername = username !== undefined ? normalizeText(username, 32) : undefined;
        const sanitizedEmail = email !== undefined ? normalizeText(email, 254).toLowerCase() : undefined;
        const sanitizedPassword = password ? normalizePassword(password) : '';
        const sanitizedFullName = full_name !== undefined ? normalizeOptionalText(full_name, 120) : undefined;
        const sanitizedPhone = phone !== undefined ? normalizeOptionalText(phone, 30) : undefined;
        const sanitizedAddress = address !== undefined ? normalizeOptionalText(address, 300) : undefined;

        const existing = await dbGet('SELECT * FROM Users WHERE username = ?', [req.user.username]);
        if (!existing) return res.status(404).json({ error: 'User not found.' });

        if (sanitizedUsername !== undefined) {
            if (!isValidUsername(sanitizedUsername)) {
                return res.status(400).json({ error: 'Username must be 3-32 characters with no spaces.' });
            }
            const duplicate = await dbGet('SELECT username FROM Users WHERE username = ? AND username <> ?', [sanitizedUsername, req.user.username]);
            if (duplicate) return res.status(409).json({ error: 'Username already in use.' });
        }
        if (sanitizedEmail !== undefined) {
            if (!isValidEmail(sanitizedEmail)) {
                return res.status(400).json({ error: 'Enter a valid email address.' });
            }
            const duplicateEmail = await dbGet('SELECT username FROM Users WHERE lower(email) = lower(?) AND username <> ?', [sanitizedEmail, req.user.username]);
            if (duplicateEmail) return res.status(409).json({ error: 'Email already in use.' });
        }
        if (sanitizedPassword && (sanitizedPassword.length < 8 || sanitizedPassword.length > 128)) {
            return res.status(400).json({ error: 'Password must be 8-128 characters long.' });
        }

        let profile_image = existing.profile_image;
        if (req.file) {
            profile_image = await uploadToCloudinary(req.file.buffer, 'profiles');
        }

        let hashedPassword = existing.password;
        if (sanitizedPassword) {
            hashedPassword = await bcrypt.hash(sanitizedPassword, SALT_ROUNDS);
        }

        await dbRun(
            'UPDATE Users SET username = ?, email = ?, password = ?, full_name = ?, phone = ?, address = ?, profile_image = ? WHERE username = ?',
            [sanitizedUsername || existing.username, sanitizedEmail || existing.email, hashedPassword, sanitizedFullName !== undefined ? sanitizedFullName : existing.full_name, sanitizedPhone !== undefined ? sanitizedPhone : existing.phone, sanitizedAddress !== undefined ? sanitizedAddress : existing.address, profile_image, req.user.username]
        );

        logActivity(req, { action: 'user.profile_updated', targetType: 'user', targetId: req.user.username, details: { changed_username: sanitizedUsername !== undefined, changed_email: sanitizedEmail !== undefined, changed_password: !!sanitizedPassword } });

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
        const sanitizedUsername = username !== undefined ? normalizeText(username, 32) : undefined;
        const sanitizedEmail = email !== undefined ? normalizeText(email, 254).toLowerCase() : undefined;
        const sanitizedRole = role !== undefined ? normalizeRole(role, true) : undefined;

        const existing = await dbGet('SELECT * FROM Users WHERE username = ?', [targetUsername]);
        if (!existing) return res.status(404).json({ error: 'User not found.' });

        if (sanitizedUsername !== undefined) {
            if (!isValidUsername(sanitizedUsername)) {
                return res.status(400).json({ error: 'Username must be 3-32 characters with no spaces.' });
            }
            const duplicate = await dbGet('SELECT username FROM Users WHERE username = ? AND username <> ?', [sanitizedUsername, targetUsername]);
            if (duplicate) return res.status(409).json({ error: 'Username already in use.' });
        }
        if (sanitizedEmail !== undefined) {
            if (!isValidEmail(sanitizedEmail)) {
                return res.status(400).json({ error: 'Enter a valid email address.' });
            }
            const duplicateEmail = await dbGet('SELECT username FROM Users WHERE lower(email) = lower(?) AND username <> ?', [sanitizedEmail, targetUsername]);
            if (duplicateEmail) return res.status(409).json({ error: 'Email already in use.' });
        }
        if (sanitizedRole === null) {
            return res.status(400).json({ error: 'Invalid role.' });
        }

        await dbRun(
            'UPDATE Users SET username = ?, email = ?, role = ? WHERE username = ?',
            [sanitizedUsername || existing.username, sanitizedEmail || existing.email, sanitizedRole || existing.role, targetUsername]
        );

        logActivity(req, { action: 'admin.user_edited', targetType: 'user', targetId: targetUsername, details: { new_username: sanitizedUsername, new_email: sanitizedEmail, new_role: sanitizedRole, old_role: existing.role } });

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
        if (targetUsername === req.user.username) {
            return res.status(400).json({ error: 'You cannot delete your own account.' });
        }
        const result = await dbRun('DELETE FROM Users WHERE username = ?', [targetUsername]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });

        logActivity(req, { action: 'admin.user_deleted', targetType: 'user', targetId: targetUsername });

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

        if (req.user.role !== 'customer') {
            return res.status(403).json({ error: 'Only customers can place orders.' });
        }

        const normalizedItems = normalizeOrderItems(items);
        if (!normalizedItems) {
            return res.status(400).json({ error: 'Order must contain at least one item.' });
        }

        const sanitizedDeliveryAddress = normalizeText(delivery_address, 255);
        if (!sanitizedDeliveryAddress) {
            return res.status(400).json({ error: 'Delivery address is required.' });
        }

        const sanitizedPaymentMethod = normalizePaymentMethod(payment_method) || 'cash';
        const sanitizedNotes = normalizeOptionalText(notes, 500);

        // calculate total price and detect restaurant id
        let total_amount = 0;
        let restaurant_id = null;
        const itemDetails = [];
        for (const item of normalizedItems) {
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
            [orderUserValue, restaurant_id, total_amount, 'pending', sanitizedDeliveryAddress, sanitizedPaymentMethod, sanitizedNotes, ...otpValues]
        );

        const orderId = orderResult.insertId;

        for (const item of itemDetails) {
            await dbRun(
                'INSERT INTO OrderDetails (order_id, menu_item_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.menu_item_id, item.quantity, item.unit_price, item.subtotal]
            );
        }

        logActivity(req, { action: 'order.placed', targetType: 'order', targetId: orderId, details: { total: total_amount, items: normalizedItems.length, payment: sanitizedPaymentMethod } });

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

        const orderId = parsePositiveInteger(id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }

        const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status.' });
        }

        const compat = await ensureSchemaCompat();
        const order = await dbGet('SELECT * FROM Orders WHERE id = ?', [orderId]);
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
            const providedOtp = normalizeText(otp, 8);
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
            [nextStatus, deliveryPersonValue, orderId]
        );

        logActivity(req, { action: 'order.status_changed', targetType: 'order', targetId: orderId, details: { old_status: order.status, new_status: nextStatus, changed_by_role: req.user.role } });

        if (req.user.role === 'delivery' && status === 'cancelled') {
            return res.json({ message: 'Order released for other riders.' });
        }

        return res.json({ message: 'Order status updated.' });
    } catch (err) {
        console.error('Update order status error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// customer cancel order
app.patch('/api/orders/:id/cancel', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const orderId = parsePositiveInteger(id);
        if (!orderId) {
            return res.status(400).json({ error: 'Invalid order id.' });
        }

        if (req.user.role !== 'customer') {
            return res.status(403).json({ error: 'Only customers can cancel their own orders.' });
        }

        const compat = await ensureSchemaCompat();
        const order = await dbGet('SELECT * FROM Orders WHERE id = ?', [orderId]);
        if (!order) return res.status(404).json({ error: 'Order not found.' });

        const orderUserValue = await resolveOrderUserValue(req.user.username);
        if (order[compat.ordersUserColumn] !== orderUserValue) {
            return res.status(403).json({ error: 'Not authorized to cancel this order.' });
        }

        if (!['pending', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ error: 'Order cannot be cancelled at this stage.' });
        }

        await dbRun(
            `UPDATE Orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [orderId]
        );

        logActivity(req, { action: 'order.cancelled_by_customer', targetType: 'order', targetId: orderId, details: { old_status: order.status } });

        return res.json({ message: 'Order cancelled successfully.' });
    } catch (err) {
        console.error('Cancel order error:', err.message);
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
        const sanitizedName = normalizeText(name, 120);
        const sanitizedDescription = normalizeOptionalText(description, 500);
        if (!sanitizedName) return res.status(400).json({ error: 'Category name is required.' });
        const result = await dbRun('INSERT INTO Categories (name, description) VALUES (?, ?)', [sanitizedName, sanitizedDescription]);
        return res.status(201).json({ message: 'Category created.', id: result.insertId });
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
        const categoryId = parsePositiveInteger(id);
        if (!categoryId) return res.status(400).json({ error: 'Invalid category id.' });
        const existing = await dbGet('SELECT * FROM Categories WHERE id = ?', [categoryId]);
        if (!existing) return res.status(404).json({ error: 'Category not found.' });
        const sanitizedName = name !== undefined ? normalizeText(name, 120) : existing.name;
        const sanitizedDescription = description !== undefined ? normalizeOptionalText(description, 500) : existing.description;
        if (name !== undefined && !sanitizedName) return res.status(400).json({ error: 'Category name is required.' });
        await dbRun('UPDATE Categories SET name = ?, description = ? WHERE id = ?',
            [sanitizedName, sanitizedDescription, categoryId]);
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
        const categoryId = parsePositiveInteger(id);
        if (!categoryId) return res.status(400).json({ error: 'Invalid category id.' });
        const result = await dbRun('DELETE FROM Categories WHERE id = ?', [categoryId]);
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
                        u.email AS user_email,
                        u.phone AS user_phone,
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
                        u.email AS user_email,
                        u.phone AS user_phone,
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

        const sanitizedRestaurantId = parsePositiveInteger(restaurant_id);
        const sanitizedOrderId = order_id ? parsePositiveInteger(order_id) : null;
        const sanitizedComment = normalizeOptionalText(comment, 1500);
        if (!sanitizedRestaurantId || rating === undefined || rating === null) {
            return res.status(400).json({ error: 'restaurant_id and rating are required.' });
        }

        const numericRating = Number(rating);
        if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
            return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
        }

        if (sanitizedOrderId) {
            const orderMatch = await dbGet(
                `SELECT id FROM Orders WHERE id = ? AND ${compat.ordersUserColumn} = ? AND restaurant_id = ?`,
                [sanitizedOrderId, reviewUserValue, sanitizedRestaurantId]
            );
            if (!orderMatch) {
                return res.status(400).json({ error: 'Order must belong to you and match the restaurant.' });
            }
        }

        const restaurant = await dbGet('SELECT id FROM Restaurants WHERE id = ?', [sanitizedRestaurantId]);
        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found.' });
        }

        const existing = await dbGet(
            `SELECT id FROM Reviews WHERE ${compat.reviewsUserColumn} = ? AND restaurant_id = ? ORDER BY id DESC LIMIT 1`,
            [reviewUserValue, sanitizedRestaurantId]
        );
        if (existing) {
            return res.status(409).json({ error: 'You already reviewed this restaurant.' });
        }

        const result = await dbRun(
            `INSERT INTO Reviews (${compat.reviewsUserColumn}, restaurant_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)`,
            [reviewUserValue, sanitizedRestaurantId, sanitizedOrderId, numericRating, sanitizedComment]
        );

        logActivity(req, { action: 'review.created', targetType: 'review', targetId: result.insertId, details: { restaurant_id: sanitizedRestaurantId, rating: numericRating } });

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
        const reviewId = parsePositiveInteger(id);
        if (!reviewId) return res.status(400).json({ error: 'Invalid review id.' });

        const review = await dbGet('SELECT * FROM Reviews WHERE id = ?', [reviewId]);
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

        const sanitizedComment = comment !== undefined ? normalizeOptionalText(comment, 1500) : undefined;

        const updates = [];
        const params = [];
        if (rating !== undefined) {
            updates.push('rating = ?');
            params.push(Number(rating));
        }
        if (comment !== undefined) {
            updates.push('comment = ?');
            params.push(sanitizedComment);
        }

        if (!updates.length) {
            return res.status(400).json({ error: 'No fields to update.' });
        }

        params.push(reviewId);
        await dbRun(`UPDATE Reviews SET ${updates.join(', ')} WHERE id = ?`, params);

        logActivity(req, { action: 'review.edited', targetType: 'review', targetId: reviewId, details: { rating: rating !== undefined ? Number(rating) : undefined } });

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
        const reviewId = parsePositiveInteger(id);
        if (!reviewId) return res.status(400).json({ error: 'Invalid review id.' });
        const replyText = normalizeOptionalText(req.body.reply, 1500);
        if (!replyText) {
            return res.status(400).json({ error: 'Reply is required.' });
        }

        const review = await dbGet('SELECT id, restaurant_id FROM Reviews WHERE id = ?', [reviewId]);
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
            [replyText, reviewId]
        );

        logActivity(req, { action: 'review.vendor_reply', targetType: 'review', targetId: reviewId });

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
        const reviewId = parsePositiveInteger(id);
        if (!reviewId) return res.status(400).json({ error: 'Invalid review id.' });
        const review = await dbGet('SELECT id, restaurant_id, vendor_reply FROM Reviews WHERE id = ?', [reviewId]);
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
            [reviewId]
        );

        logActivity(req, { action: 'review.vendor_reply_removed', targetType: 'review', targetId: reviewId });

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
        const reviewId = parsePositiveInteger(id);
        if (!reviewId) return res.status(400).json({ error: 'Invalid review id.' });
        const review = await dbGet('SELECT * FROM Reviews WHERE id = ?', [reviewId]);
        if (!review) return res.status(404).json({ error: 'Review not found.' });

        if (req.user.role !== 'admin' && review[compat.reviewsUserColumn] !== reviewUserValue) {
            return res.status(403).json({ error: 'Not authorized.' });
        }

        await dbRun('DELETE FROM Reviews WHERE id = ?', [reviewId]);

        logActivity(req, { action: 'review.deleted', targetType: 'review', targetId: reviewId });

        return res.json({ message: 'Review deleted.' });
    } catch (err) {
        console.error('Delete review error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================================
//  Activity-log endpoints
// ============================================================

// client-reported logout (fire before clearing localStorage)
app.post('/api/activity-log/logout', verifyToken, (req, res) => {
    logActivity(req, { action: 'user.logout', targetType: 'user', targetId: req.user.username });
    return res.json({ message: 'Logout recorded.' });
});

// admin: paginated activity log with filters
app.get('/api/admin/activity-log', verifyToken, requireAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        let where = [];
        let params = [];

        if (req.query.action) {
            where.push('a.action LIKE ?');
            params.push(`%${normalizeText(req.query.action, 100)}%`);
        }
        if (req.query.actor) {
            where.push('a.actor LIKE ?');
            params.push(`%${normalizeText(req.query.actor, 100)}%`);
        }
        if (req.query.search) {
            const term = `%${normalizeText(req.query.search, 120)}%`;
            where.push('(a.target_id LIKE ? OR a.details LIKE ? OR a.action LIKE ?)');
            params.push(term, term, term);
        }
        if (req.query.from) {
            where.push('a.created_at >= ?');
            params.push(req.query.from);
        }
        if (req.query.to) {
            where.push('a.created_at <= ?');
            params.push(req.query.to);
        }

        const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : '';

        const countRow = await dbGet(`SELECT COUNT(*) AS total FROM ActivityLog a${whereClause}`, params);
        const total = countRow ? countRow.total : 0;

        const rows = await dbAll(
            `SELECT a.* FROM ActivityLog a${whereClause} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        return res.json({
            logs: rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error('Activity log error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin: activity log stats for dashboard cards
app.get('/api/admin/activity-log/stats', verifyToken, requireAdmin, async (_req, res) => {
    try {
        const total = await dbGet('SELECT COUNT(*) AS c FROM ActivityLog');
        const todayLogins = await dbGet(
            "SELECT COUNT(*) AS c FROM ActivityLog WHERE action = 'user.login_success' AND created_at >= CURDATE()"
        );
        const todayActions = await dbGet(
            "SELECT COUNT(*) AS c FROM ActivityLog WHERE created_at >= CURDATE()"
        );
        return res.json({
            total_logs: total?.c || 0,
            logins_today: todayLogins?.c || 0,
            actions_today: todayActions?.c || 0
        });
    } catch (err) {
        console.error('Activity log stats error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================================
//  Barikoi Map API Proxy
// ============================================================

app.get('/api/maps/config', (req, res) => {
    // We only expose the key for domain-restricted frontend usage (like loading raster tiles).
    // The key itself is restricted via Barikoi Dashboard.
    res.json({ apiKey: process.env.BARIKOI_API_KEY || '' });
});

app.get('/api/maps/autocomplete', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required.' });
        }
        if (!process.env.BARIKOI_API_KEY) {
            return res.status(500).json({ error: 'Map API key is not configured on the server.' });
        }
        
        const url = `https://barikoi.xyz/v1/api/search/autocomplete/server/place?q=${encodeURIComponent(q)}`;
        // We use the actual API URL. Wait, the docs usually say `https://barikoi.xyz/v1/api/search/autocomplete/${API_KEY}/place?q=...`
        const apiUrl = `https://barikoi.xyz/v1/api/search/autocomplete/${process.env.BARIKOI_API_KEY}/place?q=${encodeURIComponent(q)}`;

        // We must pass a recognized origin/referer because the API key is domain-restricted.
        const rawOrigin = req.get('origin') || req.get('referer');
        const originHeader = (!rawOrigin || rawOrigin === 'null') ? 'http://localhost' : rawOrigin;

        const response = await fetch(apiUrl, {
            headers: { 'Referer': originHeader }
        });
        if (!response.ok) {
             throw new Error(`Barikoi API responded with status: ${response.status}`);
        }
        const data = await response.json();
        
        return res.json(data);
    } catch (err) {
        console.error('Barikoi autocomplete proxy error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch map data from provider.' });
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
