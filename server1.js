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

// CONFIGURACIÓN DE TABLAS DISPONIBLES
const AVAILABLE_TABLES = {
  cooperativas: {
    name: 'Cooperativas',
    description: 'Sistema de gestión de entidades (cooperativas)',
    tables: {
      cooperativas: {
        name: 'Cooperativas General',
        description: 'Registro principal de cooperativas de la Provincia de Río Negro',
        primaryKey: 'Matrícula'
      },
      financ_anr_coope: {
        name: 'Financiamientos y ANR Cooperativas',
        description: 'Registro de financiamientos y ANR otorgados a cooperativas de la Provincia de Río Negro',
        primaryKey: 'orden'
      },
      asesoria_contable: {
        name: 'Asesoría Contable',
        description: 'Registro de asesorías contables brindadas a cooperativas y mutuales de la Provincia de Río Negro',
        primaryKey: 'nota'
      },
      capacitaciones: {
        name: 'Capacitaciones',
        description: 'Registro de capacitaciones brindadas a cooperativas y mutuales de la Provincia de Río Negro',
        primaryKey: 'id'
      }
    }
  },
  mutuales: {
    name: 'Mutuales',
    description: 'Sistema de gestión de entidades (mutuales)',
    tables: {
      mutuales: {
        name: 'Mutuales General',
        description: 'Registro principal de mutuales de la Provincia de Río Negro',
        primaryKey: 'mat_nac'
      },
      financ_anr_mutuales: {
        name: 'Financiamientos y ANR Mutuales',
        description: 'Registro de financiamientos y ANR otorgados a mutuales de la Provincia de Río Negro',
        primaryKey: 'orden'
      },
      asesoria_contable: {
        name: 'Asesoría Contable',
        description: 'Registro de asesorías contables brindadas a cooperativas y mutuales de la Provincia de Río Negro',
        primaryKey: 'nota'
      },
      capacitaciones: {
        name: 'Capacitaciones',
        description: 'Registro de capacitaciones brindadas a cooperativas y mutuales de la Provincia de Río Negro',
        primaryKey: 'id'
      }
    }
  }
};

const app = express();
const PORT = process.env.PORT || 8000;

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

// Función auxiliar para validar tabla
const validateTable = (category, tableName) => {
  if (!AVAILABLE_TABLES[category]) {
    throw new Error(`Categoría '${category}' no válida`);
  }
  
  if (!AVAILABLE_TABLES[category].tables[tableName]) {
    throw new Error(`Tabla '${tableName}' no válida para categoría '${category}'`);
  }
  
  return AVAILABLE_TABLES[category].tables[tableName];
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

// NUEVOS ENDPOINTS PARA CONFIGURACIÓN

// Obtener categorías disponibles
app.get('/api/categories', (req, res) => {
  try {
    const categories = Object.keys(AVAILABLE_TABLES).map(key => ({
      id: key,
      name: AVAILABLE_TABLES[key].name,
      description: AVAILABLE_TABLES[key].description
    }));
    
    res.json({
      success: true,
      categories: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener categorías',
      error: error.message
    });
  }
});

// Obtener tablas de una categoría
app.get('/api/categories/:category/tables', (req, res) => {
  try {
    const { category } = req.params;
    
    if (!AVAILABLE_TABLES[category]) {
      return res.status(404).json({
        success: false,
        message: `Categoría '${category}' no encontrada`
      });
    }
    
    const tables = Object.keys(AVAILABLE_TABLES[category].tables).map(key => ({
      id: key,
      ...AVAILABLE_TABLES[category].tables[key]
    }));
    
    res.json({
      success: true,
      category: {
        id: category,
        name: AVAILABLE_TABLES[category].name,
        description: AVAILABLE_TABLES[category].description
      },
      tables: tables
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener tablas',
      error: error.message
    });
  }
});

// ENDPOINTS DINÁMICOS PARA OPERACIONES CRUD

// CREATE - Crear nuevo registro
app.post('/api/:category/:table/create', async (req, res) => {
  try {
    const { category, table } = req.params;
    const data = req.body;
    
    const tableConfig = validateTable(category, table);
    const primaryKey = tableConfig.primaryKey;
    
    logOperation('CREATE REQUEST', { category, table, data });

    // Validar que el campo primaryKey existe
    if (!data[primaryKey]) {
      return res.status(400).json({
        success: false,
        message: `El campo ${primaryKey} es obligatorio para crear un registro.`,
      });
    }

    // Comprobar si ya existe un registro con la misma clave primaria
    const { data: existingRecord, error: searchError } = await supabase
      .from(table)
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
      .from(table)
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
app.get('/api/:category/:table/read', async (req, res) => {
  try {
    const { category, table } = req.params;
    const tableConfig = validateTable(category, table);
    const primaryKey = tableConfig.primaryKey;
    
    logOperation('READ REQUEST', { category, table });

    const { data, error } = await supabase
      .from(table)
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
      primaryKey: primaryKey
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
app.get('/api/:category/:table/search', async (req, res) => {
  try {
    const { category, table } = req.params;
    const { searchText, searchField } = req.query;
    const tableConfig = validateTable(category, table);
    const primaryKey = tableConfig.primaryKey;
    
    logOperation('SEARCH REQUEST', { category, table, searchText, searchField });

    let query = supabase.from(table).select('*');

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
      availableCategories: Object.keys(AVAILABLE_TABLES),
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
  console.log(`📊 Available categories: ${Object.keys(AVAILABLE_TABLES).join(', ')}`);
  
  // Probar conexión al iniciar
  try {
    console.log('🔄 Probando conexión inicial a Supabase...');
    const { error } = await supabase
      .from('cooperativas')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Error de conexión inicial:', error.message);
    } else {
      console.log('✅ Conexión a Supabase exitosa');
    }
  } catch (error) {
    console.error('❌ Error al probar conexión inicial:', error.message);
  }
});
