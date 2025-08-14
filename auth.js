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
    rejectUnauthorized: false
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Función auxiliar para actualizar último acceso
async function updateLastAccess(userId) {
  try {
    await pool.query(
      'UPDATE users SET fecha_ultimo_acceso = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );
  } catch (error) {
    console.error('Error actualizando último acceso:', error);
  }
}

// Función auxiliar para verificar y actualizar estado activo
async function checkAndUpdateActiveStatus(userId) {
  try {
    const result = await pool.query(
      `UPDATE users 
       SET activo = CASE 
         WHEN fecha_vencimiento > CURRENT_TIMESTAMP THEN true 
         ELSE false 
       END 
       WHERE id = $1 
       RETURNING activo`,
      [userId]
    );
    return result.rows[0]?.activo || false;
  } catch (error) {
    console.error('Error verificando estado activo:', error);
    return false;
  }
}

exports.login = async function(req, res) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      message: "Email y contraseña requeridos." 
    });
  }

  try {
    // Buscar usuario por email
    const userRes = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: "Usuario o contraseña incorrectos." 
      });
    }

    const user = userRes.rows[0];

    // Verificar contraseña
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ 
        success: false, 
        message: "Usuario o contraseña incorrectos." 
      });
    }

    // Verificar y actualizar estado activo
    const isActive = await checkAndUpdateActiveStatus(user.id);
    
    if (!isActive) {
      return res.status(401).json({ 
        success: false, 
        message: "Usuario inactivo. Contacte al administrador." 
      });
    }

    // Actualizar fecha de último acceso
    await updateLastAccess(user.id);

    // Generar token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        rol: user.rol,
        nombre_apellido: user.nombre_apellido
      }, 
      JWT_SECRET, 
      { expiresIn: '12h' }
    );

    console.log('✅ Login exitoso para:', user.email);

    res.json({ 
      success: true, 
      token, 
      user: { 
        id: user.id, 
        email: user.email, 
        nombre_apellido: user.nombre_apellido,
        telefono: user.telefono,
        rol: user.rol,
        fecha_ultimo_acceso: new Date().toISOString()
      } 
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ 
      success: false, 
      message: "Error interno del servidor." 
    });
  }
};

exports.register = async function(req, res) {
  const { nombre_apellido, telefono, email, password, confirmPassword } = req.body;
  
  // Validaciones básicas
  if (!nombre_apellido || !email || !password || !confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: "Todos los campos obligatorios son requeridos." 
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: "Las contraseñas no coinciden." 
    });
  }

  if (password.length < 8) {
    return res.status(400).json({ 
      success: false, 
      message: "La contraseña debe tener al menos 8 caracteres." 
    });
  }

  // Validar formato de email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      success: false, 
      message: "Formato de email inválido." 
    });
  }

  try {
    // Verificar si el email ya existe
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: "Ya existe un usuario con ese email." 
      });
    }

    // Generar hash de la contraseña
    const hash = await bcrypt.hash(password, 12);
    
    // Insertar nuevo usuario
    const result = await pool.query(`
      INSERT INTO users (
        nombre_apellido, 
        telefono, 
        email, 
        password_hash, 
        rol
      ) VALUES ($1, $2, $3, $4, $5) 
      RETURNING id, nombre_apellido, telefono, email, rol, fecha_creacion, activo
    `, [
      nombre_apellido.trim(),
      telefono?.trim() || null,
      email.toLowerCase().trim(),
      hash,
      'empleado'
    ]);

    const newUser = result.rows[0];

    res.status(201).json({ 
      success: true, 
      message: "Usuario registrado exitosamente.",
      user: {
        id: newUser.id,
        nombre_apellido: newUser.nombre_apellido,
        telefono: newUser.telefono,
        email: newUser.email,
        rol: newUser.rol,
        fecha_creacion: newUser.fecha_creacion,
        activo: newUser.activo
      }
    });

  } catch (err) {
    console.error('Error en register:', err);
    
    if (err.code === '23505') {
      return res.status(409).json({ 
        success: false, 
        message: "Ya existe un usuario con ese email." 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: "Error interno del servidor." 
    });
  }
};

exports.logout = function(req, res) {
  res.json({ 
    success: true, 
    message: "Sesión cerrada correctamente." 
  });
};

// 🔧 MIDDLEWARE DE AUTENTICACIÓN CORREGIDO
exports.requireAuth = function(req, res, next) {
  // Intentar obtener el token de diferentes formas
  let token = null;
  
  // 1. Desde el header Authorization (con mayúscula)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7); // Remover "Bearer "
    } else {
      token = authHeader; // Por si viene sin "Bearer "
    }
  }
  
  // 2. Desde el query parameter (fallback)
  if (!token && req.query.token) {
    token = req.query.token;
  }
  
  // 3. Desde el body (fallback)
  if (!token && req.body.token) {
    token = req.body.token;
  }
  
  console.log('🔐 Verificando token de autenticación...');
  console.log('📋 Headers recibidos:', {
    authorization: req.headers['authorization'],
    Authorization: req.headers['Authorization'],
    'content-type': req.headers['content-type']
  });
  console.log('🎟️ Token encontrado:', token ? 'SÍ' : 'NO');
  
  if (!token) {
    console.error('❌ No se encontró token de autenticación');
    return res.status(401).json({ 
      success: false, 
      message: "Token de autenticación requerido." 
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token válido para usuario:', decoded.email);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Error verificando token:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token expirado. Por favor inicia sesión nuevamente." 
      });
    } else if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token inválido." 
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: "Error de autenticación." 
      });
    }
  }
};

exports.requireAdmin = function(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') {
    console.log('❌ Acceso denegado - No es admin:', req.user?.email);
    return res.status(403).json({ 
      success: false, 
      message: "Se requieren permisos de administrador." 
    });
  }
  console.log('✅ Acceso admin concedido a:', req.user.email);
  next();
};

exports.passwordResetConfirm = async function(req, res) {
  const { token, password, confirmPassword } = req.body;
  
  if (!token || !password || !confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: "Token, nueva contraseña y confirmación requeridos." 
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: "Las contraseñas no coinciden." 
    });
  }

  if (password.length < 8) {
    return res.status(400).json({ 
      success: false, 
      message: "La contraseña debe tener al menos 8 caracteres." 
    });
  }

  try {
    // Buscar el token
    const tokenRes = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND usado = false',
      [token]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Token inválido o ya utilizado." 
      });
    }

    const tokenRecord = tokenRes.rows[0];

    // Verificar expiración
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: "Token expirado." 
      });
    }

    // Actualizar contraseña del usuario
    const hash = await bcrypt.hash(password, 12);
    
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, tokenRecord.user_id]
    );

    // Marcar token como usado
    await pool.query(
      'UPDATE password_reset_tokens SET usado = true WHERE id = $1',
      [tokenRecord.id]
    );

    res.json({ 
      success: true, 
      message: "Contraseña actualizada correctamente." 
    });

  } catch (err) {
    console.error('Error en password reset confirm:', err);
    res.status(500).json({ 
      success: false, 
      message: "Error interno del servidor." 
    });
  }
};

// Función para limpiar usuarios vencidos (puede ejecutarse periódicamente)
exports.cleanExpiredUsers = async function() {
  try {
    const result = await pool.query(`
      UPDATE users 
      SET activo = false 
      WHERE fecha_vencimiento <= CURRENT_TIMESTAMP 
      AND activo = true
      RETURNING id, email, nombre_apellido
    `);

    if (result.rows.length > 0) {
      console.log(`🔄 Usuarios desactivados por vencimiento: ${result.rows.length}`);
      result.rows.forEach(user => {
        console.log(`- ${user.nombre_apellido} (${user.email})`);
      });
    }

    return result.rows.length;
  } catch (error) {
    console.error('Error limpiando usuarios vencidos:', error);
    return 0;
  }
};

// 🆕 Función de debugging para verificar autenticación
exports.debugAuth = function(req, res, next) {
  console.log('🔍 DEBUG AUTH - Headers:', req.headers);
  console.log('🔍 DEBUG AUTH - Method:', req.method);
  console.log('🔍 DEBUG AUTH - URL:', req.url);
  console.log('🔍 DEBUG AUTH - Body:', req.body);
  next();
};
