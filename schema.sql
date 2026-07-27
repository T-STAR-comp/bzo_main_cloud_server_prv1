-- Biazo Travel Agency — MySQL schema
-- Run: mysql -u root -p < schema.sql
--
-- If you get a foreign-key error on email_codes (user_id vs users.id),
-- an old users table may already exist. For a fresh dev database run:
--   DROP DATABASE IF EXISTS biazo_travel;
-- then run this file again.

CREATE DATABASE IF NOT EXISTS biazo_travel
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE biazo_travel;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  username      VARCHAR(50)  NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at DATETIME NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(32)  NULL,
  date_of_birth DATE         NULL,
  nationality   VARCHAR(100) NULL DEFAULT 'Malawian',
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  status        ENUM('active','suspended','pending','flagged') NOT NULL DEFAULT 'active',
  admin_notes   TEXT         NULL,
  last_login_at DATETIME     NULL,
  avatar_url    VARCHAR(512) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role),
  INDEX idx_users_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Email verification / login codes (hashed, single-use)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_codes (
  id          CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id     CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  purpose     ENUM('signup', 'login', 'password_reset') NOT NULL,
  expires_at  DATETIME     NOT NULL,
  consumed_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_email_codes_user_purpose (user_id, purpose),
  INDEX idx_email_codes_expires (expires_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Refresh token sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  user_id            CHAR(36)     NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  expires_at         DATETIME     NOT NULL,
  revoked_at         DATETIME     NULL,
  user_agent         VARCHAR(512) NULL,
  ip_address         VARCHAR(45)  NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_refresh_sessions_user (user_id),
  INDEX idx_refresh_sessions_expires (expires_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Travel & display preferences (1:1 with user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id              CHAR(36)     NOT NULL PRIMARY KEY,
  cabin_class          VARCHAR(50)  NOT NULL DEFAULT 'Economy',
  seat_preference      VARCHAR(50)  NOT NULL DEFAULT 'No preference',
  meal                 VARCHAR(50)  NOT NULL DEFAULT 'No preference',
  frequent_flyer       VARCHAR(120) NULL,
  direct_flights_only  TINYINT(1)   NOT NULL DEFAULT 1,
  avoid_red_eyes       TINYINT(1)   NOT NULL DEFAULT 0,
  offset_carbon        TINYINT(1)   NOT NULL DEFAULT 1,
  account_currency     CHAR(3)      NULL,
  language             VARCHAR(20)  NOT NULL DEFAULT 'English',
  timezone             VARCHAR(64)  NOT NULL DEFAULT 'Africa/Blantyre',
  notify_flight_status TINYINT(1)   NOT NULL DEFAULT 1,
  notify_gate_delay    TINYINT(1)   NOT NULL DEFAULT 1,
  notify_fare_drops    TINYINT(1)   NOT NULL DEFAULT 1,
  notify_journal       TINYINT(1)   NOT NULL DEFAULT 0,
  notify_product_news  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Payment methods (never store full PAN — last four + token reference only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  user_id          CHAR(36)     NOT NULL,
  brand            VARCHAR(20)  NOT NULL,
  last_four        CHAR(4)      NOT NULL,
  cardholder_name  VARCHAR(200) NOT NULL,
  expiry_month     TINYINT      NOT NULL,
  expiry_year      SMALLINT     NOT NULL,
  is_primary       TINYINT(1)   NOT NULL DEFAULT 0,
  processor_token  VARCHAR(255) NULL COMMENT 'External vault token, not raw card data',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       DATETIME     NULL,
  CONSTRAINT fk_payment_methods_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_payment_methods_user (user_id),
  INDEX idx_payment_methods_active (user_id, deleted_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Travel credit balance (MWK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS travel_credit (
  user_id    CHAR(36)    NOT NULL PRIMARY KEY,
  balance_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_travel_credit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  flight_departure_id CHAR(36) NULL,
  pnr             VARCHAR(20)  NOT NULL,
  status          ENUM('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'confirmed',
  origin_code     CHAR(3)      NOT NULL,
  origin_city     VARCHAR(100) NOT NULL,
  destination_code CHAR(3)     NOT NULL,
  destination_city VARCHAR(100) NOT NULL,
  airline         VARCHAR(120) NOT NULL,
  flight_number   VARCHAR(20)  NULL,
  depart_at       DATETIME     NOT NULL,
  arrive_at       DATETIME     NOT NULL,
  cabin_class     VARCHAR(50)  NOT NULL DEFAULT 'Economy',
  price_mwk       DECIMAL(14,2) NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bookings_user (user_id),
  INDEX idx_bookings_status (user_id, status),
  UNIQUE INDEX idx_bookings_pnr (pnr)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Ticket segments (linked to bookings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  booking_id    CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  passenger_names VARCHAR(500) NULL,
  segment_order TINYINT      NOT NULL DEFAULT 1,
  origin_code   CHAR(3)      NOT NULL,
  destination_code CHAR(3)   NOT NULL,
  origin_city   VARCHAR(100) NOT NULL,
  destination_city VARCHAR(100) NOT NULL,
  depart_at     DATETIME     NOT NULL,
  arrive_at     DATETIME     NOT NULL,
  airline       VARCHAR(120) NOT NULL,
  flight_label  VARCHAR(40)  NULL,
  seat          VARCHAR(20)  NULL,
  gate          VARCHAR(20)  NULL,
  class         VARCHAR(50)  NOT NULL DEFAULT 'Economy',
  status        ENUM('confirmed','completed','cancelled') NOT NULL DEFAULT 'confirmed',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tickets_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tickets_user (user_id),
  INDEX idx_tickets_booking (booking_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Audit / application logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    CHAR(36)     NULL,
  level      ENUM('info','warn','error') NOT NULL DEFAULT 'info',
  action     VARCHAR(120) NOT NULL,
  metadata   JSON         NULL,
  ip_address VARCHAR(45)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_user (user_id),
  INDEX idx_audit_logs_created (created_at),
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- User account issues (admin flags)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_account_issues (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  severity    ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  title       VARCHAR(200) NOT NULL,
  description TEXT         NULL,
  resolved_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_issues_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_issues_user (user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Flight routes & departures (searchable inventory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flight_routes (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  origin_code      CHAR(3)       NOT NULL,
  origin_city      VARCHAR(100)  NOT NULL,
  destination_code CHAR(3)       NOT NULL,
  destination_city VARCHAR(100)  NOT NULL,
  airline          VARCHAR(120)  NOT NULL,
  duration_minutes INT           NOT NULL DEFAULT 0,
  base_price_mwk   DECIMAL(14,2) NOT NULL,
  cabin_class      VARCHAR(50)   NOT NULL DEFAULT 'Economy',
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  notes            TEXT          NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_routes_od (origin_code, destination_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flight_departures (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  route_id         CHAR(36)     NOT NULL,
  flight_number    VARCHAR(20)  NOT NULL,
  depart_at        DATETIME     NOT NULL,
  arrive_at        DATETIME     NOT NULL,
  seats_total      INT          NOT NULL DEFAULT 120,
  seats_available  INT          NOT NULL DEFAULT 120,
  gate             VARCHAR(20)  NULL,
  status           ENUM('scheduled','delayed','cancelled','departed','full') NOT NULL DEFAULT 'scheduled',
  price_mwk        DECIMAL(14,2) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_departures_route FOREIGN KEY (route_id) REFERENCES flight_routes(id) ON DELETE CASCADE,
  INDEX idx_departures_route (route_id),
  INDEX idx_departures_depart (depart_at)
) ENGINE=InnoDB;

-- flight_departure_id FK added via schema-migrate-v2.sql for existing databases
CREATE TABLE IF NOT EXISTS finance_ledger (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  user_id     CHAR(36)      NULL,
  booking_id  CHAR(36)      NULL,
  entry_type  ENUM('payment','refund','credit','fee','payout','adjustment') NOT NULL,
  amount_mwk  DECIMAL(14,2) NOT NULL,
  description VARCHAR(255)  NOT NULL,
  reference   VARCHAR(100)  NULL,
  created_by  CHAR(36)      NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_finance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_finance_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  INDEX idx_finance_created (created_at)
) ENGINE=InnoDB;
