// server.js - Versión corregida con nombre de tabla correcto
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// ====== SISTEMA DE LOGGING ======
class Logger {
  constructor() {
    this.logsDir = path.join(__dirname, 'logs');
    this.ensureLogsDirectory();
  }

  ensureLogsDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getLogFileName() {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logsDir, `app-${date}.log`);
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      logMessage += ` | DATA: ${JSON.stringify(data)}`;
    }
    
    return logMessage + '\n';
  }

  writeLog(level, message, data = null) {
    const logMessage = this.formatMessage(level, message, data);
    const logFile = this.getLogFileName();
    
    // Escribir a archivo
    fs.appendFileSync(logFile, logMessage);
    
    // También mostrar en consola
    console.log(logMessage.trim());
  }

  info(message, data = null) {
    this.writeLog('INFO', message, data);
  }

  error(message, data = null) {
    this.writeLog('ERROR', message, data);
  }

  warn(message, data = null) {
    this.writeLog('WARN', message, data);
  }

  debug(message, data = null) {
    this.writeLog('DEBUG', message, data);
  }

  request(req, message = 'Request received') {
    const requestData = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      query: req.query,
      ip: req.ip
    };
    this.writeLog('REQUEST', message, requestData);
  }

  response(message, data = null, statusCode = 200) {
    const responseData = {
      statusCode,
      data
    };
    this.writeLog('RESPONSE', message, responseData);
  }
}

// Instancia global del logger
const logger = new Logger();

// Configuración de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const app = express();
const PORT = process.env.PORT || 8000;

// NOMBRE CORRECTO DE LA TABLA
const TABLE_NAME = 'Cooperativas'; // ← CAMBIO AQUÍ: mayúscula

// Agregar esta nueva ruta después de las rutas existentes
// GET COLUMNS - Obtener columnas de la tabla dinámicamente
app.get('/webhook/table-columns', async (req, res) => {
  try {
    // Consultar información del esquema para obtener las columnas
    const { data, error } = await supabase
      .rpc('get_table_columns', { table_name: TABLE_NAME.toLowerCase() });

    if (error) {
      // Si la función RPC no existe, usar consulta directa
      const { data: columnsData, error: queryError } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable')
        .eq('table_name', TABLE_NAME.toLowerCase())
        .eq('table_schema', 'public')
        .order('ordinal_position');

      if (queryError) {
        // Fallback: obtener una fila y extraer las columnas
        const { data: sampleData, error: sampleError } = await supabase
          .from(TABLE_NAME.toLowerCase())
          .select('*')
          .limit(1)
          .single();

        if (sampleError && sampleError.code !== 'PGRST116') {
          throw sampleError;
        }

        const columns = sampleData ? Object.keys(sampleData) : [];
        
        return res.json({
          success: true,
          columns: columns,
          source: 'sample_data',
          total: columns.length
        });
      }

      const columns = columnsData.map(col => col.column_name);
      
      return res.json({
        success: true,
        columns: columns,
        source: 'information_schema',
        total: columns.length
      });
    }

    const columns = data.map(col => col.column_name);
    
    res.json({
      success: true,
      columns: columns,
      source: 'rpc_function',
      total: columns.length
    });

  } catch (error) {
    console.error('Error getting table columns:', error);
    
    // Fallback final: usar los campos hardcodeados
    const fallbackFields = [
      'Legajo', 'Cooperativa', 'Matrícula', 'ActaPcial', 'EmisMat', 'Dirección',
      'DirecciónVerificada', 'Tel', 'Presid', 'Mail', 'EstadoEntid', 'FechaAsamb',
      'TipoAsamb', 'ConsejoAdmin', 'Sindicatura', 'Localidad', 'Departamento',
      'CodPost', 'Cuit', 'Tipo', 'Subtipo', 'Observaciones', 'Latitud', 'Longitud'
    ];

    res.json({
      success: true,
      columns: fallbackFields,
      source: 'fallback',
      total: fallbackFields.length,
      warning: 'Using fallback fields due to error: ' + error.message
    });
  }
});

// Actualizar la ruta existente /webhook/fields para usar columnas dinámicas
app.get('/webhook/fields', async (req, res) => {
  try {
    // Hacer una consulta interna al endpoint de columnas
    const response = await fetch(`${req.protocol}://${req.get('host')}/webhook/table-columns`);
    const columnData = await response.json();

    if (columnData.success) {
      res.json({
        success: true,
        fields: columnData.columns,
        source: columnData.source
      });
    } else {
      throw new Error('Failed to get columns');
    }
  } catch (error) {
    console.error('Error getting fields:', error);
    
    // Fallback
    const fallbackFields = [
      'Legajo', 'Cooperativa', 'Matrícula', 'ActaPcial', 'EmisMat', 'Dirección',
      'DirecciónVerificada', 'Tel', 'Presid', 'Mail', 'EstadoEntid', 'FechaAsamb',
      'TipoAsamb', 'ConsejoAdmin', 'Sindicatura', 'Localidad', 'Departamento',
      'CodPost', 'Cuit', 'Tipo', 'Subtipo', 'Observaciones', 'Latitud', 'Longitud'
    ];

    res.json({
      success: true,
      fields: fallbackFields,
      source: 'fallback',
      error: error.message
    });
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Middleware de logging para todas las requests
app.use((req, res, next) => {
  logger.request(req);
  next();
});

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal para servir el frontend
app.get('/', (req, res) => {
  logger.info('Serving main page');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== NUEVA RUTA PARA VER LOGS ======
app.get('/logs', (req, res) => {
  try {
    const { date } = req.query;
    let logFileName;
    
    if (date) {
      logFileName = `app-${date}.log`;
    } else {
      // Usar fecha actual si no se especifica
      const today = new Date().toISOString().split('T')[0];
      logFileName = `app-${today}.log`;
    }
    
    const logPath = path.join(__dirname, 'logs', logFileName);
    
    if (!fs.existsSync(logPath)) {
      logger.warn(`Log file not found: ${logFileName}`);
      return res.status(404).json({
        success: false,
        message: `Log file not found for date: ${date || 'today'}`
      });
    }
    
    const logContent = fs.readFileSync(logPath, 'utf8');
    const logs = logContent.split('\n').filter(line => line.trim() !== '');
    
    logger.info(`Serving logs for date: ${date || 'today'}`, { lines: logs.length });
    
    res.json({
      success: true,
      date: date || new Date().toISOString().split('T')[0],
      totalLines: logs.length,
      logs: logs
    });
    
  } catch (error) {
    logger.error('Error serving logs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error reading log file',
      error: error.message
    });
  }
});

// ====== RUTA PARA LISTAR ARCHIVOS DE LOG DISPONIBLES ======
app.get('/logs/list', (req, res) => {
  try {
    const logsDir = path.join(__dirname, 'logs');
    
    if (!fs.existsSync(logsDir)) {
      return res.json({
        success: true,
        logFiles: []
      });
    }
    
    const files = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(logsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          date: file.replace('app-', '').replace('.log', ''),
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    logger.info(`Listing log files`, { count: files.length });
    
    res.json({
      success: true,
      logFiles: files
    });
    
  } catch (error) {
    logger.error('Error listing log files:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error listing log files',
      error: error.message
    });
  }
});

// CREATE - Crear nuevo registro
app.post('/webhook/create', async (req, res) => {
  try {
    const data = req.body;
    logger.info('Creating new record', { Legajo: data.Legajo });

    // Validar que el campo Legajo existe
    if (!data.Legajo) {
      logger.warn('Create attempt without Legajo field');
      return res.status(400).json({
        success: false,
        message: 'El campo Legajo es obligatorio para crear un registro.',
      });
    }

    // Comprobar si ya existe un registro con el mismo Legajo
    const { data: existingRecord } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .select('Legajo')
      .eq('Legajo', data.Legajo)
      .single();

    if (existingRecord) {
      logger.warn('Duplicate Legajo attempt', { Legajo: data.Legajo });
      return res.status(400).json({
        success: false,
        message: 'Ya existe un registro con el Legajo proporcionado.',
      });
    }

    const { data: newRecord, error } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .insert([data])
      .select()
      .single();

    if (error) {
      logger.error('Supabase insert error', error);
      throw error;
    }
    
    logger.info('Record created successfully', { Legajo: newRecord.Legajo });
    
    const response = {
      success: true,
      message: 'Registro creado exitosamente',
      Legajo: newRecord.Legajo,
    };
    
    logger.response('Create response', response);
    res.json(response);
    
  } catch (error) {
    logger.error('Error creating record', { error: error.message, stack: error.stack });
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
    logger.info('Reading all records');
    
    const { data, error } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .select('*');

    if (error) {
      logger.error('Supabase read error', error);
      throw error;
    }

    // Mapear datos para mantener compatibilidad con el frontend
    const mappedData = data.map((record, index) => ({
      _Legajo: record.Legajo,
      ...record,
      _rowIndex: index + 1
    }));

    logger.info('Records read successfully', { count: mappedData.length });
    
    const response = {
      success: true,
      data: mappedData,
      total: mappedData.length
    };
    
    logger.response('Read response', { total: response.total });
    res.json(response);
    
  } catch (error) {
    logger.error('Error reading records', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      success: false, 
      message: 'Error al leer los registros',
      error: error.message 
    });
  }
});

// SEARCH - Búsqueda simple (MEJORADA CON LOGGING)
app.get('/webhook/search', async (req, res) => {
  try {
    const { searchText, searchField } = req.query;
    
    logger.info('Search request received', { searchText, searchField, tableName: TABLE_NAME });

    // Validar parámetros de entrada
    if (!searchText || !searchField) {
      logger.warn('Invalid search parameters', { searchText, searchField });
      return res.status(400).json({
        success: false,
        message: 'Se requieren tanto searchText como searchField para realizar la búsqueda'
      });
    }

    // Validar que el campo de búsqueda es válido
    if (!VALID_SEARCH_FIELDS.includes(searchField)) {
      logger.error('Invalid search field', { searchField, validFields: VALID_SEARCH_FIELDS });
      return res.status(400).json({
        success: false,
        message: `Campo de búsqueda inválido: ${searchField}. Campos válidos: ${VALID_SEARCH_FIELDS.join(', ')}`
      });
    }

    logger.info('Executing search query', { searchField, searchText, tableName: TABLE_NAME });

    // Construir la consulta
    let query = supabase.from(TABLE_NAME).select('*'); // ← CAMBIO AQUÍ

    // Aplicar filtro con manejo de errores mejorado
    try {
      query = query.ilike(searchField, `%${searchText}%`);
      const { data, error } = await query;

      if (error) {
        logger.error('Supabase search query error', error);
        throw error;
      }

      logger.info('Search query completed successfully', { recordsFound: data.length });

      // Mapear datos para mantener compatibilidad
      const mappedData = data.map((record, index) => ({
        _Legajo: record.Legajo,
        ...record,
        _rowIndex: index + 1
      }));

      const response = {
        success: true,
        data: mappedData,
        total: mappedData.length,
        searchText: searchText,
        searchField: searchField
      };

      logger.response('Search response', { total: response.total, searchField, searchText });
      res.json(response);

    } catch (queryError) {
      logger.error('Query execution error', { error: queryError.message, code: queryError.code });
      
      // Manejo específico de errores de Supabase
      if (queryError.code === '42703') {
        logger.error('Database field does not exist', { searchField });
        return res.status(400).json({
          success: false,
          message: `El campo '${searchField}' no existe en la base de datos`
        });
      }
      
      throw queryError;
    }

  } catch (error) {
    logger.error('Search endpoint error', { 
      error: error.message, 
      stack: error.stack,
      searchText: req.query.searchText,
      searchField: req.query.searchField,
      tableName: TABLE_NAME
    });
    
    res.status(500).json({ 
      success: false, 
      message: 'Error al buscar los registros',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// UPDATE - Actualizar registro
app.put('/webhook/update', async (req, res) => {
  try {
    const { searchCriteria, updateData } = req.body;
    
    logger.info('Update request received', { searchCriteria, updateData });
    
    if (!searchCriteria || !searchCriteria.field || searchCriteria.value === undefined) {
      logger.warn('Invalid update criteria', { searchCriteria });
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido'
      });
    }

    // Limpiar updateData de campos internos
    const cleanUpdateData = { ...updateData };
    delete cleanUpdateData._rowIndex;
    delete cleanUpdateData._Legajo;

    logger.info('Executing update query', { searchCriteria, cleanUpdateData });

    const { data, error } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .update(cleanUpdateData)
      .eq(searchCriteria.field, searchCriteria.value)
      .select()
      .single();

    if (error && error.code === 'PGRST116') {
      logger.warn('Record not found for update', { searchCriteria });
      return res.status(404).json({
        success: false,
        message: `Registro no encontrado con ${searchCriteria.field}=${searchCriteria.value}`
      });
    }

    if (error) {
      logger.error('Supabase update error', error);
      throw error;
    }

    logger.info('Record updated successfully', { Legajo: data.Legajo });

    const response = {
      success: true,
      message: 'Registro actualizado correctamente',
      data: {
        ...data,
        _Legajo: data.Legajo,
        _rowIndex: 1
      }
    };

    logger.response('Update response', response);
    res.json(response);
    
  } catch (error) {
    logger.error('Update endpoint error', { error: error.message, stack: error.stack });
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
    
    logger.info('Delete request received', { searchCriteria });

    if (!searchCriteria || !searchCriteria.field || !searchCriteria.value) {
      logger.warn('Invalid delete criteria', { searchCriteria });
      return res.status(400).json({
        success: false,
        message: 'Se requiere criterio de búsqueda válido para eliminar'
      });
    }

    logger.info('Executing delete query', { searchCriteria });

    const { data: deletedRecord, error } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .delete()
      .eq(searchCriteria.field, searchCriteria.value)
      .select()
      .single();

    if (error && error.code === 'PGRST116') {
      logger.warn('Record not found for deletion', { searchCriteria });
      return res.status(404).json({
        success: false,
        message: `No se encontró un registro con ${searchCriteria.field}: ${searchCriteria.value}`,
      });
    }

    if (error) {
      logger.error('Supabase delete error', error);
      throw error;
    }

    logger.info('Record deleted successfully', { deletedRecord: deletedRecord.Legajo });

    const response = {
      success: true,
      message: 'Registro eliminado exitosamente',
      deletedRecord: deletedRecord,
    };

    logger.response('Delete response', response);
    res.json(response);
    
  } catch (error) {
    logger.error('Delete endpoint error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el registro',
      error: error.message,
    });
  }
});

// FIELDS - Obtener campos disponibles (ACTUALIZADA)
app.get('/webhook/fields', async (req, res) => {
  try {
    logger.info('Fields request received');
    
    const response = {
      success: true,
      fields: VALID_SEARCH_FIELDS
    };
    
    logger.response('Fields response', response);
    res.json(response);
    
  } catch (error) {
    logger.error('Fields endpoint error', { error: error.message });
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
    logger.info('Health check request');
    
    const { error } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .select('count', { count: 'exact', head: true });

    if (error) {
      logger.error('Health check failed - database error', error);
      throw error;
    }

    const response = { 
      status: 'healthy', 
      database: 'connected',
      timestamp: new Date().toISOString(),
      tableName: TABLE_NAME
    };
    
    logger.info('Health check passed');
    res.json(response);
    
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
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
    logger.info('Test connection request');
    
    const { data, error } = await supabase
      .from(TABLE_NAME) // ← CAMBIO AQUÍ
      .select('count', { count: 'exact', head: true });

    if (error) {
      logger.error('Test connection failed', error);
      throw error;
    }

    const response = {
      status: 'success',
      message: 'Conexión a Supabase exitosa',
      timestamp: new Date().toISOString(),
      tableName: TABLE_NAME
    };
    
    logger.info('Test connection successful');
    res.json(response);
    
  } catch (error) {
    logger.error('Test connection error', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

app.listen(PORT, () => {
  logger.info('Server started', { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    validSearchFields: VALID_SEARCH_FIELDS.length,
    tableName: TABLE_NAME
  });
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend available at /`);
  console.log(`Health check available at /health`);
  console.log(`Logs available at /logs`);
  console.log(`Log files list at /logs/list`);
  console.log(`Using table name: ${TABLE_NAME}`);
});
