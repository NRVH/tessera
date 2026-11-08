// =============================================================================
// Los hooks de git que pudo escribir el contenedor no corren en el host sin permiso: todo git del main los apaga
// (`configSegura.ts` apunta `core.hooksPath` a una carpeta vacía), salvo una escritura pedida desde la interfaz cuyos
// hooks ya aceptó el usuario. Si hay alguno nuevo o cambiado (por su sha256), la escritura no corre: devuelve el
// pendiente con una ficha de un solo uso y el usuario decide (aceptar y recordar, o seguir sin ellos).
// Decisiones: docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { execFile as ejecutar } from 'node:child_process'
import { constants as constantes } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, opendir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { writeFileAtomic } from '../../util/atomicWrite'
import { KeyedMutex } from '../../util/mutex'
import { esWindows } from '../../../shared/plataforma'
import type { HooksPendientes, ResolucionHooks } from '../../../shared/git-ipc'
import { entornoCon, parsearListaConfig, type EntradaConfig } from './configSegura'
import { txHooks } from './textos'
import { carpetaDatosHooks } from './carpetasHooks'
import { colaGit } from './colaGit'
export { configurarHooksGit, carpetaSinHooks } from './carpetasHooks'

const ejecutarArchivo = promisify(ejecutar)
interface Peticion {
  propietario: number; resolucion?: ResolucionHooks; omitir?: boolean; operacion?: string[]; pendiente?: HooksPendientes
  nombres?: readonly string[]; entornos: Map<string, Promise<NodeJS.ProcessEnv>>; copias: string[]
}
const peticion = new AsyncLocalStorage<Peticion>()
export function conPeticionHooks<T>(propietario: number, resolucion: ResolucionHooks | undefined, operar: () => T): T {
  const solicitud: Peticion = { propietario, resolucion, entornos: new Map(), copias: [] }
  return peticion.run(solicitud, () => {
    const resultado = operar()
    if (resultado instanceof Promise) return resultado.finally(async () => {
      await Promise.all(solicitud.copias.map((carpeta) => rm(carpeta, { recursive: true, force: true })))
    }) as T
    return resultado
  })
}

export async function prepararHooksOperacion(operacion: string[], repos: string[], entorno: (raiz: string) => Promise<NodeJS.ProcessEnv>, seleccion?: readonly string[]): Promise<void> {
  const solicitud = peticion.getStore()
  if (!solicitud) return
  solicitud.operacion = operacion
  solicitud.nombres = seleccion
  const ficha = solicitud.resolucion && fichas.leer(solicitud.resolucion.ficha)
  const primero = ficha ? JSON.parse(ficha.operacion)[0] as string : undefined
  const ordenados = [...repos].sort((a, b) => Number(b === primero) - Number(a === primero))
  for (const raiz of ordenados) await autorizarHooks(operacion, raiz, await colaGit.correr(() => entorno(raiz)))
}

export function pendienteDePeticion(): HooksPendientes | undefined { return peticion.getStore()?.pendiente }
export class PendienteHooks extends Error {
  readonly pendiente: HooksPendientes
  constructor(pendiente: HooksPendientes) { super('hooks-pendientes'); this.pendiente = pendiente }
}
interface Hook { nombre: string; ruta: string; huella: string; contenido: string; truncado: boolean }
interface Archivo { relativa: string; contenido: Buffer; modo: number }
interface Inspeccion { clave: string; carpeta: string; usuario: boolean; hooks: Hook[]; archivos: Archivo[]; subcarpeta: string; incompleta?: boolean }
interface Ficha { vence: number; propietario: number; operacion: string; firma: string }
export class FichasHooks {
  private readonly fichas = new Map<string, Ficha>()
  get tamano(): number { return this.fichas.size }
  leer(id: string): Ficha | undefined { return this.fichas.get(id) }
  borrar(id: string): void { this.fichas.delete(id) }
  guardar(id: string, ficha: Ficha): void {
    for (const [clave, previa] of this.fichas) if (previa.vence <= Date.now()) this.fichas.delete(clave)
    while (this.fichas.size >= 512) this.fichas.delete(this.fichas.keys().next().value!)
    this.fichas.set(id, ficha)
  }
}
const fichas = new FichasHooks()
const candadoPermisos = new KeyedMutex()
const nombres = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate', 'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist', 'p4-post-changelist', 'p4-pre-submit', 'post-index-change', 'reference-transaction', 'proc-receive', 'pre-receive', 'update', 'post-receive', 'post-update', 'push-to-checkout']

/** Las órdenes sin tabla conservan todos los hooks. */
export function hooksDeOperacion(args: readonly string[]): readonly string[] {
  const indice = ['post-index-change']
  switch (args[0]) {
    case 'add': case 'restore': case 'update-index': case 'rm': case 'mv': return indice
    case 'checkout': case 'switch': return [...indice, 'post-checkout', 'reference-transaction']
    case 'reset': return [...indice, 'reference-transaction']
    case 'commit': return [...indice, 'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite', 'reference-transaction', 'pre-auto-gc']
    case 'clean': case 'config': return []
    default: return nombres
  }
}

export function candidatosHook(nombre: string, enWindows: boolean): string[] {
  return enWindows ? [nombre, `${nombre}.exe`] : [nombre]
}

function dentro(carpeta: string, raiz: string): boolean {
  const relativa = path.relative(raiz, carpeta)
  return relativa === '' || (!relativa.startsWith(`..${path.sep}`) && relativa !== '..' && !path.isAbsolute(relativa))
}

export function carpetaEfectiva(entradas: readonly EntradaConfig[], raiz: string, predeterminada: string): { carpeta: string; usuario: boolean } {
  const entrada = entradas.filter((e) => e.clave.toLowerCase() === 'core.hookspath').at(-1)
  const valor = (entrada?.valor ?? predeterminada).replace(/^~(?=[/\\]|$)/, homedir())
  const carpeta = path.resolve(raiz, valor)
  return { carpeta, usuario: !!entrada && ['global', 'system'].includes(entrada.ambito) && !dentro(carpeta, raiz) }
}
export function huellaHook(contenido: Uint8Array): string { return createHash('sha256').update(contenido).digest('hex') }
export function estadoHook(huella: string, aceptada?: string): 'nuevo' | 'cambiado' | null {
  return aceptada === huella ? null : aceptada === undefined ? 'nuevo' : 'cambiado'
}

/** Ruta que se enseña: relativa al repo si está dentro, completa si no. */
function rutaVisible(ruta: string, raiz: string): string {
  return dentro(ruta, raiz) ? path.relative(raiz, ruta).split(path.sep).join('/') : ruta
}

/** Qué hooks de la selección existen; sus bytes se leen después con toda la carpeta. */
async function leerEntrada(raiz: string, carpeta: string, nombre: string, enWindows: boolean): Promise<{ nombre: string; ruta: string } | undefined> {
  for (const candidato of candidatosHook(nombre, enWindows)) {
    const ruta = path.join(carpeta, candidato)
    let atributos
    try { atributos = await lstat(ruta) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (!atributos.isSymbolicLink() && (!atributos.isFile() || (!enWindows && !(atributos.mode & 0o111)))) continue
    return { nombre: candidato, ruta: rutaVisible(ruta, raiz) }
  }
  return undefined
}

/** Por qué no se puede aceptar la carpeta, y qué elemento lo impide, para que el diálogo lo nombre. */
class InspeccionIncompleta extends Error {
  readonly motivo: 'enlace' | 'limite' | 'otro'
  readonly ruta: string
  constructor(motivo: 'enlace' | 'limite' | 'otro', ruta: string) {
    super('inspeccion-incompleta')
    this.motivo = motivo
    this.ruta = ruta
  }
}

async function leerBytes(ruta: string, tope: number): Promise<Buffer> {
  const anterior = await lstat(ruta)
  if (anterior.isSymbolicLink()) throw new InspeccionIncompleta('enlace', ruta)
  if (!anterior.isFile()) throw new InspeccionIncompleta('otro', ruta)
  const descriptor = await open(ruta, constantes.O_RDONLY | (constantes.O_NOFOLLOW ?? 0))
  try {
    const abierto = await descriptor.stat()
    if (!abierto.isFile() || abierto.ino !== anterior.ino || abierto.dev !== anterior.dev) throw new InspeccionIncompleta('otro', ruta)
    const bytes = Buffer.alloc(tope + 1)
    let total = 0
    while (total < bytes.length) {
      const { bytesRead: leidos } = await descriptor.read(bytes, total, bytes.length - total, null)
      if (!leidos) break
      total += leidos
    }
    if (total > tope) throw new InspeccionIncompleta('limite', ruta)
    return bytes.subarray(0, total)
  } finally { await descriptor.close() }
}

async function leerArbol(base: string, carpeta = base, estado = { archivos: [] as Archivo[], bytes: 0, entradas: 0 }, nivel = 0): Promise<Archivo[]> {
  if (nivel > 32) throw new InspeccionIncompleta('limite', carpeta)
  if ((await lstat(carpeta)).isSymbolicLink()) throw new InspeccionIncompleta('enlace', carpeta)
  for await (const entrada of await opendir(carpeta)) {
    const archivo = path.join(carpeta, entrada.name)
    if (++estado.entradas > 1024) throw new InspeccionIncompleta('limite', carpeta)
    // Los ejemplos que crea `git init` nunca se ejecutan: ni se piden ni se copian (un hook que los cargue falla en la
    // copia en vez de correr algo sin aceptar).
    if (entrada.name.endsWith('.sample')) continue
    const atributos = await lstat(archivo)
    if (atributos.isSymbolicLink()) throw new InspeccionIncompleta('enlace', archivo)
    if (atributos.isDirectory()) await leerArbol(base, archivo, estado, nivel + 1)
    else if (atributos.isFile()) {
      const tope = Math.min(1024 * 1024, 8 * 1024 * 1024 - estado.bytes)
      if (estado.archivos.length >= 256 || atributos.size > tope) throw new InspeccionIncompleta('limite', archivo)
      const contenido = await leerBytes(archivo, tope)
      estado.bytes += contenido.length
      estado.archivos.push({ relativa: path.relative(base, archivo), contenido, modo: atributos.mode })
    } else throw new InspeccionIncompleta('otro', archivo)
  }
  // Orden por unidades de código, no por idioma: la huella del conjunto no puede cambiar con la configuración regional.
  return estado.archivos.sort((a, b) => (a.relativa < b.relativa ? -1 : a.relativa > b.relativa ? 1 : 0))
}

async function inspeccionar(raiz: string, entorno: NodeJS.ProcessEnv, seleccion: readonly string[]): Promise<Inspeccion> {
  const consultar = async (args: string[]): Promise<string> => colaGit.correr(async () => (await ejecutarArchivo('git', args, { cwd: raiz, env: entorno, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20_000, killSignal: 'SIGKILL' })).stdout.trim())
  const entradas = parsearListaConfig(await consultar(['config', '--list', '--show-scope', '--show-origin', '--includes', '-z']))
  const efectiva = carpetaEfectiva(entradas, raiz, await consultar(['rev-parse', '--git-path', 'hooks']))
  const clave = await realpath(path.resolve(raiz, await consultar(['rev-parse', '--git-common-dir'])))
  // Una ruta externa puede ser un enlace de vuelta al árbol montado o al directorio común.
  const carpetaReal = await realpath(efectiva.carpeta).catch(() => efectiva.carpeta)
  efectiva.usuario &&= !dentro(carpetaReal, await realpath(raiz)) && !dentro(carpetaReal, clave)
  if (efectiva.usuario) return { clave, ...efectiva, hooks: [], archivos: [], subcarpeta: '' }
  const presentes: { nombre: string; ruta: string }[] = []
  for (const nombre of seleccion) {
    const entrada = await leerEntrada(raiz, efectiva.carpeta, nombre, esWindows())
    if (entrada) presentes.push(entrada)
  }
  const hooks: Hook[] = []
  let archivos: Archivo[] = []
  let subcarpeta = ''
  if (presentes.length) {
    const husky = path.basename(efectiva.carpeta) === '_' && path.basename(path.dirname(efectiva.carpeta)) === '.husky'
    const base = husky ? path.dirname(efectiva.carpeta) : efectiva.carpeta
    subcarpeta = path.relative(base, efectiva.carpeta)
    try {
      if (dentro(efectiva.carpeta, raiz) && !dentro(carpetaReal, await realpath(raiz))) throw new InspeccionIncompleta('enlace', efectiva.carpeta)
      archivos = await leerArbol(efectiva.carpeta)
      if (husky) {
        archivos = archivos.map((a) => ({ ...a, relativa: path.join('_', a.relativa) }))
        for (const nombre of nombres) {
          const ruta = path.join(base, nombre)
          const atributos = await lstat(ruta).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
          if (!atributos) continue
          const tope = Math.min(1024 * 1024, 8 * 1024 * 1024 - archivos.reduce((total, a) => total + a.contenido.length, 0))
          if (atributos.isSymbolicLink()) throw new InspeccionIncompleta('enlace', ruta)
          if (!atributos.isFile()) throw new InspeccionIncompleta('otro', ruta)
          if (atributos.size > tope || archivos.length >= 256) throw new InspeccionIncompleta('limite', ruta)
          archivos.push({ relativa: nombre, contenido: await leerBytes(ruta, tope), modo: atributos.mode })
        }
      }
    } catch (error) {
      const causa = error instanceof InspeccionIncompleta ? error : new InspeccionIncompleta('otro', efectiva.carpeta)
      const contenido = txHooks().inspeccionIncompleta(causa.motivo, rutaVisible(causa.ruta, raiz))
      return { clave, ...efectiva, archivos: [], subcarpeta, incompleta: true, hooks: [{ ...presentes[0], huella: '', contenido, truncado: false }] }
    }
    const conjunto = huellaHook(Buffer.from(JSON.stringify(archivos.map((a) => [a.relativa, a.modo, huellaHook(a.contenido)]))))
    const principales = new Set(presentes.map((h) => path.join(subcarpeta, h.nombre)))
    archivos.sort((a, b) => Number(principales.has(b.relativa)) - Number(principales.has(a.relativa)))
    // Cada auxiliar se muestra: el permiso abarca los bytes que se copiarán, no solo el punto de entrada.
    for (const archivo of archivos) hooks.push({ nombre: archivo.relativa, ruta: path.relative(raiz, path.join(base, archivo.relativa)).split(path.sep).join('/'),
      huella: conjunto, contenido: archivo.contenido.subarray(0, 32 * 1024).toString('utf8'), truncado: archivo.contenido.length > 32 * 1024 })
  }
  return { clave, ...efectiva, hooks, archivos, subcarpeta }
}
function firma(inspeccion: Inspeccion): string {
  return JSON.stringify([inspeccion.clave, inspeccion.carpeta, inspeccion.usuario, inspeccion.hooks.map((h) => [h.nombre, h.huella])])
}

function consumirFicha(solicitud: Peticion, operacion: string): Ficha | undefined {
  const ahora = Date.now()
  const resolucion = solicitud.resolucion
  if (!resolucion) return undefined
  const ficha = fichas.leer(resolucion.ficha)
  fichas.borrar(resolucion.ficha)
  solicitud.resolucion = undefined
  if (!ficha || ficha.propietario !== solicitud.propietario || ficha.operacion !== operacion) throw new Error(txHooks().fichaInvalida)
  if (!['omitir', 'aceptar'].includes(resolucion.decision)) throw new Error(txHooks().fichaInvalida)
  if (ficha.vence <= ahora) return undefined
  return ficha
}

async function leerAceptados(archivo: string): Promise<Record<string, string>> {
  try {
    const valor: unknown = JSON.parse(await readFile(archivo, 'utf8'))
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {}
    return Object.fromEntries(Object.entries(valor).filter((entrada): entrada is [string, string] => typeof entrada[1] === 'string'))
  } catch { return {} }
}

export async function autorizarHooks(args: string[], raiz: string, entorno: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const solicitud = peticion.getStore()
  if (!solicitud) return entorno
  if (solicitud.omitir) return entorno
  const previa = solicitud.entornos.get(raiz)
  if (previa) return previa
  const autorizacion = autorizar(solicitud, args, raiz, entorno)
  solicitud.entornos.set(raiz, autorizacion)
  return autorizacion
}

async function autorizar(solicitud: Peticion, args: string[], raiz: string, entorno: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const operacion = JSON.stringify([raiz, solicitud.operacion ?? args])
  const omitir = solicitud.resolucion?.decision === 'omitir'
  const ficha = consumirFicha(solicitud, operacion)
  if (omitir && ficha) { solicitud.omitir = true; return entorno }
  // La configuración se lee sin la anulación de hooks para conocer su destino efectivo.
  const seleccion = solicitud.nombres ?? hooksDeOperacion(args)
  if (!seleccion.length) return entorno
  const inspeccion = await inspeccionar(raiz, process.env, seleccion)
  const archivo = path.join(carpetaDatosHooks(), 'hooks-aceptados', `${huellaHook(Buffer.from(inspeccion.clave))}.json`)
  let aceptados = await leerAceptados(archivo)
  const aceptando = !inspeccion.incompleta && ficha && ficha.firma === firma(inspeccion)
  if (aceptando) {
    aceptados = { ...aceptados, ...Object.fromEntries(inspeccion.hooks.map((h) => [`${inspeccion.carpeta}/${h.nombre}`, h.huella])) }
  }
  const pendientes = inspeccion.hooks.flatMap((h) => {
    const estado = inspeccion.incompleta ? 'nuevo' : estadoHook(h.huella, aceptados[`${inspeccion.carpeta}/${h.nombre}`])
    return estado ? [{ nombre: h.nombre, ruta: h.ruta, contenido: h.contenido, truncado: h.truncado, estado }] : []
  })
  // La ruta también forma parte del permiso: otro hooksPath no hereda la aceptación.
  if (aceptando) {
    await candadoPermisos.runExclusive(archivo, () => writeFileAtomic(archivo, JSON.stringify(aceptados)))
  } else if (pendientes.length) {
    const id = randomUUID()
    // Solo se retiene la firma; los bytes completos viven durante la inspección de esta petición.
    fichas.guardar(id, { vence: Date.now() + 120_000, propietario: solicitud.propietario, operacion, firma: firma(inspeccion) })
    solicitud.pendiente = { ficha: id, repo: path.basename(raiz), hooks: pendientes, ...(inspeccion.incompleta ? { incompleta: true } : {}) }
    throw new PendienteHooks(solicitud.pendiente)
  }
  return entornoDeInspeccion(solicitud, inspeccion, entorno)
}

async function entornoDeInspeccion(solicitud: Peticion, inspeccion: Inspeccion, entorno: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (inspeccion.usuario) return entornoCon(entorno, [['core.hooksPath', inspeccion.carpeta]])
  if (!inspeccion.hooks.length) return entorno
  const destino = path.join(carpetaDatosHooks(), 'hooks-copias', huellaHook(Buffer.from(inspeccion.clave)))
  await mkdir(destino, { recursive: true })
  const copia = await mkdtemp(path.join(destino, 'peticion-'))
  solicitud.copias.push(copia)
  for (const archivo of inspeccion.archivos) {
    const ruta = path.join(copia, archivo.relativa)
    await mkdir(path.dirname(ruta), { recursive: true })
    await writeFile(ruta, archivo.contenido, { mode: archivo.modo })
  }
  return entornoCon(entorno, [['core.hooksPath', path.join(copia, inspeccion.subcarpeta)]])
}
