-- ============================================================
-- our 3 Panda database schema (MySQL / TiDB Serverless)
-- migrated from SQLite – made from the ER diagram we drew in class
-- ============================================================

-- ---------------- users table ----------------
CREATE TABLE IF NOT EXISTS Users (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    username        VARCHAR(100)     NOT NULL,
    email           VARCHAR(255)     NOT NULL UNIQUE,
    password        VARCHAR(255)     NOT NULL,
    full_name       VARCHAR(200)     DEFAULT NULL,
    phone           VARCHAR(30)      DEFAULT NULL,
    address         TEXT             DEFAULT NULL,
    profile_image   VARCHAR(500)     DEFAULT NULL,
    role            VARCHAR(20)      NOT NULL DEFAULT 'customer'
                                     CHECK (role IN ('customer', 'admin', 'delivery')),
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP
);

-- ---------------- restaurants table ----------------
CREATE TABLE IF NOT EXISTS Restaurants (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(200)     NOT NULL,
    description     TEXT             DEFAULT NULL,
    address         TEXT             DEFAULT NULL,
    phone           VARCHAR(30)      DEFAULT NULL,
    image           VARCHAR(500)     DEFAULT NULL,
    rating          DECIMAL(3,2)     DEFAULT NULL,
    is_active       TINYINT(1)       DEFAULT 1,
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP
);

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

-- ---------------- orders table ----------------
CREATE TABLE IF NOT EXISTS Orders (
    id                 INT              PRIMARY KEY AUTO_INCREMENT,
    user_id            INT              NOT NULL,
    restaurant_id      INT              DEFAULT NULL,
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
    FOREIGN KEY (user_id)            REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id)      REFERENCES Restaurants  (id) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (delivery_person_id) REFERENCES Users        (id) ON UPDATE CASCADE ON DELETE SET NULL
);

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

-- ---------------- reviews table ----------------
CREATE TABLE IF NOT EXISTS Reviews (
    id              INT              PRIMARY KEY AUTO_INCREMENT,
    user_id         INT              NOT NULL,
    restaurant_id   INT              NOT NULL,
    order_id        INT              DEFAULT NULL,
    rating          INT              NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT             DEFAULT NULL,
    created_at      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)       REFERENCES Users       (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id) REFERENCES Restaurants  (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (order_id)      REFERENCES Orders       (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------------- sample data for testing ----------------

-- test admin user (password is admin123, already hashed)
INSERT IGNORE INTO Users (username, email, password, full_name, role)
VALUES (
    'Admin',
    'admin@3panda.com',
    '$2b$10$ZMF7VBOmreZlglKMV/nOz.WU7NYYS2WhlUPWOPojvfY2zF/2OQRkO',
    'System Admin',
    'admin'
);

-- sample categories
INSERT IGNORE INTO Categories (name, description) VALUES
    ('Chinese',  'Traditional Chinese cuisine'),
    ('Vegetarian', 'Plant-based dishes');

-- Performance indexes for frequently queried database columns
CREATE INDEX idx_users_email ON Users(email);
CREATE INDEX idx_users_username ON Users(username);
CREATE INDEX idx_users_role ON Users(role);
CREATE INDEX idx_menu_restaurant ON MenuItems(restaurant_id);
CREATE INDEX idx_menu_category ON MenuItems(category_id);
CREATE INDEX idx_orders_user ON Orders(user_id);
CREATE INDEX idx_orders_status ON Orders(status);
CREATE INDEX idx_orders_delivery ON Orders(delivery_person_id);
CREATE INDEX idx_orders_restaurant ON Orders(restaurant_id);
CREATE INDEX idx_orderDet_order ON OrderDetails(order_id);
CREATE INDEX idx_orderDet_item ON OrderDetails(menu_item_id);
CREATE INDEX idx_reviews_user ON Reviews(user_id);
CREATE INDEX idx_reviews_rest ON Reviews(restaurant_id);
