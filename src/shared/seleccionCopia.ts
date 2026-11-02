// =============================================================================
// Qué se importa de una copia de la configuración: el árbol de la vista previa (cada perfil, con su
// destino, y sus reglas, conexiones SSH, de bases de datos, agentes e historial por cuenta debajo; los
// agentes nativos, el historial nativo y los ajustes aparte), las casillas que se marcan y desmarcan con
// sus dependencias (el bastión de una SSH, el túnel de una base) y la selección que se manda a importar. Puro.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { FuenteHistorial } from './copia-configuracion-ipc.ts'
import type { EstadoReglas } from './destinoCopia.ts'

/** Una conexión del archivo tal como la ve la vista previa: sin secretos. */
export interface ConexionPrevia {
  id: string
  perfil: string
  nombre: string
  /** El grupo de una conexión SSH. */
  detalle: string | null
  /** La conexión SSH sin la que esta no funciona: su bastión, o el túnel de una base. */
  depende: string | null
  /** Ya hay una conexión con ese id en este equipo: no se toca. */
  yaEsta: boolean
}

export interface PreviaConexiones {
  ssh: ConexionPrevia[]
  bd: ConexionPrevia[]
}

export type TipoElemento = 'perfil' | 'reglas' | 'ssh' | 'bd' | 'agente' | 'nativo' | 'historial' | 'ajustes'

export interface ElementoImportar {
  clave: string
  tipo: TipoElemento
  id: string
  perfil: string | null
  nombre: string
  detalle: string | null
  yaEsta: boolean
  /** Las claves de los elementos sin los que este no puede entrar. */
  requiere: string[]
  /** El historial de una cuenta (o el nativo de un agente), para enseñar cuánto trae. */
  historial?: FuenteHistorial
}

/** Un perfil del archivo con lo suyo debajo, el perfil de aquí que lo recibe (null = perfil nuevo) y cómo quedan sus reglas en él. */
export interface GrupoImportar {
  perfil: ElementoImportar
  hijos: ElementoImportar[]
  destino: string | null
  /** Solo con destino un perfil de aquí y reglas en el archivo; un perfil nuevo se lleva las suyas. */
  reglas: Exclude<EstadoReglas, 'ninguna'> | null
}

export interface ArbolImportar {
  perfiles: GrupoImportar[]
  nativos: ElementoImportar[]
  /** El historial nativo de cada agente: del equipo, no de un perfil. */
  historialNativo: ElementoImportar[]
  ajustes: ElementoImportar | null
}

interface Nombrado {
  id: string
  nombre: string
}

export interface EntradaArbol {
  perfiles: readonly Nombrado[]
  /** El perfil de aquí que recibe cada perfil del archivo; null o ausente, perfil nuevo. */
  destinos: Readonly<Record<string, string | null>>
  /** Las reglas de cada perfil del archivo frente a las de su destino. */
  reglas?: Readonly<Record<string, EstadoReglas>>
  conexiones: PreviaConexiones
  agentes?: { nativos: readonly Nombrado[]; dockerPorPerfil: Readonly<Record<string, readonly Nombrado[]>> }
  agentesAqui: { nativos: ReadonlySet<string>; dockerPorPerfil: Readonly<Record<string, readonly string[]>> }
  ajustes: boolean
  historial?: readonly FuenteHistorial[]
}

/**
 * Lo que se manda a importar. Las conexiones van por id; los agentes Docker, por perfil; el historial, por
 * su número. `destinos`: el perfil de aquí de cada perfil elegido (null = perfil nuevo); `reglas`: los
 * perfiles elegidos cuyas reglas se ponen en su destino.
 */
export interface SeleccionImportar {
  perfiles: string[]
  destinos: Record<string, string | null>
  reglas: string[]
  ssh: string[]
  bd: string[]
  nativos: string[]
  agentesPorPerfil: Record<string, string[]>
  ajustes: boolean
  historial: string[]
}

/**
 * Lo que el main necesita para dar de alta las conexiones y el historial elegidos. `reasignar`: el id de
 * aquí que recibe lo de cada perfil del archivo (sin él, el suyo); `fusionados`: los que van a un perfil que
 * ya existía, del que no se revisa nada del archivo.
 */
export type SeleccionConexiones = Pick<SeleccionImportar, 'perfiles' | 'ssh' | 'bd' | 'historial'> & {
  reasignar: Record<string, string>
  fusionados: string[]
}

/** Una casilla que cambió sola por una dependencia: `nombre` cambió por `por`. */
export interface AvisoSeleccion {
  tipo: 'marcada' | 'desmarcada'
  nombre: string
  por: string
}

export type EstadoGrupo = 'marcado' | 'medias' | 'desmarcado' | 'yaEsta'

const claveDe = (tipo: TipoElemento, perfil: string | null, id: string): string => JSON.stringify([tipo, perfil, id])

function elemento(tipo: TipoElemento, id: string, perfil: string | null, nombre: string, yaEsta: boolean, detalle: string | null = null): ElementoImportar {
  return { clave: claveDe(tipo, perfil, id), tipo, id, perfil, nombre, detalle, yaEsta, requiere: [] }
}

/** El árbol de la vista previa. Una dependencia solo cuenta si la otra conexión viene en el archivo y aún no está aquí. */
export function arbolImportar(e: EntradaArbol): ArbolImportar {
  const sshPorId = new Map(e.conexiones.ssh.filter((c) => !c.yaEsta).map((c) => [c.id, claveDe('ssh', c.perfil, c.id)]))
  const conexion = (tipo: 'ssh' | 'bd', c: ConexionPrevia): ElementoImportar => {
    const el = elemento(tipo, c.id, c.perfil, c.nombre, c.yaEsta, c.detalle)
    const req = c.depende !== null ? sshPorId.get(c.depende) : undefined
    if (!c.yaEsta && req !== undefined && req !== el.clave) el.requiere.push(req)
    return el
  }
  const perfiles = e.perfiles.map((p): GrupoImportar => {
    const destino = e.destinos[p.id] ?? null
    // Los agentes «ya están» si los tiene el perfil que los recibe; uno nuevo no tiene ninguno.
    const agentesAqui = new Set(destino === null ? [] : (e.agentesAqui.dockerPorPerfil[destino] ?? []))
    const estado = e.reglas?.[p.id] ?? 'ninguna'
    const reglas = destino === null || estado === 'ninguna' ? null : estado
    const hijos = [
      // Solo traerlas es una casilla; iguales no hay nada que hacer, y distintas se elige aparte.
      ...(reglas !== null ? [elemento('reglas', p.id, p.id, p.nombre, reglas !== 'traer')] : []),
      ...e.conexiones.ssh.filter((c) => c.perfil === p.id).map((c) => conexion('ssh', c)),
      ...e.conexiones.bd.filter((c) => c.perfil === p.id).map((c) => conexion('bd', c)),
      ...(e.agentes?.dockerPorPerfil[p.id] ?? []).map((a) => elemento('agente', a.id, p.id, a.nombre, agentesAqui.has(a.id))),
      ...(e.historial ?? []).filter((h) => h.perfil === p.id).map(historial)
    ]
    return { perfil: elemento('perfil', p.id, null, p.nombre, destino !== null), hijos, destino, reglas }
  })
  return {
    perfiles,
    nativos: (e.agentes?.nativos ?? []).map((a) => elemento('nativo', a.id, null, a.nombre, e.agentesAqui.nativos.has(a.id))),
    historialNativo: (e.historial ?? []).filter((h) => h.perfil === null).map(historial),
    ajustes: e.ajustes ? elemento('ajustes', 'ajustes', null, '', false) : null
  }
}

/** El historial nunca «ya está»: se fusiona conversación a conversación al importar. */
function historial(h: FuenteHistorial): ElementoImportar {
  return { ...elemento('historial', String(h.id), h.perfil, h.cuenta ?? '', false), historial: h }
}

function elementos(a: ArbolImportar): ElementoImportar[] {
  return [...a.perfiles.flatMap((g) => [g.perfil, ...g.hijos]), ...a.nativos, ...a.historialNativo, ...(a.ajustes ? [a.ajustes] : [])]
}

/** De serie y con «Marcar todo», todo lo que no está aquí: así ninguna dependencia queda fuera. */
export function seleccionInicial(a: ArbolImportar): Set<string> {
  return new Set(elementos(a).filter((e) => !e.yaEsta).map((e) => e.clave))
}

/** ¿Está marcado todo lo marcable? Sin nada marcable, no. */
export function todoMarcado(a: ArbolImportar, sel: ReadonlySet<string>): boolean {
  const marcables = elementos(a).filter((e) => !e.yaEsta)
  return marcables.length > 0 && marcables.every((e) => sel.has(e.clave))
}

/**
 * Lo que dice la casilla de «Todo»: cuántas cosas entran de cuántas se pueden traer y su estado. Se
 * cuentan las cosas, no los perfiles que las agrupan; un perfil nuevo sin nada dentro cuenta él solo.
 */
export function recuentoSeleccion(
  a: ArbolImportar,
  sel: ReadonlySet<string>
): { marcadas: number; total: number; estado: Exclude<EstadoGrupo, 'yaEsta'> | 'nada' } {
  const contables = elementos(a).filter(
    (e) => !e.yaEsta && (e.tipo !== 'perfil' || !a.perfiles.some((g) => g.perfil.clave === e.clave && g.hijos.some((h) => !h.yaEsta)))
  )
  const marcadas = contables.filter((e) => sel.has(e.clave)).length
  const total = contables.length
  const estado = total === 0 ? 'nada' : marcadas === 0 ? 'desmarcado' : marcadas === total ? 'marcado' : 'medias'
  return { marcadas, total, estado }
}

export function estadoPerfil(a: ArbolImportar, sel: ReadonlySet<string>, perfil: string): EstadoGrupo {
  const g = a.perfiles.find((x) => x.perfil.id === perfil)
  const marcables = g ? [g.perfil, ...g.hijos].filter((e) => !e.yaEsta) : []
  if (marcables.length === 0) return 'yaEsta'
  const n = marcables.filter((e) => sel.has(e.clave)).length
  return n === 0 ? 'desmarcado' : n === marcables.length ? 'marcado' : 'medias'
}

/** Marca las claves con lo que necesitan (y el perfil que las recibe), avisando de lo que se marcó de más. */
function poner(a: ArbolImportar, sel: Set<string>, claves: readonly string[]): AvisoSeleccion[] {
  const todos = new Map(elementos(a).map((e) => [e.clave, e]))
  const perfilDe = new Map(a.perfiles.flatMap((g) => g.hijos.map((h) => [h.clave, g.perfil] as const)))
  const pedidas = new Set(claves)
  const avisos: AvisoSeleccion[] = []
  const pila = claves.map((c) => ({ clave: c, por: null as ElementoImportar | null }))
  while (pila.length > 0) {
    const { clave, por } = pila.pop()!
    const e = todos.get(clave)
    if (!e || e.yaEsta || sel.has(clave)) continue
    sel.add(clave)
    if (por && !pedidas.has(clave)) avisos.push({ tipo: 'marcada', nombre: e.nombre, por: por.nombre })
    const perfil = perfilDe.get(clave)
    if (perfil && !perfil.yaEsta) sel.add(perfil.clave)
    for (const r of e.requiere) pila.push({ clave: r, por: e })
  }
  return avisos
}

/** Desmarca las claves y lo que depende de ellas, avisando de lo que se desmarcó de más. */
function quitar(a: ArbolImportar, sel: Set<string>, claves: readonly string[]): AvisoSeleccion[] {
  const todos = elementos(a)
  const pedidas = new Set(claves)
  const avisos: AvisoSeleccion[] = []
  const pila = claves.map((c) => ({ clave: c, por: null as ElementoImportar | null }))
  while (pila.length > 0) {
    const { clave, por } = pila.pop()!
    if (!sel.has(clave)) continue
    sel.delete(clave)
    const e = todos.find((x) => x.clave === clave)
    if (e && por && !pedidas.has(clave)) avisos.push({ tipo: 'desmarcada', nombre: e.nombre, por: por.nombre })
    for (const d of todos) if (e && d.requiere.includes(clave)) pila.push({ clave: d.clave, por: e })
  }
  return avisos
}

/**
 * Pulsar una casilla. La de un perfil marca o desmarca todo lo suyo (a medias, lo marca). Marcar algo
 * marca también lo que necesita; desmarcarlo desmarca lo que depende de ello: nada entra sin su
 * bastión o su túnel.
 */
export function alternar(a: ArbolImportar, sel: ReadonlySet<string>, clave: string): { seleccion: Set<string>; avisos: AvisoSeleccion[] } {
  const nueva = new Set(sel)
  const grupo = a.perfiles.find((g) => g.perfil.clave === clave)
  if (grupo) {
    const marcables = [grupo.perfil, ...grupo.hijos].filter((e) => !e.yaEsta).map((e) => e.clave)
    const marcado = estadoPerfil(a, sel, grupo.perfil.id) === 'marcado'
    return { seleccion: nueva, avisos: marcado ? quitar(a, nueva, marcables) : poner(a, nueva, marcables) }
  }
  return { seleccion: nueva, avisos: sel.has(clave) ? quitar(a, nueva, [clave]) : poner(a, nueva, [clave]) }
}

/**
 * Al cambiar el destino de un perfil, la selección con el árbol nuevo: lo de los demás perfiles sigue
 * igual; lo del que cambió se marca entero (`marcar`, como de serie) o conserva lo que siga siendo
 * marcable, con su perfil si queda algo suyo.
 */
export function seleccionTrasCambiarDestino(a: ArbolImportar, sel: ReadonlySet<string>, perfil: string, marcar: boolean): Set<string> {
  const marcables = new Set(elementos(a).filter((e) => !e.yaEsta).map((e) => e.clave))
  const nueva = new Set([...sel].filter((c) => marcables.has(c)))
  const g = a.perfiles.find((x) => x.perfil.id === perfil)
  if (!g) return nueva
  const delGrupo = [g.perfil, ...g.hijos].filter((e) => !e.yaEsta).map((e) => e.clave)
  if (marcar) poner(a, nueva, delGrupo)
  else if (!g.perfil.yaEsta && g.hijos.some((h) => nueva.has(h.clave))) nueva.add(g.perfil.clave)
  return nueva
}

/**
 * La selección que se manda a importar. Un perfil entra si se marcó él o algo suyo, o si se eligió
 * sustituir sus reglas (`sustituir`, solo vale con reglas distintas a las de su destino).
 */
export function seleccionParaImportar(a: ArbolImportar, sel: ReadonlySet<string>, sustituir: ReadonlySet<string> = new Set()): SeleccionImportar {
  const fuera: SeleccionImportar = {
    perfiles: [],
    destinos: {},
    reglas: [],
    ssh: [],
    bd: [],
    nativos: [],
    agentesPorPerfil: {},
    ajustes: a.ajustes !== null && sel.has(a.ajustes.clave),
    historial: []
  }
  for (const g of a.perfiles) {
    const hijos = g.hijos.filter((h) => sel.has(h.clave))
    const sustituye = g.reglas === 'distintas' && sustituir.has(g.perfil.id)
    if (!sel.has(g.perfil.clave) && hijos.length === 0 && !sustituye) continue
    fuera.perfiles.push(g.perfil.id)
    fuera.destinos[g.perfil.id] = g.destino
    if (sustituye) fuera.reglas.push(g.perfil.id)
    for (const h of hijos) {
      if (h.tipo === 'ssh' || h.tipo === 'bd' || h.tipo === 'historial') fuera[h.tipo].push(h.id)
      else if (h.tipo === 'reglas') fuera.reglas.push(g.perfil.id)
      else (fuera.agentesPorPerfil[g.perfil.id] ??= []).push(h.id)
    }
  }
  fuera.nativos = a.nativos.filter((n) => sel.has(n.clave)).map((n) => n.id)
  fuera.historial.push(...a.historialNativo.filter((n) => sel.has(n.clave)).map((n) => n.id))
  return fuera
}

export function haySeleccion(s: SeleccionImportar): boolean {
  return s.perfiles.length > 0 || s.nativos.length > 0 || s.ajustes || s.historial.length > 0
}

const objeto = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
const idEn = (ids: ReadonlySet<string>) => (d: unknown): boolean => typeof objeto(d).id === 'string' && ids.has(objeto(d).id as string)

/** Los agentes de la copia reducidos a los elegidos; lo demás de la copia pasa tal cual. */
export function agentesSeleccionados(copia: unknown, s: Pick<SeleccionImportar, 'nativos' | 'agentesPorPerfil'>): Record<string, unknown> {
  const c = objeto(copia)
  const docker = objeto(c.dockerPorPerfil)
  const dockerPorPerfil: Record<string, unknown[]> = {}
  for (const [perfil, ids] of Object.entries(s.agentesPorPerfil)) {
    const lista = docker[perfil]
    if (Array.isArray(lista)) dockerPorPerfil[perfil] = lista.filter(idEn(new Set(ids)))
  }
  return { ...c, nativos: Array.isArray(c.nativos) ? c.nativos.filter(idEn(new Set(s.nativos))) : [], dockerPorPerfil }
}

/** La selección de conexiones que llega por IPC, saneada: lo que no es una lista de textos, vacío. */
export function leerSeleccionConexiones(raw: unknown): SeleccionConexiones {
  const o = objeto(raw)
  const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const reasignar = Object.fromEntries(Object.entries(objeto(o.reasignar)).filter((x): x is [string, string] => typeof x[1] === 'string' && x[1] !== ''))
  return { perfiles: lista(o.perfiles), ssh: lista(o.ssh), bd: lista(o.bd), historial: lista(o.historial), reasignar, fusionados: lista(o.fusionados) }
}
