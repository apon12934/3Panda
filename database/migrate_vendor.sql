-- ============================================================
-- Migration: Multi-Vendor Marketplace Upgrade
-- Run this ONCE against the live TiDB database to add the new
-- columns to Restaurants and update the Users role constraint.
-- ============================================================

-- 1. Add 'vendor' to Users role CHECK constraint
-- TiDB/MySQL: DROP the old CHECK, add the new one
-- (If the CHECK constraint name is unknown, ALTER COLUMN works in TiDB)
ALTER TABLE Users MODIFY COLUMN role VARCHAR(20) NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'admin', 'delivery', 'vendor'));

-- 2. Add owner_username column to Restaurants (FK to Users.username)
ALTER TABLE Restaurants
    ADD COLUMN owner_username VARCHAR(100) DEFAULT NULL,
    ADD CONSTRAINT fk_restaurant_owner
        FOREIGN KEY (owner_username) REFERENCES Users(username)
        ON UPDATE CASCADE ON DELETE SET NULL;

-- 3. Add status column to Restaurants
ALTER TABLE Restaurants
    ADD COLUMN status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'));

-- 4. CRITICAL: Migrate all existing restaurants to Admin ownership
UPDATE Restaurants SET owner_username = 'Admin', status = 'approved'
    WHERE owner_username IS NULL;

-- 5. Add performance indexes
CREATE INDEX idx_restaurants_owner ON Restaurants(owner_username);
CREATE INDEX idx_restaurants_status ON Restaurants(status);

-- Done! Verify with:
-- SELECT id, name, owner_username, status FROM Restaurants;
