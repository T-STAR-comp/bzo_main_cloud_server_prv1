USE biazo_travel;

-- Fix errno 150 on refresh_sessions: user_id must match users.id charset/collation.
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id                 CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  user_id            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  expires_at         DATETIME     NOT NULL,
  revoked_at         DATETIME     NULL,
  user_agent         VARCHAR(512) NULL,
  ip_address         VARCHAR(45)  NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_refresh_sessions_user (user_id),
  INDEX idx_refresh_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
