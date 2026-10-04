#!/usr/bin/env node
// =============================================================================
// Humo de solo lectura del explorador contra una Oracle real remota, por VPN: mide cuánto tarda cada operación
// con el trabajador real. Necesita la VPN y Tessera abierta con un proyecto nativo en el perfil de esa conexión.
// Lo lanza `scripts/pruebas/humo-remoto.sh`; `<alias>` es el nombre de la conexión en Tessera.
// (node src/main/db/explorador/test-db-oracle-lectura.mts <alias> [tabla]  ·  npm run test:db-oracle-lectura -- <alias> [tabla])
// =============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect, type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  ENV_DRIVERS,
  ENV_PERFIL,
  ENV_PIPE,
  ENV_REGISTRO,
  ENV_SESION,
  type DbConnection,
  type DbEsquemasVisibles,
  type DbIntrospeccion
} from '../../../shared/db-ipc.ts'
import type { DbConteos, DbErrorSql, DbRespuesta, DbTipoObjeto } from '../../../shared/db-explorador-ipc.ts'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import { esMac, plataformaActual } from '../../../shared/plataforma.ts'
import { ExploradorController } from './ExploradorController.ts'
import { leerRegistroConRespaldo } from '../registroConexiones.ts'
import {
  buscarEnRegistro,
  copiaSoloLectura,
  elegirTabla,
  formatearMs,
  interpretarRespuestaPuente,
  peticionPuente,
  resolverSecreto,
  sqlTablasModestas,
  taparSecreto,
  vetarPeticion,
  type EstadoPuente
} from './lecturaSegura.ts'
import { ProcesoTrabajador } from './ProcesoTrabajador.ts'
import { soloLecturaEnTodas } from './soloLecturaImpuesta.ts'
import type { CtxDrivers, OpTrabajador, PeticionSinId, PeticionSinIdDe, RespuestasPorOp } from './protocoloTrabajador.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Lo que no se pudo comprobar por algo del entorno, con su motivo. No es FAIL. */
interface Salto {
  name: string
  motivo: string
}
const saltos: Salto[] = []
function salta(name: string, motivo: string): void {
  saltos.push({ name, motivo })
  console.log(`  [SALTA] ${name} -> ${motivo}`)
}

let veredictoDado = false
function veredicto(): never {
  veredictoDado = true
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  for (const s of saltos) {
    console.log(`SALTA ${s.name}`)
    console.log(`      -> ${s.motivo}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total && total > 0
  const nota = saltos.length > 0 ? ` (${saltos.length} saltadas)` : ''
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}${nota}`)
  process.exit(allPass ? 0 : 1)
}

// Si el proceso se vacía sin llegar al veredicto (una promesa que nunca se resuelve),
// Node saldría con 0 y sin decir nada: eso NO puede pasar por un smoke en verde.
process.on('exit', () => {
  if (veredictoDado) return
  console.log('\nTERMINÓ SIN VEREDICTO: el smoke se cortó a mitad. Cuenta como fallo.')
  // Solo si iba a salir con 0: un Ctrl+C conserva su 130.
  if (!process.exitCode) process.exitCode = 1
})

function comoCorrerlo(alias: string): string {
  return [
    'Cómo correrlo:',
    '  1. VPN levantada, si la base remota la necesita.',
    '  2. En Tessera (abierta), un proyecto del perfil dueño de la conexión en modo nativo',
    // El nombre del equipo sale de `nombresSistema`, como en la UI: en un Mac es «tu Mac».
    `     (sin contenedor: corre en ${nombresSistema(plataformaActual()).tuEquipo}, que es lo que ve la VPN).`,
    `  3. En el selector de bases de ESE proyecto, monta «${alias}» (verificada y con contraseña).`,
    '  4. En la terminal de ese proyecto (si se abrió antes de montar, pulsa «Recargar»):',
    '       cd <carpeta del repo de Tessera>',
    `       npm run test:db-oracle-lectura -- ${alias} [TABLA]`
  ].join('\n')
}

/** Sin alias no hay nada que probar: exit 0 y cómo se corre. */
function saltar(motivo: string): never {
  veredictoDado = true
  console.log(`\nSALTADO: ${motivo}\n\n${comoCorrerlo('<alias>')}\n\nVEREDICTO: 0/0 PASS — SALTADO`)
  process.exit(0)
}

/** Con alias pero sin lo necesario para correr: exit 1, el motivo y cómo se corre. */
function noSePuede(motivo: string, alias: string): never {
  veredictoDado = true
  console.log(`\nNO SE PUEDE CORRER: ${motivo}\n\n${comoCorrerlo(alias)}\n\nVEREDICTO: 0/1 PASS — HAY FAIL`)
  process.exit(1)
}

/** Corta el smoke: un plazo vencido o algo sin lo que no queda nada que probar. */
class Abortar extends Error {}

const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)

/** Tope del smoke entero. */
const TOPE_GLOBAL_MS = 10 * 60_000
/**
 * Plazos por operación, medidos desde el main (VPN incluida). Holgados a propósito
 * en el catálogo: lo que interesa es CUÁNTO tarda, y un plazo corto convertiría
 * «tarda 90 s» en «más de 60 s» (ver la cabecera: hay consultas que en una 11g grande
 * pueden irse a minutos). El tope global acota la suma.
 */
const PLAZO = {
  /** Lanzar el trabajador, cargar el Instant Client, iniciar sesión y leer los esquemas. */
  abrir: 90_000,
  catalogo: 120_000,
  /** ALL_OBJECTS de PUBLIC: decenas de miles de sinónimos en una 11g. */
  publicos: 180_000,
  /** Las restricciones del detalle: lo más lento medido (ver la cabecera). */
  detalle: 180_000,
  datos: 60_000,
  consola: 30_000,
  guardia: 15_000,
  cierre: 5_000
}
/** Tras un plazo vencido con Stop, lo que se espera a que la operación suelte la sesión. */
const ESPERA_TRAS_STOP_MS = 10_000
const MAX_FILAS = 100
/** Tope de espera del puente: el mismo que `tdb`. */
const PUENTE_TIMEOUT_MS = 5000
const SQL_CONSOLA = 'select sysdate, user from dual'
/** La tabla de la guardia: no existe, así que ni un fallo del candado tendría efecto. */
const INVENTADA = `TESSERA_NO_EXISTE_${randomBytes(4).toString('hex').toUpperCase()}`

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function descErr(e: DbErrorSql): string {
  return `${e.motivo}${e.codigo ? ` ${e.codigo}` : ''}: ${e.mensaje.slice(0, 300)}`
}

/** Cuántas filas trae una página, sin mirar ni imprimir ninguna. */
function nFilas(filasJson: string): number {
  const f = JSON.parse(filasJson) as unknown
  return Array.isArray(f) ? f.length : -1
}

function nLineas(texto: string): number {
  return texto === '' ? 0 : texto.split('\n').length
}

function conPlazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((r) => {
      const t = setTimeout(() => r(null), ms)
      t.unref()
    })
  ])
}

function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Una operación del gestor que lanza, como `DbRespuesta` (para medirla como las demás). */
async function comoRespuesta<T>(fn: () => Promise<T>): Promise<DbRespuesta<T>> {
  try {
    return { ok: true, valor: await fn() }
  } catch (e) {
    return { ok: false, error: { motivo: 'interno', mensaje: mensajeDe(e) } }
  }
}

/** Qué hacer ante el fallo al conectar: el remedio depende del motivo. */
function pistaDeConexion(e: DbErrorSql): string {
  const texto = `${e.codigo ?? ''} ${e.mensaje}`
  if (e.motivo === 'driver') {
    return esMac()
      ? 'falta un cliente Oracle que llegue a esta versión, y en macOS no hay Instant Client para la 11.2: contra esta base, el smoke se corre en Windows.'
      : 'falta el Instant Client: instálalo desde Tessera (en la conexión, «Instalar driver») y vuelve a lanzar.'
  }
  if (/ORA-01017/.test(texto)) return 'usuario o contraseña rechazados por el servidor: revisa la contraseña guardada en la conexión.'
  if (/ORA-12170|ORA-12541|ORA-12543|NJS-503|NJS-500|timed out|timeout/i.test(texto) || e.motivo === 'timeout') {
    return 'el servidor no contesta: ¿la VPN está levantada?'
  }
  return 'sin conexión no queda nada que probar.'
}

/** `tabla 812, vista 40, …`: solo las carpetas con algo. */
function resumenConteos(c: DbConteos): string {
  const partes = Object.entries(c)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([t, n]) => `${t} ${n}`)
  return partes.join(', ') || '(vacío)'
}

// --- El puente, como `pedirAlPuente` de tdb.cjs ---------------------------------------------

function pedirAlPuente(pipe: string, token: string): Promise<EstadoPuente> {
  return new Promise((resolve) => {
    let hecho = false
    const acabar = (e: EstadoPuente): void => {
      if (hecho) return
      hecho = true
      resolve(e)
    }
    let socket: Socket
    try {
      socket = connect(pipe)
    } catch {
      acabar({ tipo: 'noResponde' })
      return
    }
    socket.setTimeout(PUENTE_TIMEOUT_MS)
    socket.on('timeout', () => {
      socket.destroy()
      acabar({ tipo: 'noResponde' })
    })
    socket.on('error', () => acabar({ tipo: 'noResponde' }))
    let buffer = ''
    socket.on('data', (t: Buffer) => {
      buffer += t.toString('utf-8')
    })
    socket.on('end', () => acabar(interpretarRespuestaPuente(buffer)))
    socket.write(peticionPuente(token))
  })
}

/**
 * Todo lo que el smoke escribe por stdout/stderr pasa por aquí: la contraseña se tapa
 * y cada tapado se cuenta (y al final es FAIL). Devuelve el contador.
 */
function instalarFiltroSalida(secreto: string): () => number {
  let tapadas = 0
  for (const flujo of [process.stdout, process.stderr] as NodeJS.WriteStream[]) {
    const escribir = flujo.write.bind(flujo) as (trozo: string | Uint8Array, ...resto: unknown[]) => boolean
    const filtrada = (trozo: string | Uint8Array, ...resto: unknown[]): boolean => {
      const texto = typeof trozo === 'string' ? trozo : Buffer.from(trozo).toString('utf8')
      const t = taparSecreto(texto, secreto)
      if (t.tapado) tapadas++
      return escribir(t.texto, ...resto)
    }
    flujo.write = filtrada as NodeJS.WriteStream['write']
  }
  return () => tapadas
}

/** Contexto de drivers como `DbController.ctxDrivers`, leído del catálogo publicado. */
function ctxDriversDe(dir: string): CtxDrivers {
  let packs: unknown[] = []
  let externos: Record<string, string> = {}
  if (dir) {
    try {
      let texto = readFileSync(path.join(dir, 'catalogo.json'), 'utf-8')
      if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1)
      const doc = JSON.parse(texto) as { packs?: unknown; externos?: unknown }
      if (Array.isArray(doc?.packs)) packs = doc.packs
      if (typeof doc?.externos === 'object' && doc.externos !== null) externos = doc.externos as Record<string, string>
    } catch {
      // Sin catálogo se sigue sin packs, como la app: thin no los necesita.
    }
  }
  return { packs, externos, driversDir: dir, usuarioWindows: process.env.USERNAME || process.env.USER || 'tessera' }
}

/** Registro en MEMORIA con la forma que el explorador espera: nada llega al disco. */
class ConexionesEnMemoria {
  private conexion: DbConnection
  private readonly secreto: string
  constructor(conexion: DbConnection, secreto: string) {
    this.conexion = conexion
    this.secreto = secreto
  }
  get(id: string): DbConnection | undefined {
    return id === this.conexion.id ? this.conexion : undefined
  }
  secretOf(id: string): string | null {
    return id === this.conexion.id ? this.secreto : null
  }
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    if (id !== this.conexion.id) throw new Error('Conexión desconocida')
    this.conexion = { ...this.conexion, esquemas: v }
    return this.conexion
  }
  setIntrospeccion(id: string, v: DbIntrospeccion): void {
    if (id === this.conexion.id) this.conexion = { ...this.conexion, introspeccion: v }
  }
  marcarVerificada(id: string, driverId: string | null): boolean {
    if (id !== this.conexion.id) return false
    this.conexion = { ...this.conexion, verificada: true, driverId }
    return true
  }
}

// --- El centinela, entre el gestor y el trabajador -------------------------------------------

const vigilancia = {
  /** TODAS las peticiones hacia el trabajador (abrir, ejecutar, tx…), vetadas o no. */
  peticiones: 0,
  /** Sentencias que llegaron a salir hacia el trabajador. */
  ejecutar: 0,
  /** Peticiones que llevaban el nombre de la tabla inventada de la guardia. */
  conCanario: 0,
  vetos: [] as string[]
}

/** El `ProcesoTrabajador` real, con `vetarPeticion` delante de cada envío. */
class TrabajadorVigilado extends ProcesoTrabajador {
  override enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>, plazoMs?: number | null): Promise<RespuestasPorOp[O]> {
    const p = peticion as unknown as PeticionSinId
    vigilancia.peticiones++
    if (p.op === 'ejecutar' && p.sql.includes(INVENTADA)) vigilancia.conCanario++
    const veto = vetarPeticion(p)
    if (veto !== null) {
      vigilancia.vetos.push(`${p.op}: ${veto}`)
      return Promise.reject(new Error(`El centinela del smoke vetó ${veto}.`))
    }
    if (p.op === 'ejecutar') vigilancia.ejecutar++
    return super.enviar<O>(peticion, plazoMs)
  }
}

// --- Tiempos ---------------------------------------------------------------------------------

interface Tiempo {
  etiqueta: string
  ms: number
  /** `rechazada`: la operación TENÍA que fallar (la guardia) y falló. */
  estado: 'ok' | 'error' | 'plazo' | 'rechazada'
}
const tiempos: Tiempo[] = []

interface OpcionesMedida {
  /** Stop de la operación, para cuando vence su plazo (datos y consola lo admiten). */
  stop?: () => void
  /** Lo esperado es un rechazo: en el resumen no se pinta como error. */
  esperaRechazo?: boolean
}

/**
 * Corre una operación con su plazo y apunta cuánto tardó. Si vence, manda Stop (si la
 * operación lo admite), espera un poco a que suelte la sesión y CORTA el smoke.
 */
async function medir<T>(
  etiqueta: string,
  plazoMs: number,
  fn: () => Promise<DbRespuesta<T>>,
  opciones: OpcionesMedida = {}
): Promise<{ r: DbRespuesta<T>; ms: number }> {
  const { stop, esperaRechazo = false } = opciones
  const t0 = performance.now()
  const p = fn()
  const r = await conPlazo(p, plazoMs)
  const ms = Math.round(performance.now() - t0)
  if (r === null) {
    tiempos.push({ etiqueta, ms, estado: 'plazo' })
    // Qué hizo el Stop es parte de la evidencia: «paró con ORA-01013» y «siguió en el
    // servidor» son dos noticias muy distintas sobre una base remota.
    let tras = 'sin Stop posible (el catálogo no se interrumpe): acabará sola en el servidor'
    if (stop) {
      stop()
      const fin = await conPlazo(p, ESPERA_TRAS_STOP_MS)
      tras =
        fin === null
          ? `se pidió Stop y no soltó la sesión en ${formatearMs(ESPERA_TRAS_STOP_MS)}`
          : fin.ok
            ? 'se pidió Stop, pero terminó por su cuenta'
            : `se pidió Stop y paró: ${descErr(fin.error)}`
    }
    check(`«${etiqueta}» dentro de su plazo (${formatearMs(plazoMs)})`, false, `sin respuesta en ${formatearMs(ms)}; ${tras}`)
    throw new Abortar(`«${etiqueta}» no contestó a tiempo: se corta para no cargar más la base.`)
  }
  tiempos.push({ etiqueta, ms, estado: r.ok ? 'ok' : esperaRechazo ? 'rechazada' : 'error' })
  console.log(`  [t] ${etiqueta}: ${formatearMs(ms)}`)
  return { r, ms }
}

async function main(): Promise<void> {
  // --- Argumentos y contexto -------------------------------------------------------------
  const args = process.argv.slice(2).filter((a) => a.trim() !== '')
  const alias = args[0] ?? ''
  const tablaPedida = args[1] ?? null
  if (!alias) saltar('falta el alias de la conexión (npm run test:db-oracle-lectura -- <alias>).')

  const rutaRegistro = process.env[ENV_REGISTRO] ?? ''
  const dirDrivers = process.env[ENV_DRIVERS] ?? ''
  const pipe = process.env[ENV_PIPE] ?? ''
  const token = process.env[ENV_SESION] ?? ''
  const perfil = process.env[ENV_PERFIL] ?? ''
  if (!rutaRegistro) {
    noSePuede('esta terminal no lleva el contexto de bases de datos de Tessera (falta TESSERA_DB_REGISTRY).', alias)
  }
  // La MISMA lectura que el main y que `tdb` (`leerRegistroConRespaldo`: BOM, `.bak` si
  // el principal no es JSON, formato ajeno). Antes se leía el principal a pelo: con él
  // corrupto el smoke se paraba aunque el `.bak` sirviera, y con un formato ajeno buscaba
  // en lo que la app no enseña. Lo único que se conserva de aquel camino es parar cuando
  // no se puede leer NINGUNO de los dos: un registro que no existe no es uno vacío.
  //   Y con el MISMO contrato de lector que `ConnectionStore.read`: `null` solo si NO
  // EXISTE; si existe y no se deja leer, lanza, y la regla lo trata como ilegible. Antes
  // aquí se tragaba cualquier error como «no existe», así que un principal
  // sin permiso con un `.bak` roto se buscaba como registro VACÍO («Disponibles:
  // (ninguna)»), donde la app lo bloquea con su aviso.
  let leidoAlguno = false
  const registro = leerRegistroConRespaldo((ruta) => {
    try {
      const texto = readFileSync(ruta, 'utf-8')
      leidoAlguno = true
      return texto
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException | null)?.code
      if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return null
      leidoAlguno = true
      throw e
    }
  }, rutaRegistro)
  if (!leidoAlguno) noSePuede(`no se pudo leer el registro de conexiones (${rutaRegistro}) ni su respaldo.`, alias)
  const busqueda = buscarEnRegistro(registro, alias, perfil || null)
  if (!busqueda.ok) noSePuede(busqueda.mensaje, alias)
  const copia = copiaSoloLectura(busqueda.entrada)
  if (!copia.ok) noSePuede(copia.mensaje, alias)
  const con = copia.conexion

  const estadoPuente: EstadoPuente = pipe && token ? await pedirAlPuente(pipe, token) : { tipo: 'sinPuente' }
  // El destino, de la entrada TAL COMO SE LEYÓ (ver `resolverSecreto`): su huella tiene que
  // ser la que vino con la contraseña.
  const { motor, host, port, database, sid, user } = busqueda.entrada
  const sec = resolverSecreto(con.id, estadoPuente, process.env, { motor, host, port, database, sid, user })
  if (!sec.ok) noSePuede(sec.mensaje, alias)
  const secreto = sec.secreto
  const tapadas = instalarFiltroSalida(secreto)
  // Leído todo lo que hacía falta, fuera las TESSERA_*: ningún hijo debe heredar ni el
  // token ni una contraseña de respaldo.
  for (const k of Object.keys(process.env)) {
    if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  }

  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (!electron || !existsSync(electron)) {
    noSePuede('falta el binario de Electron del repo (lo baja `npm run predev`, o `npm install`).', alias)
  }
  try {
    require_.resolve('oracledb')
  } catch {
    noSePuede('falta el paquete oracledb (`npm install` en el repo).', alias)
  }
  const ctx = ctxDriversDe(dirDrivers)

  hr(`Smoke de SOLO LECTURA contra «${con.alias}»`)
  console.log(`  Oracle por ${con.sid ? 'SID' : 'servicio'}; driver guardado en la conexión: ${con.driverId ?? '(ninguno: thin, o escalada a thick)'}`)
  console.log(`  solo lectura: ${copia.eraEscritura ? 'FORZADA (en el registro está en escritura)' : 'ya lo era en el registro'}`)
  console.log(`  contraseña: del ${sec.origen === 'puente' ? 'puente de Tessera' : 'entorno (TESSERA_DB_SECRET_<ID>)'}; no se imprime`)
  console.log(`  drivers: ${ctx.packs.length} pack(s) en el catálogo, ${Object.keys(ctx.externos).length} externo(s)`)
  console.log(`  plazos: ${formatearMs(TOPE_GLOBAL_MS)} en total; al primero que venza se corta`)

  // --- El explorador, con todo en temporal y en memoria -----------------------------------
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-lectura-'))
  mkdirSync(path.join(tmp, 'exportados'))
  process.on('exit', () => {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // nada
    }
  })
  const PERFIL = con.profileId
  const ID = con.id
  const logs: string[] = []
  const procesos: TrabajadorVigilado[] = []
  const conexiones = new ConexionesEnMemoria(con, secreto)
  const rutaSesion = path.resolve(aqui, '..', '..', '..', 'tdb', 'sesion.cjs')
  const ex = new ExploradorController({
    conexiones,
    registro: {
      ctxDrivers: () => ctx,
      notificarCambio: () => {},
      espacioDeDatos: (p) => path.join(tmp, 'conexiones', p),
      tdbScriptDir: () => path.dirname(rutaSesion),
      ensureWorkspace: (p) => mkdirSync(path.join(tmp, 'conexiones', p), { recursive: true })
    },
    perfilVivo: (p) => p === PERFIL,
    nombrePerfil: () => 'Smoke',
    papelera: async (ruta) => rmSync(ruta, { force: true }),
    plataforma: plataformaActual(),
    getWindow: () => null,
    emitir: () => {},
    // Exportar (15): el «diálogo» elige un archivo del temporal del smoke, que se
    // borra al salir. Nunca escribe fuera de él.
    guardarArchivo: async (_win, opciones) => ({
      canceled: false,
      filePath: path.join(tmp, 'exportados', path.basename(opciones.defaultPath ?? 'exportacion'))
    }),
    // El historial, también en el temporal: nunca en el de la Tessera instalada.
    dirHistorial: path.join(tmp, 'db-historial'),
    log: (l) => logs.push(l),
    // EL PRIMER CANDADO, IMPUESTO POR EL SMOKE: desde que la casilla «Solo
    // lectura» de la conexión es solo de los agentes, el explorador del producto NO limita
    // nada con ella. Aquí se le impone la solo lectura en TODAS las conexiones, sin mirar la
    // casilla: el main rechaza lo que escribe, cada sentencia de usuario lleva `SET
    // TRANSACTION READ ONLY` y la rejilla no se edita. Si alguien quitara esta línea, el
    // centinela (`vetarPeticion`) vetaría la primera sesión o sentencia sin candado: el smoke
    // FALLA, nunca escribe.
    soloLecturaImpuesta: soloLecturaEnTodas,
    lanzar: () => {
      const p = new TrabajadorVigilado({
        rutaScript: rutaSesion,
        execPath: electron,
        // Ver la cabecera: 'advanced' solo encaja con el mismo V8 en los dos lados.
        serializacion: process.versions.electron ? 'advanced' : 'json',
        log: (l) => logs.push(l)
      })
      procesos.push(p)
      return p
    }
  })

  // Lo que el resumen cuenta al final.
  const info = { version: '?', modo: '?', driverId: '', esquema: '', nVisibles: 0, nEsquemas: 0, tabla: '', motivoTabla: '', paquete: '' }
  const t0Total = performance.now()

  // --- Cierre: una sola vez, lo pida quien lo pida --------------------------------------
  let cierre: Promise<void> | null = null
  const cerrarYComprobar = (): Promise<void> =>
    (cierre ??= (async () => {
      hr('(12) Cerrar todo: ningún proceso vivo')
      const vivosAntes = procesos.filter((p) => p.vivo).length
      const pids = procesos.map((p) => p.pid).filter((pid): pid is number => typeof pid === 'number')
      const tc = performance.now()
      await conPlazo(ex.cerrarTodo(PLAZO.cierre), PLAZO.cierre + 3000)
      let quedan = pids.filter(pidVivo)
      for (let i = 0; i < 30 && quedan.length > 0; i++) {
        await new Promise((r) => setTimeout(r, 100))
        quedan = pids.filter(pidVivo)
      }
      const msCierre = Math.round(performance.now() - tc)
      tiempos.push({ etiqueta: 'cerrarTodo', ms: msCierre, estado: 'ok' })
      console.log(`  [t] cerrarTodo: ${formatearMs(msCierre)}`)
      check(
        'cerrarTodo no deja ningún proceso de sesión vivo',
        vivosAntes > 0 && ex.gestor.procesosVivos() === 0 && procesos.every((p) => !p.vivo) && quedan.length === 0,
        `lanzados=${procesos.length}, vivos antes=${vivosAntes}, después=${procesos.filter((p) => p.vivo).length}, pids que siguen=${quedan.length}`
      )
    })())

  // --- Final: secretos, centinela, resumen y veredicto ------------------------------------
  const finalizar = (): never => {
    if (results.some((r) => !r.pass) && logs.length > 0) {
      console.log('\n--- log del explorador (últimas 40 líneas) ---')
      for (const l of logs.slice(-40)) console.log('  ' + l)
    }
    hr('(13) Secretos, centinela y solo lectura')
    check(
      'el centinela no tuvo que vetar nada',
      vigilancia.vetos.length === 0,
      vigilancia.vetos.length > 0 ? vigilancia.vetos.join(' | ') : `${vigilancia.ejecutar} sentencias salieron, todas lecturas`
    )
    check('la conexión siguió en solo lectura hasta el final', conexiones.get(ID)?.readonly === true, `readonly=${String(conexiones.get(ID)?.readonly)}`)
    if (secreto.length >= 8) {
      check('la contraseña no aparece en el log del explorador', !logs.some((l) => l.includes(secreto)), `${logs.length} líneas revisadas`)
      check('ni en ninguna línea impresa (el filtro no tuvo que tapar nada)', tapadas() === 0, `${tapadas()} escritura(s) tapadas`)
    } else {
      salta('la contraseña no aparece en el log ni en la salida', 'tiene menos de 8 caracteres: buscarla daría falsos positivos (se tapa igual si tiene 4 o más)')
    }

    hr(`RESUMEN — «${con.alias}»`)
    console.log(`  servidor: Oracle ${info.version}, ${info.modo}${info.driverId ? ` (${info.driverId})` : ''}, solo lectura`)
    if (info.esquema) console.log(`  esquema por defecto: ${info.esquema} (${info.nVisibles} de ${info.nEsquemas} esquemas visibles)`)
    if (info.tabla) console.log(`  tabla de la pestaña de datos: ${info.tabla} (${info.motivoTabla})`)
    if (info.paquete) console.log(`  paquete: ${info.paquete}`)
    console.log('\n  Tiempos, vistos desde el main (VPN incluida):')
    for (const t of tiempos) {
      const nota =
        t.estado === 'plazo'
          ? '   <- SIN RESPUESTA'
          : t.estado === 'error'
            ? '   <- error'
            : t.estado === 'rechazada'
              ? '   (rechazada, como debe)'
              : ''
      console.log(`    ${t.etiqueta.padEnd(52, '.')} ${formatearMs(t.ms).padStart(10)}${nota}`)
    }
    console.log(`    ${'TOTAL del smoke'.padEnd(52, '.')} ${formatearMs(performance.now() - t0Total).padStart(10)}`)
    veredicto()
  }

  // --- Tope global y Ctrl+C: cerrar las sesiones SIEMPRE antes de salir -------------------
  const tope = setTimeout(() => {
    check(`el smoke termina en menos de ${formatearMs(TOPE_GLOBAL_MS)}`, false, 'tope global vencido: se cierran las sesiones y se corta')
    void cerrarYComprobar().finally(finalizar)
  }, TOPE_GLOBAL_MS)
  process.once('SIGINT', () => {
    console.log('\nInterrumpido: cerrando las sesiones antes de salir…')
    void conPlazo(ex.cerrarTodo(1500), 4000).finally(() => process.exit(130))
  })

  try {
    // --- (1) Conectar y esquemas -------------------------------------------------------
    hr('(1) Conectar y leer los esquemas')
    const m1 = await medir('conectar + esquemas', PLAZO.abrir, () => ex.esquemas(ID))
    const meta = ex.sesiones().find((s) => s.ref.rol === 'meta' && s.conexionId === ID)
    const drv = meta?.driver
    if (drv) {
      info.version = drv.version
      info.modo = drv.modo
      info.driverId = drv.driverId ?? ''
    }
    if (!m1.r.ok) {
      check('conecta y lee los esquemas', false, descErr(m1.r.error))
      throw new Abortar(pistaDeConexion(m1.r.error))
    }
    const esq = m1.r.valor
    info.esquema = esq.porDefecto
    info.nVisibles = esq.nVisibles
    info.nEsquemas = esq.esquemas.length
    check(
      'conecta y lee los esquemas, con el por defecto',
      esq.porDefecto !== '' && esq.esquemas.some((e) => e.nombre === esq.porDefecto && e.porDefecto),
      `${esq.nVisibles} de ${esq.esquemas.length} esquemas, por defecto ${esq.porDefecto}; Oracle ${info.version} en ${info.modo}${info.driverId ? ` (${info.driverId})` : ''}`
    )
    check('la sesión de catálogo es de solo lectura', meta?.soloLectura === true, `soloLectura=${String(meta?.soloLectura)}`)
    if (info.version.startsWith('11.')) check('una 11.2 abre en thick (thin no llega a ella)', info.modo === 'thick', `modo ${info.modo}`)
    const ESQ = esq.porDefecto
    const m1b = await medir('esquemas otra vez (sesión ya abierta)', PLAZO.catalogo, () => ex.esquemas(ID, true))
    check('releer los esquemas con la sesión abierta', m1b.r.ok, m1b.r.ok ? `${m1b.r.valor.esquemas.length} esquemas` : descErr(m1b.r.error))

    // --- (2) Conteos ----------------------------------------------------------------------
    hr(`(2) Conteos del esquema por defecto (${ESQ})`)
    const m2 = await medir('conteos del esquema', PLAZO.catalogo, () => ex.resumen(ID, ESQ))
    check('conteos de todas las carpetas en un viaje', m2.r.ok, m2.r.ok ? resumenConteos(m2.r.valor) : descErr(m2.r.error))
    const conteos: DbConteos = m2.r.ok ? m2.r.valor : {}

    // --- (3) Objetos: tablas y paquetes (las vistas, en el 10) --------------------------------
    hr('(3) Objetos de las carpetas de tablas y de paquetes')
    const listados: Partial<Record<DbTipoObjeto, string[]>> = {}
    const listar = async (tipo: 'tabla' | 'vista' | 'paquete'): Promise<void> => {
      const m = await medir(`objetos: ${tipo}`, PLAZO.catalogo, () => ex.objetos(ID, ESQ, tipo))
      const nombres = m.r.ok ? m.r.valor.map((o) => o.nombre) : []
      listados[tipo] = nombres
      const esperado = conteos[tipo]
      // `sqlObjetos` y `sqlConteos` comparten filtros a propósito: la cifra de la
      // carpeta y lo que se ve al desplegarla tienen que cuadrar.
      check(
        `${tipo}: el listado cuadra con el conteo de la carpeta`,
        m.r.ok && (esperado === undefined || nombres.length === esperado),
        m.r.ok ? `${nombres.length} en el listado, ${esperado ?? '?'} en el conteo` : descErr(m.r.error)
      )
    }
    await listar('tabla')
    await listar('paquete')

    // --- (4) La tabla de la pestaña de datos y del detalle -----------------------------------
    hr('(4) La tabla de la pestaña de datos')
    const tablas = listados.tabla ?? []
    let candidatas: readonly (readonly unknown[])[] = []
    if (!tablaPedida && tablas.length > 0) {
      const consulta = sqlTablasModestas(ESQ)
      const mt = await medir(
        'buscar una tabla moderada (estadísticas)',
        PLAZO.catalogo,
        () => comoRespuesta(() => ex.gestor.catalogo(ID, (c) => c.consultar(consulta), { prioridad: 'alta' }))
      )
      if (mt.r.ok) candidatas = mt.r.valor
      else console.log(`  (sin estadísticas que consultar: ${descErr(mt.r.error)}; se usa la primera del listado)`)
    }
    const eleccion = elegirTabla(tablas, candidatas, tablaPedida)
    let TABLA = ''
    if (!eleccion.ok) {
      if (tablaPedida) check('la tabla pedida existe en el esquema por defecto', false, eleccion.mensaje)
      else salta('pestaña de datos y detalle de una tabla', eleccion.mensaje)
    } else {
      TABLA = eleccion.nombre
      info.tabla = TABLA
      info.motivoTabla = eleccion.motivo
      console.log(`  tabla: ${TABLA} (${eleccion.motivo})`)
    }

    // --- (5) Pestaña de datos ---------------------------------------------------------------------
    /** Lo que la pestaña dice de la edición: lo comprueba (7b). */
    let edicionP1: { identidad: unknown; noEditables: unknown; columnas: string[] } | null = null
    hr(`(5) Pestaña de datos${TABLA ? ` de ${TABLA}` : ''}: página 1 de ${MAX_FILAS}, Contar y página 2`)
    if (!TABLA) salta('pestaña de datos', 'no hay tabla con la que abrirla')
    else {
      const mp1 = await medir(
        'pestaña: página 1',
        PLAZO.datos,
        () => ex.abrirTabla({ conexionId: ID, peticionId: 'p1', objeto: { esquema: ESQ, nombre: TABLA, tipo: 'tabla' }, maxFilas: MAX_FILAS }),
        { stop: () => ex.cancelar({ rol: 'datos', conexionId: ID, peticionId: 'p1' }) }
      )
      const res = mp1.r.ok ? mp1.r.valor.resultado : null
      if (mp1.r.ok) edicionP1 = { identidad: mp1.r.valor.identidad, noEditables: mp1.r.valor.noEditables, columnas: res && res.tipo === 'filas' ? res.columnas.map((c) => c.nombre) : [] }
      const f1 = res && res.tipo === 'filas' ? res : null
      const n1 = f1 ? nFilas(f1.pagina.filasJson) : 0
      const errP1 = !mp1.r.ok ? descErr(mp1.r.error) : res && res.tipo === 'error' ? descErr(res.error) : '?'
      check(
        `página 1: hasta ${MAX_FILAS} filas, y lector si hay más`,
        f1 !== null && n1 >= 0 && n1 <= MAX_FILAS && f1.pagina.hayMas === (f1.lector !== null),
        f1
          ? `${n1} filas × ${f1.columnas.length} columnas, hayMas=${f1.pagina.hayMas}; servidor ${formatearMs(f1.tiempos.ejecucionMs)}, lectura ${formatearMs(f1.tiempos.lecturaMs)}` +
              (f1.avisos && f1.avisos.length > 0 ? ` — ${f1.avisos.join(' / ')}` : '')
          : errP1
      )
      const datos = ex.sesiones().find((s) => s.ref.rol === 'datos' && s.conexionId === ID)
      check('la sesión de datos es de solo lectura', datos?.soloLectura === true, `soloLectura=${String(datos?.soloLectura)}`)
      const lector = f1?.lector ?? null
      if (!lector) salta('Contar y página 2', `la tabla cabe en una página (${n1} filas)`)
      else {
        const mc = await medir('Contar', PLAZO.datos, () => ex.contar(lector, 'cuenta'), {
          stop: () => ex.cancelar({ rol: 'datos', conexionId: ID, peticionId: 'cuenta' })
        })
        check('Contar: un número, y no menos de lo ya leído', mc.r.ok && mc.r.valor >= n1, mc.r.ok ? `${mc.r.valor} filas` : descErr(mc.r.error))
        const mp2 = await medir('pestaña: página 2', PLAZO.datos, () => ex.leerMas(lector, MAX_FILAS, 'p2'), {
          stop: () => ex.cancelar({ rol: 'datos', conexionId: ID, peticionId: 'p2' })
        })
        const pg = mp2.r.ok ? mp2.r.valor : null
        const n2 = pg ? nFilas(pg.filasJson) : 0
        check(
          `página 2: del MISMO cursor, desde la fila ${n1 + 1}`,
          pg !== null && pg.desde === n1 && n2 > 0 && n2 <= MAX_FILAS && pg.reejecutada !== true,
          pg ? `${n2} filas desde ${pg.desde}, hayMas=${pg.hayMas}, reejecutada=${pg.reejecutada === true}` : mp2.r.ok ? '?' : descErr(mp2.r.error)
        )
        await ex.cerrarLector(lector)
      }
    }

    // --- (6) Consola ------------------------------------------------------------------------------
    hr('(6) Consola: un SELECT pequeño')
    const consola = await conPlazo(ex.crearConsola(PERFIL, ID), PLAZO.consola)
    const K = consola && consola.ok ? consola.valor.id : ''
    if (!K) check('crear una consola', false, consola ? (consola.ok ? '?' : descErr(consola.error)) : 'sin respuesta')
    else {
      const ms = await medir(
        `consola: ${SQL_CONSOLA}`,
        PLAZO.consola,
        () => ex.ejecutar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'e1', sql: SQL_CONSOLA, maxFilas: MAX_FILAS }),
        { stop: () => ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: K, ejecucionId: 'e1' }) }
      )
      const v = ms.r.ok ? ms.r.valor : null
      const filas = v && v.tipo === 'filas' ? v : null
      const est = ex.estadoConsola(PERFIL, K)
      const nf = filas ? nFilas(filas.pagina.filasJson) : -1
      check(
        '1 fila × 2 columnas, en una consola de solo lectura y sin transacción abierta',
        filas !== null && nf === 1 && filas.columnas.length === 2 && est?.soloLectura === true && est.tx === 'ninguna',
        filas
          ? `${nf} fila × ${filas.columnas.length} columnas; servidor ${formatearMs(filas.tiempos.ejecucionMs)}; soloLectura=${String(est?.soloLectura)}, tx=${est?.tx}`
          : !ms.r.ok
            ? descErr(ms.r.error)
            : v && v.tipo === 'error'
              ? descErr(v.error)
              : `resultado ${v?.tipo ?? '?'}`
      )
    }

    // --- (7) Guardia ----------------------------------------------------------------------------
    hr('(7) Guardia: el MAIN rechaza una escritura sin mandarla')
    if (!K) salta('guardia de solo lectura', 'no hay consola en la que probarla')
    else {
      const antes = vigilancia.ejecutar
      const sqlGuardia = `update ${INVENTADA} set x = 1 where 1 = 0`
      const mg = await medir(
        'guardia: UPDATE rechazado',
        PLAZO.guardia,
        () => ex.ejecutar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'e2', sql: sqlGuardia, maxFilas: MAX_FILAS }),
        { esperaRechazo: true }
      )
      check(
        'el main rechaza el UPDATE por solo lectura',
        !mg.r.ok && mg.r.error.motivo === 'soloLectura',
        mg.r.ok ? `¡pasó! resultado ${mg.r.valor.tipo}` : descErr(mg.r.error)
      )
      check(
        '… y no salió hacia el trabajador (ni llegó al centinela)',
        vigilancia.conCanario === 0 && vigilancia.ejecutar === antes,
        `peticiones con la tabla inventada: ${vigilancia.conCanario}; sentencias enviadas durante la guardia: ${vigilancia.ejecutar - antes}`
      )
    }

    // --- (7b) Edición de la rejilla ------------------------------------------------------
    // En solo lectura NO se edita: la pestaña de (5) dice identidad 'ninguna' y no trae la
    // columna oculta del ROWID, y «Enviar» lo rechaza el MAIN sin que salga NADA hacia el
    // trabajador (ni abrir la sesión de «Enviar», que el centinela además veta). Es el
    // canario: si algún día pasara, se vería aquí antes que en la base.
    hr('(7b) Edición: en solo lectura, identidad «ninguna» y «Enviar» sin llegar al trabajador')
    if (!TABLA || !edicionP1) salta('edición en solo lectura', 'no hay pestaña de datos con la que comprobarla')
    else {
      const ed = edicionP1 as { identidad: { tipo?: string; motivo?: string } | undefined; noEditables: unknown; columnas: string[] }
      check(
        "la pestaña de datos dice identidad 'ninguna' (solo lectura) y no trae la columna del ROWID",
        ed.identidad?.tipo === 'ninguna' && /solo lectura/.test(ed.identidad.motivo ?? '') && ed.noEditables === undefined && !ed.columnas.includes('__TESSERA_ROWID'),
        JSON.stringify({ identidad: ed.identidad, columnas: ed.columnas.length })
      )
      const antes = vigilancia.peticiones
      const me = await medir(
        'edición: «Enviar» rechazado',
        PLAZO.guardia,
        () =>
          ex.enviarCambios({
            conexionId: ID,
            peticionId: 'enviar-canario',
            objeto: { esquema: ESQ, nombre: TABLA, tipo: 'tabla' },
            identidad: { tipo: 'rowid', columna: '__TESSERA_ROWID' },
            cambios: [{ tipo: 'actualizar', clave: ['AAAAAAAAAAAAAAAAAA'], valores: { [INVENTADA]: 'x' } }],
            // Aunque diga «confirmado»: solo lectura manda sobre la confirmación.
            confirmado: true
          }),
        { esperaRechazo: true }
      )
      check('el main rechaza «Enviar» por solo lectura', !me.r.ok && me.r.error.motivo === 'soloLectura', me.r.ok ? `¡pasó! ${JSON.stringify(me.r.valor).slice(0, 120)}` : descErr(me.r.error))
      check(
        '… sin UNA sola petición al trabajador (ni abrir la sesión de «Enviar»)',
        vigilancia.peticiones === antes && vigilancia.conCanario === 0,
        `peticiones durante «Enviar»: ${vigilancia.peticiones - antes}; con la columna inventada: ${vigilancia.conCanario}`
      )
    }

    // --- (8) Autocompletado -----------------------------------------------------------------------
    hr('(8) Índices de autocompletado')
    const mn = await medir(`autocompletado: esquema ${ESQ}`, PLAZO.catalogo, () => ex.nombres(ID))
    check(
      'índice del esquema por defecto',
      mn.r.ok && mn.r.valor.esquemas.indexOf(ESQ) >= 0,
      mn.r.ok
        ? `${mn.r.valor.objetos.length} nombres en ${mn.r.valor.esquemas.length} esquema(s)${mn.r.valor.truncado ? ', TRUNCADO por el tope' : ''}`
        : descErr(mn.r.error)
    )
    const mpub = await medir('autocompletado: sinónimos PUBLIC', PLAZO.publicos, () => ex.nombresPublicos(ID))
    check('índice de sinónimos PUBLIC', mpub.r.ok && mpub.r.valor.length > 0, mpub.r.ok ? `${mpub.r.valor.length} nombres` : descErr(mpub.r.error))

    // --- (9) Fuente de un paquete ---------------------------------------------------------------
    hr('(9) Fuente de un paquete')
    const paquetes = listados.paquete ?? []
    if (paquetes.length === 0) salta('fuente de un paquete', `el esquema ${ESQ} no tiene paquetes`)
    else {
      const PKG = paquetes[0]
      info.paquete = PKG
      console.log(`  paquete: ${PKG}`)
      const mf = await medir('fuente del paquete', PLAZO.catalogo, () => ex.fuente(ID, { esquema: ESQ, nombre: PKG, tipo: 'paquete' }))
      const f = mf.r.ok ? mf.r.valor : null
      check(
        'la especificación primero (y el cuerpo, si se ve)',
        f !== null && f.partes.length >= 1 && f.partes[0].titulo === 'Especificación',
        f
          ? f.partes.map((p) => `${p.titulo}: ${nLineas(p.texto)} líneas`).join(', ') + (f.aviso ? ` — aviso: ${f.aviso}` : '')
          : mf.r.ok
            ? '?'
            : descErr(mf.r.error)
      )
    }

    // --- (14) Esquema de la consola (segunda entrega) -------------------------------------------
    hr('(14) Esquema de la consola: fijarlo, comprobarlo en el servidor y volver')
    const otro = esq.esquemas.find((e) => !e.sistema && !e.pseudo && e.nombre !== ESQ)?.nombre ?? null
    if (!K) salta('esquema de la consola', 'no hay consola')
    else if (!otro) salta('esquema de la consola', 'la conexión no ve otro esquema que no sea del sistema')
    else {
      console.log(`  esquema elegido: ${otro}`)
      const mfe = await medir('esquema de la consola: fijar', PLAZO.consola, () => ex.esquemaConsola(PERFIL, K, otro))
      const sqlActual = "select sys_context('USERENV', 'CURRENT_SCHEMA') from dual"
      const mq = await medir('consola: CURRENT_SCHEMA', PLAZO.consola, () =>
        ex.ejecutar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'e3', sql: sqlActual, maxFilas: 1 })
      )
      const fila = mq.r.ok && mq.r.valor.tipo === 'filas' ? (JSON.parse(mq.r.valor.pagina.filasJson) as unknown[][])[0] : null
      const lista = await conPlazo(ex.listarConsolas(PERFIL), PLAZO.consola)
      const guardado = lista && lista.ok ? lista.valor.find((c) => c.id === K)?.esquema : undefined
      check(
        'fijar el esquema: la sesión, el servidor y el índice de consolas lo dicen',
        mfe.r.ok && mfe.r.valor.esquema === otro && fila !== null && fila[0] === otro && guardado === otro,
        mfe.r.ok
          ? `sesión=${mfe.r.valor.esquema}, servidor=${String(fila?.[0])}, índice=${String(guardado)}`
          : descErr(mfe.r.error)
      )
      const mvu = await medir('esquema de la consola: volver', PLAZO.consola, () => ex.esquemaConsola(PERFIL, K, null))
      check(
        'volver al esquema de la conexión',
        mvu.r.ok && mvu.r.valor.esquema === ESQ,
        mvu.r.ok ? `sesión=${mvu.r.valor.esquema}` : descErr(mvu.r.error)
      )
    }

    // --- (15) Un CLOB en 11.2: abrir la tabla y el valor completo (segunda entrega) ------------
    hr('(15) Tabla con CLOB y clave primaria: pestaña de datos y valor completo')
    const tablasSet = new Set(tablas)
    const candClob = await medir('buscar una tabla con CLOB (estadísticas)', PLAZO.catalogo, () =>
      comoRespuesta(() =>
        ex.gestor.catalogo(
          ID,
          (c) =>
            c.consultar({
              sql: [
                'SELECT table_name, column_name FROM (',
                '  SELECT c.table_name, c.column_name FROM all_tab_columns c, all_tab_statistics s',
                "   WHERE c.owner = :esq AND c.data_type = 'CLOB'",
                "     AND s.owner = c.owner AND s.table_name = c.table_name AND s.object_type = 'TABLE'",
                '     AND s.num_rows BETWEEN 1 AND 1000000',
                '   ORDER BY s.num_rows, c.table_name, c.column_id',
                ') WHERE ROWNUM <= 20'
              ].join('\n'),
              binds: { esq: ESQ }
            }),
          { prioridad: 'alta' }
        )
      )
    )
    let clob: { tabla: string; columna: string } | null = null
    if (candClob.r.ok) {
      for (const f of candClob.r.valor) {
        const tabla = String(f[0])
        if (!tablasSet.has(tabla)) continue
        const cols = await medir(`columnas de ${tabla}`, PLAZO.catalogo, () =>
          ex.detalle(ID, { esquema: ESQ, nombre: tabla, tipo: 'tabla' }, ['columnas'])
        )
        if (cols.r.ok && (cols.r.valor.columnas ?? []).some((c) => c.pk !== null)) {
          clob = { tabla, columna: String(f[1]) }
          break
        }
      }
    }
    if (!clob) {
      salta('tabla con CLOB', candClob.r.ok ? `el esquema ${ESQ} no tiene una tabla con CLOB, PK y estadísticas` : descErr(candClob.r.error))
    } else {
      console.log(`  tabla: ${clob.tabla}, columna ${clob.columna}`)
      const objClob = { esquema: ESQ, nombre: clob.tabla, tipo: 'tabla' as const }
      const mpc = await medir(
        'pestaña con CLOB: página 1',
        PLAZO.datos,
        () => ex.abrirTabla({ conexionId: ID, peticionId: 'pc', objeto: objClob, maxFilas: 20 }),
        { stop: () => ex.cancelar({ rol: 'datos', conexionId: ID, peticionId: 'pc' }) }
      )
      const tab = mpc.r.ok ? mpc.r.valor : null
      const res = tab?.resultado
      check(
        'una tabla con CLOB abre en la rejilla (el fallo de las clases thin tras escalar a thick)',
        res !== undefined && res.tipo === 'filas',
        res && res.tipo === 'filas'
          ? `${nFilas(res.pagina.filasJson)} filas × ${res.columnas.length} columnas`
          : res && res.tipo === 'error'
            ? descErr(res.error)
            : mpc.r.ok
              ? '?'
              : descErr(mpc.r.error)
      )
      if (tab && res && res.tipo === 'filas') {
        if (res.lector) await ex.cerrarLector(res.lector)
        const filas = JSON.parse(res.pagina.filasJson) as unknown[][]
        const iCol = res.columnas.findIndex((c) => c.nombre === clob.columna)
        const iPk = tab.clavePrimaria.map((n) => res.columnas.findIndex((c) => c.nombre === n))
        const iFila = filas.findIndex((f) => typeof f[iCol] === 'string' && (f[iCol] as string).length > 0)
        if (iCol < 0 || iPk.some((i) => i < 0) || iFila < 0) {
          salta('valor completo del CLOB', 'ninguna de las primeras 20 filas tiene el CLOB con texto')
        } else {
          const recorte = res.pagina.recortes?.find(([f, c]) => f === iFila && c === iCol)
          const mv = await medir('valor completo del CLOB', PLAZO.datos, () =>
            ex.valor({
              conexionId: ID,
              objeto: tab.objeto,
              clave: iPk.map((i) => filas[iFila][i] as string),
              columna: clob.columna
            })
          )
          const enRejilla = (filas[iFila][iCol] as string).length
          const esperado = recorte ? recorte[2] : enRejilla
          check(
            'el valor completo llega entero, por la clave primaria',
            mv.r.ok && mv.r.valor.valor !== null && mv.r.valor.valor.length === esperado && mv.r.valor.recortado === false,
            mv.r.ok
              ? `${mv.r.valor.valor?.length ?? 0} caracteres (rejilla ${enRejilla}${recorte ? `, recortado de ${recorte[2]}` : ''}), tipo ${mv.r.valor.tipoLogico}`
              : descErr(mv.r.error)
          )
        }
      }
    }

    // --- (16) Exportar (segunda entrega) -----------------------------------------------------
    hr(`(16) Exportar${TABLA ? ` ${TABLA}` : ''}: la tabla filtrada a CSV y una consulta de la consola a JSON`)
    if (!TABLA) salta('exportar', 'no hay tabla')
    else {
      const objTabla = { esquema: ESQ, nombre: TABLA, tipo: 'tabla' as const }
      const me = await medir('exportar la tabla (ROWNUM <= 1500) a CSV', PLAZO.datos, () =>
        ex.exportar({
          peticionId: 'x1',
          origen: { tipo: 'tabla', conexionId: ID, objeto: objTabla, where: 'ROWNUM <= 1500' },
          formato: 'csv',
          nombreSugerido: `${ESQ}.${TABLA}`,
          motor: 'oracle'
        })
      )
      const hecho = me.r.ok ? me.r.valor : null
      const csv = hecho ? readFileSync(path.join(tmp, 'exportados', hecho.archivo), 'utf8') : ''
      const lineasCsv = csv.split('\r\n').filter((l, i, a) => i < a.length - 1 || l !== '')
      check(
        'CSV: BOM, cabecera y una línea por fila exportada (como mucho 1500)',
        hecho !== null && csv.charCodeAt(0) === 0xfeff && lineasCsv.length === hecho.filas + 1 && hecho.filas <= 1500 && !hecho.archivo.includes(path.sep),
        hecho ? `${hecho.filas} filas, ${hecho.bytes} bytes, archivo «${hecho.archivo}»` : me.r.ok ? 'cancelado' : descErr(me.r.error)
      )
      if (!K) salta('exportar una consulta de la consola', 'no hay consola')
      else {
        const sqlExp = `select * from "${ESQ.replace(/"/g, '""')}"."${TABLA.replace(/"/g, '""')}" where rownum <= 1200`
        const mj = await medir('exportar una consulta de la consola a JSON', PLAZO.datos, () =>
          ex.exportar({
            peticionId: 'x2',
            origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: K, sql: sqlExp },
            formato: 'json',
            nombreSugerido: 'Resultado 1',
            motor: 'oracle'
          })
        )
        const hj = mj.r.ok ? mj.r.valor : null
        let n = -1
        try {
          if (hj) n = (JSON.parse(readFileSync(path.join(tmp, 'exportados', hj.archivo), 'utf8')) as unknown[]).length
        } catch {
          n = -2
        }
        check(
          'JSON: un array con una entrada por fila, re-ejecutada en la sesión de la consola',
          hj !== null && n === hj.filas && n <= 1200,
          hj ? `${hj.filas} filas, ${n} objetos en el archivo` : mj.r.ok ? 'cancelado' : descErr(mj.r.error)
        )
        const estC = ex.estadoConsola(PERFIL, K)
        check('la consola sigue de solo lectura y sin transacción', estC?.soloLectura === true && estC.tx === 'ninguna', `soloLectura=${String(estC?.soloLectura)}, tx=${estC?.tx}`)
      }
    }

    // --- (17) Ver DDL (DBMS_METADATA: 2-5 s por tabla en XE, así que va tarde) --------------------
    hr(`(17) «Ver DDL»${TABLA ? ` de ${TABLA}` : ''}`)
    if (!TABLA) salta('«Ver DDL»', 'no hay tabla')
    else {
      const mdd = await medir('Ver DDL de la tabla', PLAZO.catalogo, () => ex.ddl(ID, { esquema: ESQ, nombre: TABLA, tipo: 'tabla' }))
      const f = mdd.r.ok ? mdd.r.valor : null
      check(
        'el DDL de la tabla: CREATE TABLE con su nombre',
        f !== null && f.partes.length === 1 && f.partes[0].titulo === 'DDL' && /CREATE TABLE/i.test(f.partes[0].texto) && f.partes[0].texto.includes(TABLA),
        f ? `${nLineas(f.partes[0]?.texto ?? '')} líneas, origen ${f.origen}${f.aviso ? ` — aviso: ${f.aviso}` : ''}` : mdd.r.ok ? '?' : descErr(mdd.r.error)
      )
    }

    // --- (18) Parámetros ------------------------------------------------------------
    hr(`(18) Consola con un parámetro: ${TABLA ? `${TABLA} where rownum <= :n` : '(sin tabla)'}`)
    const tablaCitada = TABLA ? `"${ESQ.replace(/"/g, '""')}"."${TABLA.replace(/"/g, '""')}"` : ''
    const sqlBind = `select * from ${tablaCitada} where rownum <= :n`
    if (!K || !TABLA) salta('consola con un parámetro', !K ? 'no hay consola' : 'no hay tabla')
    else {
      const mb = await medir(
        'consola: SELECT con :n = 5',
        PLAZO.consola,
        () => ex.ejecutar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'e4', sql: sqlBind, maxFilas: MAX_FILAS, binds: { N: '5' } }),
        { stop: () => ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: K, ejecucionId: 'e4' }) }
      )
      const vb = mb.r.ok ? mb.r.valor : null
      check(
        'el bind llega: como mucho 5 filas',
        vb !== null && vb.tipo === 'filas' && nFilas(vb.pagina.filasJson) <= 5,
        vb && vb.tipo === 'filas' ? `${nFilas(vb.pagina.filasJson)} filas` : vb && vb.tipo === 'error' ? descErr(vb.error) : mb.r.ok ? '?' : descErr(mb.r.error)
      )
      const antesB = vigilancia.ejecutar
      const mf = await medir(
        'consola: SELECT sin el valor de :n (rechazado)',
        PLAZO.guardia,
        () => ex.ejecutar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'e5', sql: sqlBind, maxFilas: MAX_FILAS }),
        { esperaRechazo: true }
      )
      check(
        'sin el valor: «parametros» del MAIN y no sale nada hacia el trabajador',
        !mf.r.ok && mf.r.error.motivo === 'parametros' && vigilancia.ejecutar === antesB,
        mf.r.ok ? `¡pasó! resultado ${mf.r.valor.tipo}` : `${descErr(mf.r.error)}; enviadas: ${vigilancia.ejecutar - antesB}`
      )
    }

    // --- (19) Explain en solo lectura -----------------------------------------------
    hr('(19) Explain de un SELECT: EXPLAIN PLAN (que el centinela deja pasar exacto) y se revierte')
    if (!K || !TABLA) salta('Explain', !K ? 'no hay consola' : 'no hay tabla')
    else {
      const vetosAntes = vigilancia.vetos.length
      const mx = await medir(
        'Explain de un SELECT con :n',
        PLAZO.consola,
        () => ex.explicar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'x1', sql: sqlBind }),
        { stop: () => ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: K, ejecucionId: 'x1' }) }
      )
      const plan = mx.r.ok ? mx.r.valor : null
      const estX = ex.estadoConsola(PERFIL, K)
      check(
        'el plan: nodos (la raíz sin padre, la tabla) y el texto de DBMS_XPLAN',
        plan !== null && plan.nodos.length > 0 && plan.nodos[0].padre === null && plan.nodos.some((x) => (x.objeto ?? '').endsWith(`.${TABLA}`)) && /Plan hash value/.test(plan.texto),
        plan
          ? `${plan.nodos.length} pasos: ${plan.nodos.slice(0, 4).map((x) => `${x.operacion}${x.opciones ? ` ${x.opciones}` : ''}`).join(' | ')}; servidor ${formatearMs(plan.tiempos.ejecucionMs)}, lectura ${formatearMs(plan.tiempos.lecturaMs)}`
          : mx.r.ok
            ? '?'
            : descErr(mx.r.error)
      )
      check(
        'el centinela lo dejó pasar y la consola sigue de solo lectura y sin transacción (se revirtió)',
        vigilancia.vetos.length === vetosAntes && estX?.soloLectura === true && estX.tx === 'ninguna',
        `vetos nuevos: ${vigilancia.vetos.length - vetosAntes}; soloLectura=${String(estX?.soloLectura)}, tx=${estX?.tx}`
      )
      const trasX = await medir(
        `consola tras el Explain: ${SQL_CONSOLA}`,
        PLAZO.consola,
        () => ex.ejecutar({ perfilId: PERFIL, consolaId: K, ejecucionId: 'e6', sql: SQL_CONSOLA, maxFilas: MAX_FILAS }),
        { stop: () => ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: K, ejecucionId: 'e6' }) }
      )
      check('y la consola sigue funcionando con su candado', trasX.r.ok && trasX.r.valor.tipo === 'filas', trasX.r.ok ? trasX.r.valor.tipo : descErr(trasX.r.error))
    }

    // --- (20) Historial --------------------------------------------------------------
    hr('(20) Historial de la consola (en el temporal del smoke)')
    if (!K) salta('historial', 'no hay consola')
    else {
      await ex.historial?.esperar()
      const mh = await medir('historial: listar', PLAZO.guardia, () => ex.historialListar({ perfilId: PERFIL }))
      const lista = mh.r.ok ? mh.r.valor : []
      check(
        'lo ejecutado está (el SELECT con :n guarda el texto, no el valor) y el Explain y los rechazos no',
        lista.some((x) => x.sql === SQL_CONSOLA && x.resultado === 'ok') &&
          (!TABLA || lista.filter((x) => x.sql === sqlBind).length === 1) &&
          !lista.some((x) => x.sql.includes(INVENTADA)),
        `${lista.length} entradas: ${lista.map((x) => x.resultado).join(', ')}`
      )
    }

    // --- (21) Claves ajenas ----------------------------------------------------------
    hr(`(21) Claves ajenas de ${TABLA || 'una tabla'} (tres consultas cortas; RULE solo en las entrantes de la 11g)`)
    if (!TABLA) salta('claves ajenas', 'no hay tabla')
    else {
      const mk = await medir('claves ajenas de la tabla', PLAZO.catalogo, () => ex.fks(ID, { esquema: ESQ, nombre: TABLA, tipo: 'tabla' }))
      const rel = mk.r.ok ? mk.r.valor : null
      check(
        'salientes y entrantes, cada una con sus columnas',
        rel !== null && [...rel.salientes, ...rel.entrantes].every((f) => f.desde.columnas.length > 0 && f.desde.columnas.length === f.hacia.columnas.length),
        rel ? `${rel.salientes.length} salientes, ${rel.entrantes.length} entrantes` : descErr((mk.r as { ok: false; error: DbErrorSql }).error)
      )
      // la consulta única con OR tardaba 2,6-2,9 s contra la base remota (y de 45 s a más de
      // 5 min en un Docker 11.2 con un diccionario grande); las tres cortas, 33-40 ms allí.
      // El tope deja sitio a los tres viajes por la VPN y caza la vuelta a lo de antes.
      check('las claves ajenas, por debajo de 1,5 s (antes 2,6-2,9 s contra esta base)', mk.r.ok && mk.ms < 1500, formatearMs(mk.ms))
      const mk2 = await medir('claves ajenas otra vez (caché)', PLAZO.guardia, () => ex.fks(ID, { esquema: ESQ, nombre: TABLA, tipo: 'tabla' }))
      check('la segunda vez sale de la caché', mk2.r.ok && mk2.ms < 50, `${formatearMs(mk2.ms)}`)
    }

    // --- (10) Objetos: vistas (lento en 11g, ver la cabecera) --------------------------------
    hr('(10) Objetos de la carpeta de vistas (lento en 11g: va al final)')
    await listar('vista')

    // --- (11) Detalle de la tabla (lo más lento medido, lo último) ------------------------------
    hr(`(11) Detalle de ${TABLA || 'una tabla'} (las restricciones son lo más lento medido: va lo último)`)
    if (!TABLA) salta('detalle de una tabla', 'no hay tabla')
    else {
      const md = await medir(
        'detalle de la tabla',
        PLAZO.detalle,
        () => ex.detalle(ID, { esquema: ESQ, nombre: TABLA, tipo: 'tabla' }, ['columnas', 'indices', 'restricciones'])
      )
      const d = md.r.ok ? md.r.valor : null
      const cols = d?.columnas ?? []
      check(
        'detalle: columnas, índices y restricciones',
        d !== null && cols.length > 0,
        d
          ? `${cols.length} columnas (${cols.filter((c) => c.pk !== null).length} en la PK), ${d.indices?.length ?? 0} índices, ${d.restricciones?.length ?? 0} restricciones`
          : md.r.ok
            ? '?'
            : descErr(md.r.error)
      )
    }
  } catch (e) {
    if (e instanceof Abortar) salta('el resto del smoke', e.message)
    else check('sin excepciones inesperadas', false, e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await cerrarYComprobar()
  clearTimeout(tope)
  finalizar()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
