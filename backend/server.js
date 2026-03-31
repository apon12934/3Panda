// ============================================================
// this is the main backend file for 3 Panda
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'threepanda_secret_key_2026';
const SALT_ROUNDS = 10;

// database setup stuff

const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'database', 'panda.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

// small helper wrappers so we can use async/await with sqlite
const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });

const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

const dbExec = (sql) =>
    new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

// run schema.sql when server starts
const initDB = async () => {
    try {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
        await dbExec(schema);
        console.log('Database initialised.');
    } catch (err) {
        console.error('DB init error:', err.message);
    }
};

// global middlewares

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// this serves the frontend folder
app.use(express.static(path.join(__dirname, '..', 'frontend')));

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

// image upload setup

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        let subfolder = 'images/profiles';

        if (req.baseUrl.includes('restaurant') || req.path.includes('restaurant')) {
            subfolder = 'images/restaurants';
        } else if (req.baseUrl.includes('menu') || req.path.includes('menu') || req.baseUrl.includes('item') || req.path.includes('item')) {
            subfolder = 'images/items';
        }

        const dest = path.join(FRONTEND_DIR, subfolder);
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});

const upload = multer({
    storage,
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

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required.' });
        }

        const allowedRoles = ['customer', 'delivery'];
        const userRole = allowedRoles.includes(role) ? role : 'customer';

        const existing = await dbGet('SELECT id FROM Users WHERE email = ?', [email]);
        if (existing) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const result = await dbRun(
            'INSERT INTO Users (username, email, password, role, full_name, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, userRole, full_name || null, phone || null, address || null]
        );

        return res.status(201).json({ message: 'Registration successful.', userId: result.lastID });
    } catch (err) {
        console.error('Register error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// login user
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const user = await dbGet('SELECT * FROM Users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            message: 'Login successful.',
            token,
            role: user.role,
            userId: user.id,
            username: user.username
        });
    } catch (err) {
        console.error('Login error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin + restaurant routes

// get all restaurants (public)
app.get('/api/restaurants', async (_req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM Restaurants');
        return res.json(rows);
    } catch (err) {
        console.error('Get restaurants error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// add restaurant (admin only)
app.post('/api/restaurants', verifyToken, requireAdmin, upload.single('banner'), async (req, res) => {
    try {
        const { name, description, address, phone } = req.body;
        if (!name) return res.status(400).json({ error: 'Restaurant name is required.' });

        const image = req.file ? 'images/restaurants/' + req.file.filename : null;

        const result = await dbRun(
            'INSERT INTO Restaurants (name, description, address, phone, image) VALUES (?, ?, ?, ?, ?)',
            [name, description || null, address || null, phone || null, image]
        );

        return res.status(201).json({ message: 'Restaurant created.', id: result.lastID });
    } catch (err) {
        console.error('Create restaurant error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update restaurant (admin only)
app.put('/api/restaurants/:id', verifyToken, requireAdmin, upload.single('banner'), async (req, res) => {
    try {
        const { name, description, address, phone } = req.body;
        const { id } = req.params;

        const existing = await dbGet('SELECT * FROM Restaurants WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Restaurant not found.' });

        const image = req.file
            ? 'images/restaurants/' + req.file.filename
            : existing.image;

        await dbRun(
            'UPDATE Restaurants SET name = ?, description = ?, address = ?, phone = ?, image = ? WHERE id = ?',
            [name || existing.name, description !== undefined ? description : existing.description, address !== undefined ? address : existing.address, phone !== undefined ? phone : existing.phone, image, id]
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
        if (result.changes === 0) return res.status(404).json({ error: 'Restaurant not found.' });
        return res.json({ message: 'Restaurant deleted.' });
    } catch (err) {
        console.error('Delete restaurant error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin + menu item routes

// get menu items (public, can filter by restaurant_id)
app.get('/api/menu-items', async (req, res) => {
    try {
        const { restaurant_id } = req.query;
        let rows;
        if (restaurant_id) {
            rows = await dbAll('SELECT * FROM MenuItems WHERE restaurant_id = ?', [restaurant_id]);
        } else {
            rows = await dbAll('SELECT * FROM MenuItems');
        }
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

        const image = req.file ? 'images/items/' + req.file.filename : null;

        const result = await dbRun(
            'INSERT INTO MenuItems (restaurant_id, category_id, name, description, price, image) VALUES (?, ?, ?, ?, ?, ?)',
            [restaurant_id, category_id || null, name, description || null, price, image]
        );

        return res.status(201).json({ message: 'Menu item created.', id: result.lastID });
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

        const existing = await dbGet('SELECT * FROM MenuItems WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

        const image = req.file
            ? 'images/items/' + req.file.filename
            : existing.image;

        await dbRun(
            'UPDATE MenuItems SET restaurant_id = ?, category_id = ?, name = ?, description = ?, price = ?, image = ? WHERE id = ?',
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
        const result = await dbRun('DELETE FROM MenuItems WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Menu item not found.' });
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
            'SELECT id, username, email, full_name, phone, address, role, profile_image FROM Users WHERE id = ?',
            [req.user.id]
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

        const existing = await dbGet('SELECT * FROM Users WHERE id = ?', [req.user.id]);
        if (!existing) return res.status(404).json({ error: 'User not found.' });

        const profile_image = req.file
            ? 'images/profiles/' + req.file.filename
            : existing.profile_image;

        let hashedPassword = existing.password;
        if (password) {
            hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        }

        await dbRun(
            'UPDATE Users SET username = ?, email = ?, password = ?, full_name = ?, phone = ?, address = ?, profile_image = ? WHERE id = ?',
            [username || existing.username, email || existing.email, hashedPassword, full_name !== undefined ? full_name : existing.full_name, phone !== undefined ? phone : existing.phone, address !== undefined ? address : existing.address, profile_image, req.user.id]
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
            'SELECT id, username, email, full_name, phone, address, role, profile_image, created_at FROM Users'
        );
        return res.json(rows);
    } catch (err) {
        console.error('Get users error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// update any user (admin only)
app.put('/api/users/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, role } = req.body;

        const existing = await dbGet('SELECT * FROM Users WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'User not found.' });

        await dbRun(
            'UPDATE Users SET username = ?, email = ?, role = ? WHERE id = ?',
            [username || existing.username, email || existing.email, role || existing.role, id]
        );

        return res.json({ message: 'User updated.' });
    } catch (err) {
        console.error('Update user error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete user (admin only)
app.delete('/api/users/:id', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await dbRun('DELETE FROM Users WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'User not found.' });
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

        const orderResult = await dbRun(
            'INSERT INTO Orders (user_id, restaurant_id, total_amount, status, delivery_address, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, restaurant_id, total_amount, 'pending', delivery_address || null, payment_method || 'cash', notes || null]
        );

        const orderId = orderResult.lastID;

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
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount, o.payment_method, o.notes,
                    o.created_at, u.username AS delivery_person
             FROM Orders o
             LEFT JOIN Users u ON o.delivery_person_id = u.id
             WHERE o.user_id = ?
             ORDER BY o.id DESC`,
            [req.user.id]
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
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount,
                    c.username AS customer_name
             FROM Orders o
             JOIN Users c ON o.user_id = c.id
             WHERE o.status IN ('pending', 'confirmed', 'preparing')
               AND (o.delivery_person_id IS NULL OR o.delivery_person_id = ?)
             ORDER BY o.id DESC`,
            [req.user.id]
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
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount,
                    c.username AS customer_name
             FROM Orders o
             JOIN Users c ON o.user_id = c.id
             WHERE o.delivery_person_id = ?
               AND o.status IN ('delivered', 'cancelled')
             ORDER BY o.id DESC`,
            [req.user.id]
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
        const { status } = req.body;

        const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status.' });
        }

        const order = await dbGet('SELECT * FROM Orders WHERE id = ?', [id]);
        if (!order) return res.status(404).json({ error: 'Order not found.' });

        // if a delivery user takes this order, save their id
        let delivery_person_id = order.delivery_person_id;
        if (req.user.role === 'delivery' && !order.delivery_person_id) {
            delivery_person_id = req.user.id;
        }

        await dbRun(
            'UPDATE Orders SET status = ?, delivery_person_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, delivery_person_id, id]
        );

        return res.json({ message: 'Order status updated.' });
    } catch (err) {
        console.error('Update order status error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// admin route to see all orders

app.get('/api/orders', verifyToken, requireAdmin, async (_req, res) => {
    try {
        const orders = await dbAll(
            `SELECT o.id, o.status, o.delivery_address, o.total_amount, o.payment_method,
                    o.notes, o.created_at,
                    c.username AS customer_name,
                    d.username AS delivery_person
             FROM Orders o
             JOIN Users c ON o.user_id = c.id
             LEFT JOIN Users d ON o.delivery_person_id = d.id
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
        return res.status(201).json({ message: 'Category created.', id: result.lastID });
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
        const existing = await dbGet('SELECT * FROM Categories WHERE id = ?', [id]);
        if (!existing) return res.status(404).json({ error: 'Category not found.' });
        await dbRun('UPDATE Categories SET name = ?, description = ? WHERE id = ?',
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
        const result = await dbRun('DELETE FROM Categories WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Category not found.' });
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
        const { restaurant_id } = req.query;
        let rows;
        if (restaurant_id) {
            rows = await dbAll(
                `SELECT r.*, u.username FROM Reviews r JOIN Users u ON r.user_id = u.id WHERE r.restaurant_id = ? ORDER BY r.created_at DESC`,
                [restaurant_id]
            );
        } else {
            rows = await dbAll('SELECT r.*, u.username FROM Reviews r JOIN Users u ON r.user_id = u.id ORDER BY r.created_at DESC');
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
        const { restaurant_id, order_id, rating, comment } = req.body;
        if (!restaurant_id || !rating) {
            return res.status(400).json({ error: 'restaurant_id and rating are required.' });
        }
        const result = await dbRun(
            'INSERT INTO Reviews (user_id, restaurant_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, restaurant_id, order_id || null, rating, comment || null]
        );
        return res.status(201).json({ message: 'Review submitted.', id: result.lastID });
    } catch (err) {
        console.error('Create review error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// delete review (admin or review owner)
app.delete('/api/reviews/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const review = await dbGet('SELECT * FROM Reviews WHERE id = ?', [id]);
        if (!review) return res.status(404).json({ error: 'Review not found.' });
        if (req.user.role !== 'admin' && review.user_id !== req.user.id) {
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
        console.log(`Using database file: ${DB_PATH}`);
        
        // Auto-ping system for Render Free Tier (prevents sleeping after 15 mins)
        // Render sets RENDER_EXTERNAL_URL automatically (e.g. https://my-app.onrender.com)
        const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
        if (RENDER_EXTERNAL_URL) {
            console.log(`Auto-ping enabled for ${RENDER_EXTERNAL_URL}`);
            // Ping every 14 minutes (14 * 60 * 1000 = 840000 ms)
            setInterval(async () => {
                try {
                    console.log(`[Auto-ping] Pinging ${RENDER_EXTERNAL_URL}...`);
                    const response = await fetch(RENDER_EXTERNAL_URL);
                    console.log(`[Auto-ping] Status: ${response.status}`);
                } catch (err) {
                    console.error(`[Auto-ping] Error:`, err.message);
                }
            }, 840000); // 14 minutes
        }
    });
});


