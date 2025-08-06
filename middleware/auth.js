const jwt = require('jsonwebtoken');

// Middleware de autenticación para proteger rutas
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token de acceso requerido',
      redirectTo: '/login'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Token inválido o expirado',
        redirectTo: '/login'
      });
    }
    
    req.user = user;
    next();
  });
};

// Middleware opcional para verificar token sin bloquear acceso
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
    });
  }
  
  next();
};

// Middleware para verificar roles específicos
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Autenticación requerida' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'No tienes permisos para acceder a este recurso' 
      });
    }

    next();
  };
};

// Verificar si el usuario está activo
const requireActiveUser = (req, res, next) => {
  if (!req.user || !req.user.is_active) {
    return res.status(403).json({ 
      success: false, 
      message: 'Tu cuenta está desactivada. Contacta al administrador.' 
    });
  }
  
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  requireActiveUser
};