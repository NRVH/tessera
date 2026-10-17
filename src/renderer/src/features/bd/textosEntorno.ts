// =============================================================================
// Nombre visible de cada entorno de una conexión, en el idioma de la interfaz.
// Depende de shared/i18n y de db-ipc (solo el tipo); el contrato guarda los ids.
// Los consumidores (marca, pestañas, árbol, selector) llaman a `nombreEntorno`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'
import type { DbEntorno } from '../../../../shared/db-ipc.ts'

const txEntorno = crearTextos(
  { desarrollo: 'Desarrollo', pruebas: 'Pruebas', produccion: 'Producción' },
  { desarrollo: 'Development', pruebas: 'Testing', produccion: 'Production' }
)

/** El nombre del entorno para mostrarlo (marca, tooltips, pestañas, selector). */
export function nombreEntorno(entorno: DbEntorno): string {
  return txEntorno()[entorno]
}
