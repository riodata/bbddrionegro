// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Validar variables de entorno para PostgreSQL
if (!process.env.DATABASE_URL && 
    (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD)) {
  console.error('❌ Error: Se requiere DATABASE_URL o las variables DB_HOST, DB_NAME, DB_USER, DB_PASSWORD');
  console.error('Verifica tu archivo .env');
  process.exit(1);
}

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

// Pool para operaciones de aplicación (usado después del login)
let appPool;
if (process.env.APP_DB_USER && process.env.APP_DB_PASSWORD) {
  if (process.env.DATABASE_URL) {
    const dbUrl = new URL(process.env.DATABASE_URL);
    dbUrl.username = process.env.APP_DB_USER;
    dbUrl.password = process.env.APP_DB_PASSWORD;
    appPool = new Pool({
      connectionString: dbUrl.toString(),
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  } else {
    appPool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.APP_DB_USER,
      password: process.env.APP_DB_PASSWORD,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
}

// Configuración de email para recuperación de contraseñas
let emailTransporter;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// Función para obtener el pool apropiado (app pool si está disponible, sino pool principal)
function getActivePool() {
  return appPool || pool;
}

const app = express();
const PORT = process.env.PORT || 8000;

// ========== FUNCIONES PARA METADATOS DINÁMICOS CON CATEGORÍAS ==========

// ========== FUNCIONES DE AUTENTICACIÓN ==========

// Función para generar JWT
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email 
    },
    process.env.JWT_SECRET || 'default-secret-change-in-production',
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

// Middleware de autenticación
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de acceso requerido'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production', (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }
    
    req.user = user;
    next();
  });
}

// Función para generar token de recuperación
function generateResetToken() {
  return jwt.sign(
    { purpose: 'password-reset', timestamp: Date.now() },
    process.env.JWT_SECRET || 'default-secret-change-in-production',
    { expiresIn: '1h' }
  );
}

// Función para enviar email de recuperación
async function sendPasswordResetEmail(email, resetToken) {
  if (!emailTransporter) {
    throw new Error('Configuración de email no disponible');
  }

  const resetLink = `${process.env.APP_BASE_URL || 'http://localhost:8000'}/reset-password?token=${resetToken}`;
  
  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'Sistema de Gestión'}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: 'Recuperación de Contraseña - Sistema de Gestión',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4a90e2;">Recuperación de Contraseña</h2>
        <p>Has solicitado recuperar tu contraseña para el Sistema de Gestión del Gobierno de Río Negro.</p>
        <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="background-color: #4a90e2; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;">
            Restablecer Contraseña
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">
          Este enlace es válido por 1 hora. Si no solicitaste este cambio, puedes ignorar este email.
        </p>
        <p style="color: #666; font-size: 14px;">
          Si tienes problemas con el enlace, copia y pega esta URL en tu navegador:<br>
          <span style="word-break: break-all;">${resetLink}</span>
        </p>
      </div>
    `
  };

  await emailTransporter.sendMail(mailOptions);
}

// ========== FUNCIONES PARA METADATOS DINÁMICOS CON CATEGORÍAS (CONTINÚA) ==========

// Obtener todas las categorías disponibles
async function getCategories() {
  try {
    const query = `
      SELECT DISTINCT 
        category_name,
        category_display_name,
        category_description,
        category_icon
      FROM table_categories 
      WHERE is_active = true
      ORDER BY category_name
    `;
    
    const result = await getActivePool().query(query);
    return result.rows;
  } catch (error) {
    console.error('Error obteniendo categorías:', error);
    throw error;
  }
}

// Obtener tablas de una categoría específica
async function getTablesByCategory(categoryName) {
  try {
    const query = `
      SELECT 
        table_name,
        table_display_name,
        table_description,
        table_order
      FROM table_categories 
      WHERE category_name = $1 AND is_active = true
      ORDER BY table_order
    `;
    
    const result = await getActivePool().query(query, [categoryName]);
    return result.rows;
  } catch (error) {
    console.error(`Error obteniendo tablas para categoría ${categoryName}:`, error);
    throw error;
  }
}

// Obtener todas las tablas disponibles desde app_information_schema
async function getDynamicTables() {
  try {
    const query = `
      SELECT DISTINCT table_name 
      FROM app_information_schema 
      WHERE table_name NOT IN ('app_information_schema', 'table_categories')
      ORDER BY table_name
    `;
    
    const result = await getActivePool().query(query);
    return result.rows.map(row => row.table_name);
  } catch (error) {
    console.error('Error obteniendo tablas desde app_information_schema:', error);
    throw error;
  }
}

// Obtener esquema completo de una tabla desde app_information_schema
async function getTableSchema(tableName) {
  try {
    const query = `
      SELECT 
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
      FROM app_information_schema 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `;

    const result = await getActivePool().query(query, [tableName]);
    const columns = result.rows;

    if (!columns || columns.length === 0) {
      throw new Error(`No se encontraron columnas para la tabla '${tableName}'`);
    }

    // Encontrar la clave primaria
    const primaryKeyColumn = columns.find(col => col.is_primary_key === true);
    const primaryKey = primaryKeyColumn ? primaryKeyColumn.column_name : columns[0].column_name;

    // Convertir el formato para mantener compatibilidad con el frontend
    const formattedColumns = columns.map(col => ({
      column_name: col.column_name,
      data_type: col.data_type,
      is_nullable: col.is_nullable ? 'YES' : 'NO',
      column_default: col.column_default,
      ordinal_position: col.ordinal_position,
      character_maximum_length: col.max_length,
      is_primary_key: col.is_primary_key,
      is_foreign_key: col.is_foreign_key,
      foreign_table: col.foreign_table,
      foreign_column: col.foreign_column
    }));

    return {
      tableName,
      columns: formattedColumns,
      primaryKey: primaryKey,
      displayName: tableName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    };
  } catch (error) {
    console.error(`Error obteniendo esquema de ${tableName} desde app_information_schema:`, error);
    throw error;
  }
}

// Validar que una tabla existe usando app_information_schema
async function validateTableAccess(tableName) {
  try {
    const query = `
      SELECT table_name 
      FROM app_information_schema 
      WHERE table_name = $1 
      LIMIT 1
    `;
    
    const result = await getActivePool().query(query, [tableName]);

    if (result.rows.length === 0) {
      throw new Error(`Tabla '${tableName}' no encontrada en app_information_schema`);
    }

    return true;
  } catch (error) {
    console.error(`Error validando acceso a tabla ${tableName}:`, error);
    throw error;
  }
}

// Obtener campos de una tabla para búsqueda (usando app_information_schema)
async function getTableFields(tableName) {
  try {
    const query = `
      SELECT column_name, data_type, is_primary_key 
      FROM app_information_schema 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `;
    
    const result = await getActivePool().query(query, [tableName]);
    return result.rows;
  } catch (error) {
    console.error(`Error obteniendo campos de ${tableName}:`, error);
    throw error;
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para logging
const logOperation = (operation, data) => {
  console.log(`🔄 ${operation}:`, JSON.stringify(data, null, 2));
};

// Función auxiliar para manejo de errores de PostgreSQL
const handlePostgresError = (error, operation) => {
  console.error(`❌ Error en ${operation}:`, error);
  
  if (error.code === '23505') {
    return { status: 409, message: 'Ya existe un registro con esos datos' };
  }
  
  if (error.code === '23503') {
    return { status: 400, message: 'Error de referencia: algunos datos relacionados no existen' };
  }
  
  if (error.code === 'ECONNREFUSED') {
    return { status: 503, message: 'Error de conexión con la base de datos' };
  }
  
  return { status: 500, message: error.message || 'Error interno del servidor' };
};

// Ruta principal para servir el frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== RUTAS DE AUTENTICACIÓN ==========

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos'
      });
    }

    // Buscar usuario por email
    const userQuery = 'SELECT * FROM users WHERE email = $1 AND is_active = true';
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado. Contacte a su superior para obtener acceso al sistema.'
      });
    }

    const user = userResult.rows[0];

    // Verificar contraseña
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña incorrecta',
        showPasswordRecovery: true
      });
    }

    // Actualizar último ingreso
    await pool.query(
      'UPDATE users SET ultimo_ingreso = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generar token JWT
    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        ultimo_ingreso: user.ultimo_ingreso
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Solicitar recuperación de contraseña
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email es requerido'
      });
    }

    // Verificar si el usuario existe
    const userQuery = 'SELECT * FROM users WHERE email = $1 AND is_active = true';
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      // Por seguridad, no revelar si el email existe o no
      return res.json({
        success: true,
        message: 'Si el email existe en nuestro sistema, recibirás instrucciones para recuperar tu contraseña.'
      });
    }

    const user = userResult.rows[0];

    // Generar token de recuperación
    const resetToken = generateResetToken();

    // Guardar token en base de datos
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, new Date(Date.now() + 60 * 60 * 1000)] // 1 hora
    );

    // Enviar email
    try {
      await sendPasswordResetEmail(email, resetToken);
    } catch (emailError) {
      console.error('Error enviando email:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Error al enviar el email de recuperación. Contacte al administrador.'
      });
    }

    res.json({
      success: true,
      message: 'Se ha enviado un email con instrucciones para recuperar tu contraseña.'
    });

  } catch (error) {
    console.error('Error en forgot-password:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Verificar token de recuperación
app.get('/api/auth/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Verificar token en base de datos
    const tokenQuery = `
      SELECT rt.*, u.email 
      FROM password_reset_tokens rt 
      JOIN users u ON rt.user_id = u.id 
      WHERE rt.token = $1 AND rt.expires_at > CURRENT_TIMESTAMP AND rt.used_at IS NULL
    `;
    
    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }

    // Verificar JWT
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production');
    } catch (jwtError) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }

    res.json({
      success: true,
      message: 'Token válido',
      email: tokenResult.rows[0].email
    });

  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Cambiar contraseña con token de recuperación
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token y nueva contraseña son requeridos'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Verificar token en base de datos
    const tokenQuery = `
      SELECT rt.*, u.id as user_id 
      FROM password_reset_tokens rt 
      JOIN users u ON rt.user_id = u.id 
      WHERE rt.token = $1 AND rt.expires_at > CURRENT_TIMESTAMP AND rt.used_at IS NULL
    `;
    
    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }

    const tokenData = tokenResult.rows[0];

    // Hash de la nueva contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar contraseña del usuario
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, tokenData.user_id]
    );

    // Marcar token como usado
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [tokenData.id]
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });

  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Verificar token JWT (para validar sesión)
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token válido',
    user: req.user
  });
});

// Logout (invalidar token - opcional, ya que JWT es stateless)
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Sesión cerrada exitosamente'
  });
});

// Ruta para servir página de recuperación de contraseña
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// ========== FUNCIONES PARA ENUMS ==========

// Obtener valores de un enum específico
async function getEnumValues(enumName) {
  try {
    const query = `
      SELECT unnest(enum_range(NULL::${enumName})) as enum_value
    `;
    
    const result = await getActivePool().query(query);
    return result.rows.map(row => row.enum_value);
  } catch (error) {
    console.error(`Error obteniendo valores de enum ${enumName}:`, error);
    return [];
  }
}

// Obtener todos los enums para dropdowns
async function getAllEnumOptions() {
  try {
    const enumTypes = [
      'tipo',
      'subtipo', 
      'tipo_asamblea',
      'tipo_financiamiento',
      'autoridades',
      'departamento',
      'localidad'
    ];

    const enumPromises = enumTypes.map(async (enumType) => {
      try {
        const values = await getEnumValues(enumType);
        return [enumType, values];
      } catch (error) {
        console.log(`Enum ${enumType} no existe, saltando...`);
        return [enumType, []];
      }
    });

    const results = await Promise.all(enumPromises);
    
    const enumOptions = {};
    results.forEach(([enumType, values]) => {
      enumOptions[enumType] = values;
    });

    return enumOptions;
  } catch (error) {
    console.error('Error obteniendo todas las opciones de enum:', error);
    throw error;
  }
}

// Endpoint para obtener opciones de dropdowns
app.get('/api/enum-options', authenticateToken, async (req, res) => {
  try {
    const options = await getAllEnumOptions();
    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    console.error('Error en /api/enum-options:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo opciones de dropdowns',
      details: error.message
    });
  }
});

// Endpoint para obtener un enum específico
app.get('/api/enum-options/:enumName', authenticateToken, async (req, res) => {
  try {
    const { enumName } = req.params;
    const values = await getEnumValues(enumName);
    res.json({
      success: true,
      data: values
    });
  } catch (error) {
    console.error(`Error obteniendo enum ${req.params.enumName}:`, error);
    res.status(500).json({
      success: false,
      error: `Error obteniendo opciones para ${req.params.enumName}`,
      details: error.message
    });
  }
});

// ========== ENDPOINTS PARA CATEGORÍAS ==========

// Obtener todas las categorías disponibles
app.get('/api/categories', authenticateToken, async (req, res) => {
  try {
    const categories = await getCategories();
    
    res.json({
      success: true,
      categories: categories.map(cat => ({
        id: cat.category_name,
        name: cat.category_name,
        displayName: cat.category_display_name,
        description: cat.category_description,
        icon: cat.category_icon || '📊'
      })),
      total: categories.length
    });
  } catch (error) {
    console.error('Error obteniendo categorías:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las categorías disponibles',
      error: error.message
    });
  }
});

// Obtener tablas de una categoría específica
app.get('/api/categories/:categoryName/tables', authenticateToken, async (req, res) => {
  try {
    const { categoryName } = req.params;
    const tables = await getTablesByCategory(categoryName);
    
    if (tables.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No se encontraron tablas para la categoría '${categoryName}'`
      });
    }
    
    res.json({
      success: true,
      category: categoryName,
      tables: tables.map(table => ({
        id: table.table_name,
        name: table.table_name,
        displayName: table.table_display_name,
        description: table.table_description,
        order: table.table_order
      })),
      total: tables.length
    });
  } catch (error) {
    console.error(`Error obteniendo tablas para categoría ${req.params.categoryName}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las tablas de la categoría',
      error: error.message
    });
  }
});

// Obtener esquema de una tabla específica
app.get('/api/tables/:tableName/schema', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Verificar que la tabla existe
    const availableTables = await getDynamicTables();
    if (!availableTables.includes(tableName)) {
      return res.status(404).json({
        success: false,
        message: `Tabla '${tableName}' no encontrada`,
        error: `Tabla '${tableName}' no encontrada`
      });
    }
    
    const schema = await getTableSchema(tableName);
    
    res.json({
      success: true,
      schema: schema
    });
  } catch (error) {
    console.error(`Error obteniendo esquema de ${req.params.tableName}:`, error);
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({
      success: false,
      message: error.message,
      error: error.message
    });
  }
});

// ENDPOINTS DINÁMICOS PARA OPERACIONES CRUD

// CREATE - Crear nuevo registro
app.post('/api/tables/:tableName/create', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const data = req.body;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('CREATE REQUEST', { tableName, data });

    // Construir query de inserción
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`);
    
    const insertQuery = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await getActivePool().query(insertQuery, values);
    const newRecord = result.rows[0];
    
    logOperation('CREATE SUCCESS', newRecord);
    
    res.json({
      success: true,
      message: 'Registro creado exitosamente',
      primaryKey: newRecord[primaryKey],
      data: newRecord
    });
  } catch (error) {
    console.error('❌ Error inesperado en CREATE:', error);
    const errorInfo = handlePostgresError(error, 'creación de registro');
    res.status(errorInfo.status).json({
      success: false,
      message: errorInfo.message
    });
  }
});

// READ - Leer todos los registros
app.get('/api/tables/:tableName/read', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('READ REQUEST', { tableName });

    const query = `SELECT * FROM ${tableName} ORDER BY ${primaryKey} ASC`;
    const result = await getActivePool().query(query);

    // Mapear datos para mantener compatibilidad con el frontend
    const mappedData = result.rows.map((record, index) => ({
      _primaryKey: record[primaryKey],
      ...record,
      _rowIndex: index + 1
    }));

    logOperation('READ SUCCESS', `${mappedData.length} registros encontrados`);

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length,
      primaryKey: primaryKey,
      tableName: tableName
    });
  } catch (error) {
    console.error('❌ Error inesperado en READ:', error);
    const errorInfo = handlePostgresError(error, 'lectura de registros');
    res.status(errorInfo.status).json({
      success: false,
      message: errorInfo.message
    });
  }
});

// SEARCH - Búsqueda simple
app.get('/api/tables/:tableName/search', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { searchText, searchField } = req.query;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('SEARCH REQUEST', { tableName, searchText, searchField });

    let query = `SELECT * FROM ${tableName}`;
    let queryParams = [];

    // Aplicar filtro si existe
    if (searchText && searchField) {
      query += ` WHERE ${searchField} ILIKE $1`;
      queryParams.push(`%${searchText}%`);
    }

    query += ` ORDER BY ${primaryKey} ASC`;

    const result = await getActivePool().query(query, queryParams);

    // Mapear datos para mantener compatibilidad
    const mappedData = result.rows.map((record, index) => ({
      _primaryKey: record[primaryKey],
      ...record,
      _rowIndex: index + 1
    }));

    logOperation('SEARCH SUCCESS', `${mappedData.length} registros encontrados`);

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length,
      searchText: searchText || null,
      searchField: searchField || null,
      primaryKey: primaryKey
    });
  } catch (error) {
    console.error('❌ Error inesperado en SEARCH:', error);
    const errorInfo = handlePostgresError(error, 'búsqueda de registros');
    res.status(errorInfo.status).json({
      success: false,
      message: errorInfo.message
    });
  }
});

app.get('/api/tables/:tableName/fields', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    
    await validateTableAccess(tableName);
    const fields = await getTableFields(tableName);
    
    logOperation('FIELDS REQUEST', { tableName });

    res.json({
      success: true,
      fields: fields.map(field => ({
        name: field.column_name,
        type: field.data_type,
        isPrimaryKey: field.is_primary_key
      })),
      total: fields.length
    });
  } catch (error) {
    console.error('❌ Error inesperado en FIELDS:', error);
    const errorInfo = handlePostgresError(error, 'obtención de campos');
    res.status(errorInfo.status).json({
      success: false,
      message: errorInfo.message
    });
  }
});

// UPDATE - Actualizar registro
app.put('/api/tables/:tableName/update', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { searchCriteria, updateData } = req.body;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('UPDATE REQUEST', { tableName, searchCriteria, updateData });
    
    if (!searchCriteria || !searchCriteria.field || searchCriteria.value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido'
      });
    }

    // Limpiar updateData de campos internos
    const cleanUpdateData = { ...updateData };
    delete cleanUpdateData._rowIndex;
    delete cleanUpdateData._primaryKey;

    // Construir query de actualización
    const updateColumns = Object.keys(cleanUpdateData);
    const updateValues = Object.values(cleanUpdateData);
    const setClause = updateColumns.map((col, index) => `${col} = $${index + 1}`).join(', ');
    
    const updateQuery = `
      UPDATE ${tableName} 
      SET ${setClause}
      WHERE ${searchCriteria.field} = $${updateValues.length + 1}
      RETURNING *
    `;

    const result = await getActivePool().query(updateQuery, [...updateValues, searchCriteria.value]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Registro no encontrado con ${searchCriteria.field}=${searchCriteria.value}`
      });
    }

    const updatedRecord = result.rows[0];
    logOperation('UPDATE SUCCESS', updatedRecord);

    res.json({
      success: true,
      message: 'Registro actualizado correctamente',
      data: {
        ...updatedRecord,
        _primaryKey: updatedRecord[primaryKey],
        _rowIndex: 1
      }
    });
  } catch (error) {
    console.error('❌ Error inesperado en UPDATE:', error);
    const errorInfo = handlePostgresError(error, 'actualización de registro');
    res.status(errorInfo.status).json({
      success: false,
      message: errorInfo.message
    });
  }
});

// DELETE - Eliminar registro
app.delete('/api/tables/:tableName/delete', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { searchCriteria } = req.body;
    
    // Validar tabla
    await validateTableAccess(tableName);
    
    logOperation('DELETE REQUEST', { tableName, searchCriteria });

    if (!searchCriteria || !searchCriteria.field || !searchCriteria.value) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido para eliminar'
      });
    }

    const deleteQuery = `
      DELETE FROM ${tableName} 
      WHERE ${searchCriteria.field} = $1
      RETURNING *
    `;

    const result = await getActivePool().query(deleteQuery, [searchCriteria.value]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con ${searchCriteria.field}: ${searchCriteria.value}`,
      });
    }

    const deletedRecord = result.rows[0];
    logOperation('DELETE SUCCESS', deletedRecord);

    res.json({
      success: true,
      message: 'Registro eliminado exitosamente',
      deletedRecord: deletedRecord,
    });
  } catch (error) {
    console.error('❌ Error inesperado en DELETE:', error);
    const errorInfo = handlePostgresError(error, 'eliminación de registro');
    res.status(errorInfo.status).json({
      success: false,
      message: errorInfo.message
    });
  }
});

app.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Probar conexión con app_information_schema
    const result = await pool.query('SELECT COUNT(*) FROM app_information_schema');
    const responseTime = Date.now() - startTime;

    // Contar tablas disponibles
    const tables = await getDynamicTables();

    res.json({ 
      status: 'healthy', 
      database: 'connected',
      responseTime: `${responseTime}ms`,
      tablesAvailable: tables.length,
      tablesList: tables,
      dbHost: process.env.DB_HOST ? 'configured' : 'missing',
      dbUser: process.env.DB_USER ? 'configured' : 'missing',
      schemaSource: 'app_information_schema',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(503).json({ 
      status: 'unhealthy', 
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Ruta para obtener IP (temporal)
app.get('/mi-ip', (req, res) => {
  res.json({
    ip: req.ip,
    ips: req.ips,
    headers: {
      'x-forwarded-for': req.get('x-forwarded-for'),
      'x-real-ip': req.get('x-real-ip'),
      'cf-connecting-ip': req.get('cf-connecting-ip')
    },
    connection: {
      remoteAddress: req.connection?.remoteAddress,
      socket: req.socket?.remoteAddress
    }
  });
});

// Middleware de manejo de errores global
app.use((error, req, res, next) => {
  console.error('❌ Error no manejado:', error);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: error.message
  });
});

// Iniciar servidor con validación de conexión
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend available at /`);
  console.log(`🏥 Health check available at /health`);
  console.log(`🔄 Sistema dinámico activado - usando app_information_schema`);
  
  // Probar conexión y mostrar tablas disponibles
  try {
    console.log('🔄 Probando conexión inicial a PostgreSQL...');
    
    const result = await pool.query('SELECT 1');
    console.log('✅ Conexión a PostgreSQL exitosa');
    console.log('✅ app_information_schema accesible');
    
    // Mostrar tablas disponibles
    try {
      const tables = await getDynamicTables();
      console.log(`📊 Tablas detectadas: ${tables.join(', ')}`);
      
      // Mostrar categorías disponibles
      const categories = await getCategories();
      console.log(`📁 Categorías disponibles: ${categories.map(c => c.category_name).join(', ')}`);
    } catch (tableError) {
      console.log('⚠️ No se pudieron listar las tablas automáticamente:', tableError.message);
    }
  } catch (error) {
    console.error('❌ Error al probar conexión inicial:', error.message);
  }
});
