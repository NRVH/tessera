// =============================================================================
// Adónde lleva cada botón ⓘ de la app: un destino de Tessera Academy por diálogo o popover.
// Viven juntos para que `test-academy.mts` compruebe que todos existen: un ancla renombrada en
// un artículo rompe la prueba, no el botón.
// =============================================================================

import type { ArticuloId } from './indice.ts'

/** «articulo» o «articulo/ancla». */
export type DestinoAyuda = ArticuloId | `${ArticuloId}/${string}`

export const AYUDA = {
  selectorCuenta: 'cuentas/elegir',
  configuracionCuenta: 'cuentas/configuracion',
  continuarCon: 'continuar-en-otro-agente',
  reglasDelPerfil: 'reglas-del-perfil',
  contextoDeLosAgentes: 'reglas-del-perfil',
  propuestaDeReglas: 'reglas-del-perfil/propuestas',
  basesDelAgente: 'herramientas-de-los-agentes/tdb',
  hibernarPerfil: 'hibernar/perfil',
  redDelContenedor: 'contenedores-docker/red',
  agenteManual: 'agentes/manuales',
  conexionSsh: 'ssh/conexion',
  conexionBd: 'bases-de-datos/conexion'
} as const satisfies Record<string, DestinoAyuda>
