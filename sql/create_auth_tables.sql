-- Tables for authentication system
-- Users table for storing user credentials
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

-- Insert a default admin user (password: admin123)
-- Password hash for 'admin123' using bcrypt
INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) 
VALUES (
    'admin@rionegro.gov.ar', 
    '$2b$10$rqzKjF8Xj9lHfXK2HgTzquxjZJYyTGJlY8Ik1VJfGNHOYvIx7j2UK', 
    'Administrador', 
    'Sistema', 
    'admin', 
    true
) ON CONFLICT (email) DO NOTHING;

-- Insert a test user (password: test123)
INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) 
VALUES (
    'test@rionegro.gov.ar', 
    '$2b$10$8B3YkHmVYOKNR5JzjxJ9QOxJ7V5L8N9pBc2Q4WpE6Y8rL2O3x4M5j', 
    'Usuario', 
    'Prueba', 
    'user', 
    true
) ON CONFLICT (email) DO NOTHING;

-- Add to app_information_schema for system integration
INSERT INTO app_information_schema (
    table_name, column_name, data_type, is_nullable, 
    column_default, ordinal_position, max_length, 
    is_primary_key, is_foreign_key, foreign_table, foreign_column
) VALUES 
-- Users table schema
('users', 'id', 'integer', false, 'nextval(''users_id_seq''::regclass)', 1, null, true, false, null, null),
('users', 'email', 'character varying', false, null, 2, 255, false, false, null, null),
('users', 'password_hash', 'character varying', false, null, 3, 255, false, false, null, null),
('users', 'first_name', 'character varying', true, null, 4, 100, false, false, null, null),
('users', 'last_name', 'character varying', true, null, 5, 100, false, false, null, null),
('users', 'role', 'character varying', true, '''user''::character varying', 6, 50, false, false, null, null),
('users', 'is_active', 'boolean', true, 'true', 7, null, false, false, null, null),
('users', 'last_login', 'timestamp without time zone', true, null, 8, null, false, false, null, null),
('users', 'created_at', 'timestamp without time zone', true, 'CURRENT_TIMESTAMP', 9, null, false, false, null, null),
('users', 'updated_at', 'timestamp without time zone', true, 'CURRENT_TIMESTAMP', 10, null, false, false, null, null),

-- Password reset tokens table schema
('password_reset_tokens', 'id', 'integer', false, 'nextval(''password_reset_tokens_id_seq''::regclass)', 1, null, true, false, null, null),
('password_reset_tokens', 'user_id', 'integer', false, null, 2, null, false, true, 'users', 'id'),
('password_reset_tokens', 'token', 'character varying', false, null, 3, 255, false, false, null, null),
('password_reset_tokens', 'expires_at', 'timestamp without time zone', false, null, 4, null, false, false, null, null),
('password_reset_tokens', 'used', 'boolean', true, 'false', 5, null, false, false, null, null),
('password_reset_tokens', 'created_at', 'timestamp without time zone', true, 'CURRENT_TIMESTAMP', 6, null, false, false, null, null)

ON CONFLICT (table_name, column_name) DO NOTHING;

-- Add users and password_reset_tokens to table_categories for admin access
INSERT INTO table_categories (
    category_name, table_name, table_display_name, table_description,
    category_display_name, category_description, category_icon,
    table_order, is_active
) VALUES 
('administracion', 'users', 'Usuarios del Sistema', 'Gestión de usuarios y permisos de acceso al sistema', 
 'Administración', 'Gestión de usuarios y configuración del sistema', '⚙️', 1, true),
('administracion', 'password_reset_tokens', 'Tokens de Recuperación', 'Tokens para recuperación de contraseñas', 
 'Administración', 'Gestión de usuarios y configuración del sistema', '⚙️', 2, true)

ON CONFLICT (category_name, table_name) DO NOTHING;