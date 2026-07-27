USE biazo_travel;

ALTER TABLE flight_applications ADD COLUMN hotel_request_details TEXT NULL AFTER need_hotel;
ALTER TABLE flight_applications ADD COLUMN car_rental_request_details TEXT NULL AFTER need_car_rental;
ALTER TABLE flight_applications ADD COLUMN quote_exchange_rates JSON NULL AFTER quote_line_items;
ALTER TABLE flight_applications ADD COLUMN paid_currency VARCHAR(3) NULL AFTER paid_at;
ALTER TABLE flight_applications ADD COLUMN paid_amount DECIMAL(14,2) NULL AFTER paid_currency;
ALTER TABLE flight_applications ADD COLUMN customer_display_currency VARCHAR(3) NULL AFTER paid_amount;

ALTER TABLE payment_ledger ADD COLUMN payment_amount DECIMAL(14,2) NULL AFTER amount_mwk;
ALTER TABLE payment_ledger ADD COLUMN display_currency VARCHAR(3) NULL AFTER currency;
