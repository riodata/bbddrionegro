// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Validar variables de entorno al inicio
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ Error: Variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias');
  console.error('Verifica tu archivo .env');
  process.exit(1);
}

// Configuración de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

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

// Actualizar getDynamicTables para excluir tabla de configuración
async function getDynamicTables() {
  try {
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_type', 'BASE TABLE')
      .neq('table_name', 'table_categories') // Excluir tabla de configuración
      .order('table_name');
    
    if (error) throw error;
    return data.map(row => row.table_name);
  } catch (error) {
    console.error('Error obteniendo tablas:', error);
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

// ENDPOINTS DINÁMICOS PARA OPERACIONES CRUD

// CREATE - Crear nuevo registro
// CREATE - Crear nuevo registro (versión dinámica)
app.post('/api/tables/:tableName/create', async (req, res) => {
  try {
    const { tableName } = req.params;
    const data = req.body;
    
    // Validar tabla y obtener esquema
    await validateTableExists(tableName);
    const tableSchema = await getTableSchema(tableName);
    const primaryKey = tableSchema.primaryKey;
    
    logOperation('CREATE REQUEST', { tableName, data });

    // Validar que el campo primaryKey existe
    if (!data[primaryKey]) {
      return res.status(400).json({
        success: false,
        message: `El campo ${primaryKey} es obligatorio para crear un registro.`,
      });
    }

    // Comprobar si ya existe un registro con la misma clave primaria
    const { data: existingRecord, error: searchError } = await supabase
      .from(tableName)
      .select(primaryKey)
      .eq(primaryKey, data[primaryKey])
      .maybeSingle();

    if (searchError) {
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
// READ - Leer todos los registros (versión dinámica)
app.get('/api/tables/:tableName/read', async (req, res) => {
  try {
    const { tableName } = req.params;
    
    // Validar tabla y obtener esquema
    await validateTableExists(tableName);
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
    
    // Validar tabla y obtener esquema
    await validateTableExists(tableName);
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

// UPDATE - Actualizar registro
app.put('/api/:category/:table/update', async (req, res) => {
  try {
    const { category, table } = req.params;
    const { searchCriteria, updateData } = req.body;
    const tableConfig = validateTable(category, table);
    
    logOperation('UPDATE REQUEST', { category, table, searchCriteria, updateData });
    
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
      .from(table)
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
        _primaryKey: data[tableConfig.primaryKey],
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
app.delete('/api/:category/:table/delete', async (req, res) => {
  try {
    const { category, table } = req.params;
    const { searchCriteria } = req.body;
    const tableConfig = validateTable(category, table);
    
    logOperation('DELETE REQUEST', { category, table, searchCriteria });

    if (!searchCriteria || !searchCriteria.field || !searchCriteria.value) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido para eliminar'
      });
    }

    const { data: deletedRecord, error } = await supabase
      .from(table)
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

// FIELDS - Obtener campos disponibles usando introspección de Supabase
app.get('/api/:category/:table/fields', async (req, res) => {
  try {
    const { category, table } = req.params;
    validateTable(category, table);
    
    logOperation('FIELDS REQUEST', { category, table });

    // Intentar obtener los campos mediante una consulta de muestra
    const { data: sampleData, error } = await supabase
      .from(table)
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      const errorInfo = handleSupabaseError(error, 'obtención de campos');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }

    // Si hay datos, obtener los campos del primer registro
    let fields = [];
    if (sampleData) {
      fields = Object.keys(sampleData).filter(key => !key.startsWith('_'));
    }

    logOperation('FIELDS SUCCESS', `${fields.length} campos encontrados`);

    res.json({
      success: true,
      fields: fields,
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

// Health check mejorado
app.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Probar conexión con una consulta simple en la tabla cooperativas
    const { data, error } = await supabase
      .from('cooperativas')
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

  res.json({ 
    status: 'healthy', 
    database: 'connected',
    responseTime: `${responseTime}ms`,
    supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'missing',
    supabaseKey: process.env.SUPABASE_ANON_KEY ? 'configured' : 'missing',
    dynamicTables: 'enabled',
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
  console.log(`🔄 Sistema dinámico activado - detectando tablas automáticamente`);
  
  // Probar conexión y mostrar tablas disponibles
  try {
    console.log('🔄 Probando conexión inicial a Supabase...');
    const { error } = await supabase
      .from('information_schema.tables')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Error de conexión inicial:', error.message);
    } else {
      console.log('✅ Conexión a Supabase exitosa');
      
      // Mostrar tablas disponibles
      try {
        const tables = await getDynamicTables();
        console.log(`📊 Tablas detectadas: ${tables.join(', ')}`);
      } catch (tableError) {
        console.log('⚠️ No se pudieron listar las tablas automáticamente');
      }
    }
  } catch (error) {
    console.error('❌ Error al probar conexión inicial:', error.message);
  }
});
