// =============================================================================
// arbolBd — el árbol de BASES DE DATOS aplanado a filas, para virtualizarlo: la fachada de
// sus piezas (claves, tipos, reglas, aplanado por familia, teclado y pestañas).
// Puro (sin React, DOM ni IPC; imports con extensión): lo cargan las pruebas con `node`.
// Lo usan las piezas del árbol (`DbArbol*`, `FilaArbol*`, `useArbolBd.ts`), las filas y el
// nivel de bases, la caché de catálogo y el estado de la vista.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

export { ambitoEsquema, claveBd, conexionDeClave, consolaDeClave, partesAmbito } from './arbolBdClaves.ts'
export { cargaDeConexion, coincidenciaDe, kindAbreTipo, normalizarBusqueda, partesDetalle } from './arbolBdReglas.ts'
export { aplanarArbolBd } from './arbolBdAplanado.ts'
export { accionTecla, cargasPendientes, esContenedor, indicePadre, type AccionTeclaBd } from './arbolBdTeclado.ts'
export { ancestrosDe, claveDePane, paneDdlDeFila, paneDeFila } from './arbolBdPanes.ts'
export type {
  CargaBd,
  Coincidencia,
  EntradaArbolBd,
  FilaBd,
  FilaObjeto,
  FilaPlaceholder,
  InsigniaEsquemas
} from './arbolBdTipos.ts'
