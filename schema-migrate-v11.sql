USE biazo_travel;

ALTER TABLE payment_ledger
  MODIFY payment_method ENUM('mobile_money','bank','card','hosted_checkout','travel_credit') NOT NULL;

CREATE TABLE IF NOT EXISTS travel_credit_transactions (
  id                 CHAR(36)      NOT NULL PRIMARY KEY,
  user_id            CHAR(36)      NOT NULL,
  entry_type         ENUM('credit','debit','adjustment') NOT NULL,
  amount_mwk         DECIMAL(14,2) NOT NULL,
  balance_after      DECIMAL(14,2) NOT NULL,
  description        VARCHAR(255)  NOT NULL,
  reference          VARCHAR(100)  NULL,
  application_id     CHAR(36)      NULL,
  payment_ledger_id  CHAR(36)      NULL,
  created_by         CHAR(36)      NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tct_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tct_user (user_id, created_at),
  INDEX idx_tct_created (created_at)
) ENGINE=InnoDB;
