// Funciones para manejar dropdowns con enums
class DropdownManager {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
  }

  // Obtener todas las opciones de enums
  async getAllOptions() {
    if (this.cache.has('all_options')) {
      return this.cache.get('all_options');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/enum-options`);
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
        throw new Error(`Tipo de enum '${enumType}' no encontrado`);
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

  // Inicializar todos los dropdowns en una página
  async initializeDropdowns() {
    const dropdownMappings = {
      'localidad': 'localidad',
      'departamento': 'departamento',
      'autoridad': 'autoridades'
    };

    for (const [selectId, enumType] of Object.entries(dropdownMappings)) {
      const selectElement = document.getElementById(selectId);
      if (selectElement) {
        await this.populateDropdown(selectElement, enumType);
      }
    }
  }
}

// Instancia global
const dropdownManager = new DropdownManager();

// Inicializar cuando la página cargue
document.addEventListener('DOMContentLoaded', async () => {
  await dropdownManager.initializeDropdowns();
});
