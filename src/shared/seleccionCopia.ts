// =============================================================================
// Qué se importa de una copia de la configuración: el árbol de la vista previa (cada perfil con sus
// conexiones SSH, de bases de datos y agentes debajo; los agentes nativos y los ajustes aparte), las
// casillas que se marcan y desmarcan con sus dependencias (el bastión de una SSH, el túnel de una
// base) y la selección que se manda a importar. Puro: lo usan el main, el renderer y los `test-*.mts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

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

export type TipoElemento = 'perfil' | 'ssh' | 'bd' | 'agente' | 'nativo' | 'ajustes'

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
}

export interface ArbolImportar {
  perfiles: Array<{ perfil: ElementoImportar; hijos: ElementoImportar[] }>
  nativos: ElementoImportar[]
  ajustes: ElementoImportar | null
}

interface Nombrado {
  id: string
  nombre: string
}

export interface EntradaArbol {
  perfiles: readonly Nombrado[]
  perfilesAqui: ReadonlySet<string>
  conexiones: PreviaConexiones
  agentes?: { nativos: readonly Nombrado[]; dockerPorPerfil: Readonly<Record<string, readonly Nombrado[]>> }
  agentesAqui: { nativos: ReadonlySet<string>; dockerPorPerfil: Readonly<Record<string, readonly string[]>> }
  ajustes: boolean
}

/** Lo que se manda a importar. Las conexiones van por id; los agentes Docker, por perfil. */
export interface SeleccionImportar {
  perfiles: string[]
  ssh: string[]
  bd: string[]
  nativos: string[]
  agentesPorPerfil: Record<string, string[]>
  ajustes: boolean
}

/** Lo que el main necesita para dar de alta las conexiones elegidas. */
export type SeleccionConexiones = Pick<SeleccionImportar, 'perfiles' | 'ssh' | 'bd'>

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
  const perfiles = e.perfiles.map((p) => {
    const agentesAqui = new Set(e.agentesAqui.dockerPorPerfil[p.id] ?? [])
    const hijos = [
      ...e.conexiones.ssh.filter((c) => c.perfil === p.id).map((c) => conexion('ssh', c)),
      ...e.conexiones.bd.filter((c) => c.perfil === p.id).map((c) => conexion('bd', c)),
      ...(e.agentes?.dockerPorPerfil[p.id] ?? []).map((a) => elemento('agente', a.id, p.id, a.nombre, agentesAqui.has(a.id)))
    ]
    return { perfil: elemento('perfil', p.id, null, p.nombre, e.perfilesAqui.has(p.id)), hijos }
  })
  return {
    perfiles,
    nativos: (e.agentes?.nativos ?? []).map((a) => elemento('nativo', a.id, null, a.nombre, e.agentesAqui.nativos.has(a.id))),
    ajustes: e.ajustes ? elemento('ajustes', 'ajustes', null, '', false) : null
  }
}

function elementos(a: ArbolImportar): ElementoImportar[] {
  return [...a.perfiles.flatMap((g) => [g.perfil, ...g.hijos]), ...a.nativos, ...(a.ajustes ? [a.ajustes] : [])]
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

/** La selección que se manda a importar. Un perfil entra si se marcó él o algo suyo. */
export function seleccionParaImportar(a: ArbolImportar, sel: ReadonlySet<string>): SeleccionImportar {
  const fuera: SeleccionImportar = { perfiles: [], ssh: [], bd: [], nativos: [], agentesPorPerfil: {}, ajustes: a.ajustes !== null && sel.has(a.ajustes.clave) }
  for (const g of a.perfiles) {
    const hijos = g.hijos.filter((h) => sel.has(h.clave))
    if (sel.has(g.perfil.clave) || hijos.length > 0) fuera.perfiles.push(g.perfil.id)
    for (const h of hijos) {
      if (h.tipo === 'ssh' || h.tipo === 'bd') fuera[h.tipo].push(h.id)
      else (fuera.agentesPorPerfil[g.perfil.id] ??= []).push(h.id)
    }
  }
  fuera.nativos = a.nativos.filter((n) => sel.has(n.clave)).map((n) => n.id)
  return fuera
}

export function haySeleccion(s: SeleccionImportar): boolean {
  return s.perfiles.length > 0 || s.nativos.length > 0 || s.ajustes
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
  return { perfiles: lista(o.perfiles), ssh: lista(o.ssh), bd: lista(o.bd) }
}
