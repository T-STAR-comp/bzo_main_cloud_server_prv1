USE biazo_travel;

ALTER TABLE flight_application_tickets
  ADD COLUMN ticket_record_id CHAR(36) NULL AFTER application_id,
  ADD COLUMN segment_order TINYINT NOT NULL DEFAULT 1 AFTER ticket_record_id;
