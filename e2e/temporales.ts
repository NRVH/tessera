// =============================================================================
// Respalda la limpieza de los temporales cuando termina el proceso de pruebas.
// Los hooks y finally del arnés los borran al acabar el caso o la suite.
// Las señales quedan a cargo del ejecutor de pruebas.
// =============================================================================
import { crearCarpetaTemporal } from '../scripts/pruebas/temporales.mts'

export function crearTemporal(prefijo: string): string {
  return crearCarpetaTemporal(prefijo, { atenderSenales: false })
}
