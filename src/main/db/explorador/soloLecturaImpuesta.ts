// =============================================================================
// La solo lectura que IMPONE el explorador, que no es la casilla de la conexión: esa es solo
// de los agentes (`tdb`). En el producto no se impone ninguna (`sinSoloLecturaImpuesta`); la
// inyectan el humo remoto (`soloLecturaEnTodas`) y las pruebas que fijan esa maquinaria.
// Decisiones: docs/decisiones/bd/sesiones-solo-lectura-impuesta.md
// =============================================================================

import type { DbConnection } from '../../../shared/db-ipc.ts'

/** ¿El explorador trata esta conexión como de solo lectura? (Ver la cabecera.) */
export type SoloLecturaImpuesta = (con: DbConnection) => boolean

/** La del producto: el explorador no limita al usuario en ninguna conexión. */
export const sinSoloLecturaImpuesta: SoloLecturaImpuesta = () => false

/** La del humo remoto: todas, sin mirar la casilla de la conexión. */
export const soloLecturaEnTodas: SoloLecturaImpuesta = () => true
