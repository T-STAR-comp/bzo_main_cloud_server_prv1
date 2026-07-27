USE biazo_travel;

ALTER TABLE flight_applications ADD COLUMN quote_line_items JSON NULL AFTER extra_charges_note;

ALTER TABLE payment_ledger
  MODIFY payment_method ENUM('mobile_money','bank','card','hosted_checkout') NOT NULL;
