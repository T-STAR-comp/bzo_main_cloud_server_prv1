-- Link completed applications to bookings
USE biazo_travel;
ALTER TABLE flight_applications ADD COLUMN booking_id CHAR(36) NULL AFTER completed_at;
