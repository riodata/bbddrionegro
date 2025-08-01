// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// ========== CONFIGURACIÓN Y VALIDACIÓN DE VARIABLES DE ENTORNO ==========

console.log('🔍 Debug - Variables de entorno:');
console.log(`  NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`  DB_HOST: ${process.env.DB_HOST ? 'configured' : 'missing'}`);
console.log(`  DB_PORT: ${process.env.DB_PORT ? 'configured' : 'missing'}`);
console.log(`  DB_NAME: ${process.env.DB_NAME ? 'configured' : 'missing'}`);
console.log(`  DB_USER: ${process.env.DB_USER ? 'configured' : 'missing'}`);
console.log(`  DB_PASSWORD: ${process.env.DB_PASSWORD ? 'configured' : 'missing'}`);
console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? 'configured' : 'missing'}`);

// Validar variables de entorno para PostgreSQL
if (!process.env.DATABASE_URL && 
    (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD)) {
  console.error('❌ Error: Se requiere DATABASE_URL o las variables DB_HOST, DB_NAME, DB_USER, DB_PASSWORD');
  console.error('Verifica tu archivo .env');
  process.exit(1);
}

// ========== CONFIGURACIÓN OPTIMIZADA DE POSTGRESQL ==========

let pool;
let poolConfig;

if (process.env.DATABASE_URL) {
  console.log('📊 Configurando pool con DATABASE_URL...');
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    // Forzar SSL deshabilitado para desarrollo local
    ssl: false,
    // Configuraciones adicionales para desarrollo local
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,  // Aumentado a 5 segundos
    acquireTimeoutMillis: 5000,     // Timeout para obtener conexión del pool
  };
} else {
  console.log('📊 Configurando pool con variables individuales...');
  poolConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Forzar SSL completamente deshabilitado para desarrollo local
    ssl: false,
    // Configuraciones adicionales para desarrollo local
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,  // Aumentado a 5 segundos
    acquireTimeoutMillis: 5000,     // Timeout para obtener conexión del pool
  };
}

console.log('🔧 Configuración del pool PostgreSQL:');
console.log(`  Host: ${poolConfig.host || 'from URL'}`);
console.log(`  Port: ${poolConfig.port || 'from URL'}`);
console.log(`  Database: ${poolConfig.database || 'from URL'}`);
console.log(`  User: ${poolConfig.user || 'from URL'}`);
console.log(`  SSL: ${poolConfig.ssl}`);
console.log(`  Max connections: ${poolConfig.max}`);
console.log(`  Connection timeout: ${poolConfig.connectionTimeoutMillis}ms`);
console.log(`  Acquire timeout: ${poolConfig.acquireTimeoutMillis}ms`);
console.log(`  Idle timeout: ${poolConfig.idleTimeoutMillis}ms`);

try {
  pool = new Pool(poolConfig);
  console.log('✅ Pool PostgreSQL creado exitosamente');
} catch (error) {
  console.error('❌ Error creando pool PostgreSQL:', error);
  process.exit(1);
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
  
  // Errores específicos de SSL
  if (error.message && (error.message.includes('SSL') || error.message.includes('ssl'))) {
    console.error('🔍 Error SSL detectado:');
    console.error('   - El servidor PostgreSQL puede requerir configuración SSL específica');
    console.error('   - Verificar que ssl: false esté configurado correctamente');
    return { status: 503, message: 'Error de configuración SSL en la conexión a base de datos' };
  }
  
  if (error.code === '23505') {
    return { status: 409, message: 'Ya existe un registro con esos datos' };
  }
  
  if (error.code === '23503') {
    return { status: 400, message: 'Error de referencia: algunos datos relacionados no existen' };
  }
  
  if (error.code === 'ECONNREFUSED') {
    return { status: 503, message: 'Error de conexión con la base de datos' };
  }
  
  if (error.message && error.message.includes('Connection terminated due to connection timeout')) {
    return { status: 503, message: 'Timeout de conexión con la base de datos' };
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
app.get('/api/enum-options', async (req, res) => {
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
app.get('/api/enum-options/:enumName', async (req, res) => {
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
app.get('/api/categories', async (req, res) => {
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
app.get('/api/categories/:categoryName/tables', async (req, res) => {
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
app.get('/api/tables/:tableName/schema', async (req, res) => {
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
app.post('/api/tables/:tableName/create', async (req, res) => {
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
app.get('/api/tables/:tableName/read', async (req, res) => {
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
app.get('/api/tables/:tableName/search', async (req, res) => {
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

app.get('/api/tables/:tableName/fields', async (req, res) => {
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
app.put('/api/tables/:tableName/update', async (req, res) => {
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
app.delete('/api/tables/:tableName/delete', async (req, res) => {
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
    
    const startTime = Date.now();
    const result = await pool.query('SELECT 1 as test');
    const connectionTime = Date.now() - startTime;
    
    console.log(`✅ Conexión a PostgreSQL exitosa (${connectionTime}ms)`);
    console.log('✅ app_information_schema accesible');
    
    // Mostrar tablas disponibles
    try {
      const tables = await getDynamicTables();
      console.log(`📊 Tablas detectadas (${tables.length}): ${tables.join(', ')}`);
      
      // Mostrar categorías disponibles
      const categories = await getCategories();
      console.log(`📁 Categorías disponibles (${categories.length}): ${categories.map(c => c.category_name).join(', ')}`);
    } catch (tableError) {
      console.log('⚠️ No se pudieron listar las tablas automáticamente:', tableError.message);
    }
  } catch (error) {
    console.error('❌ Error al probar conexión inicial:');
    console.error(`   Mensaje: ${error.message}`);
    console.error(`   Código: ${error.code || 'No disponible'}`);
    
    // Diagnóstico adicional para errores SSL
    if (error.message.includes('SSL') || error.message.includes('ssl')) {
      console.error('🔍 Error relacionado con SSL detectado:');
      console.error('   - Verificar que el servidor PostgreSQL no requiera SSL');
      console.error('   - Configuración actual: ssl: false');
      console.error('   - Para conexiones locales, SSL debe estar deshabilitado');
    }
    
    // Diagnóstico para errores de conexión
    if (error.code === 'ECONNREFUSED') {
      console.error('🔍 Error de conexión rechazada:');
      console.error('   - Verificar que PostgreSQL esté ejecutándose');
      console.error('   - Verificar host y puerto en variables de entorno');
      console.error(`   - Host configurado: ${process.env.DB_HOST}`);
      console.error(`   - Puerto configurado: ${process.env.DB_PORT || 5432}`);
    }
    
    console.error('⚠️ El servidor continuará ejecutándose, pero la base de datos no está disponible');
  }
});
