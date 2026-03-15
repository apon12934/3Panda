-- ============================================================
-- our 3 Panda database schema (SQLite)
-- made from the ER diagram we drew in class
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------- users table ----------------
CREATE TABLE IF NOT EXISTS Users (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    username        TEXT         NOT NULL,
    email           TEXT         NOT NULL UNIQUE,
    password        TEXT         NOT NULL,
    full_name       TEXT         DEFAULT NULL,
    phone           TEXT         DEFAULT NULL,
    address         TEXT         DEFAULT NULL,
    profile_image   TEXT         DEFAULT NULL,
    role            TEXT         NOT NULL DEFAULT 'customer'
                                 CHECK (role IN ('customer', 'admin', 'delivery')),
    created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- ---------------- restaurants table ----------------
CREATE TABLE IF NOT EXISTS Restaurants (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    name            TEXT         NOT NULL,
    description     TEXT         DEFAULT NULL,
    address         TEXT         DEFAULT NULL,
    phone           TEXT         DEFAULT NULL,
    image           TEXT         DEFAULT NULL,
    rating          REAL         DEFAULT NULL,
    is_active       INTEGER      DEFAULT 1,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ---------------- categories table ----------------
CREATE TABLE IF NOT EXISTS Categories (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    name            TEXT         NOT NULL,
    description     TEXT         DEFAULT NULL,
    image           TEXT         DEFAULT NULL
);

-- ---------------- menu items table ----------------
CREATE TABLE IF NOT EXISTS MenuItems (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    restaurant_id   INTEGER      NOT NULL,
    category_id     INTEGER      DEFAULT NULL,
    name            TEXT         NOT NULL,
    description     TEXT         DEFAULT NULL,
    price           REAL         NOT NULL CHECK (price >= 0),
    image           TEXT         DEFAULT NULL,
    is_available    INTEGER      DEFAULT 1,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES Restaurants (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (category_id)   REFERENCES Categories (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------------- orders table ----------------
CREATE TABLE IF NOT EXISTS Orders (
    id                 INTEGER      PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER      NOT NULL,
    restaurant_id      INTEGER      DEFAULT NULL,
    delivery_person_id INTEGER      DEFAULT NULL,
    total_amount       REAL         NOT NULL DEFAULT 0,
    status             TEXT         NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'confirmed', 'preparing',
                                                       'out_for_delivery', 'delivered', 'cancelled')),
    delivery_address   TEXT         DEFAULT NULL,
    payment_method     TEXT         DEFAULT 'cash'
                                     CHECK (payment_method IN ('cash', 'credit_card', 'online')),
    notes              TEXT         DEFAULT NULL,
    created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)            REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id)      REFERENCES Restaurants  (id) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (delivery_person_id) REFERENCES Users        (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------------- order details table ----------------
CREATE TABLE IF NOT EXISTS OrderDetails (
    id           INTEGER      PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER      NOT NULL,
    menu_item_id INTEGER      NOT NULL,
    quantity     INTEGER      NOT NULL CHECK (quantity > 0),
    unit_price   REAL         NOT NULL DEFAULT 0,
    subtotal     REAL         NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id)     REFERENCES Orders    (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES MenuItems (id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- ---------------- reviews table ----------------
CREATE TABLE IF NOT EXISTS Reviews (
    id              INTEGER      PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER      NOT NULL,
    restaurant_id   INTEGER      NOT NULL,
    order_id        INTEGER      DEFAULT NULL,
    rating          INTEGER      NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT         DEFAULT NULL,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)       REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id) REFERENCES Restaurants  (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (order_id)      REFERENCES Orders       (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------------- sample data for testing ----------------

-- test admin user (password is admin123, already hashed)
INSERT OR IGNORE INTO Users (username, email, password, full_name, role)
VALUES (
    'Admin',
    'admin@3panda.com',
    '$2b$10$ZMF7VBOmreZlglKMV/nOz.WU7NYYS2WhlUPWOPojvfY2zF/2OQRkO',
    'System Admin',
    'admin'
);

-- sample categories
INSERT OR IGNORE INTO Categories (name, description) VALUES
    ('Chinese',  'Traditional Chinese cuisine'),
    ('Vegetarian', 'Plant-based dishes');

-- sample restaurants
INSERT OR IGNORE INTO Restaurants (name, description, address, image, is_active) VALUES
    ('Panda Wok',    'Authentic Chinese wok dishes',  '123 Panda St',  'images/restaurants/panda_wok.jpg',    1),
    ('Bamboo Bites', 'Fresh bamboo-inspired meals',   '456 Bamboo Ave', 'images/restaurants/bamboo_bites.jpg', 1);

-- sample menu items (2 for each restaurant)
INSERT OR IGNORE INTO MenuItems (restaurant_id, category_id, name, description, price, image, is_available) VALUES
    (1, 1, 'Kung Pao Chicken',  'Spicy stir-fried chicken with peanuts', 8.99,  'images/items/kung_pao_chicken.jpg', 1),
    (1, 1, 'Fried Rice Combo',  'Classic fried rice with vegetables',    6.49,  'images/items/fried_rice_combo.jpg',  1),
    (2, 2, 'Spring Rolls',      'Crispy vegetable spring rolls',         4.99,  'images/items/spring_rolls.jpg',      1),
    (2, 2, 'Tofu Stir Fry',     'Stir-fried tofu with mixed veggies',   7.49,  'images/items/tofu_stir_fry.jpg',     1);


