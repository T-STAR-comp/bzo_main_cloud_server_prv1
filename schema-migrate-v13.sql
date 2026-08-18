-- Manual bank transfer payments (when USE_PAYMENT_GATEWAY=false)

CREATE TABLE IF NOT EXISTS manual_payment_sources (
  id CHAR(36) NOT NULL PRIMARY KEY,
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
) ENGINE=InnoDB;

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
