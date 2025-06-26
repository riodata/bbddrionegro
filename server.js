// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// NUEVO: Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// NUEVO: Ruta principal para servir el frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CREATE - Crear nuevo registro
app.post('/webhook/create', async (req, res) => {
  try {
    const data = req.body;

    // Validar que el campo Legajo existe
    if (!data.Legajo) {
      return res.status(400).json({
        success: false,
        message: 'El campo Legajo es obligatorio para crear un registro.',
      });
    }

    // Comprobar si ya existe un registro con el mismo Legajo
    const { data: existingRecord } = await supabase
      .from('cooperativas')
      .select('Legajo')
      .eq('Legajo', data.Legajo)
      .single();

    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un registro con el Legajo proporcionado.',
      });
    }
    
    console.log('Datos recibidos:', data);

    const { data: newRecord, error } = await supabase
      .from('cooperativas')
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Registro creado exitosamente',
      Legajo: newRecord.Legajo,
    });
  } catch (error) {
    console.error('Error creando el registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear el registro',
      error: error.message,
    });
  }
});

// READ - Leer todos los registros (sin filtros)
app.get('/webhook/read', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cooperativas')
      .select('*');

    if (error) throw error;

    // Mapear datos para mantener compatibilidad con el frontend
    const mappedData = data.map((record, index) => ({
      _Legajo: record.Legajo,
      ...record,
      _rowIndex: index + 1 // Simular rowIndex para compatibilidad
    }));

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length
    });
  } catch (error) {
    console.error('Error reading records:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al leer los registros',
      error: error.message 
    });
  }
});

// Ruta para buscar el registro por Legajo al presionar un botón
app.get('/webhook/get/:Legajo', async (req, res) => {
  try {
    const { Legajo } = req.params;

    const { data: record, error } = await supabase
      .from('cooperativas')
      .select('*')
      .eq('Legajo', Legajo)
      .single();

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con el Legajo: ${Legajo}`,
      });
    }

    if (error) throw error;

    res.json({
      success: true,
      data: record,
    });
  } catch (error) {
    console.error('Error obteniendo el registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener el registro',
      error: error.message,
    });
  }
});

// SIMPLE SEARCH - Búsqueda simple con un campo y texto
app.get('/webhook/search', async (req, res) => {
  try {
    const { searchText, searchField } = req.query;

    let query = supabase.from('cooperativas').select('*');

    // Aplicar filtros si existen
    if (searchText && searchField) {
      query = query.ilike(searchField, `%${searchText}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Mapear datos para mantener compatibilidad
    const mappedData = data.map((record, index) => ({
      _Legajo: record.Legajo,
      ...record,
      _rowIndex: index + 1
    }));

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length,
      filtered: !!(searchText && searchField),
      searchText: searchText || null,
      searchField: searchField || null
    });
  } catch (error) {
    console.error('Error searching records:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al buscar los registros',
      error: error.message 
    });
  }
});

// FIELDS - Obtener campos disponibles para filtrado
app.get('/webhook/fields', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cooperativas')
      .select('*')
      .limit(1);

    if (error) throw error;

    if (data.length === 0) {
      return res.json({
        success: true,
        fields: [],
        message: 'No hay registros para obtener campos'
      });
    }

    // Obtener los nombres de las columnas
    const fields = Object.keys(data[0]).filter(field => 
      field !== '_Legajo' && field !== 'id' // Excluir campos internos
    );

    res.json({
      success: true,
      fields: fields
    });
  } catch (error) {
    console.error('Error getting fields:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener los campos',
      error: error.message 
    });
  }
});

// ADVANCED SEARCH - Búsqueda avanzada con múltiples filtros
app.post('/webhook/search/advanced', async (req, res) => {
  try {
    const { filters } = req.body;

    let query = supabase.from('cooperativas').select('*');

    if (filters && Array.isArray(filters) && filters.length > 0) {
      filters.forEach(filter => {
        const { field, value, operator = 'contains' } = filter;
        
        switch (operator) {
          case 'equals':
            query = query.eq(field, value);
            break;
          case 'contains':
            query = query.ilike(field, `%${value}%`);
            break;
          case 'startsWith':
            query = query.ilike(field, `${value}%`);
            break;
          case 'endsWith':
            query = query.ilike(field, `%${value}`);
            break;
          case 'notEquals':
            query = query.neq(field, value);
            break;
          default:
            query = query.ilike(field, `%${value}%`);
        }
      });
    }

    const { data, error } = await query;
    if (error) throw error;

    // Mapear datos para mantener compatibilidad
    const mappedData = data.map((record, index) => ({
      _Legajo: record.Legajo,
      ...record,
      _rowIndex: index + 1
    }));

    res.json({
      success: true,
      data: mappedData,
      total: mappedData.length,
      filtersApplied: filters?.length || 0,
      filters: filters || []
    });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al realizar búsqueda avanzada',
      error: error.message 
    });
  }
});

// UPDATE - Actualizar un registro específico
app.put('/webhook/update', async (req, res) => {
  try {
    const { searchCriteria, updateData } = req.body;
    
    console.log('Datos recibidos para actualizar:', updateData);
    
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
      .single();

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({
        success: false,
        message: `Registro no encontrado con ${searchCriteria.field}=${searchCriteria.value}`
      });
    }

    if (error) throw error;

    res.json({
      success: true,
      message: 'Registro actualizado correctamente',
      data: {
        ...data,
        _Legajo: data.Legajo,
        _rowIndex: 1 // Placeholder para compatibilidad
      }
    });
  } catch (error) {
    console.error('Error updating record:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar el registro',
      error: error.message
    });
  }
});

// DELETE - Eliminar registro con búsqueda previa
app.delete('/webhook/delete/:Legajo', async (req, res) => {
  try {
    const { Legajo } = req.params;

    const { data: deletedRecord, error } = await supabase
      .from('cooperativas')
      .delete()
      .eq('Legajo', Legajo)
      .select()
      .single();

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con el Legajo: ${Legajo}`,
      });
    }

    if (error) throw error;

    res.json({
      success: true,
      message: 'Registro eliminado exitosamente',
      deletedRecord: deletedRecord,
    });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el registro',
      error: error.message,
    });
  }
});

// Manejo de errores global
// Test connection
app.get('/test-connection', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cooperativas')
      .select('count', { count: 'exact', head: true });

    if (error) throw error;

    res.json({
      status: 'success',
      message: 'Conexión a Supabase exitosa',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase
      .from('cooperativas')
      .select('count', { count: 'exact', head: true });

    if (error) throw error;

    res.json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Stats
app.get('/stats', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('cooperativas')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    res.json({
      timestamp: new Date().toISOString(),
      totalRecords: count,
      serverUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(503).json({
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend available at /`);
  console.log(`Health check available at /health`);
  console.log(`Keep-alive available at /ping`);
});
