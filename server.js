// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// NUEVO: Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Google Sheets
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Inicializar Google Sheets
async function initializeSheet() {
  const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc.sheetsByIndex[0]; // Primera hoja
}

// NUEVO: Ruta principal para servir el frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CREATE - Crear nuevo registro
app.post('/webhook/create', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const data = req.body;

    // Validar que el campo Legajo existe
    if (!data.Legajo) {
      return res.status(400).json({
        success: false,
        message: 'El campo Legajo es obligatorio para crear un registro.',
      });
    }

    // Comprobar si ya existe un registro con el mismo Legajo
    const rows = await sheet.getRows();
    const existingRow = rows.find(row => row.Legajo === data.Legajo);
    if (existingRow) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un registro con el Legajo proporcionado.',
      });
    }
    
    // Agregar fila
    console.log('Datos recibidos:', data); // Log para depuración

    const row = await sheet.addRow(data);
    
    res.json({
      success: true,
      message: 'Registro creado exitosamente',
      Legajo: row.Legajo,
    });
  } catch (error) {
    console.error('Error creando el registro:', error); // Log detallado
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
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();
    
    // Obtener el índice (posición) de la columna Legajo
    const headerRow = await sheet.headerValues;
    const legajoIndex = headerRow.findIndex(header => header === 'Legajo');

    // Generar datos con Legajo explícito
    let data = rows.map((row, index) => {
      const rowObject = row.toObject();
      
      // Asegurarse de que el campo Legajo esté incluido explícitamente
      // (en caso de que no esté en el objeto por alguna razón)
      return {
        _Legajo: row.get('Legajo'), // Usar el valor real de la columna Legajo
        ...rowObject,  // Resto de los datos del registro
        _rowIndex: row.rowIndex // Mantener el índice por compatibilidad
      };
    });

    res.json({
      success: true,
      data: data,
      total: data.length
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

    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    const record = rows.find(row => row.Legajo === Legajo);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con el Legajo: ${Legajo}`,
      });
    }

    res.json({
      success: true,
      data: record.toObject(),
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
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    // Obtener el índice de la columna Legajo
    const headerRow = await sheet.headerValues;
    const legajoIndex = headerRow.findIndex(header => header === 'Legajo');

    let data = rows.map(row => {
      const rowObject = row.toObject();
      return {
        _Legajo: row.get('Legajo'), // Agregar explícitamente el campo Legajo
        ...rowObject,
        _rowIndex: row.rowIndex
      };
    });

    // Aplicar filtros si existen en los query parameters
    const { searchText, searchField } = req.query;

    if (searchText && searchField) {
      data = data.filter(record => {
        const fieldValue = record[searchField];
        if (fieldValue === undefined || fieldValue === null) return false;

        // Búsqueda case-insensitive y parcial
        return fieldValue.toString().toLowerCase().includes(searchText.toLowerCase());
      });
    }

    res.json({
      success: true,
      data: data,
      total: data.length,
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
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    if (rows.length === 0) {
      return res.json({
        success: true,
        fields: [],
        message: 'No hay registros para obtener campos'
      });
    }

    // Obtener los nombres de las columnas del primer registro (excluir _Legajo)
    const fields = Object.keys(rows[0].toObject()).filter(field => field !== '_Legajo');

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
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    // Obtener explícitamente el Legajo para cada registro
    let data = rows.map(row => {
      const rowObject = row.toObject();
      return {
        _Legajo: row.get('Legajo'), // Agregar explícitamente el campo Legajo
        ...rowObject,
        _rowIndex: row.rowIndex
      };
    });

    const { filters } = req.body;

    if (filters && Array.isArray(filters) && filters.length > 0) {
      data = data.filter(record => {
        return filters.every(filter => {
          const { field, value, operator = 'contains' } = filter;
          const fieldValue = record[field];

          if (fieldValue === undefined || fieldValue === null) return false;

          const recordValue = fieldValue.toString().toLowerCase();
          const searchValue = value.toString().toLowerCase();

          switch (operator) {
            case 'equals':
              return recordValue === searchValue;
            case 'contains':
              return recordValue.includes(searchValue);
            case 'startsWith':
              return recordValue.startsWith(searchValue);
            case 'endsWith':
              return recordValue.endsWith(searchValue);
            case 'notEquals':
              return recordValue !== searchValue;
            default:
              return recordValue.includes(searchValue);
          }
        });
      });
    }

    res.json({
      success: true,
      data: data,
      total: data.length,
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
    
    if (!searchCriteria || !searchCriteria.field || searchCriteria.value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido'
      });
    }

    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    // Buscar la fila usando el criterio de búsqueda
    const rowToUpdate = rows.find(row => {
      const rowData = row.toObject();
      return rowData[searchCriteria.field] == searchCriteria.value;
    });

    if (!rowToUpdate) {
      return res.status(404).json({
        success: false,
        message: `Registro no encontrado con ${searchCriteria.field}=${searchCriteria.value}`
      });
    }

    // Actualizar los campos
    Object.keys(updateData).forEach(key => {
      if (key !== '_rowIndex' && key !== '_Legajo') { // No actualizar los índices internos
        rowToUpdate[key] = updateData[key];
      }
    });

    await rowToUpdate.save();

    // MODIFICACIÓN: Usar directamente updateData en la respuesta
    // en lugar de rowToUpdate.toObject()
    res.json({
      success: true,
      message: 'Registro actualizado correctamente',
      data: {
        ...updateData, // Usar los datos actualizados enviados por el cliente
        _Legajo: rowToUpdate.get('Legajo'),
        _rowIndex: rowToUpdate.rowIndex
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

    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    // Encontrar la fila por Legajo
    const rowToDelete = rows.find(row => row.Legajo === Legajo);

    if (!rowToDelete) {
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con el Legajo: ${Legajo}`,
      });
    }

    const deletedRecord = rowToDelete.toObject();
    await rowToDelete.delete();

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
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor' 
  });
});

// Sistema de logging y monitoreo
const fs = require('fs').promises;

// Log requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// Endpoint de estadísticas
app.get('/stats', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    res.json({
      timestamp: new Date().toISOString(),
      totalRecords: rows.length,
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

// Endpoint de prueba de conectividad
app.get('/test-connection', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const info = await sheet.doc.loadInfo();

    res.json({
      status: 'success',
      sheetTitle: info.title,
      sheetCount: info.sheetCount,
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

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test Google Sheets connection
    const sheet = await initializeSheet();
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

// NUEVO: Manejar rutas SPA - debe ir al final
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend available at /`);
  console.log(`Health check available at /health`);
  console.log(`Keep-alive available at /ping`);
});
