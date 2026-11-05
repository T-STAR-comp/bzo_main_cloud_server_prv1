ALTER TABLE users MODIFY role ENUM('user','admin','agent') NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS commission_agents (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  agent_code VARCHAR(32) NOT NULL UNIQUE,
  referral_link VARCHAR(512) NOT NULL,
  status ENUM('active','paused','suspended') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_by_admin CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_commission_agents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_commission_agents_status (status),
  INDEX idx_commission_agents_code (agent_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commission_agent_records (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  agent_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  application_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  sale_amount_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  commission_amount_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  sale_date DATETIME NOT NULL,
  source ENUM('checkout','manual','adjustment') NOT NULL DEFAULT 'checkout',
  source_reference VARCHAR(120) NULL,
  note TEXT NULL,
  created_by_admin CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_records_agent FOREIGN KEY (agent_id) REFERENCES commission_agents(id) ON DELETE CASCADE,
  INDEX idx_agent_records_agent_date (agent_id, sale_date),
  INDEX idx_agent_records_user (user_id),
  UNIQUE KEY uq_agent_record_application (application_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commission_agent_redemptions (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  agent_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  amount_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  note TEXT NULL,
  created_by_admin CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_redemptions_agent FOREIGN KEY (agent_id) REFERENCES commission_agents(id) ON DELETE CASCADE,
  INDEX idx_agent_redemptions_agent (agent_id, created_at)
) ENGINE=InnoDB;

ALTER TABLE flight_applications
  ADD COLUMN agent_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER user_id,
  ADD COLUMN agent_code VARCHAR(32) NULL AFTER agent_id,
  ADD COLUMN agent_commission_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER agent_code;
