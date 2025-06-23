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

    console.log('Datos recibidos:', data); // Log para depuración

    const row = await sheet.addRow(data);

    res.json({
      success: true,
      message: 'Registro creado exitosamente',
      rowNumber: row.rowNumber,
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

    let data = rows.map(row => ({
      ...row.toObject(),
      _rowIndex: row.rowIndex // Incluir índice de fila para operaciones UPDATE/DELETE
    }));

    res.json({
      success: true,
      data: data,
      total: data.length,
    });
  } catch (error) {
    console.error('Error leyendo los registros:', error);
    res.status(500).json({
      success: false,
      message: 'Error al leer los registros',
      error: error.message,
    });
  }
});

// SIMPLE SEARCH - Búsqueda simple con un campo y texto
app.get('/webhook/search', async (req, res) => {
  try {
    const sheet = await initializeSheet();
    const rows = await sheet.getRows();

    let data = rows.map(row => ({
      ...row.toObject(),
      _rowIndex: row.rowIndex,
    }));

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
    });
  } catch (error) {
    console.error('Error buscando registros:', error);
    res.status(500).json({
      success: false,
      message: 'Error al buscar los registros',
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
