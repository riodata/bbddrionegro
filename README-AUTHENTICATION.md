# Setup Guide - Sistema de Autenticación

Este documento describe cómo configurar el sistema de autenticación completo implementado.

## 🗄️ Configuración de Base de Datos

### 1. Ejecutar Script de Schema

Ejecuta el archivo `database-schema.sql` en tu base de datos PostgreSQL:

```sql
-- Este script creará:
-- - Tabla 'users' para gestión de usuarios
-- - Tabla 'password_reset_tokens' para recuperación de contraseñas
-- - Usuario de aplicación 'koyeb_app_user'
-- - Usuario administrador por defecto
```

### 2. Usuario Administrador por Defecto

Después de ejecutar el script, podrás acceder con:

- **Email**: `admin@gobierno.rionegro.gov.ar`
- **Contraseña**: `admin123`

## 📧 Configuración de Email

Actualiza las variables de entorno en `.env` para habilitar la recuperación de contraseñas:

```env
# Configuración de email para recuperación de contraseñas
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
EMAIL_FROM=noreply@gobierno.rionegro.gov.ar
EMAIL_FROM_NAME=Sistema de Gestión - Gobierno de Río Negro
```

## 🔐 Configuración de Seguridad

### Variables de Entorno Requeridas

```env
# JWT para sesiones (IMPORTANTE: cambiar en producción)
JWT_SECRET=bbdd-rio-negro-jwt-secret-2024-change-in-production
JWT_EXPIRES_IN=24h

# Usuario de aplicación (usado después del login)
APP_DB_USER=koyeb_app_user
APP_DB_PASSWORD=secure_app_password_2024

# URL base de la aplicación
APP_BASE_URL=http://localhost:8000
```

## 🚀 Funcionalidades Implementadas

### ✅ Sistema de Login Completo
- Página de inicio de sesión que reemplaza el menú principal
- Validación de usuario y contraseña contra base de datos
- Redirección automática al menú principal después del login exitoso
- Actualización de último ingreso del usuario

### ✅ Recuperación de Contraseñas
- Enlace "¿Olvidaste tu contraseña?" en página de login
- Envío de email con link de recuperación de único uso
- Página dedicada para cambiar contraseña
- Validación de tokens temporales con expiración

### ✅ Autenticación JWT
- Tokens seguros con expiración configurable
- Middleware de autenticación en todas las rutas protegidas
- Verificación automática de sesión al cargar la aplicación
- Logout con limpieza de tokens

### ✅ Base de Datos Segura
- Tabla de usuarios con hash bcrypt para contraseñas
- Tabla de tokens de recuperación con expiración
- Usuario de aplicación separado para operaciones post-login
- Integración con el sistema de metadatos existente

### ✅ Protección de Rutas
Todas las operaciones CRUD están protegidas:
- `/api/categories` - Listar categorías
- `/api/tables/:tableName/schema` - Esquema de tabla
- `/api/tables/:tableName/create` - Crear registros
- `/api/tables/:tableName/read` - Leer registros
- `/api/tables/:tableName/search` - Buscar registros
- `/api/tables/:tableName/update` - Actualizar registros
- `/api/tables/:tableName/delete` - Eliminar registros

## 🔧 Instalación y Ejecución

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Configurar variables de entorno**:
   ```bash
   cp env.example .env
   # Editar .env con tus configuraciones
   ```

3. **Ejecutar script de base de datos**:
   ```sql
   \i database-schema.sql
   ```

4. **Iniciar servidor**:
   ```bash
   npm start
   ```

5. **Acceder a la aplicación**:
   - URL: http://localhost:8000
   - Login: admin@gobierno.rionegro.gov.ar / admin123

## 🛡️ Consideraciones de Seguridad

### Para Producción:
1. **Cambiar JWT_SECRET** por una clave segura única
2. **Configurar HTTPS** obligatorio
3. **Actualizar contraseñas por defecto**
4. **Configurar SMTP con credenciales seguras**
5. **Revisar permisos de usuario de base de datos**

### Para Desarrollo:
- El sistema funciona con configuraciones por defecto
- Email opcional (login funciona sin configuración SMTP)
- Base de datos local o remota compatible

## 📱 Flujo de Usuario

1. **Acceso Inicial**: Usuario ve página de login
2. **Autenticación**: Ingresa email y contraseña
3. **Verificación**: Sistema valida contra base de datos
4. **Acceso Concedido**: Redirección a menú principal con sesión activa
5. **Operaciones CRUD**: Acceso completo a funcionalidades existentes
6. **Recuperación**: Opción de recuperar contraseña vía email
7. **Logout**: Cierre seguro de sesión

## 🔄 Integración con Sistema Existente

- **Preserva funcionalidad CRUD completa**
- **Mantiene sistema de categorías dinámicas**
- **Compatible con esquema de metadatos existente**
- **Usa usuario koyeb_app_user para operaciones post-login**
- **Sin cambios en base de datos de aplicación existente**