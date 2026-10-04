// =============================================================================
// Enrutador de consolas: de la URI de un modelo de Monaco a la consola SQL que lo
// posee (conexión, alias, dialecto, esquema y base de su sesión). El proveedor es uno
// para toda la app, así que un modelo sin ruta (un `.sql` del editor de archivos) no
// recibe sugerencias. La baja solo quita su propia entrada.
// Puro (sin React, DOM ni Monaco): lo prueba `test-enrutador-consolas.mts`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-registro.md
// =============================================================================

import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'

/** Lo que el autocompletado necesita saber de la consola dueña de un modelo. */
export interface RutaConsola {
  /** Id de la consola (el del archivo del espacio de datos). */
  consolaId: string
  conexionId: string
  /** Alias de la conexión: la columna `description` de la sugerencia. */
  alias: string
  dialecto: DialectoSql
  /**
   * Esquema actual de la sesión de ESA consola, leído en el momento; null si aún
   * no hay sesión (el autocompletado usa entonces el esquema por defecto).
   */
  esquema(): string | null
  /**
   * La BASE de la consola en una conexión con nivel «Bases» (SQL Server sin base fija):
   * allí el «esquema» de la sesión es la base (`USE`), y el esquema para el
   * autocompletado es el por defecto del usuario (null). Ausente = ninguna.
   */
  base?(): string | null
}

/** Esquema de URI de los modelos de consola. No choca con `file:` ni `inmemory:`. */
export const ESQUEMA_URI_CONSOLA = 'tessera-db'

const rutas = new Map<string, RutaConsola>()

/**
 * URI del modelo de una consola: `tessera-db://consola/<id>.sql`. Es la que el pane
 * pasa a `monaco.Uri.parse`; para registrar se usa `model.uri.toString()`, que para
 * un id normal da exactamente esta misma cadena.
 */
export function uriConsola(consolaId: string): string {
  return `${ESQUEMA_URI_CONSOLA}://consola/${encodeURIComponent(consolaId)}.sql`
}

/** ¿La URI es de un modelo de consola (esté registrada o no)? */
export function esUriDeConsola(uri: string): boolean {
  return uri.startsWith(`${ESQUEMA_URI_CONSOLA}://consola/`)
}

/**
 * Registra (o sustituye) la ruta de una URI. Devuelve la baja, que solo quita la
 * entrada si sigue siendo ESTA ruta.
 */
export function registrarRutaConsola(uri: string, ruta: RutaConsola): () => void {
  rutas.set(uri, ruta)
  return () => {
    if (rutas.get(uri) === ruta) rutas.delete(uri)
  }
}

/** La consola dueña de un modelo, o null (un `.sql` del editor de archivos, p. ej.). */
export function rutaDeModelo(uri: string): RutaConsola | null {
  return rutas.get(uri) ?? null
}

/** Consolas de una conexión (para invalidar o avisar a todas a la vez). */
export function rutasDeConexion(conexionId: string): RutaConsola[] {
  const out: RutaConsola[] = []
  rutas.forEach((r) => {
    if (r.conexionId === conexionId) out.push(r)
  })
  return out
}

/** Solo para tests. */
export function rutasRegistradas(): number {
  return rutas.size
}
