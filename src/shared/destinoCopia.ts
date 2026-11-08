// =============================================================================
// Adónde va cada perfil de una copia de la configuración al importarla: a un perfil nuevo o a uno de
// este equipo, y qué pasa entonces con sus reglas. El destino de serie (el del mismo id; si no, el del
// mismo nombre), el estado de las reglas frente a las del destino, el plan de perfiles (los nuevos, con
// un id libre si el suyo está ocupado, y las reglas que se ponen en los de aquí) y los agentes de la
// copia reasignados a su perfil de destino. Puro: lo usan el renderer y los `test-*.mts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { normalizarReglas } from './reglasPerfil.ts'
import { sinCarpetasDocumentos } from './documentosPerfil.ts'

interface Nombrado {
  id: string
  nombre: string
}

/** Lo que el plan necesita de un perfil del archivo. */
export interface PerfilDeCopia extends Nombrado {
  reglas?: string
  agentes: ReadonlyArray<{ tipo: string; configDir: string }>
}

const claveNombre = (n: string): string => n.trim().toLocaleLowerCase()

/** El perfil de aquí al que va de serie uno del archivo: el del mismo id; si no, el del mismo nombre; si no, null (perfil nuevo). */
export function destinoPorDefecto(p: Nombrado, aqui: readonly Nombrado[]): string | null {
  if (aqui.some((x) => x.id === p.id)) return p.id
  return aqui.find((x) => claveNombre(x.nombre) === claveNombre(p.nombre))?.id ?? null
}

/** El destino de serie de cada perfil del archivo, por su id. */
export function destinosPorDefecto(copia: readonly Nombrado[], aqui: readonly Nombrado[]): Record<string, string | null> {
  return Object.fromEntries(copia.map((p) => [p.id, destinoPorDefecto(p, aqui)]))
}

/** Lo que hace falta para saber qué cuenta de aquí es la misma que una del archivo. */
export interface CuentaComparable {
  id: string
  agente: string
  nombre: string
  predeterminada: boolean
}

/**
 * La cuenta de aquí que corresponde a una del archivo, entre las de un perfil de destino: la predeterminada con la
 * predeterminada; las demás por su id, por si aquí cambió de nombre, y si no por el nombre, porque la misma cuenta
 * creada en otro equipo tiene otro id. null: habría que crearla.
 */
export function emparejarCuenta<C extends CuentaComparable>(archivo: CuentaComparable, aqui: readonly C[]): C | null {
  const delAgente = aqui.filter((c) => c.agente === archivo.agente)
  if (archivo.predeterminada) return delAgente.find((c) => c.predeterminada) ?? null
  const creadas = delAgente.filter((c) => !c.predeterminada)
  return creadas.find((c) => c.id === archivo.id) ?? creadas.find((c) => claveNombre(c.nombre) === claveNombre(archivo.nombre)) ?? null
}

/**
 * Las reglas de un perfil del archivo frente a las del perfil de aquí que lo recibe: el archivo no trae
 * (`ninguna`), aquí no hay y se traen (`traer`), son las mismas (`iguales`) o hay que elegir (`distintas`).
 */
export type EstadoReglas = 'ninguna' | 'traer' | 'iguales' | 'distintas'

export function estadoReglas(aqui: string | undefined, archivo: string | undefined): EstadoReglas {
  const deAqui = normalizarReglas(aqui ?? '')
  const delArchivo = normalizarReglas(archivo ?? '')
  if (delArchivo === '') return 'ninguna'
  if (deAqui === '') return 'traer'
  return deAqui === delArchivo ? 'iguales' : 'distintas'
}

/** Lo elegido que decide el plan: los perfiles que entran, su destino (null = perfil nuevo) y de cuáles se traen las reglas. */
export interface EleccionPerfiles {
  perfiles: readonly string[]
  destinos: Readonly<Record<string, string | null>>
  reglas: readonly string[]
}

export interface PlanPerfiles<P> {
  /** Los perfiles que se crean, ya con su id definitivo. */
  nuevos: P[]
  /** El id de aquí que recibe lo de cada perfil del archivo elegido. */
  destinos: Record<string, string>
  /** Los perfiles del archivo que van a un perfil que ya existe aquí. */
  fusionados: string[]
  /** Las reglas que se ponen en un perfil de aquí. */
  reglas: Array<{ perfil: string; reglas: string }>
}

/** `<id>-2`, `<id>-3`…: el primero que no está ocupado. */
function idLibre(id: string, ocupados: ReadonlySet<string>): string {
  let n = 2
  while (ocupados.has(`${id}-${n}`)) n++
  return `${id}-${n}`
}

/** El perfil con otro id; las carpetas de sus agentes que cuelgan de su id pasan al nuevo, para no compartirlas con el perfil que ya lo usa. */
function conOtroId<P extends PerfilDeCopia>(p: P, id: string): P {
  const viejo = `./.tessera/perfiles/${p.id}/`
  return {
    ...p,
    id,
    agentes: p.agentes.map((a) => (a.configDir.startsWith(viejo) ? { ...a, configDir: `./.tessera/perfiles/${id}/${a.configDir.slice(viejo.length)}` } : a))
  }
}

/**
 * Qué se hace con los perfiles elegidos del archivo. Con destino un perfil de aquí, ese perfil no cambia
 * de nombre ni de color: recibe lo que le falte y, si se eligió, las reglas del archivo. Sin destino (o
 * con uno que ya no existe) se crea un perfil nuevo, con su id o, si está ocupado, con uno libre.
 */
export function planPerfiles<P extends PerfilDeCopia>(aqui: readonly { id: string }[], copia: readonly P[], e: EleccionPerfiles): PlanPerfiles<P> {
  const existentes = new Set(aqui.map((p) => p.id))
  const ocupados = new Set(existentes)
  const elegidos = new Set(e.perfiles)
  const conReglas = new Set(e.reglas)
  const vistos = new Set<string>()
  const plan: PlanPerfiles<P> = { nuevos: [], destinos: {}, fusionados: [], reglas: [] }
  for (const p of copia) {
    if (!elegidos.has(p.id) || vistos.has(p.id)) continue
    vistos.add(p.id)
    const destino = e.destinos[p.id] ?? null
    if (destino !== null && existentes.has(destino)) {
      plan.destinos[p.id] = destino
      plan.fusionados.push(p.id)
      const reglas = normalizarReglas(p.reglas ?? '')
      // Dos perfiles del archivo al mismo destino: manda el primero de la lista, el que se ve arriba,
      // y nunca una sustitución que pise a otra en silencio.
      const yaTiene = plan.reglas.some((r) => r.perfil === destino)
      if (conReglas.has(p.id) && reglas !== '' && !yaTiene) plan.reglas.push({ perfil: destino, reglas })
      continue
    }
    const id = ocupados.has(p.id) ? idLibre(p.id, ocupados) : p.id
    ocupados.add(id)
    // Las carpetas de documentos no se traen nunca, ni de una copia hecha antes de que el export las quitara.
    const limpio = sinCarpetasDocumentos(p)
    plan.nuevos.push(id === p.id ? limpio : conOtroId(limpio, id))
    plan.destinos[p.id] = id
  }
  return plan
}

const objeto = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})

/** Una tabla por perfil con las claves cambiadas por su destino; dos perfiles al mismo destino juntan sus listas. Lo que no tiene destino se queda fuera. */
function reasignarTabla(tabla: unknown, destinos: Readonly<Record<string, string>>): Record<string, unknown[]> {
  const fuera: Record<string, unknown[]> = {}
  for (const [perfil, lista] of Object.entries(objeto(tabla))) {
    const destino = destinos[perfil]
    if (destino === undefined || !Array.isArray(lista)) continue
    fuera[destino] = [...(fuera[destino] ?? []), ...lista]
  }
  return fuera
}

/** Los agentes de la copia con los de cada perfil (y sus ocultos) bajo el perfil de destino. */
export function reasignarAgentes(copia: unknown, destinos: Readonly<Record<string, string>>): Record<string, unknown> {
  const c = objeto(copia)
  return { ...c, dockerPorPerfil: reasignarTabla(c.dockerPorPerfil, destinos), ocultosPorPerfil: reasignarTabla(c.ocultosPorPerfil, destinos) }
}
