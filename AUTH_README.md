# Sistema de Autenticación Completo - Gobierno de Río Negro

## Características Implementadas

✅ **Página de Login Inicial**
- Diseño profesional con branding del gobierno de Río Negro
- Campos para correo electrónico y contraseña
- Validación de formularios en tiempo real
- Mensaje "Ingreso al sistema" como solicitado

✅ **Funcionalidad de Autenticación**
- Login con credenciales: redirección automática después del login exitoso
- Actualización del último ingreso en la base de datos
- Switching de usuario de base de datos post-login (n8n_user → koyeb_app_user)
- Protección de todas las rutas del sistema

✅ **Manejo de Errores**
- Usuario no registrado: mensaje claro para contactar supervisor
- Contraseña incorrecta: opción de recuperación de contraseña
- Validación robusta de credenciales

✅ **Recuperación de Contraseña**
- Envío de email con link de recuperación único
- Integración con webhook de n8n para envío de emails
- Tokens temporales con expiración (1 hora)
- Página dedicada para cambio de contraseña

✅ **Seguridad**
- JWT para manejo de sesiones (8 horas de duración)
- Contraseñas hasheadas con bcrypt (salt rounds: 10)
- Validación de tokens en cada request
- Middleware de autenticación para proteger rutas

✅ **Base de Datos**
- Tabla `users` para usuarios del sistema
- Tabla `password_reset_tokens` para tokens de recuperación
- Índices optimizados para performance
- Usuario administrativo por defecto

## Configuración de Base de Datos

### 1. Crear las Tablas

Ejecuta el endpoint de setup (solo una vez):

```bash
curl -X POST http://localhost:8000/api/setup/init-auth-tables
```

O ejecuta manualmente el script SQL `init-auth-tables.sql`

### 2. Usuario Por Defecto

- **Email:** admin@rionegro.gov.ar
- **Contraseña:** admin123

## Variables de Entorno Requeridas

```env
# JWT y Sessions
JWT_SECRET=RN-RD-2025-Gob-Coop-Mut
SESSION_SECRET=Gob-Cooope-Mut-20-RioData-25

# Base de Datos Principal (para auth)
DATABASE_URL=postgresql://user:pass@host:port/database

# Usuario Post-Login
APP_DB_USER=koyeb_app_user
APP_DB_PASS=Gob-RN-2025-Coope-Mut

# Recuperación de Contraseña
N8N_WEBHOOK_URL=https://n8n.riodataanalisis.com.ar/webhook/recuperar-contraseña
FRONTEND_URL=https://tu-dominio.com
```

## Estructura de la Aplicación

### Páginas
- `/` - Página principal (login o dashboard según autenticación)
- `/login.html` - Página de login (acceso directo)
- `/reset-password.html` - Página de cambio de contraseña

### Endpoints de Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `GET /api/auth/verify` - Verificar token
- `POST /api/auth/logout` - Cerrar sesión
- `POST /api/auth/password-reset/request` - Solicitar recuperación
- `POST /api/auth/password-reset/confirm` - Confirmar nueva contraseña

### Endpoints Protegidos
- `GET /api/categories` - Requiere autenticación
- `GET /api/tables/*` - Todas las operaciones CRUD requieren autenticación

## Flujo de Usuario

### 1. Login Inicial
1. Usuario accede a la aplicación
2. Si no tiene token válido → página de login
3. Ingresa credenciales
4. Sistema valida contra tabla `users`
5. Si es válido → genera JWT token
6. Actualiza `last_login` en la base de datos
7. Redirecciona al dashboard principal

### 2. Navegación Autenticada
1. Todas las requests incluyen JWT token en header Authorization
2. Middleware verifica token en cada request
3. Si token es válido → acceso a funcionalidades
4. Si token es inválido → redirección a login

### 3. Recuperación de Contraseña
1. Usuario hace clic en "¿Olvidaste tu contraseña?"
2. Ingresa email en modal
3. Sistema genera token único
4. Envía email via webhook n8n
5. Usuario hace clic en link del email
6. Ingresa nueva contraseña
7. Sistema actualiza password_hash

### 4. Logout
1. Usuario hace clic en "Cerrar Sesión"
2. Token se elimina del localStorage
3. Redirección a página de login

## Testing

### Servidor de Prueba
Para testing sin conexión a base de datos:

```bash
node test-server.js
```

- Puerto: 8001
- Usuario de prueba: admin@rionegro.gov.ar / admin123
- Datos mock para categorías

### Endpoints de Testing
```bash
# Health check
curl http://localhost:8001/health

# Login test
curl -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rionegro.gov.ar","password":"admin123"}'

# Categories (authenticated)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8001/api/categories
```

## Seguridad Implementada

1. **Autenticación Multi-Capa**
   - JWT tokens con expiración
   - Verificación en cada request
   - Logout completo

2. **Protección de Contraseñas**
   - Hash bcrypt con salt
   - No almacenamiento de contraseñas en texto plano
   - Tokens temporales para recuperación

3. **Validación de Sesiones**
   - Verificación de tokens del lado servidor
   - Middleware de autenticación
   - Manejo de tokens expirados

4. **Base de Datos Segura**
   - Switching de usuarios de DB post-login
   - Queries parametrizadas (prevención SQL injection)
   - Validación de acceso a tablas

## Integración con Sistema Existente

El sistema de autenticación se integra completamente con la aplicación CRUD existente:

- ✅ Todas las operaciones CRUD están protegidas
- ✅ Interfaz de usuario mantiene funcionalidad original
- ✅ Breadcrumbs y navegación preservados
- ✅ Sistema de categorías y tablas funcional
- ✅ Formularios dinámicos preservados

La aplicación funciona exactamente igual que antes, pero ahora requiere autenticación para acceder a cualquier funcionalidad.