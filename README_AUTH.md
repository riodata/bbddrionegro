# Sistema de Autenticación - BBDD Rio Negro

## 🔐 Sistema de Login Implementado

Este sistema agrega autenticación completa al sistema CRUD existente de cooperativas y mutuales del Gobierno de Río Negro.

### ✅ Características Implementadas

- **Login principal**: Página de ingreso con email y contraseña
- **Autenticación JWT**: Sesiones seguras con tokens de 8 horas
- **Recuperación de contraseña**: Integración con webhook n8n para envío de emails
- **Protección de rutas**: Middleware que protege todas las operaciones CRUD
- **Gestión de usuarios**: Sistema completo de roles y permisos
- **Interfaz responsiva**: Diseño adaptado a dispositivos móviles

### 🚀 Instalación y Configuración

1. **Instalar dependencias**:
```bash
npm install
```

2. **Configurar variables de entorno** (ya configuradas en `.env`):
```env
# JWT Configuration
JWT_SECRET=RN-RD-2025-Gob-Coop-Mut
SESSION_SECRET=Gob-Cooope-Mut-20-RioData-25

# Email Recovery Webhook
N8N_WEBHOOK_URL=https://n8n.riodataanalisis.com.ar/webhook/recuperar-contraseña
FRONTEND_URL=https://physical-collete-riodata-cd9f9506.koyeb.app/

# Database Users
APP_DB_USER=koyeb_app_user
APP_DB_PASS=Gob-RN-2025-Coope-Mut
```

3. **Inicializar base de datos** (cuando esté accesible):
```bash
node scripts/init-database.js
```

### 👤 Usuarios de Prueba

Una vez inicializada la base de datos, estarán disponibles:

- **Administrador**: 
  - Email: `admin@rionegro.gov.ar`
  - Contraseña: `admin123`
  - Rol: admin

- **Usuario de prueba**:
  - Email: `test@rionegro.gov.ar` 
  - Contraseña: `test123`
  - Rol: user

### 🎯 Flujos de Usuario

1. **Acceso al sistema**: Ir a `/` → automáticamente redirige a `/login.html`
2. **Login exitoso**: Redirige a `/app.html` (sistema de cooperativas/mutuales)
3. **Usuario no registrado**: Mensaje para contactar al superior
4. **Contraseña incorrecta**: Opción de recuperación automática
5. **Recuperación**: Email con link de reseteo via webhook n8n
6. **Logout**: Botón en interfaz principal, invalida sesión

### 🔧 Estructura de Archivos

```
├── middleware/
│   └── auth.js              # Middleware de autenticación JWT
├── public/
│   ├── index.html           # Página de redirección automática
│   ├── login.html           # Página de login principal
│   ├── app.html             # Aplicación CRUD protegida
│   └── js/
│       └── dropdown-utils.js # Utilidades con auth integrada
├── scripts/
│   └── init-database.js     # Script de inicialización DB
├── sql/
│   └── create_auth_tables.sql # Esquema de tablas de usuarios
└── server.js                # Servidor con endpoints de auth
```

### 🛡️ Endpoints de Autenticación

- `POST /api/auth/login` - Iniciar sesión
- `GET /api/auth/verify` - Verificar token JWT
- `POST /api/auth/logout` - Cerrar sesión
- `POST /api/auth/register` - Registrar usuario (solo admin)
- `POST /api/password-reset/request` - Solicitar recuperación
- `POST /api/auth/reset-password` - Resetear contraseña

### 🔒 Rutas Protegidas

Todas las rutas CRUD existentes están protegidas:
- `/api/categories/*`
- `/api/tables/*/create`
- `/api/tables/*/read`
- `/api/tables/*/update`
- `/api/tables/*/delete`
- `/api/enum-options/*`

### 🚀 Ejecutar el Sistema

```bash
npm start
```

El sistema estará disponible en `http://localhost:8000`

### 📱 Interfaz de Usuario

- **Diseño responsive**: Se adapta a móviles y tablets
- **Información del usuario**: Muestra nombre y rol en header
- **Botón de logout**: Accesible desde la aplicación principal
- **Mensajes de estado**: Feedback claro para todas las acciones
- **Navegación intuitiva**: Breadcrumbs y navegación clara

### ⚠️ Notas Importantes

- Las tablas de usuarios se crean automáticamente al ejecutar el script de inicialización
- El sistema está integrado con el webhook de n8n para envío de emails
- Todas las contraseñas están hasheadas con bcrypt (10 salt rounds)
- Los tokens JWT expiran en 8 horas por seguridad

### 🔄 Próximos Pasos

1. Ejecutar `node scripts/init-database.js` cuando la DB esté accesible
2. Probar el login con usuarios de prueba
3. Configurar usuarios reales según necesidades del sistema
4. Implementar cambio de usuario DB post-login a `koyeb_app_user`