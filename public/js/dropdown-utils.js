// Funciones para manejar dropdowns con enums
class DropdownManager {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
  }

  // Función auxiliar para realizar peticiones autenticadas
  async authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('authToken');
    
    if (!token) {
      window.location.href = '/login.html';
      throw new Error('No authentication token');
    }

    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    const mergedOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    };

    try {
      const response = await fetch(url, mergedOptions);
      
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('authToken');
        window.location.href = '/login.html';
        throw new Error('Authentication failed');
      }
      
      return response;
    } catch (error) {
      if (error.message.includes('Authentication') || error.message.includes('Token')) {
        localStorage.removeItem('authToken');
        window.location.href = '/login.html';
      }
      throw error;
    }
  }

  // Obtener todas las opciones de enums
  async getAllOptions() {
    if (this.cache.has('all_options')) {
      return this.cache.get('all_options');
    }

    try {
      const response = await this.authenticatedFetch(`${this.baseUrl}/api/enum-options`);
      const result = await response.json();
      
      if (result.success) {
        this.cache.set('all_options', result.data);
        return result.data;
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Error obteniendo opciones:', error);
      throw error;
    }
  }

  // Llenar un dropdown específico
  async populateDropdown(selectElement, enumType) {
    try {
      const options = await this.getAllOptions();
      const enumOptions = options[enumType];

      if (!enumOptions) {
        console.warn(`Tipo de enum '${enumType}' no encontrado`);
        return;
      }

      // Limpiar opciones existentes
      selectElement.innerHTML = '<option value="">Seleccionar...</option>';

      // Agregar nuevas opciones
      enumOptions.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        selectElement.appendChild(optionElement);
      });

    } catch (error) {
      console.error(`Error llenando dropdown ${enumType}:`, error);
      selectElement.innerHTML = '<option value="">Error cargando opciones</option>';
    }
  }

  // Detectar si un campo debería ser un dropdown
  isEnumField(columnName) {
    const enumFields = {
      'localidad': 'localidad',
      'departamento': 'departamento', 
      'autoridad': 'autoridades',
      'autoridades': 'autoridades',
      'tipo_financ': 'tipo_financiamiento',
      'tipo_asamblea': 'tipo_asamblea',
      'tipoasamb': 'tipo_asamblea',
      'tipo': 'tipo',
      'subtipo': 'subtipo'
    };
    
    return enumFields[columnName.toLowerCase()] || null;
  }

  // Detectar si un campo debería ser radio buttons
  isBooleanField(columnName) {
    const booleanFields = [
      'regular',
      'activo', 
      'activa',
      'vigente',
      'habilitado',
      'habilitada',
      'estado'
    ];
    
    return booleanFields.includes(columnName.toLowerCase());
  }
}

// Instancia global
const dropdownManager = new DropdownManager();
