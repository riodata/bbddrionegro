-- SQL script to create user authentication tables
-- Run this script to set up the user management system

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- Insert a default admin user (password: admin123)
-- Password hash for 'admin123' using bcrypt
INSERT INTO users (email, password_hash, name, is_active)
VALUES ('admin@rionegro.gov.ar', '$2b$10$rOQdDvYPIRElD1gKXQAaE.kIhKmB8vN3LvGTr8yKGo4RvI0KEhLTK', 'Administrador', true)
ON CONFLICT (email) DO NOTHING;

-- Grant necessary permissions to koyeb_app_user for post-login operations
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO koyeb_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO koyeb_app_user;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO koyeb_app_user;
GRANT USAGE, SELECT ON SEQUENCE password_reset_tokens_id_seq TO koyeb_app_user;

-- Display created tables
SELECT 'Users table:' as info;
SELECT count(*) as user_count FROM users;

SELECT 'Password reset tokens table:' as info;
SELECT count(*) as token_count FROM password_reset_tokens;