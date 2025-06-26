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

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal para servir el frontend
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

// READ - Leer todos los registros
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
      _rowIndex: index + 1
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

// SEARCH - Búsqueda simple
app.get('/webhook/search', async (req, res) => {
  try {
    const { searchText, searchField } = req.query;

    console.log('Búsqueda:', { searchText, searchField });

    let query = supabase.from('cooperativas').select('*');

    // Aplicar filtro si existe
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

// UPDATE - Actualizar registro
app.put('/webhook/update', async (req, res) => {
  try {
    const { searchCriteria, updateData } = req.body;
    
    console.log('Actualizando:', { searchCriteria, updateData });
    
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
        _rowIndex: 1
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

// DELETE - Eliminar registro (con body JSON)
app.delete('/webhook/delete', async (req, res) => {
  try {
    const { searchCriteria } = req.body;
    
    console.log('Eliminando:', searchCriteria);

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
      .single();

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con ${searchCriteria.field}: ${searchCriteria.value}`,
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

// FIELDS - Obtener campos disponibles (NUEVA RUTA)
app.get('/webhook/fields', async (req, res) => {
  try {
    // Campos disponibles basados en el esquema
    const fields = [
      'Legajo', 'Cooperativa', 'Matrícula', 'ActaPcial', 'EmisMat', 'Dirección',
      'DirecciónVerificada', 'Tel', 'Presid', 'Mail', 'EstadoEntid', 'FechaAsamb',
      'TipoAsamb', 'ConsejoAdmin', 'Sindicatura', 'Localidad', 'Departamento',
      'CodPost', 'Cuit', 'Tipo', 'Subtipo', 'Observaciones', 'Latitud', 'Longitud'
    ];

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend available at /`);
  console.log(`Health check available at /health`);
});
