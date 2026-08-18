-- =============================================================================
-- Biazo Travel — full production migration (v2 → v12 + inline patches)
-- Run in phpMyAdmin on your production database.
-- Safe to re-run: CREATE IF NOT EXISTS; duplicate-column errors on ALTER can be ignored.
--
-- Production DB example: iteqeuzqir_biazo_travel
-- =============================================================================

-- USE iteqeuzqir_biazo_travel;

-- =============================================================================
-- v2 — admin user fields, bookings ↔ flight_departures
-- =============================================================================
ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL UNIQUE AFTER email;
ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER nationality;
ALTER TABLE users ADD COLUMN status ENUM('active','suspended','pending','flagged') NOT NULL DEFAULT 'active' AFTER role;
ALTER TABLE users ADD COLUMN admin_notes TEXT NULL AFTER status;
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER admin_notes;

ALTER TABLE bookings ADD COLUMN flight_departure_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER user_id;

ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_departure FOREIGN KEY (flight_departure_id) REFERENCES flight_departures(id) ON DELETE SET NULL;

-- =============================================================================
-- v3 — flight applications workflow
-- =============================================================================
CREATE TABLE IF NOT EXISTS flight_applications (
  id                    CHAR(36)      NOT NULL PRIMARY KEY,
  user_id               CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  reference_number      VARCHAR(24)   NOT NULL UNIQUE,
  status                ENUM(
    'pending','in_review','awaiting_payment','paid','purchasing','completed','cancelled'
  ) NOT NULL DEFAULT 'pending',
  origin_code           CHAR(3)       NOT NULL,
  origin_city           VARCHAR(100)  NOT NULL,
  destination_code      CHAR(3)       NOT NULL,
  destination_city      VARCHAR(100)  NOT NULL,
  trip_type             ENUM('oneway','roundtrip') NOT NULL DEFAULT 'oneway',
  depart_date           DATE          NOT NULL,
  depart_time_preferred VARCHAR(20)   NOT NULL,
  return_date           DATE          NULL,
  return_time_preferred VARCHAR(20)   NULL,
  contact_phone         VARCHAR(32)   NOT NULL,
  contact_whatsapp      VARCHAR(32)   NULL,
  cabin_class           VARCHAR(50)   NOT NULL DEFAULT 'Economy',
  need_car_rental       TINYINT(1)    NOT NULL DEFAULT 0,
  need_hotel            TINYINT(1)    NOT NULL DEFAULT 0,
  special_wheelchair    TINYINT(1)    NOT NULL DEFAULT 0,
  wheelchair_reason     TEXT          NULL,
  special_meals         TINYINT(1)    NOT NULL DEFAULT 0,
  meals_reason          TEXT          NULL,
  special_seat          TINYINT(1)    NOT NULL DEFAULT 0,
  seat_preference       VARCHAR(120)  NULL,
  quoted_origin_code    CHAR(3)       NULL,
  quoted_destination_code CHAR(3)     NULL,
  quoted_depart_date    DATE          NULL,
  quoted_depart_time    VARCHAR(20)   NULL,
  quoted_return_date    DATE          NULL,
  quoted_return_time    VARCHAR(20)   NULL,
  quoted_cabin_class    VARCHAR(50)   NULL,
  quoted_airline        VARCHAR(120)  NULL,
  quoted_flight_number  VARCHAR(30)   NULL,
  quoted_price_mwk      DECIMAL(14,2) NULL,
  extra_charges_mwk     DECIMAL(14,2) NULL DEFAULT 0,
  extra_charges_note    TEXT          NULL,
  is_alternate_offer    TINYINT(1)    NOT NULL DEFAULT 0,
  admin_message         TEXT          NULL,
  opened_by_admin_at    DATETIME      NULL,
  paid_at               DATETIME      NULL,
  completed_at          DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_applications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_applications_user (user_id),
  INDEX idx_applications_status (status),
  INDEX idx_applications_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS flight_application_passengers (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  application_id    CHAR(36)     NOT NULL,
  passenger_type    ENUM('adult','child','infant') NOT NULL DEFAULT 'adult',
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  date_of_birth     DATE         NULL,
  age_years         TINYINT      NULL,
  is_accompanied    TINYINT(1)   NULL,
  infant_seat_booked TINYINT(1)  NULL,
  sort_order        TINYINT      NOT NULL DEFAULT 1,
  CONSTRAINT fk_passengers_application FOREIGN KEY (application_id) REFERENCES flight_applications(id) ON DELETE CASCADE,
  INDEX idx_passengers_application (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS flight_application_tickets (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  application_id  CHAR(36)     NOT NULL,
  file_name       VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  file_data       MEDIUMBLOB   NULL,
  file_path       VARCHAR(512) NULL,
  ticket_record_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  segment_order   TINYINT      NOT NULL DEFAULT 1,
  uploaded_by     CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_tickets_application FOREIGN KEY (application_id) REFERENCES flight_applications(id) ON DELETE CASCADE,
  INDEX idx_app_tickets_application (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS flight_application_events (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  application_id  CHAR(36)     NOT NULL,
  event_type      VARCHAR(60)  NOT NULL,
  message         TEXT         NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_events_application FOREIGN KEY (application_id) REFERENCES flight_applications(id) ON DELETE CASCADE,
  INDEX idx_app_events_application (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- v4 — link completed applications to bookings
-- =============================================================================
ALTER TABLE flight_applications ADD COLUMN booking_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER completed_at;

-- =============================================================================
-- v5 — ticket passenger names
-- =============================================================================
ALTER TABLE tickets ADD COLUMN passenger_names VARCHAR(500) NULL AFTER user_id;

-- =============================================================================
-- v6 — payment ledger
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_ledger (
  id                          CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id                     CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  order_type                  VARCHAR(50)   NOT NULL DEFAULT 'flight_application',
  order_id                    CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  charge_id                   VARCHAR(64)   NOT NULL,
  payment_method              ENUM('mobile_money','bank','card','hosted_checkout','travel_credit') NOT NULL,
  amount_mwk                  DECIMAL(14,2) NOT NULL,
  payment_amount              DECIMAL(14,2) NULL,
  currency                    VARCHAR(3)    NOT NULL DEFAULT 'MWK',
  display_currency            VARCHAR(3)    NULL,
  status                      ENUM('pending','completed','failed','expired') NOT NULL DEFAULT 'pending',
  order_snapshot              JSON          NOT NULL,
  paychangu_ref_id            VARCHAR(100)  NULL,
  paychangu_status            VARCHAR(50)   NULL,
  provider_response           JSON          NULL,
  bank_name                   VARCHAR(120)  NULL,
  bank_account_number         VARCHAR(50)   NULL,
  bank_account_name           VARCHAR(200)  NULL,
  bank_expires_at             DATETIME      NULL,
  card_requires_3ds           TINYINT(1)    NOT NULL DEFAULT 0,
  card_3ds_url                TEXT          NULL,
  mobile_number               VARCHAR(32)   NULL,
  mobile_operator_ref_id      VARCHAR(64)   NULL,
  mobile_operator_name        VARCHAR(80)   NULL,
  verification_window_minutes TINYINT       NOT NULL DEFAULT 5,
  expires_at                  DATETIME      NOT NULL,
  completed_at                DATETIME      NULL,
  order_fulfilled_at          DATETIME      NULL,
  last_verified_at            DATETIME      NULL,
  verification_attempts       INT           NOT NULL DEFAULT 0,
  failure_reason              VARCHAR(500)  NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_payment_ledger_charge (charge_id),
  INDEX idx_payment_ledger_status (status),
  INDEX idx_payment_ledger_order (order_type, order_id),
  INDEX idx_payment_ledger_expires (expires_at),
  INDEX idx_payment_ledger_completed (completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE flight_applications ADD COLUMN payment_ledger_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER paid_at;

-- =============================================================================
-- v7 — quote line items, hosted checkout payment method
-- =============================================================================
ALTER TABLE flight_applications ADD COLUMN quote_line_items JSON NULL AFTER extra_charges_note;

ALTER TABLE payment_ledger
  MODIFY payment_method ENUM('mobile_money','bank','card','hosted_checkout','travel_credit') NOT NULL;

-- =============================================================================
-- v8 — application ticket segments
-- =============================================================================
ALTER TABLE flight_application_tickets
  ADD COLUMN ticket_record_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER application_id;

ALTER TABLE flight_application_tickets
  ADD COLUMN segment_order TINYINT NOT NULL DEFAULT 1 AFTER ticket_record_id;

-- =============================================================================
-- v9 — multi-currency, hotel/car rental details
-- =============================================================================
ALTER TABLE flight_applications ADD COLUMN hotel_request_details TEXT NULL AFTER need_hotel;
ALTER TABLE flight_applications ADD COLUMN car_rental_request_details TEXT NULL AFTER need_car_rental;
ALTER TABLE flight_applications ADD COLUMN quote_exchange_rates JSON NULL AFTER quote_line_items;
ALTER TABLE flight_applications ADD COLUMN paid_currency VARCHAR(3) NULL AFTER paid_at;
ALTER TABLE flight_applications ADD COLUMN paid_amount DECIMAL(14,2) NULL AFTER paid_currency;
ALTER TABLE flight_applications ADD COLUMN customer_display_currency VARCHAR(3) NULL AFTER paid_amount;

ALTER TABLE payment_ledger ADD COLUMN payment_amount DECIMAL(14,2) NULL AFTER amount_mwk;
ALTER TABLE payment_ledger ADD COLUMN display_currency VARCHAR(3) NULL AFTER currency;

-- =============================================================================
-- v10 — events
-- =============================================================================
CREATE TABLE IF NOT EXISTS events (
  id              CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  title           VARCHAR(200)  NOT NULL,
  slug            VARCHAR(220)  NOT NULL,
  description     TEXT          NULL,
  location        VARCHAR(255)  NULL,
  cover_image_url TEXT          NULL,
  starts_at       DATETIME      NOT NULL,
  ends_at         DATETIME      NULL,
  capacity        INT           NULL,
  price_mwk       DECIMAL(14,2) NOT NULL DEFAULT 0,
  is_free         TINYINT(1)    NOT NULL DEFAULT 0,
  status          ENUM('draft','published','cancelled') NOT NULL DEFAULT 'draft',
  created_by      CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_events_slug (slug),
  INDEX idx_events_status_starts (status, starts_at),
  CONSTRAINT fk_events_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_registrations (
  id                 CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  event_id           CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  user_id            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  status             ENUM('registered','cancelled') NOT NULL DEFAULT 'registered',
  payment_ledger_id  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  registered_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_registration (event_id, user_id),
  INDEX idx_event_registrations_user (user_id),
  CONSTRAINT fk_event_registrations_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_registrations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- v11 — travel credits (balances + transaction ledger)
-- =============================================================================
CREATE TABLE IF NOT EXISTS travel_credit (
  user_id     CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  balance_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_travel_credit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payment_ledger
  MODIFY payment_method ENUM('mobile_money','bank','card','hosted_checkout','travel_credit') NOT NULL;

CREATE TABLE IF NOT EXISTS travel_credit_transactions (
  id                 CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  entry_type         ENUM('credit','debit','adjustment') NOT NULL,
  amount_mwk         DECIMAL(14,2) NOT NULL,
  balance_after      DECIMAL(14,2) NOT NULL,
  description        VARCHAR(255) NOT NULL,
  reference          VARCHAR(100) NULL,
  application_id     CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  payment_ledger_id  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_by         CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tct_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tct_user (user_id, created_at),
  INDEX idx_tct_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- v12 — refresh_sessions (FK charset fix)
-- =============================================================================
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id                 CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  expires_at         DATETIME     NOT NULL,
  revoked_at         DATETIME     NULL,
  user_agent         VARCHAR(512) NULL,
  ip_address         VARCHAR(45)  NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_refresh_sessions_user (user_id),
  INDEX idx_refresh_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Inline patches (ensureSchemaPatches — not in numbered migration files)
-- =============================================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_schedule_log (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  report_type ENUM('weekly','monthly','quarterly','biannual','yearly','manual') NOT NULL,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  sent_to VARCHAR(255) NOT NULL,
  requested_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_report_log_type (report_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE flight_application_tickets ADD COLUMN file_path VARCHAR(512) NULL AFTER mime_type;
ALTER TABLE flight_application_tickets MODIFY file_data MEDIUMBLOB NULL;

CREATE TABLE IF NOT EXISTS destination_fun_facts (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  destination_key VARCHAR(64) NOT NULL,
  fact_text TEXT NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fun_facts_dest (destination_key, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fun_fact_deliveries (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  destination_key VARCHAR(64) NOT NULL,
  fun_fact_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  context ENUM('ticket_delivery','week_reminder','day_reminder') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ffd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ffd_user_dest (user_id, destination_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_departure_reminders (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  ticket_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  reminder_type ENUM('week_before','day_before') NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ticket_reminder (ticket_id, reminder_type),
  CONSTRAINT fk_tdr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX idx_tdr_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- v13 — Manual bank transfer payments
-- =============================================================================

CREATE TABLE IF NOT EXISTS manual_payment_sources (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(80) NOT NULL,
  branch_code VARCHAR(80) NULL,
  swift_code VARCHAR(40) NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'MWK',
  instructions TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mps_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payment_ledger MODIFY payment_method ENUM(
  'mobile_money','bank','card','hosted_checkout','travel_credit','manual_transfer'
) NOT NULL;

ALTER TABLE payment_ledger ADD COLUMN manual_reference VARCHAR(32) NULL AFTER bank_expires_at;
ALTER TABLE payment_ledger ADD COLUMN proof_file_path VARCHAR(512) NULL AFTER manual_reference;
ALTER TABLE payment_ledger ADD COLUMN proof_mime_type VARCHAR(100) NULL AFTER proof_file_path;
ALTER TABLE payment_ledger ADD COLUMN proof_submitted_at DATETIME NULL AFTER proof_mime_type;
ALTER TABLE payment_ledger ADD COLUMN proof_review_status ENUM('none','submitted','approved','rejected') NOT NULL DEFAULT 'none' AFTER proof_submitted_at;
ALTER TABLE payment_ledger ADD COLUMN proof_reviewed_at DATETIME NULL AFTER proof_review_status;
ALTER TABLE payment_ledger ADD COLUMN proof_reviewed_by CHAR(36) NULL AFTER proof_reviewed_at;
ALTER TABLE payment_ledger ADD COLUMN proof_rejection_reason VARCHAR(500) NULL AFTER proof_reviewed_by;

-- =============================================================================
-- Verify (optional — run separately)
-- =============================================================================
-- SHOW TABLES;
-- DESCRIBE travel_credit_transactions;
-- DESCRIBE payment_ledger;
