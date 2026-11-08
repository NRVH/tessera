// =============================================================================
// Los archivos de los agentes en la copia de la configuración: de cada cuenta de Docker, los dos que escribe el
// usuario (instrucciones y configuración técnica) y, de los agentes nativos, solo las instrucciones. Se leen y se
// escriben por `ServicioConfigAgente`: nada a través de un enlace en una carpeta de cuenta, con tope de tamaño y
// sintaxis comprobada, y lo sustituido queda como versión anterior. Sin electron.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { homedir } from 'node:os'
import { join } from 'node:path'
import { MAX_NOMBRE_CUENTA } from '../../../shared/agent-accounts-ipc.ts'
import {
  ARCHIVOS_CONFIG_AGENTE,
  MAX_BYTES_CONFIG_AGENTE,
  TIPOS_ARCHIVO_CONFIG,
  type AgenteConConfig,
  type BloqueoArchivoConfig,
  type TipoArchivoConfig
} from '../../../shared/configAgente-ipc.ts'
import type { ArchivoPedido, CuentaAgentePrevia, EstadoArchivoAgente, PreviaArchivosAgentes } from '../../../shared/copia-configuracion-ipc.ts'
import { emparejarCuenta } from '../../../shared/destinoCopia.ts'
import type { SeleccionConexiones } from '../../../shared/seleccionCopia.ts'
import { FIN, INICIO, reemplazarBloque } from '../../db/agentMemoryBlock.ts'
import { idSeguroEnRutas } from '../../profiles/validate.ts'
import { FIN_SANDBOX, INICIO_SANDBOX } from '../sandboxMemoryBlock.ts'
import { leerDeDisco, ServicioConfigAgente } from './ServicioConfigAgente.ts'
import { errorSintaxisConfig } from './validarConfigAgente.ts'

const AGENTES: readonly AgenteConConfig[] = ['claude-code', 'codex']

/** Una cuenta de Docker tal como viaja: solo los archivos que tienen contenido. */
export interface CuentaCopia {
  id: string
  perfil: string
  agente: AgenteConConfig
  nombre: string
  predeterminada: boolean
  archivos: Partial<Record<TipoArchivoConfig, string>>
}

/** Un archivo con lo necesario para nombrarlo ante el usuario, sin rutas de ningún equipo. */
export interface ArchivoNombrado {
  agente: AgenteConConfig
  nombre: string
  cuenta: { nombre: string; predeterminada: boolean; perfil: string } | null
}

export interface ArchivosAgentesCopia {
  cuentas: CuentaCopia[]
  nativos: Partial<Record<AgenteConConfig, string>>
  /** Solo al leer un archivo: lo que no se puede escribir, para decirlo. */
  invalidos?: ArchivoNombrado[]
}

/** Una cuenta de este equipo con su carpeta, sin crearla. */
export interface CuentaAqui {
  id: string
  agente: AgenteConConfig
  nombre: string
  predeterminada: boolean
  base: string
}

/** Lo que necesita del resto del main; la carpeta nativa sale de lo que ya la resuelve en cada equipo. */
export interface EntornoArchivosAgentes {
  cuentasDe: (perfil: string) => CuentaAqui[]
  /** La carpeta de la cuenta del perfil con ese agente y nombre; la crea (sin sesión) si no existe. Lanza si no puede. */
  carpetaDestino: (perfil: string, agente: AgenteConConfig, nombre: string, predeterminada: boolean) => string
  baseNativa: (agente: AgenteConConfig) => string
}

const objeto = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const esAgente = (v: unknown): v is AgenteConConfig => v === 'claude-code' || v === 'codex'
const claveNombre = (n: string): string => n.trim().toLocaleLowerCase()
const nombreDe = (agente: AgenteConConfig, tipo: TipoArchivoConfig): string => ARCHIVOS_CONFIG_AGENTE[agente][tipo]

/** La ruta que se enseña antes de sustituir un archivo: la real, porque el agente puede tener otra carpeta configurada. */
function rutaVisible(ruta: string): string {
  const casa = homedir()
  return ruta.startsWith(casa) ? `~${ruta.slice(casa.length).replace(/\\/g, '/')}` : ruta
}

/** Lo que Tessera escribe en las instrucciones de una cuenta es de cada equipo y se rehace solo: no es del usuario. */
function sinBloquesDeTessera(texto: string): string {
  return reemplazarBloque(reemplazarBloque(texto, '', INICIO_SANDBOX, FIN_SANDBOX), '', INICIO, FIN)
}

/** Sin BOM: un `settings.json` guardado así en un equipo no pasaría la validación del otro. */
function limpio(tipo: TipoArchivoConfig, texto: string): string {
  const sinBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
  return tipo === 'instrucciones' ? sinBloquesDeTessera(sinBom) : sinBom
}

/** El BOM y los finales de línea no son una diferencia: un mismo archivo los cambia al pasar de un sistema a otro. */
const paraComparar = (texto: string): string => (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto).replace(/\r\n/g, '\n').trimEnd()

/** Vacío o, en JSON, un objeto vacío: no hay nada que llevar ni que sustituir. */
function sinContenido(agente: AgenteConConfig, tipo: TipoArchivoConfig, texto: string): boolean {
  const t = texto.trim()
  return t === '' || (tipo === 'configuracion' && agente === 'claude-code' && t === '{}')
}

/** Tamaño y sintaxis, como al guardar desde el editor: lo que no pasa no se escribe. */
function valido(agente: AgenteConConfig, tipo: TipoArchivoConfig, texto: unknown): texto is string {
  return typeof texto === 'string' && Buffer.byteLength(texto, 'utf8') <= MAX_BYTES_CONFIG_AGENTE && errorSintaxisConfig(agente, tipo, texto) === null
}

interface Lectura {
  contenido: string
  version: string | null
  existe: boolean
  bloqueo: BloqueoArchivoConfig | 'error' | null
}

/** Un archivo de una cuenta: la carpeta se puede escribir desde el contenedor y nada se sigue a través de un enlace. */
async function leerDeCuenta(base: string, agente: AgenteConConfig, tipo: TipoArchivoConfig): Promise<Lectura> {
  try {
    const l = await leerDeDisco(join(base, nombreDe(agente, tipo)))
    return { contenido: l.contenido, version: l.version, existe: l.version !== null, bloqueo: l.bloqueo }
  } catch {
    return { contenido: '', version: null, existe: false, bloqueo: 'error' }
  }
}

/** Las instrucciones nativas: en esa carpeta un enlace es del usuario y `ServicioConfigAgente` lo respeta. */
async function leerNativas(e: EntornoArchivosAgentes, agente: AgenteConConfig): Promise<Lectura> {
  try {
    const servicio = new ServicioConfigAgente({ carpetaDe: () => e.baseNativa(agente), sesionesAbiertas: () => 0 })
    const l = (await servicio.leer({ agente, accountId: null }))?.archivos.instrucciones
    return l ? { contenido: l.contenido, version: l.version, existe: l.version !== null, bloqueo: l.bloqueo } : { contenido: '', version: null, existe: false, bloqueo: null }
  } catch {
    return { contenido: '', version: null, existe: false, bloqueo: 'error' }
  }
}

function estadoFrente(agente: AgenteConConfig, tipo: TipoArchivoConfig, archivo: string, aqui: Lectura): EstadoArchivoAgente {
  if (aqui.bloqueo) return 'bloqueado'
  const local = limpio(tipo, aqui.contenido)
  if (!aqui.existe || sinContenido(agente, tipo, local)) return 'traer'
  return paraComparar(local) === paraComparar(limpio(tipo, archivo)) ? 'igual' : 'distinto'
}

/** Los archivos de una cuenta con contenido; los que no se leen con seguridad se apuntan. */
async function archivosDeCarpeta(c: CuentaAqui, perfil: string, bloqueados: ArchivoNombrado[]): Promise<CuentaCopia['archivos']> {
  const archivos: CuentaCopia['archivos'] = {}
  for (const tipo of TIPOS_ARCHIVO_CONFIG) {
    const l = await leerDeCuenta(c.base, c.agente, tipo)
    if (l.bloqueo) bloqueados.push({ agente: c.agente, nombre: nombreDe(c.agente, tipo), cuenta: { nombre: c.nombre, predeterminada: c.predeterminada, perfil } })
    else if (l.existe && !sinContenido(c.agente, tipo, limpio(tipo, l.contenido))) archivos[tipo] = limpio(tipo, l.contenido)
  }
  return archivos
}

/** Lo que se lleva y lo que no se pudo leer. Solo lo que tiene contenido. */
export async function archivosParaCopia(
  e: EntornoArchivosAgentes,
  perfiles: readonly string[],
  pide: { cuentas: boolean; nativos: boolean }
): Promise<{ archivos: ArchivosAgentesCopia | undefined; bloqueados: ArchivoNombrado[] }> {
  const fuera: ArchivosAgentesCopia = { cuentas: [], nativos: {} }
  const bloqueados: ArchivoNombrado[] = []
  for (const perfil of pide.cuentas ? perfiles : []) {
    for (const c of e.cuentasDe(perfil)) {
      const archivos = await archivosDeCarpeta(c, perfil, bloqueados)
      if (Object.keys(archivos).length > 0) fuera.cuentas.push({ id: c.id, perfil, agente: c.agente, nombre: c.nombre, predeterminada: c.predeterminada, archivos })
    }
  }
  for (const agente of pide.nativos ? AGENTES : []) {
    const l = await leerNativas(e, agente)
    if (l.bloqueo) bloqueados.push({ agente, nombre: nombreDe(agente, 'instrucciones'), cuenta: null })
    else if (l.existe && !sinContenido(agente, 'instrucciones', l.contenido)) fuera.nativos[agente] = l.contenido
  }
  return { archivos: fuera.cuentas.length > 0 || Object.keys(fuera.nativos).length > 0 ? fuera : undefined, bloqueados }
}

function cuentaValida(c: Record<string, unknown>, perfiles: ReadonlySet<string>): c is Record<string, unknown> & Omit<CuentaCopia, 'archivos'> {
  return (
    typeof c.id === 'string' && c.id !== '' && idSeguroEnRutas(c.id) &&
    typeof c.perfil === 'string' && perfiles.has(c.perfil) &&
    esAgente(c.agente) &&
    typeof c.nombre === 'string' && c.nombre.trim() !== '' && c.nombre.trim().length <= MAX_NOMBRE_CUENTA &&
    typeof c.predeterminada === 'boolean'
  )
}

/** Sus archivos con forma válida; lo inválido se apunta para decirlo. */
function archivosDeCuenta(c: Omit<CuentaCopia, 'archivos'>, raw: Record<string, unknown>, invalidos: ArchivoNombrado[]): CuentaCopia['archivos'] {
  const archivos: CuentaCopia['archivos'] = {}
  for (const tipo of TIPOS_ARCHIVO_CONFIG) {
    const texto = raw[tipo]
    if (texto === undefined) continue
    const nombre = nombreDe(c.agente, tipo)
    if (valido(c.agente, tipo, texto)) archivos[tipo] = limpio(tipo, texto)
    else invalidos.push({ agente: c.agente, nombre, cuenta: { nombre: c.nombre, predeterminada: c.predeterminada, perfil: c.perfil } })
  }
  return archivos
}

/** Lo que trae el archivo, leído con cuidado; un archivo sin este apartado da undefined y no rompe nada. */
export function leerArchivosAgentesCopia(raw: unknown, perfiles: ReadonlySet<string>): ArchivosAgentesCopia | undefined {
  const o = objeto(raw)
  if (Object.keys(o).length === 0) return undefined
  const fuera: ArchivosAgentesCopia = { cuentas: [], nativos: {}, invalidos: [] }
  const vistas = new Set<string>()
  for (const x of Array.isArray(o.cuentas) ? o.cuentas : []) {
    const c = objeto(x)
    if (!cuentaValida(c, perfiles)) continue
    const nombre = c.nombre.trim()
    const claves = [`id:${c.perfil}/${c.id}`, `cuenta:${c.perfil}/${c.agente}/${c.predeterminada ? '' : claveNombre(nombre)}`]
    if (claves.some((k) => vistas.has(k))) continue
    claves.forEach((k) => vistas.add(k))
    const datos = { id: c.id, perfil: c.perfil, agente: c.agente, nombre, predeterminada: c.predeterminada }
    const archivos = archivosDeCuenta(datos, objeto(c.archivos), fuera.invalidos!)
    if (Object.keys(archivos).length > 0) fuera.cuentas.push({ ...datos, archivos })
  }
  const nativos = objeto(o.nativos)
  for (const agente of AGENTES) {
    const texto = nativos[agente]
    if (texto === undefined) continue
    if (valido(agente, 'instrucciones', texto) && !sinContenido(agente, 'instrucciones', texto)) fuera.nativos[agente] = texto
    else fuera.invalidos!.push({ agente, nombre: nombreDe(agente, 'instrucciones'), cuenta: null })
  }
  return fuera
}

/** Una cuenta del archivo frente a la suya en cada perfil de aquí que tenga una. */
async function frenteDe(c: CuentaCopia, aquiPorPerfil: ReadonlyMap<string, CuentaAqui[]>): Promise<CuentaAgentePrevia['frente']> {
  const frente: CuentaAgentePrevia['frente'] = {}
  for (const [perfil, aqui] of aquiPorPerfil) {
    const suya = emparejarCuenta(c, aqui)
    if (!suya) continue
    const archivos: CuentaAgentePrevia['frente'][string]['archivos'] = {}
    for (const tipo of TIPOS_ARCHIVO_CONFIG) {
      const texto = c.archivos[tipo]
      if (texto !== undefined) archivos[tipo] = estadoFrente(c.agente, tipo, texto, await leerDeCuenta(suya.base, c.agente, tipo))
    }
    frente[perfil] = { cuenta: suya.nombre, archivos }
  }
  return frente
}

/** Para la vista previa: cómo queda cada archivo frente a este equipo, sin su contenido. */
export async function previaArchivosAgentes(
  e: EntornoArchivosAgentes,
  copia: ArchivosAgentesCopia | undefined,
  perfilesAqui: readonly string[]
): Promise<Omit<PreviaArchivosAgentes, 'invalidos'>> {
  if (!copia) return { cuentas: [], nativos: [] }
  const aquiPorPerfil = new Map(perfilesAqui.map((p) => [p, e.cuentasDe(p)] as const))
  const cuentas: CuentaAgentePrevia[] = []
  for (const c of copia.cuentas) {
    cuentas.push({
      id: c.id, perfil: c.perfil, agente: c.agente, nombre: c.nombre, predeterminada: c.predeterminada,
      archivos: TIPOS_ARCHIVO_CONFIG.filter((t) => c.archivos[t] !== undefined),
      frente: await frenteDe(c, aquiPorPerfil)
    })
  }
  const nativos: PreviaArchivosAgentes['nativos'] = []
  for (const agente of AGENTES) {
    const texto = copia.nativos[agente]
    if (texto !== undefined) {
      nativos.push({ agente, ruta: rutaVisible(join(e.baseNativa(agente), nombreDe(agente, 'instrucciones'))), estado: estadoFrente(agente, 'instrucciones', texto, await leerNativas(e, agente)) })
    }
  }
  return { cuentas, nativos }
}

/** Las dos versiones de un archivo, solo si de verdad es distinto: lo demás no tiene por qué cruzar al renderer. */
export async function diferenciaArchivo(
  e: EntornoArchivosAgentes,
  copia: ArchivosAgentesCopia | undefined,
  pedido: ArchivoPedido,
  perfilesAqui: readonly string[]
): Promise<{ aqui: string; archivo: string } | null> {
  if (!copia || typeof pedido !== 'object' || pedido === null) return null
  if (pedido.origen === 'nativo') return esAgente(pedido.agente) ? diferenciaNativa(e, copia, pedido.agente) : null
  if (pedido.origen !== 'cuenta' || !perfilesAqui.includes(pedido.perfilAqui) || !TIPOS_ARCHIVO_CONFIG.includes(pedido.tipo)) return null
  const c = copia.cuentas.find((x) => x.perfil === pedido.perfil && x.id === pedido.cuenta)
  const texto = c?.archivos[pedido.tipo]
  const suya = c ? emparejarCuenta(c, e.cuentasDe(pedido.perfilAqui)) : null
  if (!c || texto === undefined || !suya) return null
  const aqui = await leerDeCuenta(suya.base, c.agente, pedido.tipo)
  if (estadoFrente(c.agente, pedido.tipo, texto, aqui) !== 'distinto') return null
  return { aqui: limpio(pedido.tipo, aqui.contenido), archivo: texto }
}

async function diferenciaNativa(e: EntornoArchivosAgentes, copia: ArchivosAgentesCopia, agente: AgenteConConfig): Promise<{ aqui: string; archivo: string } | null> {
  const texto = copia.nativos[agente]
  if (texto === undefined) return null
  const aqui = await leerNativas(e, agente)
  return estadoFrente(agente, 'instrucciones', texto, aqui) === 'distinto' ? { aqui: aqui.contenido, archivo: texto } : null
}

/** Lo elegido, ya en su perfil de destino. */
export interface ArchivosElegidos {
  cuentas: Array<CuentaCopia & { crear: boolean; sustituir: TipoArchivoConfig[] }>
  nativos: Array<{ agente: AgenteConConfig; contenido: string; sustituir: boolean }>
}

type EleccionArchivos = Pick<SeleccionConexiones, 'perfiles' | 'archivosCuentas' | 'cuentasNuevas' | 'reglasNativas' | 'reasignar'>

/**
 * El contenido reducido a lo elegido y con cada cuenta en su perfil de destino. Lo de un perfil que no se importa
 * se queda fuera, aunque venga en la selección.
 */
export function elegirArchivos(copia: ArchivosAgentesCopia | undefined, sel: EleccionArchivos): ArchivosElegidos {
  const fuera: ArchivosElegidos = { cuentas: [], nativos: [] }
  if (!copia) return fuera
  const perfiles = new Set(sel.perfiles)
  for (const c of copia.cuentas) {
    if (!perfiles.has(c.perfil)) continue
    const elegidos = sel.archivosCuentas.filter((a) => a.perfil === c.perfil && a.cuenta === c.id && c.archivos[a.tipo] !== undefined)
    const crear = sel.cuentasNuevas.some((n) => n.perfil === c.perfil && n.cuenta === c.id)
    if (elegidos.length === 0 && !crear) continue
    const archivos = Object.fromEntries(elegidos.map((a) => [a.tipo, c.archivos[a.tipo]])) as CuentaCopia['archivos']
    const perfil = Object.prototype.hasOwnProperty.call(sel.reasignar, c.perfil) ? sel.reasignar[c.perfil] : c.perfil
    fuera.cuentas.push({ ...c, perfil, archivos, crear, sustituir: elegidos.filter((a) => a.sustituir).map((a) => a.tipo) })
  }
  for (const n of sel.reglasNativas) {
    const contenido = copia.nativos[n.agente]
    if (contenido !== undefined) fuera.nativos.push({ agente: n.agente, contenido, sustituir: n.sustituir })
  }
  return fuera
}

export type MotivoArchivo = 'bloqueado' | 'invalido' | 'cambio' | 'sin-cuenta' | 'error'

export interface ResultadoArchivos {
  creados: ArchivoNombrado[]
  sustituidos: ArchivoNombrado[]
  revisar: Array<{ archivo: ArchivoNombrado; motivo: MotivoArchivo }>
}

interface Escritura {
  carpeta: string
  accountId: string | null
  agente: AgenteConConfig
  tipo: TipoArchivoConfig
  contenido: string
  sustituir: boolean
  actual: Lectura
}

/**
 * Escribe un archivo si este equipo sigue como se revisó: lo que apareció o cambió desde la lista no se pisa sin
 * que se haya elegido sustituirlo. La versión anterior la guarda el servicio.
 */
async function escribir(x: Escritura): Promise<'creado' | 'sustituido' | 'igual' | MotivoArchivo> {
  if (!valido(x.agente, x.tipo, x.contenido)) return 'invalido'
  const estado = estadoFrente(x.agente, x.tipo, x.contenido, x.actual)
  if (estado === 'igual') return 'igual'
  if (estado === 'bloqueado') return 'bloqueado'
  if (estado === 'distinto' && !x.sustituir) return 'cambio'
  const servicio = new ServicioConfigAgente({ carpetaDe: () => x.carpeta, sesionesAbiertas: () => 0 })
  const r = await servicio.guardar({ ref: { agente: x.agente, accountId: x.accountId }, tipo: x.tipo, contenido: x.contenido, versionLeida: x.actual.version, sobrescribir: false }).catch(() => null)
  if (r === null) return 'error'
  if (r.estado === 'guardado') return estado === 'traer' ? 'creado' : 'sustituido'
  if (r.estado === 'sintaxis' || r.estado === 'raiz-json') return 'invalido'
  if (r.estado === 'cambio-externo') return 'cambio'
  return r.estado === 'cuenta-no-disponible' ? 'error' : 'bloqueado'
}

function apuntar(r: ResultadoArchivos, resultado: Awaited<ReturnType<typeof escribir>>, archivo: ArchivoNombrado): void {
  if (resultado === 'creado') r.creados.push(archivo)
  else if (resultado === 'sustituido') r.sustituidos.push(archivo)
  else if (resultado !== 'igual') r.revisar.push({ archivo, motivo: resultado })
}

const tiposDe = (c: ArchivosElegidos['cuentas'][number]): TipoArchivoConfig[] => TIPOS_ARCHIVO_CONFIG.filter((t) => c.archivos[t] !== undefined)

function nombradoDe(c: ArchivosElegidos['cuentas'][number], tipo: TipoArchivoConfig): ArchivoNombrado {
  return { agente: c.agente, nombre: nombreDe(c.agente, tipo), cuenta: { nombre: c.nombre, predeterminada: c.predeterminada, perfil: c.perfil } }
}

async function importarCuenta(e: EntornoArchivosAgentes, c: ArchivosElegidos['cuentas'][number], r: ResultadoArchivos, hechos: Set<string>): Promise<void> {
  const nombrado = (tipo: TipoArchivoConfig): ArchivoNombrado => nombradoDe(c, tipo)
  const tipos = tiposDe(c)
  const suya = emparejarCuenta(c, e.cuentasDe(c.perfil))
  // Sin cuenta aquí ni permiso para crearla, sus archivos no tienen a dónde ir.
  if (!suya && !c.crear) {
    for (const tipo of tipos) r.revisar.push({ archivo: nombrado(tipo), motivo: 'sin-cuenta' })
    return
  }
  let carpeta: string
  try {
    carpeta = e.carpetaDestino(c.perfil, c.agente, suya?.nombre ?? c.nombre, suya?.predeterminada ?? c.predeterminada)
  } catch {
    for (const tipo of tipos) r.revisar.push({ archivo: nombrado(tipo), motivo: 'sin-cuenta' })
    return
  }
  for (const tipo of tipos) {
    // Dos perfiles del archivo a la misma cuenta: manda el primero de la lista, igual que con las reglas.
    const clave = `${carpeta}/${tipo}`
    if (hechos.has(clave)) continue
    hechos.add(clave)
    const actual = await leerDeCuenta(carpeta, c.agente, tipo)
    const resultado = await escribir({ carpeta, accountId: suya?.id ?? c.id, agente: c.agente, tipo, contenido: c.archivos[tipo]!, sustituir: c.sustituir.includes(tipo), actual })
    apuntar(r, resultado, nombrado(tipo))
  }
}

/**
 * Escribe lo elegido. Solo en cuentas de un perfil de aquí; nunca lanza, porque llega después de haber importado
 * las conexiones y el historial.
 */
export async function importarArchivosAgentes(e: EntornoArchivosAgentes, elegidos: ArchivosElegidos, perfilesAqui: readonly string[]): Promise<ResultadoArchivos> {
  const r: ResultadoArchivos = { creados: [], sustituidos: [], revisar: [] }
  const hechos = new Set<string>()
  for (const c of elegidos.cuentas) {
    if (!perfilesAqui.includes(c.perfil) || !idSeguroEnRutas(c.perfil)) continue
    await importarCuenta(e, c, r, hechos).catch(() => {
      for (const tipo of tiposDe(c)) r.revisar.push({ archivo: nombradoDe(c, tipo), motivo: 'error' })
    })
  }
  for (const n of elegidos.nativos) {
    const carpeta = e.baseNativa(n.agente)
    const resultado = await escribir({ carpeta, accountId: null, agente: n.agente, tipo: 'instrucciones', contenido: n.contenido, sustituir: n.sustituir, actual: await leerNativas(e, n.agente) })
    apuntar(r, resultado, { agente: n.agente, nombre: nombreDe(n.agente, 'instrucciones'), cuenta: null })
  }
  return r
}
