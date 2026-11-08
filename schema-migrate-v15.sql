ALTER TABLE flight_applications
  ADD COLUMN profit_amount_mwk DECIMAL(14,2) NULL DEFAULT NULL AFTER extra_charges_mwk;
