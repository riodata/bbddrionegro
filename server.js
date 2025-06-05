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

// READ - Leer todos los registros
app.get('/webhook/read', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();
    
    const data = rows.map(row => row.toObject());
    
    res.json(data);
  } catch (error) {
    console.error('Error reading records:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al leer los registros',
      error: error.message 
    });
  }
});

// UPDATE - Actualizar registro
app.put('/webhook/update', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const { originalRecord, ...updateData } = req.body;
    
    const rows = await sheet.getRows();
    
    // Buscar la fila que coincida con el registro original
    const rowToUpdate = rows.find(row => {
      const rowData = row.toObject();
      return Object.keys(originalRecord).every(key => 
        rowData[key] === originalRecord[key]
      );
    });
    
    if (!rowToUpdate) {
      return res.status(404).json({ 
        success: false, 
        message: 'Registro no encontrado' 
      });
    }
    
    // Actualizar los datos
    Object.keys(updateData).forEach(key => {
      rowToUpdate.set(key, updateData[key]);
    });
    
    await rowToUpdate.save();
    
    res.json({ 
      success: true, 
      message: 'Registro actualizado exitosamente' 
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

// DELETE - Eliminar registro
app.delete('/webhook/delete', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const recordToDelete = req.body;
    
    const rows = await sheet.getRows();
    
    // Buscar la fila que coincida con el registro a eliminar
    const rowToDelete = rows.find(row => {
      const rowData = row.toObject();
      return Object.keys(recordToDelete).every(key => 
        rowData[key] === recordToDelete[key]
      );
    });
    
    if (!rowToDelete) {
      return res.status(404).json({ 
        success: false, 
        message: 'Registro no encontrado' 
      });
    }
    
    await rowToDelete.delete();
    
    res.json({ 
      success: true, 
      message: 'Registro eliminado exitosamente' 
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
