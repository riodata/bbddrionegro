const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const auth = require('./auth');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

// Validar variables de entorno para PostgreSQL
if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE || !process.env.PGPASSWORD) {
  console.error('❌ Error: Faltan variables de conexión a PostgreSQL en el entorno.');
  process.exit(1);
}

// Configuración del pool de conexiones con SSL automático
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: {
    rejectUnauthorized: false  // Para SSL sin certificado local
  },
  // Configuraciones adicionales para mejor rendimiento
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Probar la conexión inicial
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error al probar conexión inicial:', err.stack || err);
    process.exit(1);
  }
  console.log('✅ Conexión a PostgreSQL OK');
  console.log('✅ SSL/TLS conectado correctamente');
  release();
});

const app = express();
const PORT = process.env.PORT || 8000;

// ⚠️ IMPORTANTE: Middlewares DEBEN ir ANTES que las rutas
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de debugging para autenticación
app.use('/api', (req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  console.log('📋 Headers:', {
    authorization: req.headers['authorization'],
    Authorization: req.headers['Authorization'],
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50) + '...'
  });
  next();
});

// AHORA SÍ: ENDPOINTS de autenticación (después de los middlewares)
app.post('/api/login', auth.login);
app.post('/api/register', auth.register);
app.post('/api/logout', auth.logout);
app.post('/api/password-reset/confirm', auth.passwordResetConfirm);

// Ejemplo de protección con middleware JWT en una ruta:
app.get('/api/protected', auth.requireAuth, (req, res) => {
  res.json({ success: true, user: req.user, message: "Acceso autorizado." });
});

// Función para actualizar fecha de último acceso
async function updateLastAccess(userId) {
  try {
    await pool.query(
      'UPDATE users SET fecha_ultimo_acceso = NOW() WHERE id = $1',
      [userId]
    );
  } catch (error) {
    console.error('Error actualizando último acceso:', error);
  }
}

// Función para verificar y actualizar estado activo
async function checkAndUpdateActiveStatus(userId) {
  try {
    const result = await pool.query(
      'SELECT activo, fecha_vencimiento FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) return false;
    
    const user = result.rows[0];
    
    // Si tiene fecha de vencimiento y ya expiró, desactivar
    if (user.fecha_vencimiento && new Date() > new Date(user.fecha_vencimiento)) {
      await pool.query(
        'UPDATE users SET activo = false WHERE id = $1',
        [userId]
      );
      return false;
    }
    
    return user.activo;
  } catch (error) {
    console.error('Error verificando estado activo:', error);
    return false;
  }
}

app.post('/api/refresh-token', auth.requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Verificar que el usuario sigue activo
        const userResult = await pool.query(
            'SELECT id, email, nombre_apellido, rol, activo FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const user = userResult.rows[0];

        if (!user.activo) {
            return res.status(401).json({
                success: false,
                message: 'Usuario inactivo'
            });
        }

        // Verificar y actualizar estado activo
        const isActive = await checkAndUpdateActiveStatus(user.id);
        
        if (!isActive) {
            return res.status(401).json({
                success: false,
                message: 'Usuario inactivo. Contacte al administrador.'
            });
        }

        // Generar nuevo token JWT
        const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
        const newToken = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                rol: user.rol,
                nombre_apellido: user.nombre_apellido
            }, 
            JWT_SECRET, 
            { expiresIn: '12h' }
        );

        // Actualizar fecha de último acceso
        await updateLastAccess(user.id);

        console.log('🔄 Token renovado para:', user.email);

        res.json({
            success: true,
            token: newToken,
            message: 'Token renovado exitosamente'
        });

    } catch (error) {
        console.error('Error renovando token:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

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
// Obtener esquema completo de una tabla desde app_information_schema
async function getTableSchema(tableName) {
  try {
    console.log(`🔍 Obteniendo esquema para tabla: ${tableName}`);
    
    // Obtener columnas de la tabla
    const columnsResult = await pool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable, 
        column_default,
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    
    if (columnsResult.rows.length === 0) {
      throw new Error(`No se encontraron columnas para la tabla ${tableName}`);
    }
    
    console.log(`📋 Columnas encontradas: ${columnsResult.rows.length}`);
    
    // Obtener información de foreign keys
    const fkResult = await pool.query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
    `, [tableName]);
    
    // Obtener primary key correctamente
    let primaryKey = null;
    try {
      const pkResult = await pool.query(`
        SELECT a.attname as column_name
        FROM   pg_index i
        JOIN   pg_attribute a ON a.attrelid = i.indrelid
                              AND a.attnum = ANY(i.indkey)
        WHERE  i.indrelid = $1::regclass
        AND    i.indisprimary
      `, [tableName]);
      
      if (pkResult.rows.length > 0) {
        primaryKey = pkResult.rows[0].column_name;
        console.log(`🔑 Primary key encontrado: ${primaryKey}`);
      }
    } catch (pkError) {
      console.warn(`⚠️ Error obteniendo primary key para ${tableName}:`, pkError.message);
    }
    
    // Fallback para primary key si no se encuentra
    if (!primaryKey) {
      // Buscar una columna llamada 'id' o similar
      const idColumn = columnsResult.rows.find(col => 
        col.column_name.toLowerCase() === 'id' || 
        col.column_name.toLowerCase().includes('id')
      );
      
      if (idColumn) {
        primaryKey = idColumn.column_name;
        console.log(`🔑 Primary key fallback encontrado: ${primaryKey}`);
      } else {
        // Último fallback: primera columna
        primaryKey = columnsResult.rows[0].column_name;
        console.log(`🔑 Primary key fallback (primera columna): ${primaryKey}`);
      }
    }
    
    // Procesar foreign keys en un objeto
    const foreignKeys = {};
    fkResult.rows.forEach(row => {
      foreignKeys[row.column_name] = {
        table: row.foreign_table_name,
        column: row.foreign_column_name
      };
    });
    
    return {
      columns: columnsResult.rows,
      foreignKeys: foreignKeys,
      primaryKey: primaryKey
    };
    
  } catch (error) {
    console.error('Error al obtener esquema:', error);
    throw new Error(`Error al obtener esquema de la tabla ${tableName}: ${error.message}`);
  }
}

// Validar que una tabla existe usando information_schema
async function validateTableAccess(tableName) {
  try {
    const query = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
      LIMIT 1
    `;
    
    const result = await pool.query(query, [tableName]);

    if (result.rows.length === 0) {
      throw new Error(`Tabla '${tableName}' no encontrada en la base de datos`);
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

// Función auxiliar mejorada para construir condiciones de búsqueda según el tipo de dato
function buildSearchCondition(fieldName, searchText, dataType) {
    const lowerDataType = dataType.toLowerCase();
    
    console.log(`🔍 Construyendo búsqueda para campo: ${fieldName}, tipo: ${dataType}, texto: ${searchText}`);
    
    // Números (enteros, decimales, etc.)
    if (lowerDataType.includes('int') || lowerDataType.includes('numeric') || 
        lowerDataType.includes('decimal') || lowerDataType.includes('float') || 
        lowerDataType.includes('double') || lowerDataType.includes('bigint') ||
        lowerDataType.includes('real') || lowerDataType.includes('money')) {
        
        if (isNaN(searchText)) {
            console.log(`📊 Número buscado como texto: ${searchText}`);
            return {
                condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
                value: `%${searchText}%`
            };
        } else {
            console.log(`📊 Búsqueda numérica exacta: ${searchText}`);
            return {
                condition: `"${fieldName}" = $1`,
                value: parseFloat(searchText)
            };
        }
    }
    
    // Booleanos
    else if (lowerDataType.includes('bool')) {
        const boolValue = ['true', '1', 'sí', 'si', 'yes', 't', 'verdadero'].includes(searchText.toLowerCase());
        console.log(`✅ Búsqueda booleana: ${searchText} -> ${boolValue}`);
        return {
            condition: `"${fieldName}" = $1`,
            value: boolValue
        };
    }
    
    // Fechas y timestamps
    else if (lowerDataType.includes('date') || lowerDataType.includes('timestamp') || 
             lowerDataType.includes('time')) {
        console.log(`📅 Búsqueda de fecha como texto: ${searchText}`);
        return {
            condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
            value: `%${searchText}%`
        };
    }
    
    // Tipos USER-DEFINED (ENUMs, tipos personalizados)
    else if (lowerDataType.includes('user-defined') || lowerDataType === 'user_defined' ||
             lowerDataType.includes('enum')) {
        console.log(`🏷️ Tipo USER-DEFINED detectado: ${dataType}`);
        return {
            condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
            value: `%${searchText}%`
        };
    }
    
    // Tipos de texto nativos
    else if (lowerDataType.includes('text') || lowerDataType.includes('varchar') || 
             lowerDataType.includes('char') || lowerDataType.includes('character') ||
             lowerDataType.includes('string') || lowerDataType.includes('name') ||
             lowerDataType.includes('citext')) {
        console.log(`📝 Texto nativo: ${dataType}`);
        return {
            condition: `"${fieldName}" ILIKE $1`,
            value: `%${searchText}%`
        };
    }
    
    // Arrays
    else if (lowerDataType.includes('array') || lowerDataType.includes('[]')) {
        console.log(`📋 Array detectado: ${dataType}`);
        return {
            condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
            value: `%${searchText}%`
        };
    }
    
    // UUID
    else if (lowerDataType.includes('uuid')) {
        console.log(`🆔 UUID detectado: ${dataType}`);
        if (searchText.length === 36 && searchText.includes('-')) {
            // Búsqueda exacta si parece un UUID completo
            return {
                condition: `"${fieldName}" = $1`,
                value: searchText
            };
        } else {
            // Búsqueda parcial
            return {
                condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
                value: `%${searchText}%`
            };
        }
    }
    
    // JSON/JSONB
    else if (lowerDataType.includes('json')) {
        console.log(`📄 JSON detectado: ${dataType}`);
        return {
            condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
            value: `%${searchText}%`
        };
    }
    
    // Cualquier otro tipo desconocido - usar conversión segura
    else {
        console.log(`❓ Tipo desconocido, usando conversión segura: ${dataType}`);
        return {
            condition: `CAST("${fieldName}" AS TEXT) ILIKE $1`,
            value: `%${searchText}%`
        };
    }
}

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
      'sino',
      'estado',
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

async function getForeignKeyData(tableName, foreignTable, foreignColumn, displayColumn = 'nombre') {
  try {
    console.log(`🔄 Obteniendo FK data para tabla: ${tableName}, foreign: ${foreignTable}`);
    
    // Lógica especial para COOPERATIVAS
    if (foreignTable === 'entidades_cooperativas') {
      const query = `
        SELECT "Matricula", "Nombre de la Entidad"
        FROM "entidades_cooperativas" 
        WHERE "Nombre de la Entidad" IS NOT NULL 
        ORDER BY "Nombre de la Entidad" ASC
      `;
      
      const result = await pool.query(query);
      console.log(`✅ Cooperativas encontradas: ${result.rows.length}`);
      
      return result.rows.map(row => ({
        value: row.Matricula,
        display: row['Nombre de la Entidad'],
        text: row['Nombre de la Entidad'],
        matricula: row.Matricula,
        tipo: 'cooperativa'
      }));
    }
    
    // Lógica especial para MUTUALES
    if (foreignTable === 'entidades_mutuales') {
      const query = `
        SELECT "Matricula Nacional", "Entidad"
        FROM "entidades_mutuales" 
        WHERE "Entidad" IS NOT NULL 
        ORDER BY "Entidad" ASC
      `;
      
      const result = await pool.query(query);
      console.log(`✅ Mutuales encontradas: ${result.rows.length}`);
      
      return result.rows.map(row => ({
        value: row['Matricula Nacional'],
        display: row.Entidad,
        text: row.Entidad,
        matricula: row['Matricula Nacional'],
        tipo: 'mutual'
      }));
    }
    
    // Lógica normal para otras tablas
    const query = `
      SELECT "${foreignColumn}", "${displayColumn}"
      FROM "${foreignTable}" 
      WHERE "${displayColumn}" IS NOT NULL 
      ORDER BY "${displayColumn}" ASC
    `;
    
    const result = await pool.query(query);
    return result.rows.map(row => ({
      value: row[foreignColumn],
      display: row[displayColumn],
      text: row[displayColumn]
    }));
  } catch (error) {
    console.error(`Error obteniendo datos de foreign key para ${tableName}.${foreignTable}:`, error);
    return [];
  }
}

// Obtener datos completos de una entidad por su clave primaria
async function getEntityData(tableName, primaryKey, primaryValue) {
  try {
    const query = `SELECT * FROM "${tableName}" WHERE "${primaryKey}" = $1`;
    const result = await pool.query(query, [primaryValue]);
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error obteniendo datos de entidad ${tableName}:`, error);
    return null;
  }
}

// Endpoint para obtener opciones de dropdowns
app.get('/api/enum-options', auth.requireAuth, async (req, res) => {
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
app.get('/api/enum-options/:enumName', auth.requireAuth, async (req, res) => {
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

// Endpoint para obtener datos de foreign keys
app.get('/api/tables/:tableName/foreign-key-data', auth.requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params;
    await validateTableAccess(tableName);
    
    const schema = await getTableSchema(tableName);
    const foreignKeyData = {};
    
    // Procesar cada columna que sea foreign key
    for (const column of schema.columns) {
      if (column.is_foreign_key && column.foreign_table) {
        const foreignTable = column.foreign_table;
        const foreignColumn = column.foreign_column || 'id';
        
        // Determinar el campo de display basado en la tabla
        let displayColumn = 'nombre';
        if (foreignTable.includes('cooperativas') || foreignTable.includes('mutuales')) {
          displayColumn = 'nombre';
        }
        
        const data = await getForeignKeyData(tableName, foreignTable, foreignColumn, displayColumn);
        foreignKeyData[column.column_name] = {
          foreignTable,
          foreignColumn,
          displayColumn,
          data
        };
      }
    }
    
    res.json({
      success: true,
      data: foreignKeyData
    });
  } catch (error) {
    console.error('Error obteniendo datos de foreign keys:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo datos de foreign keys',
      details: error.message
    });
  }
});

// Endpoint para obtener datos completos de una entidad
app.get('/api/tables/:tableName/entity/:primaryValue', auth.requireAuth, async (req, res) => {
  try {
    const { tableName, primaryValue } = req.params;
    await validateTableAccess(tableName);
    
    const schema = await getTableSchema(tableName);
    const primaryKey = schema.primaryKey;
    
    const entityData = await getEntityData(tableName, primaryKey, primaryValue);
    
    if (!entityData) {
      return res.status(404).json({
        success: false,
        message: 'Entidad no encontrada'
      });
    }
    
    res.json({
      success: true,
      data: entityData
    });
  } catch (error) {
    console.error('Error obteniendo datos de entidad:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo datos de entidad',
      details: error.message
    });
  }
});

// ========== ENDPOINTS PARA CATEGORÍAS ==========

// Obtener todas las categorías disponibles
app.get('/api/categories', auth.requireAuth, async (req, res) => {
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
app.get('/api/categories/:categoryName/tables', auth.requireAuth, async (req, res) => {
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

// Endpoints para estadísticas
app.get('/estadisticas-cooperativas', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Estadísticas Cooperativas</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .header { background: #007bff; color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .back-btn { 
          margin-bottom: 20px; 
          padding: 10px 20px; 
          background: #28a745; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px; 
          display: inline-block;
        }
        .back-btn:hover { background: #218838; }
        iframe { width: 100%; height: 80vh; border: none; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📊 Estadísticas Cooperativas</h1>
        <p>Análisis de datos y métricas del sector cooperativo</p>
      </div>
      <a href="/" class="back-btn">← Volver al inicio</a>
      <iframe src="https://lookerstudio.google.com/embed/reporting/48b80800-b981-4b3f-a254-4f3e55015c91/page/62DPE"></iframe>
    </body>
    </html>
  `);
});

app.get('/estadisticas-mutuales', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Estadísticas Mutuales</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .header { background: #17a2b8; color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .back-btn { 
          margin-bottom: 20px; 
          padding: 10px 20px; 
          background: #28a745; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px; 
          display: inline-block;
        }
        .back-btn:hover { background: #218838; }
        iframe { width: 100%; height: 80vh; border: none; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📈 Estadísticas Mutuales</h1>
        <p>Análisis de datos y métricas del sector mutual</p>
      </div>
      <a href="/" class="back-btn">← Volver al inicio</a>
      <iframe src="https://lookerstudio.google.com/embed/reporting/48b80800-b981-4b3f-a254-4f3e55015c91/page/62DPE"></iframe>
    </body>
    </html>
  `);
});

// Endpoint para obtener información de estadísticas disponibles
app.get('/api/statistics-info', auth.requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      statistics: [
        {
          id: 'cooperativas',
          name: 'Estadísticas Cooperativas',
          description: 'Análisis de datos del sector cooperativo',
          url: '/estadisticas-cooperativas',
          icon: '📊',
          color: '#28a745'
        },
        {
          id: 'mutuales',
          name: 'Estadísticas Mutuales', 
          description: 'Análisis de datos del sector mutual',
          url: '/estadisticas-mutuales',
          icon: '📈',
          color: '#17a2b8'
        }
      ]
    });
  } catch (error) {
    console.error('Error obteniendo información de estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo información de estadísticas'
    });
  }
});

// Obtener esquema de una tabla específica
app.get('/api/tables/:tableName/schema', auth.requireAuth, async (req, res) => {
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

// Endpoint para validar matrícula única
app.post('/api/validate-matricula', auth.requireAuth, async (req, res) => {
  try {
    const { matricula, tableName, fieldName } = req.body;
    
    if (!matricula || !tableName || !fieldName) {
      return res.status(400).json({
        success: false,
        message: 'Parámetros requeridos: matricula, tableName, fieldName'
      });
    }
    
    // Buscar en todas las tablas de entidades
    const tables = ['entidades_cooperativas', 'entidades_mutuales'];
    let exists = false;
    let entityName = '';
    
    for (const table of tables) {
      try {
        let query;
        if (table === 'entidades_cooperativas') {
          query = 'SELECT "Nombre de la Entidad" FROM "entidades_cooperativas" WHERE "Matricula" = $1';
        } else if (table === 'entidades_mutuales') {
          query = 'SELECT "Entidad" FROM "entidades_mutuales" WHERE "Matricula Nacional" = $1';
        }
        
        const result = await pool.query(query, [matricula]);
        
        if (result.rows.length > 0) {
          exists = true;
          entityName = result.rows[0]['Nombre de la Entidad'] || result.rows[0]['Entidad'] || 'Entidad encontrada';
          break;
        }
      } catch (error) {
        console.log(`Tabla ${table} no accesible o no existe:`, error.message);
      }
    }
    
    res.json({
      success: true,
      exists: exists,
      entityName: entityName
    });
    
  } catch (error) {
    console.error('Error validando matrícula:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Endpoint para validar legajo único
app.post('/api/validate-legajo', auth.requireAuth, async (req, res) => {
  try {
    const { legajo, tableName, fieldName } = req.body;
    
    if (!legajo || !tableName || !fieldName) {
      return res.status(400).json({
        success: false,
        message: 'Parámetros requeridos: legajo, tableName, fieldName'
      });
    }
    
    // Buscar en la tabla actual
    let exists = false;
    let entityName = '';
    
    try {
      // Obtener esquema para encontrar la columna correcta
      const schema = await getTableSchema(tableName);
      const legajoColumn = schema.columns.find(col => 
        col.column_name.toLowerCase().includes('legajo')
      );
      
      if (legajoColumn) {
        // Buscar registro con mismo legajo
        const query = `SELECT * FROM "${tableName}" WHERE "${legajoColumn.column_name}" = $1 LIMIT 1`;
        const result = await pool.query(query, [legajo]);
        
        if (result.rows.length > 0) {
          exists = true;
          const record = result.rows[0];
          // Buscar un campo que pueda identificar la entidad
          entityName = record.nombre || record.denominacion || record['Nombre de la Entidad'] || 
                      record.entidad || `ID ${record.id}` || 'entidad existente';
        }
      }
    } catch (error) {
      console.log(`Error verificando legajo en ${tableName}:`, error.message);
    }
    
    res.json({
      success: true,
      exists: exists,
      entityName: entityName
    });
    
  } catch (error) {
    console.error('Error validando legajo:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Endpoint para obtener esquema filtrado (sin entidad_id para ciertos formularios)
app.get('/api/tables/:tableName/schema-filtered', auth.requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { formType } = req.query; // 'create' o 'edit'
    
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
    
    // Filtrar columnas para formularios de creación de entidades específicas
    if (formType === 'create' && 
        (tableName === 'entidades_cooperativas' || tableName === 'entidades_mutuales')) {
      schema.columns = schema.columns.filter(col => col.column_name !== 'entidad_id');
    }
    
    res.json({
      success: true,
      schema: schema,
      filtered: formType === 'create' && 
               (tableName === 'entidades_cooperativas' || tableName === 'entidades_mutuales')
    });
  } catch (error) {
    console.error(`Error obteniendo esquema filtrado de ${req.params.tableName}:`, error);
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({
      success: false,
      message: error.message,
      error: error.message
    });
  }
});

// Endpoint para obtener cooperativas
app.get('/api/entidades/cooperativas', auth.requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT "Matricula" as matricula, "Nombre de la Entidad" as nombre
      FROM "entidades_cooperativas" 
      WHERE "Nombre de la Entidad" IS NOT NULL 
      ORDER BY "Nombre de la Entidad" ASC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error obteniendo cooperativas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo cooperativas',
      error: error.message
    });
  }
});

// Endpoint para obtener mutuales
app.get('/api/entidades/mutuales', auth.requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT "Matricula Nacional" as matricula, "Entidad" as nombre
      FROM "entidades_mutuales" 
      WHERE "Entidad" IS NOT NULL 
      ORDER BY "Entidad" ASC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error obteniendo mutuales:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo mutuales',
      error: error.message
    });
  }
});

// ENDPOINTS DINÁMICOS PARA OPERACIONES CRUD
// CREATE - Crear nuevo registro
app.post('/api/tables/:tableName/create', auth.requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params;
    const data = req.body;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('CREATE REQUEST', { tableName, data });

    // Limpiar datos de campos vacíos o undefined
    const cleanData = {};
    Object.keys(data).forEach(key => {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
        cleanData[key] = data[key];
      }
    });

    // Construir query de inserción CON COMILLAS DOBLES
    const columns = Object.keys(cleanData);
    const values = Object.values(cleanData);
    
    if (columns.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No hay datos válidos para insertar'
      });
    }
    
    const placeholders = values.map((_, index) => `$${index + 1}`);
    const quotedColumns = columns.map(col => `"${col}"`).join(', ');
    
    const insertQuery = `
      INSERT INTO "${tableName}" (${quotedColumns})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    console.log('📋 Query SQL:', insertQuery);
    console.log('📋 Valores:', values);

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
app.get('/api/tables/:tableName/read', auth.requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Validar tabla
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    
    // Asegurar que tenemos un primary key válido
    const primaryKey = tableSchema.primaryKey;
    
    if (!primaryKey) {
      throw new Error(`No se pudo determinar el primary key para la tabla ${tableName}`);
    }
    
    logOperation('READ REQUEST', { tableName, primaryKey });

    // USAR COMILLAS DOBLES PARA PRESERVAR CASE SENSITIVITY
    const query = `SELECT * FROM "${tableName}" ORDER BY "${primaryKey}" ASC`;
    console.log(`📋 Query SQL: ${query}`);
    
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
      tableName: tableName  // ESTA LÍNEA SOLUCIONA EL PROBLEMA DEL UNDEFINED
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
// SEARCH - Búsqueda simple usando la función auxiliar mejorada
app.get('/api/tables/:tableName/search', auth.requireAuth, async (req, res) => {
    try {
        const { tableName } = req.params;
        const { searchText, searchField } = req.query;
        
        await validateTableAccess(tableName);
        const tableSchema = await getTableSchema(tableName);
        const primaryKey = tableSchema.primaryKey;
        
        logOperation('SEARCH REQUEST', { tableName, searchText, searchField });

        let query = `SELECT * FROM "${tableName}"`;
        let queryParams = [];

        if (searchText && searchField) {
            const fieldInfo = tableSchema.columns.find(col => col.column_name === searchField);
            
            if (!fieldInfo) {
                return res.status(400).json({
                    success: false,
                    message: `El campo '${searchField}' no existe en la tabla`
                });
            }

            const searchCondition = buildSearchCondition(searchField, searchText, fieldInfo.data_type);
            query += ` WHERE ${searchCondition.condition}`;
            queryParams.push(searchCondition.value);
        }

        query += ` ORDER BY "${primaryKey}" ASC`;
        
        console.log(`📋 Query final: ${query}`);
        console.log(`📋 Parámetros: ${JSON.stringify(queryParams)}`);

        const result = await pool.query(query, queryParams);

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
            primaryKey: primaryKey,
            availableFields: tableSchema.columns.map(col => col.column_name)
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

app.get('/api/tables/:tableName/fields', auth.requireAuth, async (req, res) => {
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
app.put('/api/tables/:tableName/update', auth.requireAuth, async (req, res) => {
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

    // Construir query de actualización CON COMILLAS DOBLES
    const updateColumns = Object.keys(cleanUpdateData);
    const updateValues = Object.values(cleanUpdateData);
    const setClause = updateColumns.map((col, index) => `"${col}" = $${index + 1}`).join(', ');
    
    const updateQuery = `
      UPDATE "${tableName}" 
      SET ${setClause}
      WHERE "${searchCriteria.field}" = $${updateValues.length + 1}
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
app.delete('/api/tables/:tableName/delete', auth.requireAuth, async (req, res) => {
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
      DELETE FROM "${tableName}" 
      WHERE "${searchCriteria.field}" = $1
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
      ssl: 'enabled',
      responseTime: `${responseTime}ms`,
      tablesAvailable: tables.length,
      tablesList: tables,
      dbHost: process.env.PGHOST ? 'configured' : 'missing',
      dbUser: process.env.PGUSER ? 'configured' : 'missing',
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

// ========== ENDPOINTS ADICIONALES PARA GESTIÓN DE USUARIOS ==========

// Endpoint para obtener información del usuario actual
app.get('/api/user/profile', auth.requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(`
      SELECT 
        id, 
        nombre_apellido, 
        telefono, 
        email, 
        rol, 
        fecha_creacion, 
        fecha_ultimo_acceso, 
        fecha_vencimiento, 
        activo 
      FROM users 
      WHERE id = $1
    `, [req.user.id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const user = userResult.rows[0];
    
    res.json({
      success: true,
      user: user
    });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Endpoint para listar todos los usuarios (solo admin)
app.get('/api/admin/users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        nombre_apellido, 
        telefono, 
        email, 
        rol, 
        fecha_creacion, 
        fecha_ultimo_acceso, 
        fecha_vencimiento, 
        activo 
      FROM users 
      ORDER BY fecha_creacion DESC
    `);

    res.json({
      success: true,
      users: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Endpoint para activar/desactivar usuario (solo admin)
app.put('/api/admin/users/:userId/toggle-status', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(`
      UPDATE users 
      SET activo = NOT activo 
      WHERE id = $1 
      RETURNING id, nombre_apellido, email, activo
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      message: `Usuario ${result.rows[0].activo ? 'activado' : 'desactivado'} exitosamente`,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error cambiando estado del usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Endpoint para cambiar rol de usuario (solo admin)
app.put('/api/admin/users/:userId/role', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { rol } = req.body;

    if (!['admin', 'empleado'].includes(rol)) {
      return res.status(400).json({
        success: false,
        message: 'Rol inválido'
      });
    }

    const result = await pool.query(`
      UPDATE users 
      SET rol = $1 
      WHERE id = $2 
      RETURNING id, nombre_apellido, email, rol
    `, [rol, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      message: `Rol actualizado a ${rol} exitosamente`,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error cambiando rol del usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Endpoint para limpiar usuarios vencidos manualmente (solo admin)
app.post('/api/admin/clean-expired-users', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const cleanedCount = await auth.cleanExpiredUsers();
    
    res.json({
      success: true,
      message: `Se procesaron ${cleanedCount} usuarios vencidos`,
      cleanedCount: cleanedCount
    });
  } catch (error) {
    console.error('Error limpiando usuarios vencidos:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// Programar limpieza automática de usuarios vencidos cada 24 horas
setInterval(async () => {
  try {
    const cleanedCount = await auth.cleanExpiredUsers();
    if (cleanedCount > 0) {
      console.log(`🔄 Limpieza automática completada: ${cleanedCount} usuarios desactivados`);
    }
  } catch (error) {
    console.error('Error en limpieza automática:', error);
  }
}, 24 * 60 * 60 * 1000); // 24 horas

// Ruta para servir el registro
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Ruta para servir el login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Iniciar servidor con validación de conexión
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend available at /`);
  console.log(`🏥 Health check available at /health`);
  console.log(`🔄 Sistema dinámico activado - usando app_information_schema`);
  console.log(`🔒 SSL/TLS habilitado para PostgreSQL`);
  
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
