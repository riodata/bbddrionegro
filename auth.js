// auth.js (nuevo archivo para lógica de autenticación)

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Configuración del pool usando las mismas variables que server.js
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: {
    rejectUnauthorized: false  // Para SSL sin certificado local
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

exports.login = async function(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: "Email y contraseña requeridos." });
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1 AND activo = true', [email]);
    if (userRes.rows.length === 0) return res.status(401).json({ success: false, message: "Usuario o contraseña incorrectos." });
    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: "Usuario o contraseña incorrectos." });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, nombre: user.nombre } });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ success: false, message: "Error interno." });
  }
};

exports.register = async function(req, res) {
  const { email, password, nombre } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: "Email y contraseña requeridos." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, nombre) VALUES ($1, $2, $3) RETURNING id, email, nombre',
      [email, hash, nombre || null]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('Error en register:', err);
    if (err.code === '23505') return res.status(409).json({ success: false, message: "Ya existe un usuario con ese email." });
    res.status(500).json({ success: false, message: "Error interno." });
  }
};

exports.logout = function(req, res) {
  // Si usas JWT, solo se borra del frontend. Si tienes blacklist, agrega aquí.
  res.json({ success: true, message: "Sesión cerrada." });
};

exports.requireAuth = function(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ success: false, message: "Token requerido." });
  const token = header.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: "Token inválido o expirado." });
  }
};

exports.passwordResetConfirm = async function(req, res) {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ success: false, message: "Token y nueva contraseña requeridos." });
  try {
    // Buscar el token, verificar expiración y si ya fue usado
    const tokenRes = await pool.query('SELECT * FROM password_reset_tokens WHERE token = $1', [token]);
    if (tokenRes.rows.length === 0) return res.status(400).json({ success: false, message: "Token inválido." });
    const record = tokenRes.rows[0];
    if (record.usado) return res.status(400).json({ success: false, message: "Token ya utilizado." });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ success: false, message: "Token expirado." });
    // Actualizar contraseña del usuario
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, record.user_id]);
    await pool.query('UPDATE password_reset_tokens SET usado = true WHERE id = $1', [record.id]);
    res.json({ success: true, message: "Contraseña actualizada correctamente." });
  } catch (err) {
    console.error('Error en password reset confirm:', err);
    res.status(500).json({ success: false, message: "Error interno." });
  }
};
