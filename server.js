// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { Pool } = require('pg');

// Validar variables de entorno para PostgreSQL
if (!process.env.DATABASE_URL && 
    (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD)) {
  console.error('❌ Error: Se requiere DATABASE_URL o las variables DB_HOST, DB_NAME, DB_USER, DB_PASSWORD');
  console.error('Verifica tu archivo .env');
  process.exit(1);
}

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const app = express();
const PORT = process.env.PORT || 8000;

// ========== FUNCIONES PARA METADATOS DINÁMICOS CON CATEGORÍAS ==========

// Obtener todas las categorías disponibles
async function getCategories() {
  try {
    const { data, error } = await supabase
      .from('table_categories')
      .select(`
        category_name,
        category_display_name,
        category_description,
        category_icon
      `)
      .eq('is_active', true)
      .order('category_name');
    
    if (error) throw error;
    
    // Eliminar duplicados por categoría
    const uniqueCategories = data.reduce((acc, current) => {
      const existing = acc.find(item => item.category_name === current.category_name);
      if (!existing) {
        acc.push(current);
      }
      return acc;
    }, []);
    
    return uniqueCategories;
  } catch (error) {
    console.error('Error obteniendo categorías:', error);
    throw error;
  }
}

// Obtener tablas de una categoría específica
async function getTablesByCategory(categoryName) {
  try {
    const { data, error } = await supabase
      .from('table_categories')
      .select(`
        table_name,
        table_display_name,
        table_description,
        table_order
      `)
      .eq('category_name', categoryName)
      .eq('is_active', true)
      .order('table_order');
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error(`Error obteniendo tablas para categoría ${categoryName}:`, error);
    throw error;
  }
}

// Obtener todas las tablas disponibles desde app_information_schema
async function getDynamicTables() {
  try {
    const { data, error } = await supabase
      .from('app_information_schema')
      .select('table_name')
      .neq('table_name', 'app_information_schema') // Excluir la tabla de metadatos
      .neq('table_name', 'table_categories') // Excluir tabla de configuración
      .order('table_name');
    
    if (error) throw error;
    
    // Obtener lista única de tablas
    const uniqueTables = [...new Set(data.map(row => row.table_name))];
    return uniqueTables;
  } catch (error) {
    console.error('Error obteniendo tablas desde app_information_schema:', error);
    throw error;
  }
}

// Obtener esquema completo de una tabla desde app_information_schema
async function getTableSchema(tableName) {
  try {
    const { data: columns, error } = await supabase
      .from('app_information_schema')
      .select(`
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
      `)
      .eq('table_name', tableName)
      .order('ordinal_position');

    if (error) throw error;

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
    const { data, error } = await supabase
      .from('app_information_schema')
      .select('table_name')
      .eq('table_name', tableName)
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
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
    const { data, error } = await supabase
      .from('app_information_schema')
      .select('column_name, data_type, is_primary_key')
      .eq('table_name', tableName)
      .order('ordinal_position');

    if (error) throw error;

    return data || [];
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

// Función auxiliar para manejo de errores de Supabase
const handleSupabaseError = (error, operation) => {
  console.error(`❌ Error en ${operation}:`, error);
  
  if (error.code === 'PGRST116') {
    return { status: 404, message: 'Registro no encontrado' };
  }
  
  if (error.code === '23505') {
    return { status: 409, message: 'Ya existe un registro con esos datos' };
  }
  
  if (error.message.includes('connection')) {
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
    const { data, error } = await supabase
      .rpc('get_enum_values', { enum_name: enumName });
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error(`Error obteniendo valores de enum ${enumName}:`, error);
    throw error;
  }
}

// Obtener todos los enums para dropdowns
async function getAllEnumOptions() {
  try {
    const [
      tipos,
      subtipos,
      tipo_asambleas,
      tipo_financiamientos,
      autoridades,
      departamentos,
      localidades
    ] = await Promise.all([
      getEnumValues('tipo'),
      getEnumValues('subtipo'),
      getEnumValues('tipo_asamblea'),
      getEnumValues('tipo_financiamiento'),
      getEnumValues('autoridades'),
      getEnumValues('departamento'),
      getEnumValues('localidad')
    ]);

    return {
      tipo: tipos,
      subtipo: subtipos,
      tipo_asamblea: tipo_asambleas,
      tipo_financiamiento: tipo_financiamientos,
      autoridades: autoridades,
      departamento: departamentos,
      localidad: localidades
    };
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
    
    // Verificar que la tabla existe usando getDynamicTables en lugar de validateTableExists
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

// ENDPOINTS DINÁMICOS PARA OPERACIONES CRUD

// CREATE - Crear nuevo registro
app.post('/api/tables/:tableName/create', async (req, res) => {
  try {
    const { tableName } = req.params;
    const data = req.body;
    
    // Validar tabla usando app_information_schema
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('CREATE REQUEST', { tableName, data });

    // Validar que el campo primaryKey existe (solo si es requerido)
    const primaryKeyColumn = tableSchema.columns.find(col => col.column_name === primaryKey);
    const isPrimaryKeyRequired = primaryKeyColumn && primaryKeyColumn.is_nullable === 'NO' && !primaryKeyColumn.column_default;
    
    if (isPrimaryKeyRequired && !data[primaryKey]) {
      return res.status(400).json({
        success: false,
        message: `El campo ${primaryKey} es obligatorio para crear un registro.`,
      });
    }

    // Si hay clave primaria y no es auto-generada, verificar duplicados
    if (data[primaryKey] && !primaryKeyColumn.column_default) {
      const { data: existingRecord, error: searchError } = await supabase
        .from(tableName)
        .select(primaryKey)
        .eq(primaryKey, data[primaryKey])
        .maybeSingle();

      if (searchError && searchError.code !== 'PGRST116') {
        const errorInfo = handleSupabaseError(searchError, 'búsqueda de registro existente');
        return res.status(errorInfo.status).json({
          success: false,
          message: errorInfo.message
        });
      }

      if (existingRecord) {
        return res.status(409).json({
          success: false,
          message: `Ya existe un registro con el ${primaryKey} proporcionado.`,
        });
      }
    }

    // Insertar nuevo registro
    const { data: newRecord, error: insertError } = await supabase
      .from(tableName)
      .insert([data])
      .select()
      .single();

    if (insertError) {
      const errorInfo = handleSupabaseError(insertError, 'creación de registro');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }
    
    logOperation('CREATE SUCCESS', newRecord);
    
    res.json({
      success: true,
      message: 'Registro creado exitosamente',
      primaryKey: newRecord[primaryKey],
      data: newRecord
    });
  } catch (error) {
    console.error('❌ Error inesperado en CREATE:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
});

// READ - Leer todos los registros
app.get('/api/tables/:tableName/read', async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Validar tabla usando app_information_schema
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('READ REQUEST', { tableName });

    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order(primaryKey, { ascending: true });

    if (error) {
      const errorInfo = handleSupabaseError(error, 'lectura de registros');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }

    // Mapear datos para mantener compatibilidad con el frontend
    const mappedData = data.map((record, index) => ({
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
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor',
      error: error.message 
    });
  }
});

// SEARCH - Búsqueda simple
app.get('/api/tables/:tableName/search', async (req, res) => {
  try {
    const { tableName } = req.params;
    const { searchText, searchField } = req.query;
    
    // Validar tabla usando app_information_schema
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('SEARCH REQUEST', { tableName, searchText, searchField });

    let query = supabase.from(tableName).select('*');

    // Aplicar filtro si existe
    if (searchText && searchField) {
      query = query.ilike(searchField, `%${searchText}%`);
    }

    query = query.order(primaryKey, { ascending: true });

    const { data, error } = await query;
    
    if (error) {
      const errorInfo = handleSupabaseError(error, 'búsqueda de registros');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }

    // Mapear datos para mantener compatibilidad
    const mappedData = data.map((record, index) => ({
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
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor',
      error: error.message 
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
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor',
      error: error.message 
    });
  }
});

// UPDATE - Actualizar registro
app.put('/api/tables/:tableName/update', async (req, res) => {
  try {
    const { tableName } = req.params;
    const { searchCriteria, updateData } = req.body;
    
    // Validar tabla y obtener esquema
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

    const { data, error } = await supabase
      .from(tableName)
      .update(cleanUpdateData)
      .eq(searchCriteria.field, searchCriteria.value)
      .select()
      .maybeSingle();

    if (error) {
      const errorInfo = handleSupabaseError(error, 'actualización de registro');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `Registro no encontrado con ${searchCriteria.field}=${searchCriteria.value}`
      });
    }

    logOperation('UPDATE SUCCESS', data);

    res.json({
      success: true,
      message: 'Registro actualizado correctamente',
      data: {
        ...data,
        _primaryKey: data[primaryKey], // CORREGIDO: usar primaryKey del schema
        _rowIndex: 1
      }
    });
  } catch (error) {
    console.error('❌ Error inesperado en UPDATE:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

// DELETE - Eliminar registro
app.delete('/api/tables/:tableName/delete', async (req, res) => {
  try {
    const { tableName } = req.params;
    const { searchCriteria } = req.body;
    
    // Validar tabla y obtener esquema
    await validateTableAccess(tableName);
    const tableSchema = await getTableSchema(tableName);
    
    logOperation('DELETE REQUEST', { tableName, searchCriteria });

    if (!searchCriteria || !searchCriteria.field || !searchCriteria.value) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido para eliminar'
      });
    }

    const { data: deletedRecord, error } = await supabase
      .from(tableName)
      .delete()
      .eq(searchCriteria.field, searchCriteria.value)
      .select()
      .maybeSingle();

    if (error) {
      const errorInfo = handleSupabaseError(error, 'eliminación de registro');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }

    if (!deletedRecord) {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con ${searchCriteria.field}: ${searchCriteria.value}`,
      });
    }

    logOperation('DELETE SUCCESS', deletedRecord);

    res.json({
      success: true,
      message: 'Registro eliminado exitosamente',
      deletedRecord: deletedRecord,
    });
  } catch (error) {
    console.error('❌ Error inesperado en DELETE:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
});

app.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Probar conexión con app_information_schema
    const { data, error } = await supabase
      .from('app_information_schema')
      .select('count', { count: 'exact', head: true });

    const responseTime = Date.now() - startTime;

    if (error) {
      console.error('❌ Health check falló:', error);
      return res.status(503).json({ 
        status: 'unhealthy', 
        database: 'disconnected',
        error: error.message,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString()
      });
    }

    // Contar tablas disponibles
    const tables = await getDynamicTables();

    res.json({ 
      status: 'healthy', 
      database: 'connected',
      responseTime: `${responseTime}ms`,
      tablesAvailable: tables.length,
      tablesList: tables,
      supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'missing',
      supabaseKey: process.env.SUPABASE_ANON_KEY ? 'configured' : 'missing',
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
    console.log('🔄 Probando conexión inicial a Supabase...');
    
    // CORREGIDO: Usar app_information_schema en lugar de information_schema
    const { error } = await supabase
      .from('app_information_schema')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Error de conexión inicial:', error.message);
    } else {
      console.log('✅ Conexión a Supabase exitosa');
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
    }
  } catch (error) {
    console.error('❌ Error al probar conexión inicial:', error.message);
  }
});
