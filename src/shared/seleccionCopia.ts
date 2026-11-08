// =============================================================================
// Qué se importa de una copia de la configuración: el árbol de la vista previa (cada perfil, con su
// destino, y sus reglas, conexiones SSH, de bases de datos, agentes, historial por cuenta y configuración de
// Docker y los archivos de sus cuentas debajo; los agentes nativos con sus reglas, el historial nativo, la configuración
// global de Docker y los ajustes aparte), las casillas que se marcan y desmarcan con
// sus dependencias (el bastión de una SSH, el túnel de una base) y la selección que se manda a importar. Puro.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import type { EstadoConfigDocker, FuenteHistorial, PreviaArchivosAgentes, PreviaConfigDocker } from './copia-configuracion-ipc.ts'
import type { EstadoReglas } from './destinoCopia.ts'
import { claveDe, elemento, elementosDeCuentas, elementosReglasNativas, leerEleccionArchivos, type EleccionArchivosIpc, type ElementoImportar } from './elementosCopia.ts'

export type { ElementoImportar } from './elementosCopia.ts'

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
  /** La configuración global de Docker: de todo el equipo, no de un perfil. */
  configGlobal: ElementoImportar | null
  ajustes: ElementoImportar | null
  /** Las reglas de los agentes nativos, en el grupo de los nativos. */
  reglasNativas: ElementoImportar[]
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
  configDocker?: PreviaConfigDocker
  archivosAgentes?: PreviaArchivosAgentes
}

/**
 * Lo que se manda a importar. Las conexiones van por id; los agentes Docker, por perfil; el historial, por
 * su número. `destinos`: el perfil de aquí de cada perfil elegido (null = perfil nuevo); `reglas`: los
 * perfiles elegidos cuyas reglas se ponen en su destino; `configDocker`: los perfiles elegidos cuya
 * configuración de Docker se pone en su destino; los archivos de agentes, por cuenta del archivo.
 */
export interface SeleccionImportar extends EleccionArchivosIpc {
  perfiles: string[]
  destinos: Record<string, string | null>
  reglas: string[]
  ssh: string[]
  bd: string[]
  nativos: string[]
  agentesPorPerfil: Record<string, string[]>
  ajustes: boolean
  historial: string[]
  configDocker: string[]
  configGlobal: boolean
}

/**
 * Lo que el main necesita para dar de alta las conexiones y el historial elegidos. `reasignar`: el id de
 * aquí que recibe lo de cada perfil del archivo (sin él, el suyo); `fusionados`: los que van a un perfil que
 * ya existía, del que no se revisa nada del archivo.
 */
export type SeleccionConexiones = Pick<SeleccionImportar, 'perfiles' | 'ssh' | 'bd' | 'historial' | 'configDocker' | 'configGlobal' | keyof EleccionArchivosIpc> & {
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
      ...(e.historial ?? []).filter((h) => h.perfil === p.id).map(historial),
      ...configDelPerfil(e.configDocker, p, destino),
      ...elementosDeCuentas(e.archivosAgentes, p.id, destino)
    ]
    return { perfil: elemento('perfil', p.id, null, p.nombre, destino !== null), hijos, destino, reglas }
  })
  const global = e.configDocker?.global ?? null
  return {
    perfiles,
    nativos: (e.agentes?.nativos ?? []).map((a) => elemento('nativo', a.id, null, a.nombre, e.agentesAqui.nativos.has(a.id))),
    historialNativo: (e.historial ?? []).filter((h) => h.perfil === null).map(historial),
    configGlobal: global === null ? null : { ...config(elemento('configGlobal', 'global', null, '', false), global), partesGlobal: e.configDocker?.partesGlobal },
    ajustes: e.ajustes ? elemento('ajustes', 'ajustes', null, '', false) : null,
    reglasNativas: elementosReglasNativas(e.archivosAgentes)
  }
}

/** Igual que la de aquí, ya está; distinta, se puede marcar para sustituirla, pero no de serie. */
function config(el: ElementoImportar, estado: EstadoConfigDocker): ElementoImportar {
  if (estado === 'igual') return { ...el, yaEsta: true }
  return estado === 'distinta' ? { ...el, sustituye: true } : el
}

/** La configuración de Docker del perfil del archivo frente a la de su destino; un perfil nuevo la trae. */
function configDelPerfil(previa: PreviaConfigDocker | undefined, p: Nombrado, destino: string | null): ElementoImportar[] {
  const frente = previa?.perfiles[p.id]
  if (!frente) return []
  return [config(elemento('configDocker', p.id, p.id, p.nombre, false), destino === null ? 'traer' : (frente[destino] ?? 'traer'))]
}

/** El historial nunca «ya está»: se fusiona conversación a conversación al importar. */
function historial(h: FuenteHistorial): ElementoImportar {
  return { ...elemento('historial', String(h.id), h.perfil, h.cuenta ?? '', false), historial: h }
}

function elementos(a: ArbolImportar): ElementoImportar[] {
  return [
    ...a.perfiles.flatMap((g) => [g.perfil, ...g.hijos]),
    ...a.nativos,
    ...a.reglasNativas,
    ...a.historialNativo,
    ...(a.configGlobal ? [a.configGlobal] : []),
    ...(a.ajustes ? [a.ajustes] : [])
  ]
}

/**
 * De serie, todo lo que no está aquí: así ninguna dependencia queda fuera. Lo que sustituiría algo distinto
 * de este equipo y lo que afecta a los agentes de todo el equipo se marca a mano o con «Todo» (`seleccionTodo`).
 */
export function seleccionInicial(a: ArbolImportar): Set<string> {
  return new Set(elementos(a).filter((e) => !e.yaEsta && !e.sustituye && !e.soloAMano).map((e) => e.clave))
}

/** Lo que marca «Todo»: todo lo marcable, también lo que sustituye algo de este equipo. */
export function seleccionTodo(a: ArbolImportar): Set<string> {
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

/**
 * Lo que marca la casilla de un perfil: todo lo suyo que no está aquí, salvo lo que sustituiría algo de este
 * equipo, que solo se marca en su propia casilla o con «Todo».
 */
function marcablesDelGrupo(g: GrupoImportar): ElementoImportar[] {
  return [g.perfil, ...g.hijos].filter((e) => !e.yaEsta && !e.sustituye)
}

export function estadoPerfil(a: ArbolImportar, sel: ReadonlySet<string>, perfil: string): EstadoGrupo {
  const g = a.perfiles.find((x) => x.perfil.id === perfil)
  const marcables = g ? marcablesDelGrupo(g) : []
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
    const marcado = estadoPerfil(a, sel, grupo.perfil.id) === 'marcado'
    // Desmarcar el perfil quita todo lo suyo, también lo que sustituye; marcarlo no lo pone.
    const claves = (marcado ? [grupo.perfil, ...grupo.hijos].filter((e) => !e.yaEsta) : marcablesDelGrupo(grupo)).map((e) => e.clave)
    return { seleccion: nueva, avisos: marcado ? quitar(a, nueva, claves) : poner(a, nueva, claves) }
  }
  // Una cuenta nueva arrastra sus archivos: marcarla los ofrece ya marcados, sin avisar de cada uno.
  const juntas = [clave, ...elementos(a).filter((e) => e.tipo === 'archivoCuenta' && e.requiere.includes(clave)).map((e) => e.clave)]
  return { seleccion: nueva, avisos: sel.has(clave) ? quitar(a, nueva, juntas) : poner(a, nueva, juntas) }
}

/**
 * Al cambiar el destino de un perfil, la selección con el árbol nuevo: lo de los demás perfiles sigue
 * igual; lo del que cambió se marca entero (`marcar`, como de serie) o conserva lo que siga siendo
 * marcable, con su perfil si queda algo suyo. Lo suyo que ahora sustituiría algo del destino nuevo se
 * desmarca: se eligió frente a otro destino.
 */
export function seleccionTrasCambiarDestino(a: ArbolImportar, sel: ReadonlySet<string>, perfil: string, marcar: boolean): Set<string> {
  const marcables = new Set(elementos(a).filter((e) => !e.yaEsta).map((e) => e.clave))
  const nueva = new Set([...sel].filter((c) => marcables.has(c)))
  const g = a.perfiles.find((x) => x.perfil.id === perfil)
  if (!g) return nueva
  for (const h of g.hijos) if (h.sustituye) nueva.delete(h.clave)
  const delGrupo = marcablesDelGrupo(g).map((e) => e.clave)
  if (marcar) poner(a, nueva, delGrupo)
  // Lo que en el destino nuevo pide una cuenta sin marcar queda oculto: no debe seguir elegido.
  for (const h of g.hijos) if (h.tipo === 'archivoCuenta' && h.requiere.some((r) => !nueva.has(r))) nueva.delete(h.clave)
  if (!marcar && !g.perfil.yaEsta && g.hijos.some((h) => nueva.has(h.clave))) nueva.add(g.perfil.clave)
  return nueva
}

/**
 * La selección que se manda a importar. Un perfil entra si se marcó él o algo suyo, o si se eligió
 * sustituir sus reglas (`sustituir`, solo vale con reglas distintas a las de su destino) o un archivo de
 * una de sus cuentas (`sustituirArchivos`, por clave del elemento, solo los distintos).
 */
export function seleccionParaImportar(
  a: ArbolImportar,
  sel: ReadonlySet<string>,
  sustituir: ReadonlySet<string> = new Set(),
  sustituirArchivos: ReadonlySet<string> = new Set()
): SeleccionImportar {
  const sustituye = (e: ElementoImportar): boolean => e.archivo?.estado === 'distinto' && sustituirArchivos.has(e.clave)
  const fuera: SeleccionImportar = {
    perfiles: [],
    destinos: {},
    reglas: [],
    ssh: [],
    bd: [],
    nativos: [],
    agentesPorPerfil: {},
    ajustes: a.ajustes !== null && sel.has(a.ajustes.clave),
    historial: [],
    configDocker: [],
    configGlobal: a.configGlobal !== null && sel.has(a.configGlobal.clave),
    archivosCuentas: [],
    cuentasNuevas: [],
    reglasNativas: []
  }
  for (const g of a.perfiles) {
    const hijos = g.hijos.filter((h) => sel.has(h.clave))
    const reglas = g.reglas === 'distintas' && sustituir.has(g.perfil.id)
    const archivos = g.hijos.filter(sustituye)
    if (!sel.has(g.perfil.clave) && hijos.length === 0 && !reglas && archivos.length === 0) continue
    fuera.perfiles.push(g.perfil.id)
    fuera.destinos[g.perfil.id] = g.destino
    if (reglas) fuera.reglas.push(g.perfil.id)
    for (const h of hijos) anotarHijo(fuera, g.perfil.id, h)
    for (const h of archivos) fuera.archivosCuentas.push({ perfil: g.perfil.id, cuenta: h.archivo!.cuenta!, tipo: h.archivo!.tipo, sustituir: true })
  }
  fuera.nativos = a.nativos.filter((n) => sel.has(n.clave)).map((n) => n.id)
  fuera.reglasNativas = a.reglasNativas.filter((n) => sel.has(n.clave) || sustituye(n)).map((n) => ({ agente: n.archivo!.agente, sustituir: sustituye(n) }))
  fuera.historial.push(...a.historialNativo.filter((n) => sel.has(n.clave)).map((n) => n.id))
  return fuera
}

/** Apunta en la selección un elemento marcado de un perfil del archivo, en su lista. */
function anotarHijo(fuera: SeleccionImportar, perfil: string, h: ElementoImportar): void {
  if (h.tipo === 'ssh' || h.tipo === 'bd' || h.tipo === 'historial') fuera[h.tipo].push(h.id)
  else if (h.tipo === 'reglas') fuera.reglas.push(perfil)
  else if (h.tipo === 'configDocker') fuera.configDocker.push(perfil)
  else if (h.tipo === 'cuentaAgente') fuera.cuentasNuevas.push({ perfil, cuenta: h.id })
  else if (h.tipo === 'archivoCuenta') fuera.archivosCuentas.push({ perfil, cuenta: h.archivo!.cuenta!, tipo: h.archivo!.tipo, sustituir: false })
  else (fuera.agentesPorPerfil[perfil] ??= []).push(h.id)
}

export function haySeleccion(s: SeleccionImportar): boolean {
  return s.perfiles.length > 0 || s.nativos.length > 0 || s.ajustes || s.historial.length > 0 || s.configGlobal || s.reglasNativas.length > 0
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
  return {
    perfiles: lista(o.perfiles),
    ssh: lista(o.ssh),
    bd: lista(o.bd),
    historial: lista(o.historial),
    configDocker: lista(o.configDocker),
    configGlobal: o.configGlobal === true,
    ...leerEleccionArchivos(o),
    reasignar,
    fusionados: lista(o.fusionados)
  }
}
