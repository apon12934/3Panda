-- ============================================================
-- our 3 Panda database schema (MySQL / TiDB Serverless)
-- migrated from SQLite – made from the ER diagram we drew in class
-- ============================================================

-- ---------------- users table ----------------
CREATE TABLE IF NOT EXISTS Users (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    username        VARCHAR(100)     NOT NULL UNIQUE,
    email           VARCHAR(255)     NOT NULL UNIQUE,
    password        VARCHAR(255)     NOT NULL,
    full_name       VARCHAR(200)     DEFAULT NULL,
    phone           VARCHAR(30)      DEFAULT NULL,
    address         TEXT             DEFAULT NULL,
    profile_image   VARCHAR(500)     DEFAULT NULL,
    role            VARCHAR(20)      NOT NULL DEFAULT 'customer'
                                     CHECK (role IN ('customer', 'admin', 'delivery', 'vendor')),
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP
);

-- Add id column if it doesn't exist (for existing deployments)
-- Use UNIQUE instead of PRIMARY KEY for compatibility with tables that already have username as PK
ALTER TABLE Users ADD COLUMN IF NOT EXISTS id INT UNIQUE AUTO_INCREMENT;

-- Update Restaurants to support both ownership approaches
CREATE TABLE IF NOT EXISTS Restaurants (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(200)     NOT NULL,
    description     TEXT             DEFAULT NULL,
    address         TEXT             DEFAULT NULL,
    phone           VARCHAR(30)      DEFAULT NULL,
    image           VARCHAR(500)     DEFAULT NULL,
    rating          DECIMAL(3,2)     DEFAULT NULL,
    is_active       TINYINT(1)       DEFAULT 1,
    owner_username  VARCHAR(100)     DEFAULT NULL,
    owner_id        INT              DEFAULT NULL,
    status          VARCHAR(20)      DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_username) REFERENCES Users (username)
        ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES Users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- Add owner_id column if it doesn't exist (for existing deployments)
ALTER TABLE Restaurants ADD COLUMN IF NOT EXISTS owner_id INT DEFAULT NULL;
ALTER TABLE Restaurants ADD FOREIGN KEY IF NOT EXISTS (owner_id) REFERENCES Users (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- ---------------- categories table ----------------
CREATE TABLE IF NOT EXISTS Categories (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(200)     NOT NULL,
    description     TEXT             DEFAULT NULL,
    image           VARCHAR(500)     DEFAULT NULL
);

-- ---------------- menu items table ----------------
CREATE TABLE IF NOT EXISTS MenuItems (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    restaurant_id   INT              NOT NULL,
    category_id     INT              DEFAULT NULL,
    name            VARCHAR(200)     NOT NULL,
    description     TEXT             DEFAULT NULL,
    price           DECIMAL(10,2)    NOT NULL CHECK (price >= 0),
    image           VARCHAR(500)     DEFAULT NULL,
    is_available    TINYINT(1)       DEFAULT 1,
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES Restaurants (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (category_id)   REFERENCES Categories (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- Update Orders table to support both username and ID-based foreign keys
CREATE TABLE IF NOT EXISTS Orders (
    id                 INT              PRIMARY KEY AUTO_INCREMENT,
    user_username      VARCHAR(100)     DEFAULT NULL,
    user_id            INT              DEFAULT NULL,
    restaurant_id      INT              DEFAULT NULL,
    delivery_person_username VARCHAR(100) DEFAULT NULL,
    delivery_person_id INT              DEFAULT NULL,
    total_amount       DECIMAL(10,2)    NOT NULL DEFAULT 0,
    status             VARCHAR(30)      NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending', 'confirmed', 'preparing',
                                                           'out_for_delivery', 'delivered', 'cancelled')),
    delivery_address   TEXT             DEFAULT NULL,
    payment_method     VARCHAR(20)      DEFAULT 'cash'
                                         CHECK (payment_method IN ('cash', 'credit_card', 'online')),
    notes              TEXT             DEFAULT NULL,
    created_at         TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_username)            REFERENCES Users       (username) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (user_id)                  REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id)            REFERENCES Restaurants (id) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (delivery_person_username) REFERENCES Users       (username) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (delivery_person_id)       REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Add ID-based columns if they don't exist (for existing deployments)
ALTER TABLE Orders ADD COLUMN IF NOT EXISTS user_id INT DEFAULT NULL;
ALTER TABLE Orders ADD COLUMN IF NOT EXISTS delivery_person_id INT DEFAULT NULL;
ALTER TABLE Orders ADD FOREIGN KEY IF NOT EXISTS (user_id) REFERENCES Users (id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE Orders ADD FOREIGN KEY IF NOT EXISTS (delivery_person_id) REFERENCES Users (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- ---------------- order details table ----------------
CREATE TABLE IF NOT EXISTS OrderDetails (
    id           INT              PRIMARY KEY AUTO_INCREMENT,
    order_id     INT              NOT NULL,
    menu_item_id INT              NOT NULL,
    quantity     INT              NOT NULL CHECK (quantity > 0),
    unit_price   DECIMAL(10,2)    NOT NULL DEFAULT 0,
    subtotal     DECIMAL(10,2)    NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id)     REFERENCES Orders    (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES MenuItems (id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Update Reviews table to support both username and ID-based user references
CREATE TABLE IF NOT EXISTS Reviews (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    user_username   VARCHAR(100)     DEFAULT NULL,
    user_id         INT              DEFAULT NULL,
    restaurant_id   INT              NOT NULL,
    order_id        INT              DEFAULT NULL,
    rating          INT              NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT             DEFAULT NULL,
    vendor_reply    TEXT             DEFAULT NULL,
    vendor_reply_at TIMESTAMP        NULL DEFAULT NULL,
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_username)       REFERENCES Users       (username) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (user_id)             REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id)       REFERENCES Restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (order_id)            REFERENCES Orders      (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Add user_id column if it doesn't exist (for existing deployments)
ALTER TABLE Reviews ADD COLUMN IF NOT EXISTS user_id INT DEFAULT NULL;
ALTER TABLE Reviews ADD FOREIGN KEY IF NOT EXISTS (user_id) REFERENCES Users (id) ON UPDATE CASCADE ON DELETE CASCADE;

-- Ensure vendor_reply columns exist (for backward compatibility with older schemas)
ALTER TABLE Reviews ADD COLUMN IF NOT EXISTS vendor_reply TEXT DEFAULT NULL;
ALTER TABLE Reviews ADD COLUMN IF NOT EXISTS vendor_reply_at TIMESTAMP NULL DEFAULT NULL;

-- ---------------- sample data for testing ----------------
DELETE FROM Users WHERE email = 'admin@3panda.com';
DELETE FROM Users WHERE username = 'Admin' AND email = 'admin@3panda.com';

-- test admin user (password is admin123, already hashed)
INSERT IGNORE INTO Users (username, email, password, full_name, role)
VALUES (
    'Admin',
    'admin@3panda.ddns.net',
    '$2b$10$ZMF7VBOmreZlglKMV/nOz.WU7NYYS2WhlUPWOPojvfY2zF/2OQRkO',
    'System Admin',
    'admin'
);

-- sample categories
INSERT IGNORE INTO Categories (name, description) VALUES
    ('Chinese',  'Traditional Chinese cuisine'),
    ('Vegetarian', 'Plant-based dishes');

-- migrate existing restaurants to Admin ownership with approved status
UPDATE Restaurants SET owner_username = 'Admin', status = 'approved'
    WHERE owner_username IS NULL;

-- Performance indexes for frequently queried database columns
CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON Users(username);
CREATE INDEX IF NOT EXISTS idx_users_id ON Users(id);
CREATE INDEX IF NOT EXISTS idx_users_role ON Users(role);
CREATE INDEX IF NOT EXISTS idx_menu_restaurant ON MenuItems(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_category ON MenuItems(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_username ON Orders(user_username);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON Orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON Orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_username ON Orders(delivery_person_username);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_id ON Orders(delivery_person_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON Orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orderDet_order ON OrderDetails(order_id);
CREATE INDEX IF NOT EXISTS idx_orderDet_item ON OrderDetails(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_username ON Reviews(user_username);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON Reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rest ON Reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON Restaurants(owner_username);
CREATE INDEX IF NOT EXISTS idx_restaurants_owner_id ON Restaurants(owner_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_status ON Restaurants(status);
