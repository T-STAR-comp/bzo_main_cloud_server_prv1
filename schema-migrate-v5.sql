USE biazo_travel;
ALTER TABLE tickets ADD COLUMN passenger_names VARCHAR(500) NULL AFTER user_id;
