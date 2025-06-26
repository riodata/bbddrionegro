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

// Configuración de Supabase con mejor manejo de errores
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

// CREATE - Crear nuevo registro
app.post('/webhook/create', async (req, res) => {
  try {
    const data = req.body;
    logOperation('CREATE REQUEST', data);

    // Validar que el campo Legajo existe
    if (!data.Legajo) {
      return res.status(400).json({
        success: false,
        message: 'El campo Legajo es obligatorio para crear un registro.',
      });
    }

    // Comprobar si ya existe un registro con el mismo Legajo
    const { data: existingRecord, error: searchError } = await supabase
      .from('cooperativas')
      .select('Legajo')
      .eq('Legajo', data.Legajo)
      .maybeSingle(); // Usar maybeSingle() en lugar de single()

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
        message: 'Ya existe un registro con el Legajo proporcionado.',
      });
    }

    // Insertar nuevo registro
    const { data: newRecord, error: insertError } = await supabase
      .from('cooperativas')
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
      Legajo: newRecord.Legajo,
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
app.get('/webhook/read', async (req, res) => {
  try {
    logOperation('READ REQUEST', 'Solicitando todos los registros');

    const { data, error } = await supabase
      .from('cooperativas')
      .select('*')
      .order('Legajo', { ascending: true });

    if (error) {
      const errorInfo = handleSupabaseError(error, 'lectura de registros');
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.message
      });
    }

    // Mapear datos para mantener compatibilidad con el frontend
    const mappedData = data.map((record, index) => ({
      _Legajo: record.Legajo,
      ...record,
      _rowIndex: index + 1
    }));

    logOperation('READ SUCCESS', `${mappedData.length} registros encontrados`);

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length
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
app.get('/webhook/search', async (req, res) => {
  try {
    const { searchText, searchField } = req.query;
    logOperation('SEARCH REQUEST', { searchText, searchField });

    let query = supabase.from('cooperativas').select('*');

    // Aplicar filtro si existe
    if (searchText && searchField) {
      // Validar que el campo de búsqueda existe
      const validFields = [
        'Legajo', 'Cooperativa', 'Matrícula', 'ActaPcial', 'EmisMat', 'Dirección',
        'DirecciónVerificada', 'Tel', 'Presid', 'Mail', 'EstadoEntid', 'FechaAsamb',
        'TipoAsamb', 'ConsejoAdmin', 'Sindicatura', 'Localidad', 'Departamento',
        'CodPost', 'Cuit', 'Tipo', 'Subtipo', 'Observaciones', 'Latitud', 'Longitud'
      ];
      
      if (!validFields.includes(searchField)) {
        return res.status(400).json({
          success: false,
          message: `Campo de búsqueda '${searchField}' no válido`
        });
      }
      
      query = query.ilike(searchField, `%${searchText}%`);
    }

    query = query.order('Legajo', { ascending: true });

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
      _Legajo: record.Legajo,
      ...record,
      _rowIndex: index + 1
    }));

    logOperation('SEARCH SUCCESS', `${mappedData.length} registros encontrados`);

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length,
      searchText: searchText || null,
      searchField: searchField || null
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
app.put('/webhook/update', async (req, res) => {
  try {
    const { searchCriteria, updateData } = req.body;
    logOperation('UPDATE REQUEST', { searchCriteria, updateData });
    
    if (!searchCriteria || !searchCriteria.field || searchCriteria.value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido'
      });
    }

    // Limpiar updateData de campos internos
    const cleanUpdateData = { ...updateData };
    delete cleanUpdateData._rowIndex;
    delete cleanUpdateData._Legajo;

    const { data, error } = await supabase
      .from('cooperativas')
      .update(cleanUpdateData)
      .eq(searchCriteria.field, searchCriteria.value)
      .select()
      .maybeSingle(); // Usar maybeSingle() en lugar de single()

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
        _Legajo: data.Legajo,
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
app.delete('/webhook/delete', async (req, res) => {
  try {
    const { searchCriteria } = req.body;
    logOperation('DELETE REQUEST', searchCriteria);

    if (!searchCriteria || !searchCriteria.field || !searchCriteria.value) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido para eliminar'
      });
    }

    const { data: deletedRecord, error } = await supabase
      .from('cooperativas')
      .delete()
      .eq(searchCriteria.field, searchCriteria.value)
      .select()
      .maybeSingle(); // Usar maybeSingle() en lugar de single()

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
app.get('/webhook/fields', async (req, res) => {
  try {
    logOperation('FIELDS REQUEST', 'Obteniendo campos de la tabla');

    // Intentar obtener los campos mediante una consulta de muestra
    const { data: sampleData, error } = await supabase
      .from('cooperativas')
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
    } else {
      // Fallback a campos predefinidos si no hay datos
      fields = [
        'Legajo', 'Cooperativa', 'Matrícula', 'ActaPcial', 'EmisMat', 'Dirección',
        'DirecciónVerificada', 'Tel', 'Presid', 'Mail', 'EstadoEntid', 'FechaAsamb',
        'TipoAsamb', 'ConsejoAdmin', 'Sindicatura', 'Localidad', 'Departamento',
        'CodPost', 'Cuit', 'Tipo', 'Subtipo', 'Observaciones', 'Latitud', 'Longitud'
      ];
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
    
    // Probar conexión con una consulta simple
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

// Test connection mejorado
app.get('/test-connection', async (req, res) => {
  try {
    console.log('🔄 Probando conexión a Supabase...');
    
    const startTime = Date.now();
    
    // Probar múltiples operaciones
    const tests = [];
    
    // Test 1: Contar registros
    try {
      const { count, error: countError } = await supabase
        .from('cooperativas')
        .select('*', { count: 'exact', head: true });
      
      tests.push({
        test: 'count_records',
        success: !countError,
        result: countError ? countError.message : `${count} registros`,
        error: countError?.message
      });
    } catch (e) {
      tests.push({
        test: 'count_records',
        success: false,
        error: e.message
      });
    }

    // Test 2: Leer un registro
    try {
      const { data, error: readError } = await supabase
        .from('cooperativas')
        .select('Legajo')
        .limit(1)
        .maybeSingle();
      
      tests.push({
        test: 'read_sample',
        success: !readError,
        result: readError ? readError.message : (data ? 'Datos disponibles' : 'Sin datos'),
        error: readError?.message
      });
    } catch (e) {
      tests.push({
        test: 'read_sample',
        success: false,
        error: e.message
      });
    }

    const responseTime = Date.now() - startTime;
    const allTestsPassed = tests.every(test => test.success);

    console.log(`✅ Test de conexión completado en ${responseTime}ms`);

    res.json({
      status: allTestsPassed ? 'success' : 'partial_failure',
      message: allTestsPassed ? 'Todas las pruebas pasaron' : 'Algunas pruebas fallaron',
      responseTime: `${responseTime}ms`,
      environment: {
        supabaseUrl: process.env.SUPABASE_URL ? 'configured' : 'missing',
        supabaseKey: process.env.SUPABASE_ANON_KEY ? 'configured' : 'missing'
      },
      tests: tests,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error en test de conexión:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
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
  console.log(`🔧 Test connection available at /test-connection`);
  
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
