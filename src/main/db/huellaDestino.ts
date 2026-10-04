// =============================================================================
// Huella del destino de una conexión: a qué servidor, por qué protocolo y como quién se manda su contraseña.
// Viaja con cada contraseña que Tessera entrega a `tdb` (entorno sin puente, respuesta del puente) y `tdb`
// solo la usa si la entrada del registro que va a abrir tiene esa huella. `tdb.cjs` lleva una copia.
// Decisiones: docs/decisiones/bd/puente-huella-del-destino.md
// =============================================================================
import { createHash } from 'node:crypto'

/** Lo que entra en la huella. `unknown`: en `tdb` sale del JSON tal cual, sin validar tipos. */
export interface DestinoBd {
  motor: unknown
  host: unknown
  port: unknown
  database?: unknown
  sid?: unknown
  user: unknown
  /** Motor de archivo: la ruta guardada (`archivo` en disco). Ver abajo. */
  archivo?: unknown
  /** (SQL Server.) Instancia, autenticación, dominio y cifrado. Ver abajo. */
  instancia?: unknown
  autenticacion?: unknown
  dominio?: unknown
  tls?: unknown
}

/** Caracteres hexadecimales de la huella (128 bits). */
export const LARGO_HUELLA = 32

/**
 * La huella del destino de una conexión. DEBE dar lo mismo que `huellaDestino` de `src/tdb/tdbConectar.cjs`.
 * El archivo entra como séptimo valor solo si la entrada lo trae, y instancia, autenticación, dominio y
 * `tls` como una lista más, solo si trae alguno: la huella de toda Oracle, PG o conexión de red sin ellos
 * es la de antes al byte.
 */
export function huellaDestino(c: DestinoBd): string {
  const valores: unknown[] = [c.motor, c.host, c.port, c.database, c.sid, c.user]
  if (c.archivo !== undefined) valores.push(c.archivo)
  if (c.instancia !== undefined || c.autenticacion !== undefined || c.dominio !== undefined || c.tls !== undefined) {
    valores.push([c.instancia, c.autenticacion, c.dominio, c.tls].map((v) => (v === undefined ? null : v)))
  }
  const campos = valores.map((v) => (v === undefined ? null : v))
  return createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex').slice(0, LARGO_HUELLA)
}
