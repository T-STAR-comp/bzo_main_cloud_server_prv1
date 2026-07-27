-- Flight application workflow (v3)
USE biazo_travel;

CREATE TABLE IF NOT EXISTS flight_applications (
  id                    CHAR(36)      NOT NULL PRIMARY KEY,
  user_id               CHAR(36)      NOT NULL,
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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flight_application_tickets (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  application_id  CHAR(36)     NOT NULL,
  file_name       VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  file_data       MEDIUMBLOB   NOT NULL,
  uploaded_by     CHAR(36)     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_tickets_application FOREIGN KEY (application_id) REFERENCES flight_applications(id) ON DELETE CASCADE,
  INDEX idx_app_tickets_application (application_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flight_application_events (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  application_id  CHAR(36)     NOT NULL,
  event_type      VARCHAR(60)  NOT NULL,
  message         TEXT         NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_app_events_application FOREIGN KEY (application_id) REFERENCES flight_applications(id) ON DELETE CASCADE,
  INDEX idx_app_events_application (application_id)
) ENGINE=InnoDB;
