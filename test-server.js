// Simple test server without database connections for UI testing
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8001;

// Mock user data for testing
const mockUsers = [
  {
    id: 1,
    email: 'admin@rionegro.gov.ar',
    password_hash: '$2b$10$9EyUR1wKMYN83bEuRfI8tuszCsCVfHZ.p7nSDmJIn3ppjM8zev3py', // admin123
    name: 'Administrador',
    is_active: true
  }
];

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mock JWT secret
const JWT_SECRET = 'test-secret';

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token de acceso requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Token inválido' });
    }
    req.user = user;
    next();
  });
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
    });
  }
  next();
}

// Routes
app.get('/', optionalAuth, (req, res) => {
  if (req.user) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos'
      });
    }

    const user = mockUsers.find(u => u.email === email && u.is_active);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no registrado. Contacte a su superior para obtener acceso.'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña incorrecta',
        showPasswordRecovery: true
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logout exitoso'
  });
});

// Password recovery endpoints (mock)
app.post('/api/auth/password-reset/request', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email requerido" });
  }

  const user = mockUsers.find(u => u.email === email && u.is_active);
  if (!user) {
    return res.status(404).json({ success: false, message: "Usuario no encontrado" });
  }

  // Mock successful response
  res.json({ 
    success: true, 
    message: "Solicitud enviada. Revisa tu email (modo de prueba - no se envía email real)." 
  });
});

app.post('/api/auth/password-reset/confirm', (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!token || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Token y nueva contraseña son requeridos'
    });
  }

  // Mock successful response
  res.json({
    success: true,
    message: 'Contraseña actualizada exitosamente (modo de prueba)'
  });
});

// Mock categories endpoint
app.get('/api/categories', authenticateToken, (req, res) => {
  res.json({
    success: true,
    categories: [
      {
        id: 'cooperativas',
        name: 'cooperativas',
        displayName: 'Cooperativas',
        description: 'Gestión de cooperativas de la provincia',
        icon: '🏢'
      },
      {
        id: 'mutuales',
        name: 'mutuales',
        displayName: 'Mutuales',
        description: 'Gestión de asociaciones mutuales',
        icon: '🤝'
      }
    ],
    total: 2
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    mode: 'testing',
    message: 'Test server running without database',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log(`📱 Frontend available at http://localhost:${PORT}`);
  console.log(`🧪 Test mode - using mock data`);
  console.log(`👤 Test user: admin@rionegro.gov.ar / admin123`);
});