// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios'); // Agrega axios para enviar la petición al webhook de n8n
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { authenticateToken, optionalAuth, requireRole, requireActiveUser } = require('./middleware/auth');
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

const app = express();
const PORT = process.env.PORT || 8000;

// ========== FUNCIONES PARA METADATOS DINÁMICOS CON CATEGORÍAS ==========

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
    
    const result = await pool.query(query);
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
    
    const result = await pool.query(query, [categoryName]);
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
    
    const result = await pool.query(query);
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

    const result = await pool.query(query, [tableName]);
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
    
    const result = await pool.query(query, [tableName]);

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
    
    const result = await pool.query(query, [tableName]);
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

// Ruta principal para servir el frontend (index redirige al login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para el login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Ruta para la aplicación principal (protegida)
app.get('/app', authenticateToken, requireActiveUser, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ========== FUNCIONES PARA ENUMS ==========

// Obtener valores de un enum específico
async function getEnumValues(enumName) {
  try {
    const query = `
      SELECT unnest(enum_range(NULL::${enumName})) as enum_value
    `;
    
    const result = await pool.query(query);
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
app.get('/api/enum-options', authenticateToken, requireActiveUser, async (req, res) => {
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
app.get('/api/enum-options/:enumName', authenticateToken, requireActiveUser, async (req, res) => {
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
app.get('/api/categories', authenticateToken, requireActiveUser, async (req, res) => {
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
app.get('/api/categories/:categoryName/tables', authenticateToken, requireActiveUser, async (req, res) => {
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
app.get('/api/tables/:tableName/schema', authenticateToken, requireActiveUser, async (req, res) => {
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

// Endpoint para solicitar recuperación de contraseña
app.post('/api/password-reset/request', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email requerido" });
  }

  try {
    // Busca usuario en DB
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }
    const userId = userResult.rows[0].id;

    // Genera token único (simple ejemplo, usa mejor uuid en producción)
    const token = Math.random().toString(36).substr(2, 24);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Guarda el token en la base
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, token, expires]
    );

    // Arma el link de recuperación (ajusta la URL según tu frontend)
    const resetLink = `${process.env.FRONTEND_URL || 'https://tusistema.rionegro.gov.ar'}/reset-password?token=${token}`;

    // Envía los datos al webhook de n8n
    await axios.post(process.env.N8N_WEBHOOK_URL, {
      email,
      resetLink,
      nombre: email // Puedes buscar el nombre si lo tienes en la DB
    });

    return res.json({ success: true, message: "Solicitud enviada. Revisa tu email." });
  } catch (err) {
    console.error("Error en password reset:", err);
    return res.status(500).json({ success: false, message: "Error interno" });
  }
});

// ========== ENDPOINTS DE AUTENTICACIÓN ==========

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos'
      });
    }

    // Buscar usuario en la base de datos
    const userQuery = 'SELECT * FROM users WHERE email = $1 AND is_active = true';
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no registrado. Contacta a tu superior para obtener acceso.'
      });
    }

    const user = userResult.rows[0];

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña incorrecta'
      });
    }

    // Actualizar último login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Crear JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        is_active: user.is_active
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // TODO: Cambiar conexión de base de datos a koyeb_app_user después del login
    // Esta funcionalidad se implementará cuando la base de datos esté accesible

    res.json({
      success: true,
      message: 'Login exitoso',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        last_login: user.last_login
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

// Verificar token endpoint
app.get('/api/auth/verify', authenticateToken, requireActiveUser, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Logout endpoint
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  // En un sistema más complejo, aquí se invalidaría el token en una blacklist
  res.json({
    success: true,
    message: 'Logout exitoso'
  });
});

// Register endpoint (solo para administradores)
app.post('/api/auth/register', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { email, password, first_name, last_name, role = 'user' } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son requeridos'
      });
    }

    // Verificar si el usuario ya existe
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'El usuario ya existe'
      });
    }

    // Hash de la contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insertar nuevo usuario
    const insertQuery = `
      INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING id, email, first_name, last_name, role, created_at
    `;
    
    const result = await pool.query(insertQuery, [
      email, passwordHash, first_name, last_name, role
    ]);

    const newUser = result.rows[0];

    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente',
      user: newUser
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Reset password endpoint
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token y nueva contraseña son requeridos'
      });
    }

    // Verificar token
    const tokenQuery = `
      SELECT prt.*, u.email 
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token = $1 AND prt.used = false AND prt.expires_at > CURRENT_TIMESTAMP
    `;
    
    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }

    const resetData = tokenResult.rows[0];

    // Hash de la nueva contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar contraseña del usuario
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, resetData.user_id]
    );

    // Marcar token como usado
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE id = $1',
      [resetData.id]
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });

  } catch (error) {
    console.error('Error en reset password:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// ENDPOINTS DINÁMICOS PARA OPERACIONES CRUD (PROTEGIDAS)

// CREATE - Crear nuevo registro
app.post('/api/tables/:tableName/create', authenticateToken, requireActiveUser, async (req, res) => {
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

    const result = await pool.query(insertQuery, values);
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
app.get('/api/tables/:tableName/read', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('READ REQUEST', { tableName });

    const query = `SELECT * FROM ${tableName} ORDER BY ${primaryKey} ASC`;
    const result = await pool.query(query);

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
app.get('/api/tables/:tableName/search', authenticateToken, requireActiveUser, async (req, res) => {
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

    const result = await pool.query(query, queryParams);

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

app.get('/api/tables/:tableName/fields', authenticateToken, requireActiveUser, async (req, res) => {
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
app.put('/api/tables/:tableName/update', authenticateToken, requireActiveUser, async (req, res) => {
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

    const result = await pool.query(updateQuery, [...updateValues, searchCriteria.value]);

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
app.delete('/api/tables/:tableName/delete', authenticateToken, requireActiveUser, async (req, res) => {
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

    const result = await pool.query(deleteQuery, [searchCriteria.value]);

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
