const { Pool } = require('./node_modules/pg');
require('./node_modules/dotenv').config();

async function testConnection() {
  try {
    console.log('Testing database connection...');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful!');
    console.log('Current time:', result.rows[0].now);
    
    // Test if users table exists
    try {
      const tableCheck = await pool.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')");
      console.log('Users table exists:', tableCheck.rows[0].exists);
    } catch (err) {
      console.log('Could not check users table:', err.message);
    }
    
    await pool.end();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
}

testConnection();