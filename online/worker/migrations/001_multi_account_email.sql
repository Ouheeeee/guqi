-- 一个邮箱可对应多个独立账户；邮箱不再唯一。
-- 执行一次即可；旧的 users 表和邮箱唯一索引会被替换。
ALTER TABLE users RENAME TO users_old_multi;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO users (id, email, display_name, password_hash, password_salt, password_iterations, created_at)
  SELECT id, email, display_name, password_hash, password_salt, password_iterations, created_at
  FROM users_old_multi;
DROP TABLE users_old_multi;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
