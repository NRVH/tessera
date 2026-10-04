// =============================================================================
// Edición de la rejilla en el main: fachada que reexporta, con su API de siempre, la identidad
// de una fila (`edicionRejillaIdentidad`), lo que el catálogo dice de la tabla
// (`edicionRejillaTablas`), la validación de «Enviar» (`edicionRejillaValidacion`), su
// preparación (`edicionRejillaEnvio`) y la espera de bloqueos (`edicionRejillaBloqueos`).
// La usan el controlador (que decide) y el gestor (que ejecuta). Puro: sin electron ni drivers.
// Decisiones: docs/decisiones/bd/rejilla-edicion-identidad.md, docs/decisiones/bd/rejilla-envio-bloqueos.md
// =============================================================================

export { COLUMNA_ROWID } from './sqlRejilla.ts'

/**
 * Prefijo del id de la sesión EFÍMERA de «Enviar» dentro del trabajador. Lo exporta
 * para el centinela del smoke de solo lectura (`lecturaSegura.ts`), que la veta.
 */
export const PREFIJO_SESION_EDICION = 'edicion:'

export { MAX_CAMBIOS_ENVIO, MAX_CLAVE, MAX_COLUMNAS_CAMBIO } from './edicionRejillaTipos.ts'
export type {
  BindsEnvio,
  ClaveBloqueo,
  EnvioValidado,
  FalloCambio,
  LoteBloqueo,
  SentenciaEnvio,
  Validacion
} from './edicionRejillaTipos.ts'

export {
  MOTIVO_ROWID_TAPADO,
  MOTIVO_SIN_CLAVE_PG,
  MOTIVO_SOLO_LECTURA,
  MOTIVO_TABLA_INTERNA,
  columnasFueraDelCatalogo,
  conMarcasDeTabla,
  decidirIdentidad,
  esEsquemaDelSistema,
  esIdentidad,
  identidadAntesDeLeer,
  mismaIdentidad,
  necesitaUnica,
  puedeSerEditable
} from './edicionRejillaIdentidad.ts'
export type { EntradaIdentidad } from './edicionRejillaIdentidad.ts'

export {
  comparablesDe,
  mapearColumnasEdicion,
  mapearTablaEdicion,
  mapearUnicaNoNula,
  noEditablesDe,
  sqlColumnasEdicion,
  sqlUnicaNoNula
} from './edicionRejillaTablas.ts'
export type { ColumnaEdicion, ComparacionOriginal, TablaEdicion } from './edicionRejillaTablas.ts'

export { validarCambios, validarFormaEnvio } from './edicionRejillaValidacion.ts'

export {
  mensajeFalloCommit,
  mensajeFilas,
  originalesComparables,
  prepararEnvio
} from './edicionRejillaEnvio.ts'

export {
  ESPERA_BLOQUEO_ENVIO_S,
  esEsperaDeBloqueo,
  esOcupadaSinEspera,
  filasConRelleno,
  filasPorLote,
  loteDeBloqueo,
  lotesDeBloqueo,
  mensajeFilaBloqueada,
  notaSinCulpable,
  primerCulpable,
  sqlEsperaBloqueoTransaccion
} from './edicionRejillaBloqueos.ts'
