#!/usr/bin/env node
/**
 * Database initialization script for authentication system
 * Run this script when the database is accessible to create the required tables
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuración de PostgreSQL
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} else {
  pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
}

async function initializeDatabase() {
  try {
    console.log('🔄 Iniciando creación de tablas de autenticación...');
    
    // Leer el script SQL
    const sqlPath = path.join(__dirname, '..', 'sql', 'create_auth_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Ejecutar el script
    await pool.query(sql);
    
    console.log('✅ Tablas de autenticación creadas exitosamente');
    console.log('📋 Tablas creadas:');
    console.log('   - users (usuarios del sistema)');
    console.log('   - password_reset_tokens (tokens de recuperación)');
    console.log('');
    console.log('👤 Usuarios de prueba creados:');
    console.log('   - admin@rionegro.gov.ar (contraseña: admin123)');
    console.log('   - test@rionegro.gov.ar (contraseña: test123)');
    console.log('');
    console.log('🔐 Sistema de autenticación listo para usar');
    
  } catch (error) {
    console.error('❌ Error al inicializar la base de datos:', error);
    console.error('');
    console.error('Posibles causas:');
    console.error('- La base de datos no está accesible');
    console.error('- Las credenciales en .env son incorrectas');
    console.error('- Las tablas ya existen (esto es normal)');
    
    if (error.message.includes('already exists')) {
      console.log('');
      console.log('ℹ️  Las tablas ya existen. El sistema está listo.');
    }
  } finally {
    await pool.end();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  initializeDatabase();
}

module.exports = { initializeDatabase };