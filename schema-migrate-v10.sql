USE biazo_travel;

CREATE TABLE IF NOT EXISTS events (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
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
  created_by      CHAR(36)      NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_events_slug (slug),
  INDEX idx_events_status_starts (status, starts_at),
  CONSTRAINT fk_events_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_registrations (
  id                 CHAR(36)  NOT NULL PRIMARY KEY,
  event_id           CHAR(36)  NOT NULL,
  user_id            CHAR(36)  NOT NULL,
  status             ENUM('registered','cancelled') NOT NULL DEFAULT 'registered',
  payment_ledger_id  CHAR(36)  NULL,
  registered_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_registration (event_id, user_id),
  INDEX idx_event_registrations_user (user_id),
  CONSTRAINT fk_event_registrations_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_registrations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
