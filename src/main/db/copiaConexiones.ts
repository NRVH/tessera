// =============================================================================
// Una conexión de bases de datos en la copia de la configuración, de ida y de vuelta: al exportar
// se quita lo que es de este equipo (la verificación, el driver elegido, la caché del catálogo, el
// orden y el secreto cifrado con su almacén); al importar, el registro de la copia se lee como la
// entrada de un alta, para que pase por la misma validación que una hecha a mano. Puro.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { normalizarEsquemasVisibles } from '../../shared/dbEsquemas.ts'
import type { DbEsquemasVisibles } from '../../shared/db-ipc.ts'
import type { ConexionPersistida } from './conservarAlEditar.ts'
import { txDb } from './textosDb.ts'
import type { EntradaConexion } from './controlador/validacionConexion.ts'

/** Lo que viaja de una conexión: sus datos y su contraseña en claro (dentro del archivo cifrado con la frase). */
export interface ConexionBdCopia {
  registro: Omit<ConexionPersistida, 'secretEnc' | 'verificadaEn' | 'introspeccion' | 'driverId' | 'orden'>
  secreto: string | null
}

/** Ids que se aceptan de una copia: los de `randomUUID` y parecidos, nunca algo que acabe en una ruta rara. */
export const ID_COPIA = /^[A-Za-z0-9-]{1,64}$/

/** El registro tal como viaja: sin lo que es de este equipo. */
export function registroParaCopia(c: ConexionPersistida): ConexionBdCopia['registro'] {
  const { secretEnc: _s, verificadaEn: _v, introspeccion: _i, driverId: _d, orden: _o, ...resto } = structuredClone(c)
  return resto
}

/** La entrada de un alta a partir del registro de la copia; lanza con un mensaje si no tiene la forma. */
export function entradaDesdeCopia(raw: unknown): { id: string; entrada: EntradaConexion; esquemas?: DbEsquemasVisibles; bases?: DbEsquemasVisibles } {
  if (typeof raw !== 'object' || raw === null) throw new Error(txDb().conexion.formaInvalida)
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID_COPIA.test(r.id)) throw new Error(txDb().conexion.idInvalido)
  if (typeof r.alias !== 'string' || typeof r.profileId !== 'string') throw new Error(txDb().conexion.sinNombreOPerfil)
  const { id, archivo, esquemas, bases, ...datos } = r
  const entrada = {
    ...datos,
    host: typeof datos.host === 'string' ? datos.host : '',
    user: typeof datos.user === 'string' ? datos.user : '',
    port: typeof datos.port === 'number' ? datos.port : 0,
    ...(typeof archivo === 'string' ? { rutaArchivo: archivo } : {}),
    password: undefined
  } as unknown as EntradaConexion
  const fuera: ReturnType<typeof entradaDesdeCopia> = { id: id as string, entrada }
  if (esquemas !== undefined) fuera.esquemas = normalizarEsquemasVisibles(esquemas)
  if (bases !== undefined) fuera.bases = normalizarEsquemasVisibles(bases)
  return fuera
}
