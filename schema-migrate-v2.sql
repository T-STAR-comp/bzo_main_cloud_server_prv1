USE biazo_travel;

ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL UNIQUE AFTER email;
ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER nationality;
ALTER TABLE users ADD COLUMN status ENUM('active','suspended','pending','flagged') NOT NULL DEFAULT 'active' AFTER role;
ALTER TABLE users ADD COLUMN admin_notes TEXT NULL AFTER status;
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER admin_notes;

ALTER TABLE bookings ADD COLUMN flight_departure_id CHAR(36) NULL AFTER user_id;

ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_departure FOREIGN KEY (flight_departure_id) REFERENCES flight_departures(id) ON DELETE SET NULL;
