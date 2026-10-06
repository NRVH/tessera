// =============================================================================
// El borrado de lo de un perfil BORRADO: cerrar sus sesiones, parar su contenedor, su historial de
// consultas, sus conexiones SSH y mandar a la papelera sus carpetas. Cada perfil con su candado
// (`candadoDeBorrado.ts`) de principio a fin, y cada paso irreversible decidido contra la lista de
// perfiles de ESE momento: entre medias pasan segundos y el usuario puede haber recreado el perfil con
// el mismo id. Pura y sin Electron (todo llega inyectado), para probarla con `node` a secas
// (`test-borrado-de-perfil.mts`); la compone `agents/componer.ts`.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { hayMismoPerfil, type ResultadoBorrado } from '../util/carpetaDePerfil.ts'
import type { CandadoDeBorrado } from './candadoDeBorrado.ts'

/**
 * El dueño de una carpeta del perfil (`EspacioTerminal`, `EspacioDatos`): la manda a la papelera del
 * sistema, que lleva inyectada desde que nace, con los ids vivos de cada momento. No hay otra forma de
 * quitar las carpetas: el borrado se deduce de la lista guardada, y lo que se quite así tiene que poder
 * recuperarse.
 */
export interface DuenoDeCarpeta {
  borrar: (profileId: string, idsVivos: () => readonly string[]) => Promise<ResultadoBorrado>
}

/** Una carpeta del perfil: qué es (para el registro) y su dueño. */
export type CarpetaDePerfil = readonly [cual: string, dueno: DuenoDeCarpeta]

export interface DepsBorradoDePerfil {
  /** Los ids de los perfiles que existen AHORA: se lee en cada paso, nunca se captura una vez. */
  idsVivos: () => readonly string[]
  /** Cierra las sesiones que sigan abiertas con ese perfil (agente y terminal). */
  cerrarSesiones: (profileId: string) => Promise<unknown>
  carpetas: readonly CarpetaDePerfil[]
  log: (mensaje: string) => void
  error: (mensaje: string, err?: unknown) => void
}

/** Lo que borra un perfil entero: sus sesiones, su contenedor, su historial, sus conexiones SSH y sus carpetas. */
export interface DepsBorradoCompleto<P extends { id: string }> extends DepsBorradoDePerfil {
  /** El candado por id que espera lo que recrea un perfil (su carpeta, su espacio de datos, sus sesiones). */
  candado: Pick<CandadoDeBorrado, 'mientrasSeBorra'>
  pararContenedor: (perfil: P) => Promise<unknown>
  /** Su historial de consultas, que vive fuera de su espacio de datos: nadie más lo borraría. */
  borrarHistorial: (profileId: string) => Promise<unknown>
  /** Sus conexiones SSH y lo que cuelga de ellas (huellas, claves): se borran EN FIRME, sin papelera. */
  borrarConexionesSsh: (profileId: string) => void
}

/**
 * ¿Ha vuelto a existir el perfil? Un perfil recreado con el mismo nombre recibe el mismo id. Con el
 * criterio de la carpeta y del candado (`hayMismoPerfil`): un id que solo cambia en la caja o en la
 * forma Unicode es el mismo perfil, y lo suyo no se toca.
 */
export function perfilVuelveAExistir(idsVivos: readonly string[], profileId: string): boolean {
  return hayMismoPerfil(idsVivos, profileId)
}

/**
 * ¿Sigue borrado el perfil, según la lista de ESTE momento? Si ha vuelto a existir lo registra: el paso
 * que iba a darse y los siguientes ya serían del perfil nuevo.
 */
function sigueBorrado(deps: Pick<DepsBorradoDePerfil, 'idsVivos' | 'log'>, profileId: string, que: string): boolean {
  if (!perfilVuelveAExistir(deps.idsVivos(), profileId)) return true
  deps.log(`[tessera] el perfil ${profileId} ha vuelto a existir: no se tocan ${que}`)
  return false
}

/**
 * Cierra las sesiones del perfil y manda sus carpetas a la papelera, una a una. Antes de cada paso se
 * mira la lista de ESE momento: si el perfil vuelve a existir, se para sin tocar nada más (sus sesiones
 * y su carpeta recién sembrada son ya del perfil nuevo). Cada carpeta por su lado: un fallo se
 * registra (la carpeta se queda en su sitio) y no impide la otra.
 */
export async function borrarCarpetasDelPerfil(deps: DepsBorradoDePerfil, profileId: string): Promise<void> {
  if (!sigueBorrado(deps, profileId, 'sus sesiones ni sus carpetas')) return
  await cerrarSesionesDelPerfil(deps, profileId)
  await mandarCarpetasAPapelera(deps, profileId)
}

/** Cierra las sesiones del perfil; un fallo se registra y no corta el borrado. */
async function cerrarSesionesDelPerfil(deps: DepsBorradoDePerfil, profileId: string): Promise<void> {
  try {
    await deps.cerrarSesiones(profileId)
  } catch (err) {
    deps.error(`[tessera] no se pudieron cerrar las sesiones del perfil eliminado ${profileId}:`, err)
  }
}

/** Sus carpetas a la papelera, una a una, mirando antes de cada una si el perfil sigue borrado. */
async function mandarCarpetasAPapelera(deps: DepsBorradoDePerfil, profileId: string): Promise<void> {
  for (const [cual, dueno] of deps.carpetas) {
    if (!sigueBorrado(deps, profileId, 'sus carpetas')) return
    try {
      const r = await dueno.borrar(profileId, deps.idsVivos)
      if (r !== 'no-existia') deps.log(`[tessera] carpeta ${cual} del perfil eliminado ${profileId}: ${r}`)
    } catch (err) {
      deps.error(`[tessera] la carpeta ${cual} del perfil eliminado ${profileId} no fue a la papelera y se queda en su sitio:`, err)
    }
  }
}

/**
 * Lo de un perfil, en orden: sus sesiones, su contenedor, su historial, sus conexiones SSH y sus carpetas.
 * Justo antes de cada paso se mira si sigue borrado, sin nada que esperar entre esa comprobación y el paso: parar
 * el contenedor de un perfil recreado mataría sus agentes, y sus conexiones SSH se borran en firme.
 */
async function borrarPerfil<P extends { id: string }>(deps: DepsBorradoCompleto<P>, perfil: P): Promise<void> {
  const id = perfil.id
  // Las sesiones, lo PRIMERO: una SSH abierta seguiría usando sus claves y su known_hosts mientras
  // se borran, y un agente seguiría escribiendo en las carpetas que van a la papelera.
  if (!sigueBorrado(deps, id, 'sus sesiones ni nada suyo')) return
  await cerrarSesionesDelPerfil(deps, id)
  if (!sigueBorrado(deps, id, 'su contenedor ni nada suyo')) return
  try {
    await deps.pararContenedor(perfil)
  } catch (err) {
    deps.error(`[tessera] stopContainer(perfil eliminado ${id}) falló:`, err)
  }
  if (!sigueBorrado(deps, id, 'su historial ni nada suyo')) return
  try {
    await deps.borrarHistorial(id)
  } catch (err) {
    deps.error(`[tessera] no se pudo borrar el historial del perfil eliminado ${id}:`, err)
  }
  if (!sigueBorrado(deps, id, 'sus conexiones SSH ni nada suyo')) return
  try {
    deps.borrarConexionesSsh(id)
  } catch (err) {
    deps.error(`[tessera] no se pudieron borrar las conexiones SSH del perfil eliminado ${id}:`, err)
  }
  await mandarCarpetasAPapelera(deps, id)
}

/**
 * Borra lo de los perfiles que un guardado quitó, uno detrás de otro. Los candados de TODOS se toman
 * al llamar, antes de esperar nada: si no, lo que recrease el segundo mientras se borra el primero no
 * tendría a qué esperar.
 */
export function borrarPerfiles<P extends { id: string }>(deps: DepsBorradoCompleto<P>, perfiles: readonly P[]): Promise<void> {
  let anterior: Promise<unknown> = Promise.resolve()
  const borrados = perfiles.map((perfil) => {
    const turno = anterior
    const hecho = deps.candado.mientrasSeBorra(perfil.id, async () => {
      await turno
      await borrarPerfil(deps, perfil)
    })
    anterior = hecho.catch(() => undefined)
    return hecho
  })
  return Promise.all(borrados).then(() => undefined)
}
