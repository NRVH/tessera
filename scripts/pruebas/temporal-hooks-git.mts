// =============================================================================
// Registra la ruta de hooks que la prueba de Git crea con la configuración por defecto.
// La ruta es propia del proceso y puede que la prueba nunca llegue a crearla.
// Así se conserva la configuración que ejercita la prueba y se retira al salir.
// =============================================================================
import { carpetaDatosHooks } from '../../src/main/git/adaptadores/carpetasHooks.ts'
import { registrarTemporal } from './temporales.mts'

registrarTemporal(carpetaDatosHooks())
