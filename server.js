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

// Helper function to read all records
async function readRecords() {
  const sheet = await initializeSheet();
  const rows = await sheet.getRows();
  
  return rows.map(row => ({
    ...row.toObject(),
    _rowIndex: row.rowIndex
  }));
}

// Helper function to find row index by legajo
async function findRowIndexByLegajo(legajo) {
  const records = await readRecords();
  
  // Find the record with the matching legajo (case insensitive)
  const rowIndex = records.findIndex(record => {
    // Find the legajo field regardless of case
    const legajoField = Object.keys(record).find(key => 
      key.toLowerCase() === 'legajo'
    );
    
    return legajoField && String(record[legajoField]) === String(legajo);
  });
  
  if (rowIndex === -1) {
    throw new Error('Registro no encontrado');
  }
  
  return rowIndex;
}


// Helper function to update a record
async function updateRecord(rowIndex, data) {
  const sheet = await initializeSheet();
  const rows = await sheet.getRows();
  
  // Find the row by index
  const rowToUpdate = rows.find(row => row.rowIndex === parseInt(rowIndex));
  
  if (!rowToUpdate) {
    throw new Error('Registro no encontrado');
  }
  
  // Update the fields
  Object.keys(data).forEach(key => {
    if (key !== '_rowIndex') {
      rowToUpdate[key] = data[key];
    }
  });
  
  await rowToUpdate.save();
  return rowToUpdate;
}

// Helper function to delete a record
async function deleteRecord(rowIndex) {
  const sheet = await initializeSheet();
  const rows = await sheet.getRows();
  
  // Find the row by index
  const rowToDelete = rows.find(row => row.rowIndex === parseInt(rowIndex));
  
  if (!rowToDelete) {
    throw new Error('Registro no encontrado');
  }
  
  await rowToDelete.delete();
  return true;
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
    
    // Agregar fila
    const row = await sheet.addRow(data);
    
    res.json({ 
      success: true, 
      message: 'Registro creado exitosamente',
      rowNumber: row.rowNumber 
    });
  } catch (error) {
    console.error('Error creating record:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al crear el registro',
      error: error.message 
    });
  }
});

// READ - Leer todos los registros (sin filtros)
app.get('/webhook/read', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();
    
    let data = rows.map(row => ({
      ...row.toObject(),
      _rowIndex: row.rowIndex // Incluir índice de fila para operaciones UPDATE/DELETE
    }));
    
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

// SIMPLE SEARCH - Búsqueda simple con un campo y texto
app.get('/webhook/search', async (req, res) => {
    try {
        const { searchText, searchField } = req.query;
        const sheet = await initializeSheet();
        const rows = await sheet.getRows();

        let data = rows.map(row => ({
            ...row.toObject(),
            _rowIndex: row.rowIndex
        }));

        // Filter by searchField and searchText
        if (searchText && searchField) {
            data = data.filter(record => {
                const fieldValue = record[searchField];
                return fieldValue && fieldValue.toString().toLowerCase().includes(searchText.toLowerCase());
            });
        }

        res.json({ success: true, data: data, total: data.length });
    } catch (error) {
        console.error('Error searching records:', error);
        res.status(500).json({ success: false, message: 'Error al realizar la búsqueda.', error: error.message });
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
    
    // Obtener los nombres de las columnas del primer registro (excluir _rowIndex)
    const fields = Object.keys(rows[0].toObject()).filter(field => field !== '_rowIndex');
    
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
    
    let data = rows.map(row => ({
      ...row.toObject(),
      _rowIndex: row.rowIndex
    }));
    
    const { filters } = req.body; // Array de objetos: [{field, value, operator}]
    
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

// DELETE - Eliminar un registro específico por índice de fila
app.delete('/webhook/delete/:rowIndex', async (req, res) => {
  try {
    const { rowIndex } = req.params;
    
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();
    
    // Encontrar la fila por índice
    const rowToDelete = rows.find(row => row.rowIndex === parseInt(rowIndex));
    
    if (!rowToDelete) {
      return res.status(404).json({
        success: false,
        message: 'Registro no encontrado'
      });
    }
    
    const deletedRecord = rowToDelete.toObject();
    await rowToDelete.delete();
    
    res.json({
      success: true,
      message: 'Registro eliminado correctamente',
      deletedRecord: deletedRecord
    });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el registro',
      error: error.message
    });
  }
});

// Update Record by Legajo
app.put('/webhook/update-by-legajo/:legajo', async (req, res) => {
    try {
        const { legajo } = req.params;
        const data = req.body;

        // Find the record with the matching legajo
        const rowIndex = await findRowIndexByLegajo(legajo);

        // Update the record in Google Sheets
        await updateRecord(rowIndex, data);

        res.json({ success: true, message: 'Registro actualizado correctamente.' });
    } catch (error) {
        console.error('Error updating record by legajo:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el registro.', error: error.message });
    }
});

// Delete Record by Legajo
app.delete('/webhook/delete-by-legajo/:legajo', async (req, res) => {
    try {
        const { legajo } = req.params;

        // Find the record with the matching legajo
        const rowIndex = await findRowIndexByLegajo(legajo);

        // Delete the record from Google Sheets
        await deleteRecord(rowIndex);

        res.json({ success: true, message: 'Registro eliminado correctamente.' });
    } catch (error) {
        console.error('Error deleting record by legajo:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar el registro.', error: error.message });
    }
});

// UPDATE - Actualizar un registro específico
app.put('/webhook/update/:rowIndex', async (req, res) => {
  try {
    const { rowIndex } = req.params;
    const updateData = req.body;
    
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();
    
    // Encontrar la fila por índice
    const rowToUpdate = rows.find(row => row.rowIndex === parseInt(rowIndex));
    
    if (!rowToUpdate) {
      return res.status(404).json({
        success: false,
        message: 'Registro no encontrado'
      });
    }
    
    // Actualizar los campos
    Object.keys(updateData).forEach(key => {
      if (key !== '_rowIndex') { // No actualizar el índice interno
        rowToUpdate[key] = updateData[key];
      }
    });
    
    await rowToUpdate.save();
    
    res.json({
      success: true,
      message: 'Registro actualizado correctamente',
      data: {
        ...rowToUpdate.toObject(),
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
app.delete('/webhook/delete', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const { searchCriteria } = req.body;
    
    const rows = await sheet.getRows();
    
    // Buscar la fila usando criterios de búsqueda más flexibles
    const rowToDelete = rows.find(row => {
      const rowData = row.toObject();
      
      if (searchCriteria.recordToDelete) {
        // Método original - buscar por registro completo
        return Object.keys(searchCriteria.recordToDelete).every(key => 
          rowData[key] === searchCriteria.recordToDelete[key]
        );
      } else if (searchCriteria.field && searchCriteria.value) {
        // Nuevo método - buscar por campo específico
        return rowData[searchCriteria.field] === searchCriteria.value;
      }
      
      return false;
    });
    
    if (!rowToDelete) {
      return res.status(404).json({ 
        success: false, 
        message: 'Registro no encontrado con los criterios especificados' 
      });
    }
    
    const deletedRecord = rowToDelete.toObject();
    await rowToDelete.delete();
    
    res.json({ 
      success: true, 
      message: 'Registro eliminado exitosamente',
      deletedRecord: deletedRecord
    });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al eliminar el registro',
      error: error.message 
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
