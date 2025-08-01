-- Database schema for authentication system
-- Run this SQL script to create the required tables for user authentication

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    ultimo_ingreso TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Password reset tokens table  
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- Insert a default admin user (password: admin123)
-- The password hash is for 'admin123' using bcrypt with 10 rounds
INSERT INTO users (email, password_hash, is_active) 
VALUES ('admin@gobierno.rionegro.gov.ar', '$2b$10$9vKyKh.s6Kx.qz1k2S0Yy.VwXjKJ1jQwYtZt2K3Z.t3nP2kKvH5F6', true)
ON CONFLICT (email) DO NOTHING;

-- Create database user for post-login operations if it doesn't exist
-- Note: This user should have limited permissions for security
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'koyeb_app_user') THEN
        CREATE USER koyeb_app_user WITH ENCRYPTED PASSWORD 'secure_app_password_2024';
    END IF;
END
$$;

-- Grant appropriate permissions to koyeb_app_user
GRANT USAGE ON SCHEMA public TO koyeb_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO koyeb_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koyeb_app_user;

-- Ensure future tables also get these permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO koyeb_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO koyeb_app_user;

-- Add users table to the app_information_schema if it exists and is used
-- This allows the dynamic table system to recognize the users table
INSERT INTO app_information_schema (
    table_name, 
    column_name, 
    data_type, 
    is_nullable, 
    column_default, 
    ordinal_position, 
    max_length, 
    is_primary_key, 
    is_foreign_key, 
    foreign_table, 
    foreign_column
) VALUES 
    ('users', 'id', 'integer', false, 'nextval(''users_id_seq''::regclass)', 1, NULL, true, false, NULL, NULL),
    ('users', 'email', 'character varying', false, NULL, 2, 255, false, false, NULL, NULL),
    ('users', 'password_hash', 'character varying', false, NULL, 3, 255, false, false, NULL, NULL),
    ('users', 'ultimo_ingreso', 'timestamp with time zone', true, NULL, 4, NULL, false, false, NULL, NULL),
    ('users', 'created_at', 'timestamp with time zone', true, 'CURRENT_TIMESTAMP', 5, NULL, false, false, NULL, NULL),
    ('users', 'is_active', 'boolean', true, 'true', 6, NULL, false, false, NULL, NULL)
ON CONFLICT DO NOTHING;

-- Add password_reset_tokens table to the app_information_schema  
INSERT INTO app_information_schema (
    table_name, 
    column_name, 
    data_type, 
    is_nullable, 
    column_default, 
    ordinal_position, 
    max_length, 
    is_primary_key, 
    is_foreign_key, 
    foreign_table, 
    foreign_column
) VALUES 
    ('password_reset_tokens', 'id', 'integer', false, 'nextval(''password_reset_tokens_id_seq''::regclass)', 1, NULL, true, false, NULL, NULL),
    ('password_reset_tokens', 'user_id', 'integer', false, NULL, 2, NULL, false, true, 'users', 'id'),
    ('password_reset_tokens', 'token', 'character varying', false, NULL, 3, 255, false, false, NULL, NULL),
    ('password_reset_tokens', 'expires_at', 'timestamp with time zone', false, NULL, 4, NULL, false, false, NULL, NULL),
    ('password_reset_tokens', 'used_at', 'timestamp with time zone', true, NULL, 5, NULL, false, false, NULL, NULL),
    ('password_reset_tokens', 'created_at', 'timestamp with time zone', true, 'CURRENT_TIMESTAMP', 6, NULL, false, false, NULL, NULL)
ON CONFLICT DO NOTHING;

-- Add user management to table_categories for admin access
INSERT INTO table_categories (
    category_name,
    category_display_name, 
    category_description,
    category_icon,
    table_name,
    table_display_name,
    table_description,
    table_order,
    is_active
) VALUES 
    ('admin', 'Administración', 'Gestión de usuarios y configuración del sistema', '⚙️', 'users', 'Usuarios del Sistema', 'Gestión de usuarios con acceso al sistema', 1, true)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE users IS 'Tabla de usuarios del sistema con autenticación';
COMMENT ON TABLE password_reset_tokens IS 'Tokens para recuperación de contraseñas con expiración';