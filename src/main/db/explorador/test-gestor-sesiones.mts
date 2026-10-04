#!/usr/bin/env node
// =============================================================================
// Prueba del gestor de sesiones del explorador (`GestorSesiones.ts` y `sesiones/`) con un
// TRANSPORTE FALSO: cada proceso es un `TrabajadorFalso` que apunta los mensajes y responde lo
// que diga el caso (o lo deja en suspenso para ver colas, Stop y caídas). Fija la fontanería y
// la autoridad del main: mensajes al trabajador en su orden, transacciones, pérdidas, lectores,
// exportar, «Enviar», producción y solo lectura impuesta. El trabajador real: `test-db-*.mts`.
// (npm run test:db-gestor)
// =============================================================================

import type { DbConnection } from '../../../shared/db-ipc.ts'
import { MOTORES } from '../../../shared/motores/index.ts'
import type {
  DbBinds,
  DbEntradaHistorial,
  DbEstadoSesion,
  DbEstadoTx,
  DbResultadoError,
  DbResultadoFilas,
  DbTxModo
} from '../../../shared/db-explorador-ipc.ts'
import {
  AVISO_BINDS_ORACLE,
  PREFIJO_EXPLICAR_PG,
  SQL_NODOS_ORACLE,
  SQL_PUNTO_PG,
  SQL_SOLTAR_PUNTO_PG,
  SQL_TEXTO_ORACLE,
  SQL_VOLVER_AL_PUNTO_PG
} from './planSql.ts'
import {
  ErrorGestor,
  GestorSesiones,
  MENSAJE_ESQUEMA_CAMBIADO,
  MENSAJE_SIN_LECTOR,
  versionMayor,
  type PeticionTabla,
  type RefConsola,
  type TrabajadorGestor
} from './GestorSesiones.ts'
import { mensajeFilaBloqueada, MOTIVO_SOLO_LECTURA, notaSinCulpable } from './edicionRejilla.ts'
import { MAX_LECTORES_POR_SESION, MAX_PROCESOS, MAX_PROCESOS_CONSOLA, PROCESO_SIN_SESIONES_MS } from './limites.ts'
import { MENSAJES } from './maquinaSesion.ts'
import { MOTORES_EXPLORADOR } from './motores/index.ts'
import { vetarPeticion } from './lecturaSegura.ts'
import { soloLecturaEnTodas, type SoloLecturaImpuesta } from './soloLecturaImpuesta.ts'
import type { DbFiltroGuiado, DbOrdenColumna } from '../../../shared/filtroGuiado.ts'
import {
  CODIGO_LECTOR_DESCONOCIDO,
  FalloTrabajador,
  type ErrorTrabajador,
  type EventoTrabajador,
  type OpTrabajador,
  type PeticionSinId,
  type PeticionSinIdDe,
  type RespuestasPorOp,
  type ResultadoTrabajador
} from './protocoloTrabajador.ts'

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

// --- Utilidades -------------------------------------------------------------------------

const SECRETO = 'S3cr3t-muy-largo-9f8e7d6c'

class Diferido<T = unknown> {
  promesa: Promise<T>
  resolver!: (v: T) => void
  rechazar!: (e: unknown) => void
  constructor() {
    this.promesa = new Promise<T>((res, rej) => {
      this.resolver = res
      this.rechazar = rej
    })
    // Un rechazo que nadie espera (proceso muerto) no debe tumbar el test.
    this.promesa.catch(() => {})
  }
}

const tic = (): Promise<void> => new Promise((r) => setImmediate(r))
async function esperarA(cond: () => boolean, max = 200): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if (cond()) return true
    await tic()
  }
  return cond()
}

function fallo(clase: ErrorTrabajador['clase'], extra: Partial<ErrorTrabajador> = {}, op: OpTrabajador = 'ejecutar'): FalloTrabajador {
  return new FalloTrabajador({ clase, mensaje: extra.mensaje ?? `fallo ${clase}`, ...extra }, op)
}

function rFilas(n: number, extra: Partial<Extract<ResultadoTrabajador, { tipo: 'filas' }>> = {}): ResultadoTrabajador {
  return {
    tipo: 'filas',
    columnas: [{ nombre: 'a', tipoLogico: 'numero', tipoMotor: 'int4' }],
    filasJson: JSON.stringify(Array.from({ length: n }, (_, i) => [String(i)])),
    nFilas: n,
    hayMas: false,
    lector: null,
    comando: 'SELECT',
    msEjecucion: 1,
    msLectura: 1,
    tx: 'ninguna',
    ...extra
  }
}

function conexion(id: string, extra: Partial<DbConnection> = {}): DbConnection {
  return {
    id,
    profileId: 'perfil1',
    alias: `ALIAS-${id}`,
    motor: 'postgres',
    host: 'servidor.local',
    port: 5432,
    database: 'db',
    user: 'usuario',
    tieneSecreto: true,
    readonly: false,
    ...extra
  }
}

type Responder = (p: PeticionSinId, f: TrabajadorFalso) => unknown

/** Lo que responde un trabajador sano si el caso no dice otra cosa. */
function respuestaPorDefecto(p: PeticionSinId, f: TrabajadorFalso): unknown {
  switch (p.op) {
    case 'abrir':
      return {
        modo: f.conexion.motor === 'oracle' ? 'thin' : 'nativo',
        driverId: f.conexion.driverId ?? null,
        version: f.conexion.motor === 'oracle' ? '19.3.0.0.0' : '16.4',
        esquema: f.conexion.motor === 'oracle' ? 'SCOTT' : 'public',
        usuario: 'usuario'
      }
    case 'ejecutar':
      if (p.opciones.proposito === 'catalogo') return rFilas(1)
      if (/^\s*(update|insert|delete)/i.test(p.sql)) return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: 'ninguna' }
      if (/^\s*(select|with)/i.test(p.sql)) return rFilas(2)
      return { tipo: 'hecho', comando: null, ms: 1, tx: 'ninguna' }
    case 'tx':
      return { tx: 'ninguna' }
    case 'cerrar':
      return { cerrada: true }
    case 'cancelar':
      return { cancelada: true }
    case 'cerrarLector':
      return { cerrado: true }
    case 'leer':
      return { filasJson: '[]', nFilas: 0, hayMas: false, lector: null, ms: 1 }
    case 'autoCommit':
      return { autoCommit: true, tx: 'ninguna' }
    default:
      return {}
  }
}

class TrabajadorFalso implements TrabajadorGestor {
  readonly conexion: DbConnection
  readonly mensajes: PeticionSinId[] = []
  vivo = false
  arrancado = false
  private enVuelo = 0
  private readonly diferidos = new Set<Diferido>()
  private readonly oyentesEvento = new Set<(e: EventoTrabajador) => void>()
  private readonly oyentesSalida = new Set<(s: { codigo: number | null; senal: string | null }) => void>()
  responder: Responder

  constructor(conexion: DbConnection, responder: Responder) {
    this.conexion = conexion
    this.responder = responder
  }

  get pendientes(): number {
    return this.enVuelo
  }

  async arrancar(): Promise<unknown> {
    this.arrancado = true
    this.vivo = true
    return { v: 1, pid: 4242, versiones: { node: 'falso' } }
  }

  async enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>): Promise<RespuestasPorOp[O]> {
    const p = peticion as PeticionSinId
    this.mensajes.push(JSON.parse(JSON.stringify(p)) as PeticionSinId)
    if (!this.vivo) throw fallo('perdida', { codigo: 'TESSERA-PROCESO', mensaje: 'El proceso no está en marcha.' }, p.op)
    this.enVuelo++
    try {
      if (p.op === 'cancelar') {
        // El Stop interrumpe lo que esté en suspenso, como un break() o un CancelRequest.
        for (const d of [...this.diferidos]) d.rechazar(fallo('cancelada', { codigo: '57014', mensaje: 'cancelada por el usuario' }))
      }
      if (p.op === 'salir') {
        this.morir(0, null)
        return { saliendo: true } as RespuestasPorOp[O]
      }
      let r = this.responder(p, this)
      if (r instanceof Diferido) {
        this.diferidos.add(r)
        try {
          r = await r.promesa
        } finally {
          this.diferidos.delete(r as Diferido)
        }
      }
      return r as RespuestasPorOp[O]
    } finally {
      this.enVuelo--
    }
  }

  onEvento(cb: (e: EventoTrabajador) => void): () => void {
    this.oyentesEvento.add(cb)
    return () => this.oyentesEvento.delete(cb)
  }

  onSalida(cb: (s: { codigo: number | null; senal: string | null }) => void): () => void {
    this.oyentesSalida.add(cb)
    return () => this.oyentesSalida.delete(cb)
  }

  emitirEvento(e: EventoTrabajador): void {
    for (const cb of [...this.oyentesEvento]) cb(e)
  }

  async salir(): Promise<void> {
    if (!this.vivo) return
    this.mensajes.push({ op: 'salir' })
    this.morir(0, null)
  }

  /** Como `ProcesoTrabajador.matar`: con `motivo`, lo que está en vuelo se rechaza con él (Stop de SQLite). */
  matar(motivo?: ErrorTrabajador): void {
    this.morir(null, 'SIGKILL', motivo)
  }

  morir(codigo: number | null, senal: string | null, motivo?: ErrorTrabajador): void {
    if (!this.vivo) return
    this.vivo = false
    for (const d of [...this.diferidos]) {
      d.rechazar(motivo ? new FalloTrabajador(motivo, 'ejecutar') : fallo('perdida', { codigo: 'TESSERA-PROCESO', mensaje: 'El proceso terminó.' }))
    }
    for (const cb of [...this.oyentesSalida]) cb({ codigo, senal })
  }

  ops(op: OpTrabajador): PeticionSinId[] {
    return this.mensajes.filter((m) => m.op === op)
  }

  ejecutados(): Array<PeticionSinIdDe<'ejecutar'>> {
    return this.mensajes.filter((m): m is PeticionSinIdDe<'ejecutar'> => m.op === 'ejecutar')
  }
}

interface Entorno {
  gestor: GestorSesiones
  conexiones: Map<string, DbConnection>
  falsos: TrabajadorFalso[]
  eventos: DbEstadoSesion[]
  logs: string[]
  abiertas: Array<[string, string | null]>
  ddl: Array<[string, string | null, boolean]>
  responder: { actual: Responder }
  reloj: { t: number }
  /** `alPerderEsquema`: [consolaId, esquema] de cada esquema olvidado. */
  perdidos: Array<[string, string]>
  /** `alSentencia`: lo que se anotaría en el historial. */
  historial: Array<Omit<DbEntradaHistorial, 'id'>>
}

interface OpcionesEntorno {
  /**
   * `consolaId` -> esquema elegido: lo que el controlador da por `esquemaDeConsola`.
   * `alPerderEsquema` lo borra, como el controlador.
   */
  esquemas?: Map<string, string>
  /**
   * La solo lectura que IMPONE el explorador (`soloLecturaImpuesta.ts`). Ausente, la de este
   * test: `(c) => c.readonly`, para que sus secciones sigan fijando la maquinaria de solo
   * lectura (la que usa el humo remoto) mezclando conexiones de las dos clases en un mismo
   * gestor. `null` = la del PRODUCTO (no se pasa nada: ninguna), la de la sección (34).
   */
  soloLecturaImpuesta?: SoloLecturaImpuesta | null
}

function entorno(conexiones: DbConnection[], op: OpcionesEntorno = {}): Entorno {
  const mapa = new Map(conexiones.map((c) => [c.id, c]))
  const falsos: TrabajadorFalso[] = []
  const eventos: DbEstadoSesion[] = []
  const logs: string[] = []
  const abiertas: Array<[string, string | null]> = []
  const ddl: Array<[string, string | null, boolean]> = []
  const perdidos: Array<[string, string]> = []
  const historial: Array<Omit<DbEntradaHistorial, 'id'>> = []
  const responder = { actual: respuestaPorDefecto as Responder }
  const reloj = { t: 1_000_000 }
  const esquemas = op.esquemas
  const gestor = new GestorSesiones({
    lanzar: (con) => {
      const f = new TrabajadorFalso(con, (p, t) => responder.actual(p, t))
      falsos.push(f)
      return f
    },
    conexion: (id) => mapa.get(id),
    secreto: (id) => (mapa.has(id) ? SECRETO : null),
    ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
    emitirSesion: (e) => eventos.push(e),
    alAbrir: (id, driverId) => abiertas.push([id, driverId]),
    alDdl: (id, esquema, global) => ddl.push([id, esquema, global]),
    ...(esquemas
      ? {
          esquemaDeConsola: (_perfilId: string, consolaId: string) => esquemas.get(consolaId) ?? null,
          alPerderEsquema: (_perfilId: string, consolaId: string, esquema: string) => {
            perdidos.push([consolaId, esquema])
            esquemas.delete(consolaId)
          }
        }
      : {}),
    alSentencia: (e) => historial.push(e),
    ahora: () => (reloj.t += 1),
    log: (l) => logs.push(l),
    ...(op.soloLecturaImpuesta === null ? {} : { soloLecturaImpuesta: op.soloLecturaImpuesta ?? ((c: DbConnection) => c.readonly) })
  })
  return { gestor, conexiones: mapa, falsos, eventos, logs, abiertas, ddl, responder, reloj, perdidos, historial }
}

/** `"ventas", public` -> ['ventas', 'public'] (lo que escribe `searchPathDe` o el usuario). */
function listaDePath(texto: string): string[] {
  return texto
    .split(',')
    .map((x) => x.trim().replace(/^"|"$/g, ''))
    .filter((x) => x !== '')
}

/** El `search_path` de UNA sesión del PG de mentira. */
interface SesionPgFalsa {
  confirmado: string[]
  actual: string[]
  enTx: boolean
}

/**
 * Un PostgreSQL de mentira con `search_path` TRANSACCIONAL, lo justo para el esquema de
 * la consola (sección (19)): por sesión, `confirmado` es el de fuera de la tx y `actual`
 * el de ahora; un ROLLBACK (sentencia o botón) vuelve al confirmado y un COMMIT
 * confirma el actual. Como PG, `current_schema()` es el primero del path que EXISTE.
 */
class PgEsquemaFalso {
  readonly sesiones = new Map<string, SesionPgFalsa>()
  readonly existen = new Set(['public', 'ventas', 'compras'])
  /** [sesión, esquema] en el que cayó cada INSERT sin calificar. */
  readonly inserts: Array<[string, string | null]> = []
  /** La relectura de `current_schema()` no llega: el trabajador responde null. */
  relecturaRota = false
  /** Se llama con cada `set_config` antes de responder (para simular una pérdida). */
  alFijar: ((p: PeticionSinIdDe<'ejecutar'>, f: TrabajadorFalso) => void) | null = null

  de(id: string): SesionPgFalsa {
    let s = this.sesiones.get(id)
    if (!s) {
      s = { confirmado: ['public'], actual: ['public'], enTx: false }
      this.sesiones.set(id, s)
    }
    return s
  }

  esquemaDe(id: string): string | null {
    return this.de(id).actual.find((e) => this.existen.has(e)) ?? null
  }

  private fijar(s: SesionPgFalsa, path: string[]): void {
    s.actual = path
    if (!s.enTx) s.confirmado = path
  }

  readonly responder: Responder = (p, f) => {
    if (p.op === 'abrir') {
      this.sesiones.delete(p.sesion)
      return respuestaPorDefecto(p, f)
    }
    if (p.op === 'tx') {
      const s = this.de(p.sesion)
      if (p.accion === 'rollback') {
        s.enTx = false
        s.actual = s.confirmado
      } else if (p.accion === 'commit') {
        s.enTx = false
        s.confirmado = s.actual
      }
      return { tx: s.enTx ? 'pendiente' : 'ninguna' }
    }
    if (p.op !== 'ejecutar') return respuestaPorDefecto(p, f)
    const s = this.de(p.sesion)
    const sql = p.sql.trim()
    const tx = (): DbEstadoTx => (s.enTx ? 'pendiente' : 'ninguna')
    const conEsquema = (r: object): object =>
      p.opciones.leerEsquema ? { ...r, esquema: this.relecturaRota ? null : this.esquemaDe(p.sesion) } : r
    if (/^SELECT set_config\('search_path'/.test(sql)) {
      this.fijar(s, listaDePath(String((p.binds as unknown[])[0])))
      this.alFijar?.(p, f)
      return conEsquema(rFilas(1))
    }
    if (/^RESET search_path$/i.test(sql)) {
      this.fijar(s, ['public'])
      return conEsquema({ tipo: 'hecho', comando: 'RESET', ms: 1, tx: tx() })
    }
    if (p.opciones.proposito === 'catalogo') return conEsquema(rFilas(1))
    // Una sentencia del usuario: el BEGIN perezoso del modo Manual, como el trabajador.
    if (p.opciones.txManual === true && p.opciones.sinBegin !== true) s.enTx = true
    let m: RegExpExecArray | null
    if (/^(begin|start\s+transaction)\b/i.test(sql)) s.enTx = true
    else if (/^(commit|end)\b/i.test(sql)) {
      s.enTx = false
      s.confirmado = s.actual
    } else if (/^(rollback|abort)$/i.test(sql)) {
      s.enTx = false
      s.actual = s.confirmado
    } else if ((m = /^set\s+local\s+search_path\s+to\s+(.+)$/i.exec(sql))) {
      if (s.enTx) s.actual = listaDePath(m[1])
    } else if ((m = /^set\s+search_path\s+to\s+(.+)$/i.exec(sql))) this.fijar(s, listaDePath(m[1]))
    else if (/^insert\s/i.test(sql)) {
      this.inserts.push([p.sesion, this.esquemaDe(p.sesion)])
      return conEsquema({ tipo: 'afectadas', filas: 1, comando: 'INSERT', ms: 1, tx: tx() })
    } else if (/^select\b/i.test(sql)) return conEsquema(rFilas(2, { tx: tx() }))
    return conEsquema({ tipo: 'hecho', comando: null, ms: 1, tx: tx() })
  }
}

function refConsola(consolaId: string, conexionId = 'c1'): { perfilId: string; consolaId: string; conexionId: string } {
  return { perfilId: 'perfil1', consolaId, conexionId }
}

let ejecucion = 0
function ejecutar(
  g: GestorSesiones,
  sql: string,
  consolaId = 'k1',
  conexionId = 'c1',
  maxFilas = 500
): ReturnType<GestorSesiones['ejecutarConsola']> {
  return g.ejecutarConsola({ perfilId: 'perfil1', consolaId, conexionId, ejecucionId: `e${++ejecucion}`, sql, maxFilas })
}

/** Como `ejecutar`, con los valores de los parámetros. */
function ejecutarCon(
  g: GestorSesiones,
  sql: string,
  binds: unknown,
  consolaId = 'k1',
  conexionId = 'c1'
): ReturnType<GestorSesiones['ejecutarConsola']> {
  return g.ejecutarConsola({
    perfilId: 'perfil1',
    consolaId,
    conexionId,
    ejecucionId: `e${++ejecucion}`,
    sql,
    maxFilas: 500,
    binds: binds as DbBinds
  })
}

/** EXPLAIN de una consola. */
function explicar(
  g: GestorSesiones,
  sql: string,
  consolaId: string,
  conexionId: string,
  binds?: DbBinds,
  ejecucionId = `x${++ejecucion}`
): ReturnType<GestorSesiones['explicar']> {
  return g.explicar({ perfilId: 'perfil1', consolaId, conexionId, ejecucionId, sql, ...(binds ? { binds } : {}) })
}

/** Todas las SQL que se enviaron en la prueba, para comprobar que ninguna llega al log. */
const sqlEnviadas: string[] = []

/**
 * El tope de espera de bloqueos de «Enviar» en PG, AL BYTE. Era `SQL_ESPERA_BLOQUEO_PG`
 * de `edicionRejilla.ts`, una copia que solo leían los tests y que se quitó:
 * lo que se fija aquí es lo que el gestor MANDA, contra el texto de siempre.
 */
const TOPE_ESPERA_PG = "SET LOCAL lock_timeout = '10s'"

// =============================================================================

async function main(): Promise<void> {
  hr('(1) Apertura perezosa; el secreto solo en «abrir» y nunca en el log')
  {
    const e = entorno([conexion('c1')])
    check('sin peticiones no se lanza ningún proceso', e.falsos.length === 0 && e.gestor.procesosVivos() === 0, `falsos=${e.falsos.length}`)
    const filas = await e.gestor.catalogo('c1', async (ctx) => ctx.consultar({ sql: 'SELECT 42 FROM catalogo_uno', binds: [] }))
    sqlEnviadas.push('SELECT 42 FROM catalogo_uno')
    const f = e.falsos[0]
    check('la primera operación lanza UN proceso', e.falsos.length === 1 && f.arrancado, `falsos=${e.falsos.length}`)
    const ops = f.mensajes.map((m) => m.op).join(',')
    check('abre la sesión meta y luego ejecuta', ops === 'abrir,ejecutar', ops)
    const abrir = f.ops('abrir')[0] as PeticionSinIdDe<'abrir'>
    check('abrir: rol meta, timeout de 60 s, secreto', abrir.rol === 'meta' && abrir.opciones.timeoutMs === 60_000 && abrir.secreto === SECRETO, JSON.stringify(abrir.opciones))
    const ej = f.ejecutados()[0]
    check('catálogo: proposito catalogo, sin BEGIN, sin sonda de tx', ej.opciones.proposito === 'catalogo' && ej.opciones.sinBegin === true && ej.opciones.comprobarTx === false, JSON.stringify(ej.opciones))
    check('las filas del catálogo llegan parseadas', JSON.stringify(filas) === JSON.stringify([['0']]), JSON.stringify(filas))
    await e.gestor.catalogo('c1', async (ctx) => ctx.consultar({ sql: 'SELECT 43', binds: [] }))
    check('la segunda operación NO reabre', f.ops('abrir').length === 1 && e.falsos.length === 1, `abrir=${f.ops('abrir').length}`)
    check('alAbrir avisa con el driverId (null en PG)', e.abiertas.length === 1 && e.abiertas[0][0] === 'c1' && e.abiertas[0][1] === null, JSON.stringify(e.abiertas))
    const meta = e.eventos.filter((x) => x.ref.rol === 'meta')
    check('EV_SESION: abriendo -> lista -> ocupada -> lista', meta.map((x) => x.fase).slice(0, 4).join(',') === 'abriendo,lista,ocupada,lista', meta.map((x) => x.fase).join(','))
    const conSecreto = f.mensajes.filter((m) => JSON.stringify(m).includes(SECRETO)).map((m) => m.op)
    check('el secreto solo aparece en mensajes «abrir»', conSecreto.length > 0 && conSecreto.every((op) => op === 'abrir'), conSecreto.join(','))
    check('ni el secreto ni el SQL llegan al log', !e.logs.some((l) => l.includes(SECRETO) || l.includes('catalogo_uno')), `${e.logs.length} líneas`)
    // Sin secreto: `sinSecreto` sin lanzar nada.
    const e2 = entorno([conexion('c2', { tieneSecreto: false })])
    let motivo = ''
    try {
      await e2.gestor.catalogo('c2', async () => 1)
    } catch (err) {
      motivo = (err as { error?: { motivo?: string } }).error?.motivo ?? String(err)
    }
    check('sin contraseña: sinSecreto sin lanzar proceso', motivo === 'sinSecreto' && e2.falsos.length === 0, motivo)
  }

  hr('(2) Cola por sesión con prioridad')
  {
    const e = entorno([conexion('c1')])
    const puerta = new Diferido<unknown>()
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === 'LENTA') return puerta
      return respuestaPorDefecto(p, f)
    }
    const a = e.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'LENTA', binds: [] }))
    await esperarA(() => e.falsos[0]?.ejecutados().length === 1)
    const b = e.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'AUTOCOMPLETADO', binds: [] }), { prioridad: 'baja' })
    const c = e.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'ARBOL', binds: [] }), { prioridad: 'alta' })
    await tic()
    check('mientras la primera corre, las demás esperan', e.falsos[0].ejecutados().length === 1, `${e.falsos[0].ejecutados().length}`)
    puerta.resolver(rFilas(0))
    await Promise.all([a, b, c])
    const orden = e.falsos[0].ejecutados().map((x) => x.sql).join(',')
    check('el árbol (alta) pasa por delante del autocompletado (baja)', orden === 'LENTA,ARBOL,AUTOCOMPLETADO', orden)
  }

  hr('(3) Stop: saca de la cola, cancela la que corre, ignora la ajena')
  {
    const e = entorno([conexion('c1')])
    const puerta = new Diferido<unknown>()
    e.responder.actual = (p, f) => (p.op === 'ejecutar' && p.opciones.proposito === 'usuario' ? puerta : respuestaPorDefecto(p, f))
    const pet = (id: string): ReturnType<GestorSesiones['leerTabla']> =>
      e.gestor.leerTabla({ conexionId: 'c1', peticionId: id, objeto: { esquema: 'public', nombre: 'cliente' }, pk: ['id'], maxFilas: 500 })
    const p1 = pet('p1')
    await esperarA(() => e.falsos[0]?.ejecutados().length === 1)
    const p2 = pet('p2')
    await tic()
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'otra' })
    check('un Stop que no es de la activa no manda nada', e.falsos[0].ops('cancelar').length === 0, 'sin cancelar')
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'p2' })
    const r2 = await p2
    check('la que esperaba sale sin enviarse (cancelada)', !r2.ok && r2.error.motivo === 'cancelada' && e.falsos[0].ejecutados().length === 1, JSON.stringify(r2))
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'p1' })
    check('la que corre recibe «cancelar» al instante (salta la cola)', e.falsos[0].ops('cancelar').length === 1, `${e.falsos[0].ops('cancelar').length}`)
    const r1 = await p1
    check('y termina como resultado cancelado', r1.ok && r1.valor.tipo === 'error' && (r1.valor as DbResultadoError).error.motivo === 'cancelada', JSON.stringify(r1))
    const ej = e.falsos[0].ejecutados()[0]
    check('tabla: SQL con LIMIT/OFFSET, orden por PK, binds [501, 0]', /ORDER BY "id"\nLIMIT \$1 OFFSET \$2$/.test(ej.sql) && JSON.stringify(ej.binds) === '[501,0]', `${ej.sql} ${JSON.stringify(ej.binds)}`)
  }

  hr('(4) Una ejecución por consola')
  {
    const e = entorno([conexion('c1')])
    const puerta = new Diferido<unknown>()
    e.responder.actual = (p, f) => (p.op === 'ejecutar' && p.sql === 'select pg_sleep(30)' ? puerta : respuestaPorDefecto(p, f))
    sqlEnviadas.push('select pg_sleep(30)')
    const a = ejecutar(e.gestor, 'select pg_sleep(30)')
    await esperarA(() => e.falsos[0]?.ejecutados().length === 1)
    const b = await ejecutar(e.gestor, 'select 1')
    check('la segunda es ocupada al instante', !b.ok && b.error.motivo === 'ocupada', JSON.stringify(b))
    const tx = await e.gestor.txConsola(refConsola('k1'), 'commit')
    check('Commit mientras ejecuta: ocupada', !tx.ok && tx.error.motivo === 'ocupada', JSON.stringify(tx))
    puerta.resolver(rFilas(1))
    const ra = await a
    check('la primera termina bien', ra.ok && ra.valor.tipo === 'filas', JSON.stringify(ra.ok))
    const c = await ejecutar(e.gestor, 'select 1')
    check('después, otra ya entra', c.ok, JSON.stringify(c.ok))
  }

  hr('(5) El main vuelve a partir: exactamente una sentencia')
  {
    const e = entorno([conexion('c1')])
    const dos = await ejecutar(e.gestor, 'select 1; select 2')
    const cero = await ejecutar(e.gestor, '-- solo un comentario')
    const e2 = entorno([conexion('o1', { motor: 'oracle' })])
    const cliente = await ejecutar(e2.gestor, 'set serveroutput on', 'k1', 'o1')
    check('dos sentencias: interno', !dos.ok && dos.error.motivo === 'interno' && /2 sentencias/.test(dos.error.mensaje), JSON.stringify(dos))
    check('ninguna sentencia: interno', !cero.ok && cero.error.motivo === 'interno', JSON.stringify(cero))
    check('comando del cliente (SQL*Plus): no se envía', !cliente.ok && /cliente/.test(cliente.error.mensaje), JSON.stringify(cliente))
    check('nada de eso llegó a un trabajador', e.falsos.length === 0 && e2.falsos.length === 0, `${e.falsos.length}/${e2.falsos.length}`)
    const pegadas = await ejecutar(e.gestor, 'select * from cliente\nselect * from pedido')
    sqlEnviadas.push('select * from cliente')
    const env = e.falsos[0].ejecutados()[0]
    check('dos pegadas sin ; son UNA y se envían tal cual', pegadas.ok && env.sql === 'select * from cliente\nselect * from pedido', env.sql)
    await ejecutar(e.gestor, 'update t set a = 1 where id = 7;')
    sqlEnviadas.push('update t set a = 1 where id = 7')
    const up = e.falsos[0].ejecutados()[1]
    check('el ; final se quita', up.sql === 'update t set a = 1 where id = 7', up.sql)
  }

  hr('(6) Guardia de solo lectura y opciones del trabajador')
  {
    const e = entorno([conexion('c1', { readonly: true }), conexion('c2'), conexion('o1', { motor: 'oracle', readonly: true })])
    const up = await ejecutar(e.gestor, 'update t set a = 1', 'k1', 'c1')
    check('RO: UPDATE rechazado en el main', !up.ok && up.error.motivo === 'soloLectura' && e.falsos.length === 0, JSON.stringify(up))
    await ejecutar(e.gestor, 'select 1', 'k1', 'c1')
    const sel = e.falsos[0].ejecutados()[0]
    check('RO: SELECT con candado y DENTRO del envoltorio', sel.opciones.candadoRO === true && sel.opciones.fueraDeEnvoltorio === false, JSON.stringify(sel.opciones))
    const abrirRO = e.falsos[0].ops('abrir')[0] as PeticionSinIdDe<'abrir'>
    check('RO: la sesión se abre en Auto', abrirRO.opciones.autoCommit === true && abrirRO.rol === 'consola', JSON.stringify(abrirRO.opciones))
    await ejecutar(e.gestor, 'set search_path to ventas', 'k1', 'c1')
    const setsp = e.falsos[0].ejecutados()[1]
    check('RO: SET de la lista blanca FUERA del envoltorio y relee el esquema', setsp.opciones.fueraDeEnvoltorio === true && setsp.opciones.leerEsquema === true, JSON.stringify(setsp.opciones))
    const fmtRO = await ejecutar(e.gestor, 'set datestyle to iso', 'k1', 'c1')
    const fmtRW = await ejecutar(e.gestor, 'set datestyle to iso', 'k2', 'c2')
    check('formato fijado: rechazado en RO', !fmtRO.ok && /Tessera fija este formato/.test(fmtRO.error.mensaje), JSON.stringify(fmtRO))
    check('formato fijado: rechazado también en lectura/escritura', !fmtRW.ok && /Tessera fija este formato/.test(fmtRW.error.mensaje), JSON.stringify(fmtRW))
    const manualRO = await e.gestor.modoTx(refConsola('k1', 'c1'), 'manual')
    check('RO: pasar a Manual se rechaza', !manualRO.ok && manualRO.error.motivo === 'soloLectura', JSON.stringify(manualRO))
    const oraCs = await ejecutar(e.gestor, 'alter session set current_schema = VENTAS', 'k3', 'o1')
    const oraNls = await ejecutar(e.gestor, "alter session set nls_date_format = 'DD'", 'k3', 'o1')
    const oraBloque = await ejecutar(e.gestor, 'begin null; end;', 'k3', 'o1')
    check('Oracle RO: ALTER SESSION SET CURRENT_SCHEMA pasa', oraCs.ok, JSON.stringify(oraCs.ok))
    check('Oracle: NLS_DATE_FORMAT rechazado', !oraNls.ok && /NLS_DATE_FORMAT/.test(oraNls.error.mensaje), JSON.stringify(oraNls))
    check('Oracle RO: bloque PL/SQL rechazado', !oraBloque.ok && oraBloque.error.motivo === 'soloLectura', JSON.stringify(oraBloque))
    // Lectura/escritura
    await ejecutar(e.gestor, 'begin', 'k2', 'c2')
    await ejecutar(e.gestor, 'vacuum', 'k2', 'c2')
    await ejecutar(e.gestor, 'update t set a = 1 where id = 1', 'k2', 'c2')
    const f2 = e.falsos.find((f) => f.conexion.id === 'c2') as TrabajadorFalso
    const [begin, vacuum, dml] = f2.ejecutados()
    check('clase tx (BEGIN): sin BEGIN perezoso', begin.opciones.sinBegin === true, JSON.stringify(begin.opciones))
    check('no transaccional (VACUUM): sin BEGIN', vacuum.opciones.sinBegin === true, JSON.stringify(vacuum.opciones))
    check('DML: esDml y con BEGIN perezoso posible', dml.opciones.esDml === true && dml.opciones.sinBegin === false && dml.opciones.candadoRO === false, JSON.stringify(dml.opciones))
    const man = await e.gestor.modoTx(refConsola('k2', 'c2'), 'manual')
    await ejecutar(e.gestor, 'select 1', 'k2', 'c2')
    const tras = f2.ejecutados()[3]
    check('Manual: txManual en la siguiente sentencia', man.ok && man.valor.txModo === 'manual' && tras.opciones.txManual === true, JSON.stringify(tras.opciones))
    // El catálogo de una conexión RO: SQL fijo de Tessera, sin el viaje de más del candado.
    await e.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'SELECT 1 FROM catalogo_ro', binds: [] }))
    const cat = e.falsos[0].ejecutados().find((x) => x.sql === 'SELECT 1 FROM catalogo_ro')
    check('RO: el catálogo (meta) va SIN candado por sentencia', cat?.opciones.proposito === 'catalogo' && cat.opciones.candadoRO !== true, JSON.stringify(cat?.opciones))
  }

  hr('(7) Posición del error')
  {
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })])
    const sql = "select '😀', x frm t"
    const cp = [...sql.slice(0, sql.indexOf('frm'))].length
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === sql) throw fallo('servidor', { codigo: '42601', mensaje: 'syntax error at or near "frm"', offsetCp: cp })
      if (p.op === 'ejecutar' && p.sql === 'select 1\nselect 2') throw fallo('servidor', { codigo: '42601', mensaje: 'syntax error', offsetCp: 9 })
      if (p.op === 'ejecutar' && p.sql === 'BEGIN p(1); END;') throw fallo('servidor', { codigo: 'ORA-06550', mensaje: 'ORA-06550', offsetCp: 6 })
      // Sin `position`: lo que el trabajador de PG manda para un DO y una función SQL.
      if (p.op === 'ejecutar' && p.sql.startsWith('DO $$')) {
        throw fallo('servidor', { codigo: 'P0001', mensaje: 'x', donde: 'PL/pgSQL function inline_code_block line 2 at RAISE' })
      }
      if (p.op === 'ejecutar' && p.sql.startsWith('create function')) {
        // `offsetInternoCp` 15 = la «n» de `nope` dentro de ' select x from nope ' (base 0).
        throw fallo('servidor', { codigo: '42P01', mensaje: 'relation "nope" does not exist', consultaInterna: ' select x from nope ', offsetInternoCp: 15 })
      }
      return respuestaPorDefecto(p, f)
    }
    const r = await ejecutar(e.gestor, sql)
    const pos = r.ok && r.valor.tipo === 'error' ? r.valor.error.posicion : undefined
    check('puntos de código -> UTF-16 (emoji antes del error)', pos === sql.indexOf('frm') && cp !== sql.indexOf('frm'), `pos=${pos} esperado=${sql.indexOf('frm')} cp=${cp}`)
    const pegadas = await ejecutar(e.gestor, 'select 1\nselect 2', 'k2')
    const pos2 = pegadas.ok && pegadas.valor.tipo === 'error' ? pegadas.valor.error.posicion : undefined
    check('sentencias pegadas: ✗ en la segunda', pos2 === 9, `pos=${pos2}`)
    const ex = await ejecutar(e.gestor, 'exec p(1)', 'k3', 'o1')
    const enviado = e.falsos.find((f) => f.conexion.id === 'o1')?.ejecutados()[0]
    const pos3 = ex.ok && ex.valor.tipo === 'error' ? ex.valor.error.posicion : undefined
    check('EXEC se traduce a BEGIN … END;', enviado?.sql === 'BEGIN p(1); END;', String(enviado?.sql))
    check('y la posición vuelve al texto del usuario', pos3 === 'exec p(1)'.indexOf('p(1)'), `pos=${pos3}`)
    const ok = r.ok && r.valor.tipo === 'error' && r.valor.error.motivo === 'servidor' && r.valor.error.codigo === '42601'
    check('el error del servidor viaja como resultado (ok:true) con su código', ok, JSON.stringify(r))
    const bloque = "DO $$ BEGIN\n  RAISE EXCEPTION 'x';\nEND $$"
    const rDo = await ejecutar(e.gestor, bloque, 'k4')
    const posDo = rDo.ok && rDo.valor.tipo === 'error' ? rDo.valor.error.posicion : undefined
    check('DO sin posición: el «line 2» del where marca el RAISE', posDo === bloque.indexOf('RAISE'), `pos=${posDo} esperado=${bloque.indexOf('RAISE')}`)
    const funcion = 'create function f() returns int language sql as $$ select x from nope $$'
    const rFn = await ejecutar(e.gestor, funcion, 'k5')
    const posFn = rFn.ok && rFn.valor.tipo === 'error' ? rFn.valor.error.posicion : undefined
    check('función SQL: la consulta interna y su posición (base 0 -> base 1) marcan «nope»', posFn === funcion.indexOf('nope'), `pos=${posFn} esperado=${funcion.indexOf('nope')}`)
  }

  hr('(8) Transacciones de consola')
  {
    const e = entorno([conexion('c1')])
    let txServidor: 'ninguna' | 'pendiente' | 'fallida' = 'ninguna'
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && /^update/.test(p.sql)) {
        txServidor = 'pendiente'
        return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: txServidor }
      }
      if (p.op === 'ejecutar' && p.sql === 'select rota') {
        txServidor = 'fallida'
        throw fallo('servidor', { codigo: '42703', mensaje: 'column "rota" does not exist', offsetCp: 7 })
      }
      if (p.op === 'tx') {
        if (p.accion !== 'estado') txServidor = 'ninguna'
        return { tx: txServidor }
      }
      return respuestaPorDefecto(p, f)
    }
    const ref = refConsola('k1')
    await e.gestor.modoTx(ref, 'manual')
    const up = await ejecutar(e.gestor, 'update cliente set saldo = 0 where id = 2')
    let est = e.gestor.estadoConsola('perfil1', 'k1')
    check('UPDATE en Manual: tx pendiente, 1 sentencia', up.ok && est?.tx === 'pendiente' && est.sentenciasEnTx === 1, JSON.stringify(est))
    check(
      'pendientes() y hayTxPendiente() lo ven, con su tx',
      e.gestor.pendientes().length === 1 && e.gestor.pendientes()[0].tx === 'pendiente' && e.gestor.hayTxPendiente('c1'),
      JSON.stringify(e.gestor.pendientes())
    )
    const auto = await e.gestor.modoTx(ref, 'auto')
    check('Manual -> Auto con tx exige resolver', !auto.ok && auto.error.motivo === 'txPendiente' && auto.error.txPendientes?.length === 1, JSON.stringify(auto))
    const com = await e.gestor.txConsola(ref, 'commit')
    est = e.gestor.estadoConsola('perfil1', 'k1')
    check('Commit: el servidor dice ninguna', com.ok && com.valor.tx === 'ninguna' && est?.sentenciasEnTx === 0, JSON.stringify(com))
    const f = e.falsos[0]
    check('Commit se pidió al trabajador', f.ops('tx').some((m) => (m as PeticionSinIdDe<'tx'>).accion === 'commit'), 'tx commit')
    const rota = await ejecutar(e.gestor, 'select rota')
    est = e.gestor.estadoConsola('perfil1', 'k1')
    check('un error en la tx: se sondea el estado real (fallida)', rota.ok && rota.valor.tipo === 'error' && est?.tx === 'fallida', JSON.stringify(est))
    // El diálogo nativo de salida marca las fallidas con esto: sin la `tx`, «Confirmar
    // y salir» parecería que las confirma.
    check("pendientes() dice que es 'fallida'", e.gestor.pendientes()[0]?.tx === 'fallida', JSON.stringify(e.gestor.pendientes()))
    // Una tx fallida no se confirma: PG haría ROLLBACK y lo daría por bueno. Ningún
    // camino que ofrezca «Confirmar» puede acabar en éxito ni mandar el COMMIT.
    const commits = (): number => f.ops('tx').filter((m) => (m as PeticionSinIdDe<'tx'>).accion === 'commit').length
    const commitsAntes = commits()
    const comFallida = await e.gestor.txConsola(ref, 'commit')
    check(
      'Commit con tx fallida: rechazado con su mensaje y sin enviar COMMIT',
      !comFallida.ok && comFallida.error.motivo === 'txPendiente' && comFallida.error.mensaje === MENSAJES.txFallida && commits() === commitsAntes,
      JSON.stringify(comFallida)
    )
    // «Confirmar y salir» y desconectar con «Confirmar» NO van aquí: son resoluciones
    // en BLOQUE, donde una fallida se revierte en vez de rechazarse. Tienen su sección,
    // (8b); lo de abajo son los caminos de UNA consola, que siguen rechazando.
    const cerrarCommit = await e.gestor.cerrarSesionConsola('perfil1', 'k1', 'commit')
    est = e.gestor.estadoConsola('perfil1', 'k1')
    check('cerrar o eliminar la consola con «Confirmar»: rechazado y no se cierra', !cerrarCommit.ok && cerrarCommit.error.mensaje === MENSAJES.txFallida && est?.tx === 'fallida', JSON.stringify(cerrarCommit))
    const aAuto = await e.gestor.modoTx(ref, 'auto', 'commit')
    check('pasar a Auto confirmando: rechazado, sigue en Manual', !aAuto.ok && aAuto.error.mensaje === MENSAJES.txFallida && e.gestor.estadoConsola('perfil1', 'k1')?.txModo === 'manual', JSON.stringify(aAuto))
    const cerrarSin = await e.gestor.cerrarSesionConsola('perfil1', 'k1')
    check('cerrar con tx fallida y sin resolver: txPendiente', !cerrarSin.ok && cerrarSin.error.motivo === 'txPendiente', JSON.stringify(cerrarSin))
    const cerrar = await e.gestor.cerrarSesionConsola('perfil1', 'k1', 'rollback')
    check('cerrar con rollback: cierra y olvida el estado', cerrar.ok && e.gestor.estadoConsola('perfil1', 'k1') === null, JSON.stringify(cerrar))
    check('y manda «cerrar» al trabajador', f.ops('cerrar').some((m) => (m as PeticionSinIdDe<'cerrar'>).sesion === 'consola:k1'), 'cerrar consola:k1')
  }

  hr('(8b) En BLOQUE, «Confirmar» confirma las pendientes y revierte las fallidas')
  {
    type TxServidor = 'ninguna' | 'pendiente' | 'fallida'
    /**
     * Una conexión con DOS consolas en Manual: `kp` con un UPDATE pendiente y `kf` con
     * una tx fallida. El «servidor» lleva la tx POR SESIÓN y apunta cada COMMIT o
     * ROLLBACK que recibe, en orden. `commitFalla`: sesión cuyo COMMIT rechaza el
     * servidor (un fallo DE VERDAD, que el bloque sí tiene que reportar).
     */
    const preparar = async (commitFalla?: string): Promise<{ e: Entorno; acciones: string[]; txDe: (k: string) => string | undefined }> => {
      const e = entorno([conexion('c1')])
      const tx = new Map<string, TxServidor>()
      const acciones: string[] = []
      e.responder.actual = (p, f) => {
        if (p.op === 'ejecutar' && /^update/.test(p.sql)) {
          tx.set(p.sesion, 'pendiente')
          return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: 'pendiente' }
        }
        if (p.op === 'ejecutar' && p.sql === 'select rota') {
          tx.set(p.sesion, 'fallida')
          throw fallo('servidor', { codigo: '42703', mensaje: 'column "rota" does not exist' })
        }
        if (p.op === 'tx') {
          if (p.accion !== 'estado') {
            acciones.push(`${p.sesion}:${p.accion}`)
            if (p.accion === 'commit' && p.sesion === commitFalla) {
              throw fallo('servidor', { codigo: '40001', mensaje: 'could not serialize access' }, 'tx')
            }
            tx.set(p.sesion, 'ninguna')
          }
          return { tx: tx.get(p.sesion) ?? 'ninguna' }
        }
        return respuestaPorDefecto(p, f)
      }
      await e.gestor.modoTx(refConsola('kp'), 'manual')
      await e.gestor.modoTx(refConsola('kf'), 'manual')
      await ejecutar(e.gestor, 'update cliente set saldo = 1 where id = 1', 'kp')
      await ejecutar(e.gestor, 'update cliente set saldo = 2 where id = 2', 'kf')
      await ejecutar(e.gestor, 'select rota', 'kf')
      return { e, acciones, txDe: (k) => e.gestor.estadoConsola('perfil1', k)?.tx }
    }
    const esKf = (ref: { rol: string; consolaId?: string } | undefined): boolean => ref?.rol === 'consola' && ref.consolaId === 'kf'

    // --- «Confirmar y salir» (resolverTodas) -------------------------------------
    {
      const { e, acciones, txDe } = await preparar()
      check('preparación: kp pendiente y kf fallida', txDe('kp') === 'pendiente' && txDe('kf') === 'fallida', `${txDe('kp')} / ${txDe('kf')}`)
      // El Commit de UNA consola no es un bloque: sigue rechazando, sin enviar nada.
      const uno = await e.gestor.txConsola(refConsola('kf'), 'commit')
      check(
        'el Commit de UNA consola fallida sigue rechazado (txFallida) y no llega al servidor',
        !uno.ok && uno.error.mensaje === MENSAJES.txFallida && txDe('kf') === 'fallida' && acciones.length === 0,
        JSON.stringify(uno)
      )
      const salida = await e.gestor.resolverTodas('commit')
      check('«Confirmar y salir» con pendiente + fallida: ok y sin errores (no hay segundo diálogo)', salida.ok && salida.errores.length === 0, JSON.stringify(salida))
      check('la fallida vuelve en `revertidas`, y solo ella', salida.revertidas.length === 1 && esKf(salida.revertidas[0]?.ref), JSON.stringify(salida.revertidas))
      check(
        'al servidor: COMMIT de la pendiente y ROLLBACK de la fallida, sin COMMIT para ella',
        acciones.includes('consola:kp:commit') && acciones.includes('consola:kf:rollback') && !acciones.includes('consola:kf:commit'),
        acciones.join(', ')
      )
      check('y no queda nada pendiente', e.gestor.pendientes().length === 0 && txDe('kp') === 'ninguna' && txDe('kf') === 'ninguna', JSON.stringify(e.gestor.pendientes()))
    }

    // --- Desconectar con «Confirmar» --------------------------------------------
    {
      const { e, acciones, txDe } = await preparar()
      const f = e.falsos[0]
      const desc = await e.gestor.desconectar('c1', 'commit')
      check('desconectar con «Confirmar» y pendiente + fallida: ok (antes fallaba a medias)', desc.ok, JSON.stringify(desc))
      check(
        'la respuesta lista la fallida revertida (revertidasFallidas)',
        desc.ok && desc.valor.revertidasFallidas?.length === 1 && esKf(desc.valor.revertidasFallidas[0]),
        JSON.stringify(desc)
      )
      check(
        'la pendiente se confirma ANTES de tocar la fallida, y la fallida se revierte',
        acciones.indexOf('consola:kp:commit') >= 0 && acciones.indexOf('consola:kp:commit') < acciones.indexOf('consola:kf:rollback') && !acciones.includes('consola:kf:commit'),
        acciones.join(', ')
      )
      check('y la conexión se desconecta (el proceso sale)', !f.vivo && f.ops('salir').length === 1, `vivo=${f.vivo} kp=${txDe('kp')} kf=${txDe('kf')}`)
      // Sin fallidas, la respuesta no trae la lista (campo opcional, ausente).
      const limpio = entorno([conexion('c2')])
      await ejecutar(limpio.gestor, 'select 1', 'k2', 'c2')
      const d2 = await limpio.gestor.desconectar('c2', 'commit')
      check('sin fallidas, ok y sin `revertidasFallidas`', d2.ok && d2.valor.revertidasFallidas === undefined, JSON.stringify(d2))
    }

    // --- Un COMMIT que el servidor rechaza de verdad sigue siendo un error ----------
    {
      const { e, acciones, txDe } = await preparar('consola:kp')
      const f = e.falsos[0]
      const desc = await e.gestor.desconectar('c1', 'commit')
      check('desconectar: si el COMMIT de la pendiente falla, error y la conexión sigue', !desc.ok && f.vivo && txDe('kp') === 'pendiente', JSON.stringify(desc))
      check('y la fallida ni se ha tocado (va al final del bloque)', txDe('kf') === 'fallida' && !acciones.some((a) => a.startsWith('consola:kf:')), acciones.join(', '))
      const salida = await e.gestor.resolverTodas('commit')
      check(
        '«Confirmar y salir»: el fallo real va a `errores` (segundo diálogo) y la fallida a `revertidas`',
        !salida.ok && salida.errores.length === 1 && salida.errores[0].ref.rol === 'consola' && !esKf(salida.errores[0].ref) && salida.revertidas.length === 1 && esKf(salida.revertidas[0]?.ref),
        JSON.stringify(salida)
      )
    }
  }

  hr('(8c) perder la sesión con el COMMIT en camino NO es «el servidor revirtió»')
  {
    // El COMMIT sale con cambios pendientes y la sesión se pierde (red, proceso) antes de
    // la respuesta: el servidor pudo confirmarlo. El mensaje y el aviso decían que se
    // había revertido, e invitaban a repetir los cambios (un INSERT repetido duplica).
    const e = entorno([conexion('c1')])
    let txServidor: DbEstadoTx = 'ninguna'
    let alCommit: ((f: TrabajadorFalso) => unknown) | null = null
    let alEjecutar: ((sql: string) => unknown) | null = null
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        const r = alEjecutar?.(p.sql)
        if (r !== undefined) return r
        if (/^update/i.test(p.sql)) {
          if (p.opciones.txManual === true) txServidor = 'pendiente'
          return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: txServidor }
        }
      }
      if (p.op === 'tx') {
        if (p.accion === 'commit' && alCommit) return alCommit(f)
        if (p.accion !== 'estado') txServidor = 'ninguna'
        return { tx: txServidor }
      }
      return respuestaPorDefecto(p, f)
    }
    const avisoDe = (consolaId: string): DbEstadoSesion['aviso'] => e.gestor.estadoConsola('perfil1', consolaId)?.aviso
    const conPendiente = async (consolaId: string): Promise<void> => {
      await e.gestor.modoTx(refConsola(consolaId), 'manual')
      await ejecutar(e.gestor, 'update cliente set saldo = 0 where id = 2', consolaId)
    }

    // 1) El botón Commit, con la conexión que se corta con el COMMIT en camino.
    await conPendiente('m1')
    alCommit = () => {
      throw fallo('perdida', { codigo: 'ORA-03113', mensaje: 'end-of-file on communication channel' }, 'tx')
    }
    const c1 = await e.gestor.txConsola(refConsola('m1'), 'commit')
    const a1 = avisoDe('m1')
    check(
      'botón Commit perdido en camino: sesionPerdida con «no se sabe… comprueba», nunca «revirtió»',
      !c1.ok && c1.error.motivo === 'sesionPerdida' && c1.error.mensaje === MENSAJES.perdidaEnCommit && !/revirti/.test(c1.error.mensaje),
      JSON.stringify(c1)
    )
    check(
      '… y el aviso de la sesión tampoco: SIN txPerdida (el renderer no pinta su «revertida»)',
      a1?.tipo === 'perdida' && a1.txPerdida === false && a1.mensaje === MENSAJES.perdidaEnCommit,
      JSON.stringify(a1)
    )

    // 2) El proceso muere con el COMMIT dentro: el aviso lo pone `alSalirProceso`, que
    //    llega ANTES que el rechazo del COMMIT.
    await conPendiente('m2')
    const puerta = new Diferido<unknown>()
    alCommit = () => puerta
    const enVuelo = e.gestor.txConsola(refConsola('m2'), 'commit')
    const fM2 = e.falsos[e.falsos.length - 1]
    await esperarA(() => fM2.ops('tx').some((m) => (m as PeticionSinIdDe<'tx'>).accion === 'commit' && (m as PeticionSinIdDe<'tx'>).sesion === 'consola:m2'))
    fM2.morir(null, 'SIGKILL')
    const c2 = await enVuelo
    const a2 = avisoDe('m2')
    check(
      'el proceso muere con el COMMIT dentro: error y aviso de CAÍDA «con el COMMIT en camino», sin txPerdida',
      !c2.ok && c2.error.mensaje === MENSAJES.caidaEnCommit && a2?.tipo === 'caida' && a2.txPerdida === false && a2.mensaje === MENSAJES.caidaEnCommit,
      JSON.stringify({ c2, a2 })
    )

    // 3) El vigilante vence con el COMMIT dentro: se mata el proceso, y tampoco se sabe.
    await conPendiente('m3')
    alCommit = () => {
      throw fallo('timeout', { codigo: 'TESSERA-PLAZO', mensaje: 'el proceso no respondió' }, 'tx')
    }
    const c3 = await e.gestor.txConsola(refConsola('m3'), 'commit')
    check('plazo vencido con el COMMIT dentro: «no se sabe», con el detalle', !c3.ok && c3.error.mensaje.startsWith(MENSAJES.caidaEnCommit) && /no respondió/.test(c3.error.mensaje), JSON.stringify(c3))
    alCommit = null

    // 4) NEGATIVO: una pérdida con la tx pendiente SIN commit en camino sí es «revertida».
    await conPendiente('m4')
    alEjecutar = (sql) => {
      if (sql === 'select 1') throw fallo('perdida', { codigo: 'ORA-03113', mensaje: 'end-of-file' })
      return undefined
    }
    const r4 = await ejecutar(e.gestor, 'select 1', 'm4')
    const a4 = avisoDe('m4')
    check(
      'NEGATIVO: un SELECT perdido con la tx pendiente: «revirtió la transacción» y txPerdida, como antes',
      r4.ok && r4.valor.tipo === 'error' && r4.valor.error.mensaje.startsWith(MENSAJES.perdidaConTx) && a4?.txPerdida === true && a4.mensaje === MENSAJES.perdidaConTx,
      JSON.stringify({ r4, a4 })
    )
    // Y el botón Rollback perdido: revertido de todas formas.
    await conPendiente('m5')
    const pRb = e.responder.actual
    e.responder.actual = (p, f) => {
      if (p.op === 'tx' && p.accion === 'rollback') throw fallo('perdida', { codigo: 'ORA-03113', mensaje: 'x' }, 'tx')
      return pRb(p, f)
    }
    const c5 = await e.gestor.txConsola(refConsola('m5'), 'rollback')
    e.responder.actual = pRb
    check('NEGATIVO: el botón Rollback perdido: «revirtió» (no hay nada que dudar)', !c5.ok && c5.error.mensaje === MENSAJES.perdidaConTx && avisoDe('m5')?.txPerdida === true, JSON.stringify(c5))

    // 5) Un COMMIT ESCRITO en la consola, perdido en camino.
    await conPendiente('m6')
    alEjecutar = (sql) => {
      if (sql === 'commit') throw fallo('perdida', { codigo: '08006', mensaje: 'connection lost' })
      return undefined
    }
    const r6 = await ejecutar(e.gestor, 'commit', 'm6')
    check(
      'un COMMIT escrito y perdido: su error dice que no se sabe (con el detalle), y el aviso también',
      r6.ok && r6.valor.tipo === 'error' && r6.valor.error.mensaje.startsWith(MENSAJES.perdidaEnCommit) && /connection lost/.test(r6.valor.error.mensaje) && avisoDe('m6')?.txPerdida === false,
      JSON.stringify({ r6, aviso: avisoDe('m6') })
    )

    // 6) Una escritura en AUTO perdida en camino: se confirma sola, no se sabe si llegó.
    alEjecutar = (sql) => {
      if (/^update/.test(sql)) throw fallo('perdida', { codigo: '08006', mensaje: 'connection lost' })
      return undefined
    }
    const r7 = await ejecutar(e.gestor, 'update cliente set saldo = 1 where id = 2', 'm7')
    check(
      'un UPDATE en Auto perdido: «se confirma sola… no se sabe», nunca «revirtió»',
      r7.ok && r7.valor.tipo === 'error' && r7.valor.error.mensaje.startsWith(MENSAJES.perdidaEnAuto) && !/revirti/.test(r7.valor.error.mensaje),
      JSON.stringify(r7)
    )
    // NEGATIVO: el mismo UPDATE en MANUAL se revierte con la sesión.
    await e.gestor.modoTx(refConsola('m8'), 'manual')
    const r8 = await ejecutar(e.gestor, 'update cliente set saldo = 1 where id = 2', 'm8')
    check('NEGATIVO: el mismo UPDATE perdido en Manual: «revirtió»', r8.ok && r8.valor.tipo === 'error' && r8.valor.error.mensaje.startsWith(MENSAJES.perdidaConTx), JSON.stringify(r8))
    alEjecutar = null

    // 7) Oracle en MANUAL, un bloque PL/SQL con un COMMIT escrito
    //    perdido a mitad. El COMMIT del bloque pudo confirmar lo pendiente (y lo que el
    //    propio bloque escribió): decir «revirtió» invitaba a repetir los INSERT. El
    //    renderer ya lo detectaba (la confirmación de producción lo dice); el main no.
    const eo = entorno([conexion('o1', { motor: 'oracle' })])
    let txOra: DbEstadoTx = 'ninguna'
    let perderSi: RegExp | null = null
    eo.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        if (perderSi && perderSi.test(p.sql)) throw fallo('perdida', { codigo: 'ORA-03113', mensaje: 'end-of-file on communication channel' })
        if (/^update/i.test(p.sql)) {
          if (p.opciones.txManual === true) txOra = 'pendiente'
          return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: txOra }
        }
      }
      if (p.op === 'tx') {
        if (p.accion !== 'estado') txOra = 'ninguna'
        return { tx: txOra }
      }
      return respuestaPorDefecto(p, f)
    }
    const avisoO = (consolaId: string): DbEstadoSesion['aviso'] => eo.gestor.estadoConsola('perfil1', consolaId)?.aviso
    const pendienteO = async (consolaId: string): Promise<void> => {
      await eo.gestor.modoTx(refConsola(consolaId, 'o1'), 'manual')
      await ejecutar(eo.gestor, 'update cliente set saldo = 0 where id = 2', consolaId, 'o1')
    }
    const BLOQUE_COMMIT = 'begin\n  insert into cliente (id) values (9);\n  commit;\nend;'
    await pendienteO('mo1')
    perderSi = /^begin/i
    const ro1 = await ejecutar(eo.gestor, BLOQUE_COMMIT, 'mo1', 'o1')
    check(
      'Oracle, Manual: un bloque con un COMMIT escrito perdido a mitad: «no se sabe… comprueba» (con el detalle), nunca «revirtió»',
      ro1.ok && ro1.valor.tipo === 'error' && ro1.valor.error.mensaje.startsWith(MENSAJES.perdidaEnCommit) && /end-of-file/.test(ro1.valor.error.mensaje) && !/revirti/.test(ro1.valor.error.mensaje),
      JSON.stringify(ro1)
    )
    check(
      '… y el aviso de la sesión tampoco: SIN txPerdida (el renderer no pinta su «revertida»)',
      avisoO('mo1')?.txPerdida === false && avisoO('mo1')?.mensaje === MENSAJES.perdidaEnCommit,
      JSON.stringify(avisoO('mo1'))
    )
    // Sin nada pendiente antes: lo que el bloque escribió antes de su COMMIT también pudo quedar.
    await eo.gestor.modoTx(refConsola('mo2', 'o1'), 'manual')
    const ro2 = await ejecutar(eo.gestor, 'BEGIN\n  <<uno>>\n  COMMIT WORK;\nEND;', 'mo2', 'o1')
    check(
      '… también sin cambios pendientes antes (el bloque confirma lo suyo), y con etiqueta y COMMIT WORK',
      ro2.ok && ro2.valor.tipo === 'error' && ro2.valor.error.mensaje.startsWith(MENSAJES.perdidaEnCommit),
      JSON.stringify(ro2)
    )
    // Sin un COMMIT DE VERDAD en el bloque (en una cadena, en un comentario, o una columna
    // que se llama así) no se nombra ningún COMMIT; pero el bloque puede confirmar POR
    // DENTRO igual (ver 8 abajo), así que tampoco dice «revirtió».
    for (const [i, sql] of [
      "begin\n  insert into cliente (nota) values ('commit;');\nend;",
      'begin\n  -- commit;\n  insert into cliente (id) values (9);\nend;',
      'begin\n  update cliente set commit = 1 where id = 2;\nend;'
    ].entries()) {
      const k = `mn${i}`
      await pendienteO(k)
      const r = await ejecutar(eo.gestor, sql, k, 'o1')
      check(
        `un bloque sin COMMIT escrito (${['en una cadena', 'en un comentario', 'una columna'][i]}) perdido: «puede confirmar por dentro», ni «COMMIT en camino» ni «revirtió»`,
        r.ok && r.valor.tipo === 'error' && r.valor.error.mensaje.startsWith(MENSAJES.perdidaPorDentro) && avisoO(k)?.txPerdida === false && avisoO(k)?.mensaje === MENSAJES.perdidaPorDentro,
        JSON.stringify({ r, aviso: avisoO(k) })
      )
    }

    // 8) lo que NO se ve. Un CALL (o un bloque que llama a
    //    un procedimiento) puede hacer COMMIT por dentro. MEDIDO en la 11.2 y la 21c con el trabajador
    //    real: INSERT pendiente, CALL de un procedimiento con COMMIT, Forzar a mitad; Tessera
    //    decía «revirtió» y la fila pendiente estaba CONFIRMADA.
    await pendienteO('mr1')
    perderSi = /^call/i
    const rr1 = await ejecutar(eo.gestor, 'call cargar_lote(7)', 'mr1', 'o1')
    check(
      'Oracle, Manual: un CALL perdido a mitad con cambios pendientes: «puede confirmar por dentro… no se sabe… comprueba» (con el detalle), nunca «revirtió»',
      rr1.ok && rr1.valor.tipo === 'error' && rr1.valor.error.motivo === 'sesionPerdida' && rr1.valor.error.mensaje.startsWith(MENSAJES.perdidaPorDentro) && /end-of-file/.test(rr1.valor.error.mensaje) &&
        !/revirti/.test(rr1.valor.error.mensaje),
      JSON.stringify(rr1)
    )
    check('… y el aviso: SIN txPerdida y con el mismo texto', avisoO('mr1')?.txPerdida === false && avisoO('mr1')?.mensaje === MENSAJES.perdidaPorDentro, JSON.stringify(avisoO('mr1')))
    // Sin nada pendiente antes: lo que el procedimiento escribió y confirmó también puede haber quedado.
    await eo.gestor.modoTx(refConsola('mr2', 'o1'), 'manual')
    const rr2 = await ejecutar(eo.gestor, 'call cargar_lote(8)', 'mr2', 'o1')
    check('… también sin nada pendiente antes (el procedimiento confirma lo suyo)', rr2.ok && rr2.valor.tipo === 'error' && rr2.valor.error.mensaje.startsWith(MENSAJES.perdidaPorDentro), JSON.stringify(rr2))
    perderSi = null
    // El proceso muere con el CALL dentro: el aviso lo pone `alSalirProceso`, que llega ANTES
    // que el rechazo de la operación, y tiene que llevar el mismo texto (de caída).
    await pendienteO('mr3')
    const puertaCall = new Diferido<unknown>()
    const pOra = eo.responder.actual
    eo.responder.actual = (p, f) => (p.op === 'ejecutar' && /^call/i.test(p.sql) ? puertaCall : pOra(p, f))
    const enVueloCall = ejecutar(eo.gestor, 'call cargar_lote(9)', 'mr3', 'o1')
    const fMr3 = eo.falsos[eo.falsos.length - 1]
    // ESTE CALL (el 9): los de arriba pasaron por el mismo proceso.
    await esperarA(() => fMr3.ejecutados().some((m) => m.sql === 'call cargar_lote(9)'))
    fMr3.morir(null, 'SIGKILL')
    const rr3 = await enVueloCall
    eo.responder.actual = pOra
    const ar3 = avisoO('mr3')
    check(
      'el proceso muere con el CALL dentro: error y aviso de CAÍDA «puede confirmar por dentro», sin txPerdida',
      rr3.ok && rr3.valor.tipo === 'error' && rr3.valor.error.mensaje.startsWith(MENSAJES.caidaPorDentro) && ar3?.tipo === 'caida' && ar3.txPerdida === false && ar3.mensaje === MENSAJES.caidaPorDentro,
      JSON.stringify({ rr3, ar3 })
    )
    // NEGATIVO: lo que NO puede confirmar la transacción (un DML, una consulta) perdido en
    // Manual sí revierte lo pendiente, y lo sigue diciendo.
    for (const [i, sql] of ['update cliente set saldo = 5 where id = 2', 'select * from cliente'].entries()) {
      const k = `mq${i}`
      await pendienteO(k)
      perderSi = i === 0 ? /^update cliente set saldo = 5/i : /^select \* from cliente/i
      const r = await ejecutar(eo.gestor, sql, k, 'o1')
      check(
        `NEGATIVO: ${['un UPDATE', 'un SELECT'][i]} perdido en Manual de Oracle: «revirtió» y txPerdida, como antes`,
        r.ok && r.valor.tipo === 'error' && r.valor.error.mensaje.startsWith(MENSAJES.perdidaConTx) && avisoO(k)?.txPerdida === true,
        JSON.stringify({ r, aviso: avisoO(k) })
      )
    }
    perderSi = null
  }

  hr('(9) Lectores')
  {
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })])
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === 'select * from grande') {
        const salto = p.opciones.saltarFilas ?? 0
        const quedan = 1234 - salto
        const n = Math.min(quedan, p.opciones.maxFilas)
        return rFilas(n, { hayMas: quedan > p.opciones.maxFilas, saltadas: salto })
      }
      if (p.op === 'ejecutar' && /returning/.test(p.sql)) return rFilas(500, { hayMas: true, comando: 'INSERT' })
      if (p.op === 'ejecutar' && /^SELECT COUNT/.test(p.sql)) return rFilas(1, { filasJson: '[["1234"]]' })
      return respuestaPorDefecto(p, f)
    }
    sqlEnviadas.push('select * from grande')
    const r = await ejecutar(e.gestor, 'select * from grande')
    const lector = r.ok && r.valor.tipo === 'filas' ? r.valor.lector : null
    check('PG: hayMas sin cursor -> lector del main, releíble', lector !== null && r.ok && r.valor.tipo === 'filas' && !r.valor.noReleible, JSON.stringify(r.ok && r.valor.tipo === 'filas' ? { lector: r.valor.lector, noReleible: r.valor.noReleible } : r))
    const m1 = await e.gestor.leerMas(lector as string, 500)
    const ej2 = e.falsos[0].ejecutados()[1]
    check('más: re-ejecuta con saltarFilas 500 y sin BEGIN', ej2.opciones.saltarFilas === 500 && ej2.opciones.sinBegin === true, JSON.stringify(ej2.opciones))
    check('página 2: desde 500, 500 filas, re-ejecutada, hay más', m1.ok && m1.valor.desde === 500 && JSON.parse(m1.valor.filasJson).length === 500 && m1.valor.reejecutada === true && m1.valor.hayMas, JSON.stringify(m1.ok && { desde: m1.valor.desde, hayMas: m1.valor.hayMas }))
    const cnt = await e.gestor.contar(lector as string, 'cuenta1')
    const ejc = e.falsos[0].ejecutados().find((x) => /^SELECT COUNT/.test(x.sql))
    check('contar: COUNT(*) sobre la consulta, en su sesión', cnt.ok && cnt.valor === 1234 && ejc?.sesion === 'consola:k1', JSON.stringify(cnt))
    const m2 = await e.gestor.leerMas(lector as string, 500)
    check('página 3: 234 filas y fin', m2.ok && JSON.parse(m2.valor.filasJson).length === 234 && !m2.valor.hayMas && m2.valor.desde === 1000, JSON.stringify(m2.ok && { desde: m2.valor.desde, hayMas: m2.valor.hayMas }))
    const m3 = await e.gestor.leerMas(lector as string, 500)
    check('agotado: el lector ya no existe', !m3.ok && m3.error.motivo === 'noReleible', JSON.stringify(m3))
    const ret = await ejecutar(e.gestor, 'insert into t select generate_series(1,900) returning *')
    const lr = ret.ok && ret.valor.tipo === 'filas' ? ret.valor : null
    check('RETURNING con más filas: noReleible', lr !== null && lr.noReleible === true && lr.lector !== null, JSON.stringify(lr && { noReleible: lr.noReleible, lector: lr.lector }))
    const mr = await e.gestor.leerMas(lr?.lector as string, 500)
    check('y «más» no la re-ejecuta', !mr.ok && mr.error.motivo === 'noReleible', JSON.stringify(mr))

    // Oracle: cursor vivo, y su respaldo si el trabajador lo expulsó.
    let lecturas = 0
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === 'select * from grande' && f.conexion.motor === 'oracle') {
        return rFilas(Math.min(p.opciones.maxFilas, 1234 - (p.opciones.saltarFilas ?? 0)), { hayMas: true, lector: p.opciones.lector ?? 'lx' })
      }
      if (p.op === 'leer') {
        lecturas++
        if (lecturas === 2) throw fallo('protocolo', { codigo: 'TESSERA-LECTOR', mensaje: 'el lector ya no existe' }, 'leer')
        return { filasJson: JSON.stringify([['x']]), nFilas: 1, hayMas: true, lector: p.lector, ms: 1 }
      }
      return respuestaPorDefecto(p, f)
    }
    const o = await ejecutar(e.gestor, 'select * from grande', 'k9', 'o1')
    const fo = e.falsos.find((f) => f.conexion.id === 'o1') as TrabajadorFalso
    const ejo = fo.ejecutados()[0]
    const lo = o.ok && o.valor.tipo === 'filas' ? o.valor.lector : null
    check('Oracle: el main da el id del cursor y el resultado lo usa', !!ejo.opciones.lector && lo === ejo.opciones.lector, `${ejo.opciones.lector} / ${lo}`)
    const mo1 = await e.gestor.leerMas(lo as string, 500)
    check('Oracle: «más» lee del cursor (leer), sin re-ejecutar', mo1.ok && fo.ops('leer').length === 1 && fo.ejecutados().length === 1 && !mo1.valor.reejecutada, `leer=${fo.ops('leer').length}`)
    const mo2 = await e.gestor.leerMas(lo as string, 500)
    const reej = fo.ejecutados()[1]
    check('Oracle: cursor expulsado -> re-ejecuta saltando lo leído', mo2.ok && mo2.valor.reejecutada === true && reej?.opciones.saltarFilas === 501, JSON.stringify(reej?.opciones))
    // Tope de lectores por sesión.
    for (let i = 0; i < MAX_LECTORES_POR_SESION + 1; i++) await ejecutar(e.gestor, 'select * from grande', 'k8', 'o1')
    await esperarA(() => fo.ops('cerrarLector').length >= 1)
    check(`tope de ${MAX_LECTORES_POR_SESION} lectores: el más viejo se cierra en el trabajador`, fo.ops('cerrarLector').length === 1, `cerrarLector=${fo.ops('cerrarLector').length}`)
  }

  hr('(10) LRU de procesos que respeta las transacciones')
  {
    const ids = Array.from({ length: MAX_PROCESOS + 2 }, (_, i) => `p${i}`)
    const e = entorno(ids.map((id) => conexion(id)))
    for (let i = 0; i < MAX_PROCESOS; i++) await e.gestor.catalogo(ids[i], async () => 1)
    check(`${MAX_PROCESOS} procesos vivos`, e.gestor.procesosVivos() === MAX_PROCESOS, `${e.gestor.procesosVivos()}`)
    // p1 se usa ahora: el menos usado pasa a ser p0.
    await e.gestor.catalogo(ids[1], async () => 1)
    await e.gestor.catalogo(ids[MAX_PROCESOS], async () => 1)
    await esperarA(() => !e.falsos[0].vivo)
    check('el siguiente expulsa al ocioso menos usado (p0)', !e.falsos[0].vivo && e.falsos[0].ops('salir').length === 1 && e.falsos[1].vivo, `p0 vivo=${e.falsos[0].vivo}`)
    check('y siguen siendo el tope', e.gestor.procesosVivos() === MAX_PROCESOS, `${e.gestor.procesosVivos()}`)
    // Todos con una transacción pendiente: nadie es expulsable.
    e.responder.actual = (p, f) =>
      p.op === 'ejecutar' && /^update/.test(p.sql)
        ? { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: 'pendiente' }
        : respuestaPorDefecto(p, f)
    const vivos = ids.slice(1, MAX_PROCESOS + 1)
    for (const id of vivos) {
      await e.gestor.modoTx(refConsola(`k-${id}`, id), 'manual')
      await ejecutar(e.gestor, 'update t set a = 2 where id = 3', `k-${id}`, id)
    }
    const lleno = await ejecutar(e.gestor, 'select 1', 'k-ultima', ids[MAX_PROCESOS + 1])
    check('todos con tx: el siguiente falla con «limite» sin matar a nadie', !lleno.ok && lleno.error.motivo === 'limite' && e.gestor.procesosVivos() === MAX_PROCESOS, JSON.stringify(lleno))
  }

  hr('(11) Barrido: inactividad, proceso sin sesiones, conexión borrada')
  {
    const e = entorno([conexion('c1'), conexion('c2')])
    e.responder.actual = (p, f) =>
      p.op === 'ejecutar' && /^update/.test(p.sql)
        ? { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: 'pendiente' }
        : respuestaPorDefecto(p, f)
    await e.gestor.catalogo('c1', async () => 1)
    await e.gestor.modoTx(refConsola('conTx'), 'manual')
    await ejecutar(e.gestor, 'update t set a = 3 where id = 4', 'conTx')
    await ejecutar(e.gestor, 'select 1', 'sinTx')
    const f = e.falsos[0]
    const t0 = e.reloj.t
    e.gestor.barrer(t0 + 11 * 60_000)
    const cerrados = () => f.ops('cerrar').map((m) => (m as PeticionSinIdDe<'cerrar'>).sesion)
    check('a los 11 min se cierra meta; las consolas no', cerrados().join(',') === 'meta', cerrados().join(','))
    e.gestor.barrer(t0 + 31 * 60_000)
    const sinTx = e.gestor.estadoConsola('perfil1', 'sinTx')
    const conTx = e.gestor.estadoConsola('perfil1', 'conTx')
    check('a los 31 min se cierra la consola sin tx, con aviso de inactividad', cerrados().includes('consola:sinTx') && sinTx?.fase === 'cerrada' && sinTx.aviso?.tipo === 'inactividad', JSON.stringify(sinTx))
    check('la consola con tx pendiente NUNCA se cierra', conTx?.fase === 'lista' && conTx.tx === 'pendiente' && !cerrados().includes('consola:conTx'), JSON.stringify(conTx))
    // Proceso sin sesiones: rollback y cierre de la última -> 60 s -> sale.
    await e.gestor.cerrarSesionConsola('perfil1', 'conTx', 'rollback')
    e.gestor.barrer(t0 + 32 * 60_000)
    check('recién sin sesiones: el proceso sigue', f.vivo, `vivo=${f.vivo}`)
    e.gestor.barrer(t0 + 32 * 60_000 + PROCESO_SIN_SESIONES_MS)
    await esperarA(() => !f.vivo)
    check(`tras ${PROCESO_SIN_SESIONES_MS / 1000} s sin sesiones sale`, !f.vivo && f.ops('salir').length === 1, `vivo=${f.vivo}`)
    // Conexión borrada por fuera: sus sesiones se cierran y se olvidan.
    await ejecutar(e.gestor, 'select 1', 'kb', 'c2')
    e.conexiones.delete('c2')
    e.gestor.barrer()
    const f2 = e.falsos.find((x) => x.conexion.id === 'c2') as TrabajadorFalso
    check('conexión borrada: la sesión se cierra y se olvida', e.gestor.estadoConsola('perfil1', 'kb') === null && f2.ops('cerrar').length === 1, `cerrar=${f2.ops('cerrar').length}`)
  }

  hr('(12) Pérdida y caída: nada se re-ejecuta solo, la reapertura es perezosa')
  {
    const e = entorno([conexion('c1')])
    let perder = true
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === 'select 1' && perder) {
        perder = false
        throw fallo('perdida', { codigo: '57P01', mensaje: 'terminating connection due to administrator command' })
      }
      return respuestaPorDefecto(p, f)
    }
    const r = await ejecutar(e.gestor, 'select 1')
    const est = e.gestor.estadoConsola('perfil1', 'k1')
    const err = r.ok && r.valor.tipo === 'error' ? r.valor.error : null
    check('respuesta: sesionPerdida con el mensaje del plan', err?.motivo === 'sesionPerdida' && (err.mensaje ?? '').startsWith('Sesión perdida; el servidor revirtió la transacción'), JSON.stringify(err))
    check('la sesión queda perdida con su aviso', est?.fase === 'perdida' && est.aviso?.tipo === 'perdida', JSON.stringify(est))
    const f = e.falsos[0]
    const ejecucionesAntes = f.ejecutados().length
    const r2 = await ejecutar(e.gestor, 'select 2')
    check('la siguiente reabre (otro abrir) y funciona', r2.ok && f.ops('abrir').length === 2 && f.ejecutados().length === ejecucionesAntes + 1, `abrir=${f.ops('abrir').length}`)
    check('y no repitió la sentencia perdida', f.ejecutados().filter((x) => x.sql === 'select 1').length === 1, 'una vez')
    // Evento de pérdida estando ociosa.
    f.emitirEvento({ ev: 'perdida', sesion: 'consola:k1', error: { clase: 'perdida', mensaje: 'Connection terminated unexpectedly' } })
    check('evento «perdida» de una sesión ociosa: fase perdida', e.gestor.estadoConsola('perfil1', 'k1')?.fase === 'perdida', JSON.stringify(e.gestor.estadoConsola('perfil1', 'k1')?.fase))
    // Caída del proceso.
    await ejecutar(e.gestor, 'select 3')
    f.morir(70, null)
    const caida = e.gestor.estadoConsola('perfil1', 'k1')
    check('caída del proceso: sesiones perdidas con aviso «caida»', caida?.fase === 'perdida' && caida.aviso?.tipo === 'caida', JSON.stringify(caida?.aviso))
    const r3 = await ejecutar(e.gestor, 'select 4')
    check('la siguiente operación lanza un proceso nuevo', r3.ok && e.falsos.length === 2 && e.falsos[1].ops('abrir').length === 1, `falsos=${e.falsos.length}`)
  }

  hr('(13) Editar, cambiar de driver, desconectar, forzar, resolverTodas')
  {
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle', driverId: 'oracle-ic-19' })])
    e.responder.actual = (p, f) =>
      p.op === 'ejecutar' && /^update/.test(p.sql)
        ? { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: 'pendiente' }
        : p.op === 'tx' && p.accion !== 'estado'
          ? { tx: 'ninguna' }
          : respuestaPorDefecto(p, f)
    await ejecutar(e.gestor, 'select 1')
    const c1 = e.conexiones.get('c1') as DbConnection
    e.gestor.alCambiarConexion(c1, { ...c1, host: 'otro' })
    await esperarA(() => !e.falsos[0].vivo)
    const ed = e.gestor.estadoConsola('perfil1', 'k1')
    check('editar: el proceso se retira y la sesión avisa «editada»', !e.falsos[0].vivo && ed?.fase === 'cerrada' && ed.aviso?.tipo === 'editada', JSON.stringify(ed?.aviso))
    await ejecutar(e.gestor, 'select 1')
    check('y se reabre en un proceso nuevo', e.falsos.length === 2 && e.falsos[1].vivo, `falsos=${e.falsos.length}`)
    // Driver: con tx pendiente se niega; sin tx, cierra el proceso.
    await e.gestor.modoTx(refConsola('ko', 'o1'), 'manual')
    await ejecutar(e.gestor, 'update t set a = 5 where id = 6', 'ko', 'o1')
    let negado = ''
    try {
      await e.gestor.cerrarProcesosDelDriver('oracle-ic-19')
    } catch (err) {
      negado = (err as Error).message
    }
    const fo = e.falsos.find((f) => f.conexion.id === 'o1') as TrabajadorFalso
    check('cambiar de driver con tx pendiente: se niega', /transacciones pendientes/.test(negado) && fo.vivo, negado)
    const d1 = await e.gestor.desconectar('o1')
    check('desconectar con tx y sin resolver: txPendiente', !d1.ok && d1.error.motivo === 'txPendiente', JSON.stringify(d1))
    const todas = await e.gestor.resolverTodas('commit')
    check('resolverTodas(commit): sin pendientes', todas.ok && e.gestor.pendientes().length === 0, JSON.stringify(todas))
    await e.gestor.cerrarProcesosDelDriver('oracle-ic-19')
    await esperarA(() => !fo.vivo)
    check('sin tx: el proceso del driver se cierra', !fo.vivo && fo.ops('salir').length === 1, `vivo=${fo.vivo}`)
    await ejecutar(e.gestor, 'select 1', 'kd')
    const d2 = await e.gestor.desconectar('c1', 'rollback')
    check('desconectar: ok y el proceso sale', d2.ok && !e.falsos[1].vivo, JSON.stringify(d2))
    await ejecutar(e.gestor, 'select 1', 'kf')
    const ultimo = e.falsos[e.falsos.length - 1]
    e.gestor.forzar('c1')
    check('forzar: mata el proceso y la sesión queda perdida', !ultimo.vivo && e.gestor.estadoConsola('perfil1', 'kf')?.fase === 'perdida', `vivo=${ultimo.vivo}`)
  }

  hr('(14) Pestaña de tabla: filtro inválido y error en el WHERE')
  {
    const e = entorno([conexion('c1')])
    const local = await e.gestor.leerTabla({ conexionId: 'c1', peticionId: 'x', objeto: { esquema: 'public', nombre: 't' }, where: 'a = 1; drop table t', pk: [], maxFilas: 500 })
    const le = local.ok && local.valor.tipo === 'error' ? local.valor.error : null
    check('«;» en el WHERE: error en el campo sin ir al servidor', le?.campo === 'where' && le.posicion === 5 && e.falsos.length === 0, JSON.stringify(le))
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        const cp = [...p.sql.slice(0, p.sql.indexOf('frm'))].length
        throw fallo('servidor', { codigo: '42601', mensaje: 'syntax error at or near "frm"', offsetCp: cp })
      }
      return respuestaPorDefecto(p, f)
    }
    const srv = await e.gestor.leerTabla({ conexionId: 'c1', peticionId: 'y', objeto: { esquema: 'public', nombre: 't' }, where: 'a frm 1', pk: [], maxFilas: 500 })
    const se = srv.ok && srv.valor.tipo === 'error' ? srv.valor.error : null
    check('error del servidor dentro del WHERE: campo where, posición en el campo', se?.campo === 'where' && se.posicion === 2, JSON.stringify(se))
    e.responder.actual = respuestaPorDefecto
    const sinPk = await e.gestor.leerTabla({ conexionId: 'c1', peticionId: 'z', objeto: { esquema: 'public', nombre: 't' }, pk: [], maxFilas: 500 })
    const sf = sinPk.ok && sinPk.valor.tipo === 'filas' ? (sinPk.valor as DbResultadoFilas) : null
    check('sin PK ni ORDER BY: aviso de orden no estable', !!sf?.avisos?.some((a) => /Sin orden estable/.test(a)), JSON.stringify(sf?.avisos))
  }

  hr('(15) DDL correcto -> aviso al catálogo')
  {
    const e = entorno([conexion('c1')])
    await ejecutar(e.gestor, 'create table nueva (a int)')
    await ejecutar(e.gestor, 'create table otra.t2 (a int)')
    check('DDL sin esquema: el actual de la sesión', e.ddl[0]?.[0] === 'c1' && e.ddl[0][1] === 'public' && e.ddl[0][2] === false, JSON.stringify(e.ddl[0]))
    check('DDL con esquema: ese esquema', e.ddl[1]?.[1] === 'otra', JSON.stringify(e.ddl[1]))
    await ejecutar(e.gestor, 'select 1')
    check('una consulta no avisa', e.ddl.length === 2, `${e.ddl.length}`)
  }

  hr('(16) cerrarTodo')
  {
    const e = entorno([conexion('c1'), conexion('c2')])
    await ejecutar(e.gestor, 'select 1', 'k1', 'c1')
    await e.gestor.catalogo('c2', async () => 1)
    await e.gestor.cerrarTodo(100)
    check('todos reciben «salir» y ninguno sigue vivo', e.falsos.every((f) => !f.vivo && f.ops('salir').length === 1) && e.gestor.procesosVivos() === 0, `vivos=${e.gestor.procesosVivos()}`)
    const tarde = await ejecutar(e.gestor, 'select 1', 'k1', 'c1')
    check('después no se lanza nada nuevo', !tarde.ok && e.falsos.length === 2, JSON.stringify(tarde))
    // Plan C de una actualización: el cierre se aborta y la app vuelve al usuario.
    e.gestor.reanudarTrasCierreAbortado()
    const otra = await ejecutar(e.gestor, 'select 1', 'k1', 'c1')
    const cat = await e.gestor.catalogo('c2', async () => 'árbol')
    check(
      'cierre abortado: la consola y el árbol reabren en procesos nuevos',
      otra.ok && cat === 'árbol' && e.falsos.length === 4 && e.falsos[2].vivo && e.falsos[3].vivo,
      `falsos=${e.falsos.length} consola=${JSON.stringify(otra.ok)}`
    )
  }

  hr('(17) Ningún log con SQL ni secreto en todo el recorrido')
  {
    // Un entorno más con todo lo sensible, y el log entero revisado.
    const e = entorno([conexion('c1')])
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && /secreta/.test(p.sql)) throw fallo('servidor', { mensaje: 'relation "tabla_secreta" does not exist', codigo: '42P01' })
      return respuestaPorDefecto(p, f)
    }
    await ejecutar(e.gestor, 'select * from tabla_secreta')
    await e.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'SELECT nspname FROM pg_namespace', binds: [] }))
    const sucio = e.logs.filter((l) => l.includes(SECRETO) || /tabla_secreta|pg_namespace/.test(l) || sqlEnviadas.some((s) => l.includes(s)))
    check('el log no tiene SQL, mensajes del servidor ni el secreto', sucio.length === 0 && e.logs.length > 0, sucio.join(' | ') || `${e.logs.length} líneas limpias`)
  }

  hr('(18) Stop de «más filas»: la que corre y la que espera')
  {
    // Antes «más» se encolaba sin clave: `cancelar` no lo encontraba, el Stop no
    // hacía nada y la re-ejecución lenta bloqueaba la sesión `datos` de la conexión.
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })])
    let puerta: Diferido<unknown> | null = null
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        if (puerta) return puerta
        return rFilas(500, { hayMas: true, lector: f.conexion.motor === 'oracle' ? (p.opciones.lector ?? null) : null })
      }
      if (p.op === 'leer' && puerta) return puerta
      return respuestaPorDefecto(p, f)
    }
    // PG: cada página re-ejecuta con OFFSET.
    const tabla = await e.gestor.leerTabla({ conexionId: 'c1', peticionId: 't1', objeto: { esquema: 'public', nombre: 'grande' }, pk: ['id'], maxFilas: 500 })
    const lector = tabla.ok && tabla.valor.tipo === 'filas' ? tabla.valor.lector : null
    check('PG: la tabla deja un lector (hay más)', lector !== null, String(lector))
    const f = e.falsos[0]
    puerta = new Diferido<unknown>()
    const m1 = e.gestor.leerMas(lector as string, 500, 'm1')
    await esperarA(() => f.ejecutados().length === 2)
    const m2 = e.gestor.leerMas(lector as string, 500, 'm2')
    await tic()
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'm2' })
    const r2 = await m2
    check('«más» en espera: sale de la cola sin enviarse', !r2.ok && r2.error.motivo === 'cancelada' && f.ejecutados().length === 2, JSON.stringify(r2))
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'm1' })
    check('«más» en curso: el trabajador recibe «cancelar»', f.ops('cancelar').length === 1, `cancelar=${f.ops('cancelar').length}`)
    const r1 = await m1
    check('y termina cancelada', !r1.ok && r1.error.motivo === 'cancelada', JSON.stringify(r1))
    puerta = null
    const m3 = await e.gestor.leerMas(lector as string, 500, 'm3')
    const ej = f.ejecutados()[2]
    check('la página siguiente sigue donde estaba (OFFSET 500)', m3.ok && m3.valor.desde === 500 && JSON.stringify(ej?.binds) === '[501,500]', JSON.stringify(ej?.binds))

    // Oracle: el Stop del `leer` del cursor lo suelta en el trabajador; aquí también.
    const tablaO = await e.gestor.leerTabla({ conexionId: 'o1', peticionId: 't2', objeto: { esquema: 'SCOTT', nombre: 'GRANDE' }, pk: ['ID'], maxFilas: 500 })
    const lo = tablaO.ok && tablaO.valor.tipo === 'filas' ? tablaO.valor.lector : null
    const fo = e.falsos.find((x) => x.conexion.id === 'o1') as TrabajadorFalso
    puerta = new Diferido<unknown>()
    const mo = e.gestor.leerMas(lo as string, 500, 'mo1')
    await esperarA(() => fo.ops('leer').length === 1)
    e.gestor.cancelar({ rol: 'datos', conexionId: 'o1', peticionId: 'mo1' })
    const ro = await mo
    check('Oracle: Stop del «leer» del cursor: cancelar enviado y cancelada', !ro.ok && ro.error.motivo === 'cancelada' && fo.ops('cancelar').length === 1, JSON.stringify(ro))
    puerta = null
    const mo2 = await e.gestor.leerMas(lo as string, 500, 'mo2')
    check(
      'Oracle: después no pide el cursor soltado, re-ejecuta (ROWNUM)',
      mo2.ok && mo2.valor.reejecutada === true && fo.ops('leer').length === 1 && fo.ejecutados().length === 2,
      `leer=${fo.ops('leer').length} ejecutar=${fo.ejecutados().length}`
    )
  }

  hr('(19a) PG tras una sentencia tx o el botón Revertir: un SET a mano manda')
  {
    const esquemas = new Map<string, string>()
    const e = entorno([conexion('c1')], { esquemas })
    const pg = new PgEsquemaFalso()
    e.responder.actual = pg.responder
    const sets = (): string[] =>
      e.falsos[0].ejecutados().filter((x) => /set_config\('search_path'/.test(x.sql)).map((x) => String((x.binds as unknown[])[0]))
    const estado = (k: string): string | null | undefined => e.gestor.estadoConsola('perfil1', k)?.esquema
    const ultimoInsert = (k: string): string | null | undefined => pg.inserts.filter((x) => x[0] === `consola:${k}`).at(-1)?.[1]

    // (A) El escenario del hallazgo: elegido ventas, SET a mano a compras, BEGIN, INSERT, COMMIT.
    esquemas.set('kA', 'ventas')
    await ejecutar(e.gestor, 'select 1', 'kA')
    check('al abrir se aplica el elegido', estado('kA') === 'ventas' && sets().length === 1, `${estado('kA')} sets=${JSON.stringify(sets())}`)
    await ejecutar(e.gestor, 'set search_path to compras', 'kA')
    const sA = sets().length
    await ejecutar(e.gestor, 'begin', 'kA')
    check('A: tras un SET a mano a compras, BEGIN NO vuelve a ventas', sets().length === sA && estado('kA') === 'compras', `${estado('kA')} sets=${JSON.stringify(sets().slice(sA))}`)
    await ejecutar(e.gestor, 'insert into pedidos values (1)', 'kA')
    await ejecutar(e.gestor, 'commit', 'kA')
    check('A: el INSERT cae en compras y el COMMIT tampoco reaplica', ultimoInsert('kA') === 'compras' && sets().length === sA && estado('kA') === 'compras', `insert en ${ultimoInsert('kA')}, ${estado('kA')}`)

    // (B) BEGIN; SET LOCAL compras; SAVEPOINT a; INSERT.
    esquemas.set('kB', 'ventas')
    await ejecutar(e.gestor, 'select 1', 'kB')
    await ejecutar(e.gestor, 'begin', 'kB')
    await ejecutar(e.gestor, 'set local search_path to compras', 'kB')
    const sB = sets().length
    await ejecutar(e.gestor, 'savepoint a', 'kB')
    await ejecutar(e.gestor, 'insert into pedidos values (2)', 'kB')
    check('B: un SAVEPOINT no pisa el SET LOCAL y el INSERT cae en compras', sets().length === sB && ultimoInsert('kB') === 'compras', `insert en ${ultimoInsert('kB')}`)
    await ejecutar(e.gestor, 'rollback', 'kB')
    check('B: el ROLLBACK vuelve al confirmado (ventas), leído del servidor', estado('kB') === 'ventas' && sets().length === sB, `${estado('kB')}`)

    // (C) SET compras FUERA de una tx y un ROLLBACK sin transacción.
    esquemas.set('kC', 'ventas')
    await ejecutar(e.gestor, 'select 1', 'kC')
    await ejecutar(e.gestor, 'set search_path to compras', 'kC')
    const sC = sets().length
    await ejecutar(e.gestor, 'rollback', 'kC')
    check('C: un ROLLBACK que no revirtió nada deja compras', sets().length === sC && estado('kC') === 'compras', `${estado('kC')}`)

    // (E) La mitad que SÍ reaplica: el selector puso ventas dentro de la tx y la
    // sentencia ROLLBACK lo deshizo.
    await e.gestor.modoTx(refConsola('kE'), 'manual')
    await ejecutar(e.gestor, 'select 1', 'kE')
    esquemas.set('kE', 'ventas')
    const fE = await e.gestor.fijarEsquemaConsola(refConsola('kE'), 'ventas')
    const sE = sets().length
    await ejecutar(e.gestor, 'rollback', 'kE')
    check(
      'E: elegir ventas dentro de la tx y escribir ROLLBACK -> se vuelve a aplicar',
      fE.ok && sets().length === sE + 1 && estado('kE') === 'ventas' && pg.esquemaDe('consola:kE') === 'ventas',
      `${estado('kE')} sets=${JSON.stringify(sets().slice(sE))}`
    )

    // Botón Revertir: la misma mitad positiva…
    await e.gestor.modoTx(refConsola('kF'), 'manual')
    await ejecutar(e.gestor, 'select 1', 'kF')
    esquemas.set('kF', 'ventas')
    await e.gestor.fijarEsquemaConsola(refConsola('kF'), 'ventas')
    const sF = sets().length
    const rbF = await e.gestor.txConsola(refConsola('kF'), 'rollback')
    check('botón: elegido dentro de la tx y Revertir -> se vuelve a aplicar', rbF.ok && rbF.valor.esquema === 'ventas' && sets().length === sF + 1, JSON.stringify(rbF.ok ? rbF.valor.esquema : rbF))
    // …y la negativa: un SET a mano CONFIRMADO no lo pisa el botón.
    esquemas.set('kG', 'ventas')
    await ejecutar(e.gestor, 'select 1', 'kG')
    await ejecutar(e.gestor, 'set search_path to compras', 'kG')
    await e.gestor.modoTx(refConsola('kG'), 'manual')
    await ejecutar(e.gestor, 'select 1', 'kG')
    const sG = sets().length
    const lecturasG = e.falsos[0].ejecutados().filter((x) => x.sql === 'SELECT current_schema()').length
    const rbG = await e.gestor.txConsola(refConsola('kG'), 'rollback')
    check(
      'botón: tras un SET a mano a compras, Revertir NO vuelve a ventas (solo relee)',
      rbG.ok && rbG.valor.esquema === 'compras' && sets().length === sG && e.falsos[0].ejecutados().filter((x) => x.sql === 'SELECT current_schema()').length === lecturasG + 1,
      JSON.stringify(rbG.ok ? rbG.valor.esquema : rbG)
    )
    // Sin elegido, un SET dentro de la tx que la reversión deshace: la barra no se queda vieja.
    await e.gestor.modoTx(refConsola('kH'), 'manual')
    await ejecutar(e.gestor, 'select 1', 'kH')
    await ejecutar(e.gestor, 'set search_path to compras', 'kH')
    const antesH = estado('kH')
    const rbH = await e.gestor.txConsola(refConsola('kH'), 'rollback')
    check('botón: un SET dentro de la tx se revierte y el estado lo relee (public)', antesH === 'compras' && rbH.ok && rbH.valor.esquema === 'public', `${antesH} -> ${JSON.stringify(rbH.ok ? rbH.valor.esquema : rbH)}`)
  }

  hr('(19b) Un lector está atado al esquema con el que nació')
  {
    const esquemas = new Map<string, string>()
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })], { esquemas })
    const pg = new PgEsquemaFalso()
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === 'select * from grande') {
        const salto = p.opciones.saltarFilas ?? 0
        const quedan = 1234 - salto
        const lector = f.conexion.motor === 'oracle' ? (p.opciones.lector ?? null) : null
        return rFilas(Math.min(quedan, p.opciones.maxFilas), { hayMas: quedan > p.opciones.maxFilas, saltadas: salto, lector })
      }
      if (p.op === 'ejecutar' && /^SELECT COUNT/.test(p.sql)) return rFilas(1, { filasJson: '[["1234"]]' })
      if (f.conexion.motor === 'oracle') {
        const alter = p.op === 'ejecutar' ? /^ALTER SESSION SET CURRENT_SCHEMA = "(.+)"$/.exec(p.sql) : null
        if (alter) return { tipo: 'hecho', comando: null, ms: 1, tx: 'ninguna', esquema: alter[1] }
        if (p.op === 'leer') return { filasJson: JSON.stringify([['x']]), nFilas: 1, hayMas: true, lector: p.lector, ms: 1 }
        return respuestaPorDefecto(p, f)
      }
      return pg.responder(p, f)
    }
    const fpg = (): TrabajadorFalso => e.falsos.find((x) => x.conexion.id === 'c1') as TrabajadorFalso
    const vecesGrande = (f: TrabajadorFalso): number => f.ejecutados().filter((x) => x.sql === 'select * from grande').length
    const lectorDe = (r: Awaited<ReturnType<typeof ejecutar>>): string => (r.ok && r.valor.tipo === 'filas' ? (r.valor.lector ?? '') : '')

    // PG: nace en public; el selector pasa a ventas.
    const l1 = lectorDe(await ejecutar(e.gestor, 'select * from grande', 'kL'))
    esquemas.set('kL', 'ventas')
    await e.gestor.fijarEsquemaConsola(refConsola('kL'), 'ventas')
    const antes = vecesGrande(fpg())
    const cnt = await e.gestor.contar(l1, 'cuenta-l1')
    check(
      'PG: Contar en otro esquema -> noReleible, sin enviar el COUNT',
      !cnt.ok && cnt.error.motivo === 'noReleible' && cnt.error.mensaje === MENSAJE_ESQUEMA_CAMBIADO && !fpg().ejecutados().some((x) => /^SELECT COUNT/.test(x.sql)),
      JSON.stringify(cnt)
    )
    const mas = await e.gestor.leerMas(l1, 500)
    check(
      'PG: «más» en otro esquema -> noReleible y NO se re-ejecuta (nada de mezclar tablas)',
      !mas.ok && mas.error.motivo === 'noReleible' && mas.error.mensaje === MENSAJE_ESQUEMA_CAMBIADO && vecesGrande(fpg()) === antes,
      JSON.stringify(mas)
    )
    const mas2 = await e.gestor.leerMas(l1, 500)
    check('y el lector queda cerrado (la rejilla ya lo dio por cerrado)', !mas2.ok && mas2.error.mensaje === MENSAJE_SIN_LECTOR, JSON.stringify(mas2))
    // Volver al esquema de nacimiento ANTES de leer no rompe nada.
    const l2 = lectorDe(await ejecutar(e.gestor, 'select * from grande', 'kL'))
    esquemas.set('kL', 'compras')
    await e.gestor.fijarEsquemaConsola(refConsola('kL'), 'compras')
    esquemas.set('kL', 'ventas')
    await e.gestor.fijarEsquemaConsola(refConsola('kL'), 'ventas')
    const mas3 = await e.gestor.leerMas(l2, 500)
    check('PG: ir a compras y volver a ventas antes de leer: «más» sigue (re-ejecuta desde 500)', mas3.ok && mas3.valor.desde === 500 && mas3.valor.reejecutada === true, JSON.stringify(mas3.ok ? { desde: mas3.valor.desde } : mas3))
    // Un SET a mano cuenta igual que el selector.
    const l3 = lectorDe(await ejecutar(e.gestor, 'select * from grande', 'kL'))
    await ejecutar(e.gestor, 'set search_path to compras', 'kL')
    const mas4 = await e.gestor.leerMas(l3, 500)
    check('PG: tras un SET search_path a mano, lo mismo', !mas4.ok && mas4.error.mensaje === MENSAJE_ESQUEMA_CAMBIADO, JSON.stringify(mas4))

    // Oracle: el cursor vivo quedó resuelto contra el esquema original y sigue.
    const lo = lectorDe(await ejecutar(e.gestor, 'select * from grande', 'kO', 'o1'))
    esquemas.set('kO', 'HR')
    const fO = await e.gestor.fijarEsquemaConsola(refConsola('kO', 'o1'), 'HR')
    const fo = e.falsos.find((x) => x.conexion.id === 'o1') as TrabajadorFalso
    const mo = await e.gestor.leerMas(lo, 500)
    check('Oracle: con el cursor vivo, «más» sigue leyendo del cursor tras cambiar de esquema', fO.ok && fO.valor.esquema === 'HR' && mo.ok && fo.ops('leer').length === 1 && vecesGrande(fo) === 1, JSON.stringify(mo.ok ? mo.valor.desde : mo))
    const co = await e.gestor.contar(lo, 'cuenta-o')
    const mo2 = await e.gestor.leerMas(lo, 500)
    check('Oracle: pero Contar re-ejecuta el texto -> noReleible, y el cursor sigue vivo', !co.ok && co.error.mensaje === MENSAJE_ESQUEMA_CAMBIADO && mo2.ok && fo.ops('leer').length === 2, JSON.stringify(co))

    // Exportar: el esquema que vio el renderer al ejecutar.
    const ref = refConsola('kL')
    const exportar = (esquema: string | null | undefined): string => {
      try {
        e.gestor.validarExportacionConsulta(ref, 'select * from grande', esquema)
        return 'ok'
      } catch (err) {
        return err instanceof ErrorGestor ? `${err.error.motivo}: ${err.error.mensaje}` : String(err)
      }
    }
    check('exportar: en otro esquema -> noReleible antes del diálogo', exportar('ventas') === `noReleible: ${MENSAJE_ESQUEMA_CAMBIADO}`, exportar('ventas'))
    check('exportar: en el mismo, o sin saberlo (null / ausente), sigue', exportar('compras') === 'ok' && exportar(null) === 'ok' && exportar(undefined) === 'ok', `${exportar('compras')} ${exportar(null)} ${exportar(undefined)}`)
    // Con la sesión cerrada (por inactividad: sigue con el esquema que tenía), reabrir
    // aplica el elegido: la comprobación se repite dentro, ya con la sesión abierta.
    esquemas.set('kX', 'ventas')
    await ejecutar(e.gestor, 'select 1', 'kX')
    await ejecutar(e.gestor, 'set search_path to compras', 'kX')
    e.gestor.barrer(e.reloj.t + 31 * 60_000)
    const cerrada = e.gestor.estadoConsola('perfil1', 'kX')
    const antesX = vecesGrande(fpg())
    let paginas = 0
    let errX = ''
    try {
      await e.gestor.exportarConsulta({ ...refConsola('kX'), sql: 'select * from grande', peticionId: 'exp-x', topes: {}, esquema: 'compras' }, async () => {
        paginas++
      }, () => false)
    } catch (err) {
      errX = err instanceof ErrorGestor ? err.error.mensaje : String(err)
    }
    check(
      'exportar con la sesión cerrada: reabre en el elegido (ventas) y no exporta la de compras',
      cerrada?.fase === 'cerrada' && cerrada.esquema === 'compras' && errX === MENSAJE_ESQUEMA_CAMBIADO && paginas === 0 && vecesGrande(fpg()) === antesX && e.gestor.estadoConsola('perfil1', 'kX')?.esquema === 'ventas',
      JSON.stringify({ fase: cerrada?.fase, esquema: cerrada?.esquema, errX, paginas })
    )
  }

  hr('(19c) Al reabrir, solo la señal real de «no existe» olvida el esquema')
  {
    const oracle = async (
      alter: (p: PeticionSinIdDe<'ejecutar'>) => unknown
    ): Promise<{ e: Entorno; esquemas: Map<string, string>; r: Awaited<ReturnType<typeof ejecutar>> }> => {
      const esquemas = new Map<string, string>([['kR', 'HR']])
      const e = entorno([conexion('o1', { motor: 'oracle' })], { esquemas })
      e.responder.actual = (p, f) => (p.op === 'ejecutar' && /^ALTER SESSION/.test(p.sql) ? alter(p) : respuestaPorDefecto(p, f))
      const r = await ejecutar(e.gestor, 'select 1 from dual', 'kR', 'o1')
      return { e, esquemas, r }
    }
    const avisos = (r: Awaited<ReturnType<typeof ejecutar>>): string[] => (r.ok && r.valor.tipo === 'filas' ? (r.valor.avisos ?? []) : [])
    const o1 = await oracle(() => ({ tipo: 'hecho', comando: null, ms: 1, tx: 'ninguna', esquema: null }))
    check(
      'Oracle: el ALTER fue bien y la relectura no llegó -> NO se olvida y la sesión dice HR',
      o1.e.perdidos.length === 0 && o1.esquemas.get('kR') === 'HR' && o1.e.gestor.estadoConsola('perfil1', 'kR')?.esquema === 'HR' && avisos(o1.r).length === 0,
      JSON.stringify({ perdidos: o1.e.perdidos, estado: o1.e.gestor.estadoConsola('perfil1', 'kR')?.esquema, avisos: avisos(o1.r) })
    )
    const o2 = await oracle(() => {
      throw fallo('servidor', { codigo: 'ORA-12571', mensaje: 'ORA-12571: TNS:packet writer failure' })
    })
    check(
      'Oracle: ORA-12571 (red, fuera de los de pérdida) -> NO se olvida, sin aviso falso; la sesión en el de la conexión',
      o2.e.perdidos.length === 0 && o2.esquemas.get('kR') === 'HR' && o2.e.gestor.estadoConsola('perfil1', 'kR')?.esquema === 'SCOTT' && avisos(o2.r).length === 0,
      JSON.stringify({ perdidos: o2.e.perdidos, avisos: avisos(o2.r) })
    )
    const o3 = await oracle(() => {
      throw fallo('servidor', { codigo: 'ORA-01435', mensaje: 'ORA-01435: user does not exist' })
    })
    check(
      'Oracle: ORA-01435 -> SÍ se olvida y se avisa (la señal real)',
      JSON.stringify(o3.e.perdidos) === '[["kR","HR"]]' && !o3.esquemas.has('kR') && avisos(o3.r).some((a) => /HR/.test(a) && /ya no existe/.test(a)),
      JSON.stringify({ perdidos: o3.e.perdidos, avisos: avisos(o3.r) })
    )
    // fijarEsquemaConsola: la misma confianza en el ALTER.
    const oF = entorno([conexion('o1', { motor: 'oracle' })], { esquemas: new Map() })
    oF.responder.actual = (p, f) => (p.op === 'ejecutar' && /^ALTER SESSION/.test(p.sql) ? { tipo: 'hecho', comando: null, ms: 1, tx: 'ninguna', esquema: null } : respuestaPorDefecto(p, f))
    await ejecutar(oF.gestor, 'select 1 from dual', 'kF', 'o1')
    const fF = await oF.gestor.fijarEsquemaConsola(refConsola('kF', 'o1'), 'HR')
    check('Oracle: fijar con el ALTER bien y sin relectura -> ok en HR (no lo deshace)', fF.ok && fF.valor.esquema === 'HR', JSON.stringify(fF))
    // El mensaje es de la sesión de cada motor
    // (`mensajeEsquemaNoAplicado`). Si la relectura de Oracle dice OTRO esquema (no debería
    // pasar: el ALTER valida), el mensaje es el de Oracle, al byte, y no el del USAGE de PG.
    const oG = entorno([conexion('o1', { motor: 'oracle' })], { esquemas: new Map() })
    oG.responder.actual = (p, f) =>
      p.op === 'ejecutar' && p.sql === 'ALTER SESSION SET CURRENT_SCHEMA = "HR"' ? { tipo: 'hecho', comando: null, ms: 1, tx: 'ninguna', esquema: 'OTRO' } : respuestaPorDefecto(p, f)
    await ejecutar(oG.gestor, 'select 1 from dual', 'kG', 'o1')
    const fG = await oG.gestor.fijarEsquemaConsola(refConsola('kG', 'o1'), 'HR')
    check('Oracle: si la relectura dice otro esquema, el mensaje de Oracle (sin USAGE), al byte', !fG.ok && fG.error.mensaje === 'El esquema HR no existe en esta conexión.', JSON.stringify(fG))
    check(
      'versionMayor: sin versión, la mínima de cada motor (11 Oracle, 12 PG, las de antes); con ella, la mayor',
      versionMayor(undefined, 'oracle') === 11 && versionMayor('', 'postgres') === 12 && versionMayor('Oracle Database 19c', 'oracle') === 19 && versionMayor('16.4', 'postgres') === 16,
      JSON.stringify([versionMayor(undefined, 'oracle'), versionMayor('', 'postgres')])
    )

    const postgres = async (preparar: (pg: PgEsquemaFalso) => void): Promise<{ e: Entorno; esquemas: Map<string, string>; r: Awaited<ReturnType<typeof ejecutar>>; pg: PgEsquemaFalso }> => {
      const esquemas = new Map<string, string>([['kP', 'ventas']])
      const e = entorno([conexion('c1')], { esquemas })
      const pg = new PgEsquemaFalso()
      preparar(pg)
      e.responder.actual = pg.responder
      const r = await ejecutar(e.gestor, 'select 1', 'kP')
      return { e, esquemas, r, pg }
    }
    const p1 = await postgres((pg) => {
      // La conexión muere justo tras el set_config: el trabajador avisa la pérdida y la
      // relectura de current_schema() responde null.
      pg.alFijar = (p, f) => {
        pg.relecturaRota = true
        f.emitirEvento({ ev: 'perdida', sesion: p.sesion, error: { clase: 'perdida', mensaje: 'Connection terminated unexpectedly' } })
      }
    })
    check('PG: pérdida durante la relectura -> NO se olvida ni se avisa', p1.e.perdidos.length === 0 && p1.esquemas.get('kP') === 'ventas', JSON.stringify({ perdidos: p1.e.perdidos, r: p1.r.ok ? p1.r.valor.tipo : p1.r }))
    const p2 = await postgres((pg) => {
      pg.relecturaRota = true
    })
    const resets2 = p2.e.falsos[0].ejecutados().filter((x) => x.sql === 'RESET search_path').length
    check(
      'PG: relectura null con la sesión viva -> vuelve al de la conexión SIN olvidar ni avisar',
      p2.e.perdidos.length === 0 && p2.esquemas.get('kP') === 'ventas' && resets2 === 1 && avisos(p2.r).length === 0,
      JSON.stringify({ perdidos: p2.e.perdidos, resets: resets2, avisos: avisos(p2.r) })
    )
    const p3 = await postgres((pg) => {
      pg.existen.delete('ventas')
    })
    check(
      'PG: current_schema() lo salta (ya no existe) -> SÍ se olvida, se avisa y queda en public',
      JSON.stringify(p3.e.perdidos) === '[["kP","ventas"]]' && avisos(p3.r).some((a) => /ventas/.test(a)) && p3.e.gestor.estadoConsola('perfil1', 'kP')?.esquema === 'public',
      JSON.stringify({ perdidos: p3.e.perdidos, avisos: avisos(p3.r) })
    )
  }

  hr('(19d) Si PG salta el esquema pedido, se vuelve al elegido ANTERIOR')
  {
    const esquemas = new Map<string, string>([['kV', 'ventas']])
    const e = entorno([conexion('c1')], { esquemas })
    const pg = new PgEsquemaFalso()
    e.responder.actual = pg.responder
    await ejecutar(e.gestor, 'select 1', 'kV')
    // Como el controlador: el mapa ya dice el nuevo mientras se aplica.
    esquemas.set('kV', 'sin_usage')
    const r = await e.gestor.fijarEsquemaConsola(refConsola('kV'), 'sin_usage', 'ventas')
    const ultimoSet = e.falsos[0].ejecutados().filter((x) => /set_config\('search_path'/.test(x.sql)).at(-1)
    check(
      'no cuaja: la sesión vuelve a ventas (el anterior), no al de la conexión',
      !r.ok && e.gestor.estadoConsola('perfil1', 'kV')?.esquema === 'ventas' && pg.esquemaDe('consola:kV') === 'ventas' && JSON.stringify(ultimoSet?.binds) === '["\\"ventas\\", public"]',
      JSON.stringify({ r, estado: e.gestor.estadoConsola('perfil1', 'kV')?.esquema })
    )
    check('y el mensaje no afirma que no exista: puede faltar el permiso USAGE', !r.ok && /USAGE/.test(r.error.mensaje) && /sin_usage/.test(r.error.mensaje), r.ok ? '' : r.error.mensaje)
    check(
      'el mensaje de PG es el de siempre, al byte (sale de la sesión de PG)',
      !r.ok && r.error.mensaje === 'No se puede usar el esquema sin_usage en esta conexión: no existe o no tienes permiso de uso (USAGE) sobre él.',
      r.ok ? '' : r.error.mensaje
    )
    // Sin anterior (era el de la conexión): RESET.
    await ejecutar(e.gestor, 'select 1', 'kW')
    esquemas.set('kW', 'sin_usage')
    const r2 = await e.gestor.fijarEsquemaConsola(refConsola('kW'), 'sin_usage', null)
    check(
      'sin anterior: RESET search_path, al de la conexión',
      !r2.ok && e.gestor.estadoConsola('perfil1', 'kW')?.esquema === 'public' && e.falsos[0].ejecutados().some((x) => x.sesion === 'consola:kW' && x.sql === 'RESET search_path'),
      JSON.stringify(e.gestor.estadoConsola('perfil1', 'kW')?.esquema)
    )
    // El mensaje lo da la SESIÓN del motor
    // (`mensajeEsquemaNoAplicado`), no la bandera `fijarEsquemaValida`. Con el de PG
    // cambiado a propósito (y restaurado) el gestor lo sigue; con el ternario sobre la
    // bandera, seguiría diciendo el del USAGE y los casos de arriba no lo verían.
    await ejecutar(e.gestor, 'select 1', 'kX')
    esquemas.set('kX', 'sin_usage')
    const sesionPg = MOTORES_EXPLORADOR.postgres.sesion as { mensajeEsquemaNoAplicado: (x: string) => string }
    const mensajeDePg = sesionPg.mensajeEsquemaNoAplicado
    let r3: Awaited<ReturnType<typeof e.gestor.fijarEsquemaConsola>>
    try {
      sesionPg.mensajeEsquemaNoAplicado = (x) => `mensaje del motor para ${x}`
      r3 = await e.gestor.fijarEsquemaConsola(refConsola('kX'), 'sin_usage', null)
    } finally {
      sesionPg.mensajeEsquemaNoAplicado = mensajeDePg
    }
    check('el mensaje sale de la sesión del motor (cambiado a propósito, el gestor lo sigue)', !r3.ok && r3.error.mensaje === 'mensaje del motor para sin_usage', JSON.stringify(r3))
  }

  hr('(20) Exportar una tabla de PG: UNA lectura con cursor vivo en una sesión efímera')
  {
    // Antes: primera página con LIMIT/OFFSET en `datos` y cada «más» re-ejecutando con
    // otro OFFSET (coste cuadrático, una instantánea por página, empates que se repiten).
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })])
    let puerta: Diferido<unknown> | null = null
    let leidas = 0
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario' && (p.opciones.mantenerCursor === true || f.conexion.motor === 'oracle')) {
        return rFilas(3, { hayMas: true, lector: p.opciones.lector ?? null })
      }
      if (p.op === 'leer') {
        if (puerta) return puerta
        leidas++
        const ultima = leidas % 2 === 0
        return { filasJson: JSON.stringify([[`p${leidas}`]]), nFilas: 1, hayMas: !ultima, lector: ultima ? null : p.lector, ms: 1 }
      }
      return respuestaPorDefecto(p, f)
    }
    const peticion = (peticionId: string, extra: Partial<PeticionTabla> = {}): PeticionTabla => ({
      conexionId: 'c1',
      peticionId,
      objeto: { esquema: 'public', nombre: 'grande' },
      pk: ['id'],
      maxFilas: 5000,
      topes: { topeCelda: 123 },
      ...extra
    })
    const sesionesDe = (op: OpTrabajador, f: TrabajadorFalso): string[] =>
      f.ops(op).map((m) => (m as { sesion?: string }).sesion ?? '')
    // Una pestaña de la tabla ya abierta: su sesión `datos` es otra.
    await e.gestor.leerTabla({ ...peticion('t0'), maxFilas: 500 })
    const f = e.falsos[0]
    const eventosAntes = e.eventos.length
    const paginas: string[] = []
    const r1 = await e.gestor.exportarTabla(peticion('exp-1'), async (pg) => {
      paginas.push(pg.filasJson)
    }, () => false)
    const ej = f.ejecutados().find((x) => x.opciones.mantenerCursor === true)
    const abrirExp = (f.ops('abrir') as Array<PeticionSinIdDe<'abrir'>>).find((x) => x.sesion === 'exportacion:exp-1')
    check(
      'UN ejecutar con cursor vivo y el SQL de la pestaña SIN límite: `LIMIT $1 OFFSET $2` con [null, 0], orden por la PK y sus topes',
      ej !== undefined && /ORDER BY "id"\nLIMIT \$1 OFFSET \$2$/.test(ej.sql) && JSON.stringify(ej.binds) === '[null,0]' && ej.opciones.topeCelda === 123 && ej.opciones.sinBegin === true,
      JSON.stringify(ej && { sql: ej.sql, binds: ej.binds, opciones: ej.opciones })
    )
    check(
      'en su PROPIA sesión del trabajador (no en `datos`), abierta como «exportar» con el rol de `datos`',
      ej?.sesion === 'exportacion:exp-1' && abrirExp?.rol === 'datos' && abrirExp.opciones.accion === 'exportar',
      JSON.stringify(abrirExp && { sesion: ej?.sesion, rol: abrirExp.rol, accion: abrirExp.opciones.accion })
    )
    check(
      'las páginas siguientes son `leer` de ESE cursor, sin re-ejecutar nada',
      f.ejecutados().filter((x) => x.sesion === 'exportacion:exp-1').length === 1 && sesionesDe('leer', f).every((x) => x === 'exportacion:exp-1') && sesionesDe('leer', f).length === 2 && paginas.length === 3,
      `paginas=${paginas.length} leer=${sesionesDe('leer', f).join(',')}`
    )
    check('sin aviso de orden: es una sola lectura', r1.aviso === undefined, JSON.stringify(r1))
    check(
      'al acabar se cierra en el trabajador y no queda en la lista',
      sesionesDe('cerrar', f).includes('exportacion:exp-1') && e.gestor.sesiones().length === 1 && e.gestor.sesiones()[0].ref.rol === 'datos',
      JSON.stringify({ cerrar: sesionesDe('cerrar', f), sesiones: e.gestor.sesiones().map((x) => x.ref.rol) })
    )
    check('ni se emite ni ocupa `datos`: ningún dbx:ev:sesion mientras exporta', e.eventos.length === eventosAntes, `${e.eventos.length - eventosAntes} eventos`)

    // Stop con la lectura en vuelo; mientras tanto la pestaña de la tabla no espera.
    puerta = new Diferido<unknown>()
    const p2 = e.gestor.exportarTabla(peticion('exp-2'), async () => {}, () => false).then(
      (): unknown => null,
      (x: unknown) => x
    )
    await esperarA(() => f.ops('leer').length === 3)
    const durante = e.gestor.sesiones()
    const otraPestana = await e.gestor.leerTabla({ ...peticion('t1'), maxFilas: 500 })
    check(
      'mientras exporta: la pestaña de la tabla lee en `datos` sin esperar, y la efímera no se lista',
      otraPestana.ok && otraPestana.valor.tipo === 'filas' && durante.length === 1,
      JSON.stringify({ durante: durante.map((x) => x.ref.rol), otra: otraPestana.ok })
    )
    e.gestor.cancelar({ rol: 'exportacion', peticionId: 'exp-2' })
    const err2 = await p2
    check(
      'Stop con la lectura en vuelo: «cancelar» a la sesión efímera, cancelada, y se cierra igual',
      sesionesDe('cancelar', f).includes('exportacion:exp-2') && err2 instanceof ErrorGestor && err2.error.motivo === 'cancelada' && sesionesDe('cerrar', f).includes('exportacion:exp-2'),
      JSON.stringify({ err: err2 instanceof ErrorGestor ? err2.error : String(err2), cancelar: sesionesDe('cancelar', f) })
    )
    puerta = null

    // Pérdida del proceso a media lectura: se olvida igual (el mismo id vuelve a valer).
    puerta = new Diferido<unknown>()
    const p4 = e.gestor.exportarTabla(peticion('exp-4'), async () => {}, () => false).then(
      (): unknown => null,
      (x: unknown) => x
    )
    await esperarA(() => f.ops('leer').length === 4)
    f.morir(null, 'SIGKILL')
    const err4 = await p4
    puerta = null
    let otraVez = ''
    try {
      await e.gestor.exportarTabla(peticion('exp-4'), async () => {}, () => false)
      otraVez = 'ok'
    } catch (x) {
      otraVez = x instanceof ErrorGestor ? x.error.motivo : String(x)
    }
    check(
      'pérdida del proceso a media lectura: sesionPerdida, y la efímera se olvidó (el mismo peticionId vuelve a exportar)',
      err4 instanceof ErrorGestor && err4.error.motivo === 'sesionPerdida' && otraVez === 'ok',
      JSON.stringify({ err: err4 instanceof ErrorGestor ? err4.error.motivo : String(err4), otraVez })
    )

    // Un WHERE que el servidor rechaza: el error del campo, como en la pestaña.
    e.responder.actual = (p, fx) => {
      if (p.op === 'ejecutar' && p.opciones.mantenerCursor === true) {
        const cp = [...p.sql.slice(0, p.sql.indexOf('frm'))].length
        throw fallo('servidor', { codigo: '42601', mensaje: 'syntax error at or near "frm"', offsetCp: cp })
      }
      return respuestaPorDefecto(p, fx)
    }
    let err3: unknown = null
    try {
      await e.gestor.exportarTabla(peticion('exp-3', { where: 'a frm 1' }), async () => {}, () => false)
    } catch (x) {
      err3 = x
    }
    const f2 = e.falsos[e.falsos.length - 1]
    check(
      'un WHERE que el servidor rechaza: su campo y su posición, y la efímera cerrada',
      err3 instanceof ErrorGestor && err3.error.campo === 'where' && err3.error.posicion === 2 && sesionesDe('cerrar', f2).includes('exportacion:exp-3'),
      JSON.stringify(err3 instanceof ErrorGestor ? err3.error : String(err3))
    )

    // Oracle: TAMBIÉN en su sesión efímera. Antes iba por `datos` y su cursor
    // competía con el de cada pestaña en los LRU de lectores (8 por sesión): la novena
    // pestaña abierta a media exportación lo expulsaba y la exportación fallaba sin lector
    // (LRU del main) o seguía por el ROWNUM de respaldo con OTRA instantánea (LRU del
    // trabajador). En su sesión es el único cursor: nada lo expulsa.
    leidas = 0
    e.responder.actual = (p, fx) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') return rFilas(3, { hayMas: true, lector: p.opciones.lector ?? null })
      if (p.op === 'leer') {
        leidas++
        const ultima = leidas % 2 === 0
        return { filasJson: JSON.stringify([[`o${leidas}`]]), nFilas: 1, hayMas: !ultima, lector: ultima ? null : p.lector, ms: 1 }
      }
      return respuestaPorDefecto(p, fx)
    }
    const reqO: PeticionTabla = { ...peticion('exp-o'), conexionId: 'o1', objeto: { esquema: 'SCOTT', nombre: 'GRANDE' }, pk: ['ID'] }
    const paginasO: string[] = []
    let errO: unknown = null
    try {
      await e.gestor.exportarTabla(
        reqO,
        async (pg) => {
          paginasO.push(pg.filasJson)
          if (paginasO.length === 1) {
            // Una pestaña MÁS que el LRU de lectores de `datos`, todas con más por leer.
            for (let i = 0; i <= MAX_LECTORES_POR_SESION; i++) await e.gestor.leerTabla({ ...reqO, peticionId: `lru-o-${i}`, maxFilas: 500 })
          }
        },
        () => false
      )
    } catch (x) {
      errO = x instanceof ErrorGestor ? x.error : String(x)
    }
    const fo = e.falsos.find((x) => x.conexion.id === 'o1') as TrabajadorFalso
    const ejO = fo.ejecutados().filter((x) => x.sesion === 'exportacion:exp-o')
    const abrirO = (fo.ops('abrir') as Array<PeticionSinIdDe<'abrir'>>).find((x) => x.sesion === 'exportacion:exp-o')
    check(
      'Oracle: UN ejecutar en SU sesión efímera («exportar», rol datos), en forma de cursor (sin ROWNUM ni binds), con su lector y sus topes',
      ejO.length === 1 && ejO[0].sql === 'SELECT * FROM "SCOTT"."GRANDE"' && (ejO[0].binds === undefined || JSON.stringify(ejO[0].binds) === '[]') &&
        typeof ejO[0].opciones.lector === 'string' && ejO[0].opciones.mantenerCursor === undefined && ejO[0].opciones.topeCelda === 123 &&
        abrirO?.rol === 'datos' && abrirO.opciones.accion === 'exportar',
      JSON.stringify({ ejO, abrir: abrirO && { rol: abrirO.rol, accion: abrirO.opciones.accion } })
    )
    const leerO = sesionesDe('leer', fo)
    check(
      `Oracle: con ${MAX_LECTORES_POR_SESION + 1} pestañas abiertas a media exportación, TODAS las páginas salen de ESE cursor (sin re-ejecutar, sin fallar)`,
      errO === null && paginasO.length === 3 && leerO.length === 2 && leerO.every((x) => x === 'exportacion:exp-o') &&
        !fo.ejecutados().some((x) => /ROWNUM/i.test(x.sql)) && fo.ejecutados().filter((x) => x.sesion === 'datos').length === MAX_LECTORES_POR_SESION + 1,
      JSON.stringify({ errO, paginas: paginasO.length, leer: leerO })
    )
    check(
      'Oracle: el LRU de `datos` cerró solo lectores de las pestañas, nunca el de la exportación; y la efímera se cierra',
      sesionesDe('cerrarLector', fo).every((x) => x === 'datos') && sesionesDe('cerrar', fo).includes('exportacion:exp-o'),
      JSON.stringify({ cerrarLector: sesionesDe('cerrarLector', fo), cerrar: sesionesDe('cerrar', fo) })
    )
  }

  hr('(21) Valor completo de un resultado de CONSOLA: en SU sesión, con su modo')
  {
    // Antes siempre en `datos`, que no ve la transacción sin confirmar de la consola.
    const e = entorno([conexion('c1'), conexion('c2')])
    const puerta = new Diferido<unknown>()
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql === 'select pg_sleep(9)') return puerta
      if (p.op === 'ejecutar' && /^insert/i.test(p.sql)) return { tipo: 'afectadas', filas: 1, comando: 'INSERT', ms: 1, tx: 'pendiente' }
      return respuestaPorDefecto(p, f)
    }
    const sqlValor = 'SELECT "cuerpo" FROM "public"."nota" WHERE "id" = $1'
    await ejecutar(e.gestor, 'select 1', 'k1')
    await e.gestor.modoTx(refConsola('k1'), 'manual')
    await ejecutar(e.gestor, "insert into nota values (2, 'x')", 'k1')
    const f = e.falsos[0]
    const conConsola = await e.gestor.leerValor({ conexionId: 'c1', sql: sqlValor, binds: ['2'], topes: { topeCelda: 7 }, consola: refConsola('k1') })
    const ejC = f.ejecutados().at(-1)
    check(
      'con `consola`: en la sesión de ESA consola, con su modo (Manual), sin BEGIN y con los topes del valor',
      conConsola.ok && ejC?.sesion === 'consola:k1' && ejC.sql === sqlValor && ejC.opciones.txManual === true && ejC.opciones.sinBegin === true && ejC.opciones.maxFilas === 1 && ejC.opciones.topeCelda === 7,
      JSON.stringify(ejC && { sesion: ejC.sesion, opciones: ejC.opciones })
    )
    check('leer el valor no toca la transacción de la consola', e.gestor.estadoConsola('perfil1', 'k1')?.tx === 'pendiente', String(e.gestor.estadoConsola('perfil1', 'k1')?.tx))
    const sinConsola = await e.gestor.leerValor({ conexionId: 'c1', sql: sqlValor, binds: ['2'], topes: {} })
    const ejD = f.ejecutados().at(-1)
    check(
      'sin `consola` (la pestaña de tabla): en `datos`, como antes',
      sinConsola.ok && ejD?.sesion === 'datos' && ejD.opciones.txManual === undefined,
      JSON.stringify(ejD && { sesion: ejD.sesion, txManual: ejD.opciones.txManual })
    )
    const larga = ejecutar(e.gestor, 'select pg_sleep(9)', 'k1')
    await esperarA(() => f.ejecutados().some((x) => x.sql === 'select pg_sleep(9)'))
    const antes = f.mensajes.length
    const ocupada = await e.gestor.leerValor({ conexionId: 'c1', sql: sqlValor, binds: ['2'], topes: {}, consola: refConsola('k1') })
    check(
      'con la consola ejecutando: `ocupada` al instante, sin encolarse ni enviar nada',
      !ocupada.ok && ocupada.error.motivo === 'ocupada' && f.mensajes.length === antes,
      JSON.stringify(ocupada)
    )
    puerta.resolver(rFilas(1))
    await larga
    // La consola k2 es de c2: pedir por c1 con ella no puede leer en c2.
    await ejecutar(e.gestor, 'select 1', 'k2', 'c2')
    const nMensajes = e.falsos.reduce((n, x) => n + x.mensajes.length, 0)
    const ajena = await e.gestor.leerValor({ conexionId: 'c1', sql: sqlValor, binds: ['2'], topes: {}, consola: refConsola('k2', 'c1') })
    const cruzada = await e.gestor.leerValor({ conexionId: 'c1', sql: sqlValor, binds: ['2'], topes: {}, consola: refConsola('k1', 'c2') })
    check(
      'una consola de OTRA conexión (o una ref que no casa con la conexión): interno, sin enviar nada',
      !ajena.ok && ajena.error.motivo === 'interno' && !cruzada.ok && cruzada.error.motivo === 'interno' && e.falsos.reduce((n, x) => n + x.mensajes.length, 0) === nMensajes,
      JSON.stringify({ ajena, cruzada })
    )
  }

  hr('(22) Oracle: qué sentencias leen DBMS_OUTPUT (y cuáles no)')
  {
    // Quitar `dml`/`ddl` ahorraría un viaje, pero la línea de un trigger se quedaría en
    // el buffer y la enseñaría la siguiente sentencia que lee (ver GestorSesiones.ts).
    const e = entorno([conexion('o1', { motor: 'oracle' }), conexion('c1')])
    const casos: Array<[string, boolean]> = [
      ['insert into t values (1)', true],
      ['update t set a = 2', true],
      ['delete from t', true],
      ['create table t2 (a number)', true],
      ['begin null; end;', true],
      ['call p()', true],
      ['select 1 from dual', false],
      ['select * from t for update', false],
      ['commit', false],
      ['set role none', false]
    ]
    const vistos: string[] = []
    for (const [sql, lee] of casos) {
      await ejecutar(e.gestor, sql, 'kO', 'o1')
      const f = e.falsos.find((x) => x.conexion.id === 'o1') as TrabajadorFalso
      const ej = f.ejecutados().filter((x) => x.sql === sql).at(-1)
      if ((ej?.opciones.salidaServidor === true) !== lee) vistos.push(`${sql} -> ${String(ej?.opciones.salidaServidor)}`)
    }
    check('dml, ddl, plsql y rutina leen la salida tras la sentencia; consulta, bloqueo, tx y sesion no', vistos.length === 0, vistos.join(' | ') || 'todas como se espera')
    await ejecutar(e.gestor, 'select 1', 'kP', 'c1')
    const fp = e.falsos.find((x) => x.conexion.id === 'c1') as TrabajadorFalso
    check('PG: siempre (los NOTICE llegan sin viaje)', fp.ejecutados().find((x) => x.sql === 'select 1')?.opciones.salidaServidor === true, 'select 1')
  }

  hr('(23) Parámetros: el main es la autoridad y solo viajan los usados')
  {
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' }), conexion('r1', { readonly: true })])
    const fDe = (id: string): TrabajadorFalso => e.falsos.find((f) => f.conexion.id === id) as TrabajadorFalso
    const rp = await ejecutarCon(e.gestor, 'select * from t where id = $1 and n = $2', { '1': '5', '2': 'x', '3': 'sobra' })
    const ejp = fDe('c1').ejecutados().at(-1)
    check('PG: array posicional con SOLO $1 y $2 (el 3 que sobra no viaja)', rp.ok && JSON.stringify(ejp?.binds) === JSON.stringify(['5', 'x']), JSON.stringify(ejp?.binds))
    const antes = fDe('c1').ejecutados().length
    const rf = await ejecutarCon(e.gestor, 'select * from t where id = $1 and n = $2', { '1': '5' })
    check(
      'falta $2: ok:false «parametros» con la clave, y NO se envía nada',
      !rf.ok && rf.error.motivo === 'parametros' && JSON.stringify(rf.error.parametros) === '["2"]' && /\$2/.test(rf.error.mensaje) && fDe('c1').ejecutados().length === antes,
      JSON.stringify(rf)
    )
    const rmal = await ejecutarCon(e.gestor, 'select $1', { '1': 5 })
    check('un valor que no es texto: «parametros»', !rmal.ok && rmal.error.motivo === 'parametros', JSON.stringify(rmal))
    // `$n` por encima del tope de PG: antes el main construía un array de mil millones de NULL.
    const antesAlto = fDe('c1').ejecutados().length
    const ralto = await ejecutarCon(e.gestor, 'select $1000000000', { '1000000000': 'x' })
    check(
      '`$1000000000`: «parametros» sin la lista de claves (no hay valor que pedir) y sin enviar nada',
      !ralto.ok && ralto.error.motivo === 'parametros' && ralto.error.parametros === undefined && fDe('c1').ejecutados().length === antesAlto,
      JSON.stringify(ralto)
    )
    // PG: los `$n` de un PREPARE son del servidor (con un valor, PG: «requires 0»).
    const rprep = await ejecutarCon(e.gestor, 'PREPARE q (int) AS SELECT * FROM t WHERE id = $1', undefined)
    const ejprep = fDe('c1').ejecutados().at(-1)
    check('PREPARE con `$1`: se envía sin binds y sin pedir nada', rprep.ok && /^PREPARE q/.test(ejprep?.sql ?? '') && ejprep?.binds === undefined, JSON.stringify(rprep.ok ? ejprep?.binds : rprep))
    const ro = await ejecutarCon(e.gestor, 'select :id, :"Nom" from dual where :id > 0', { ID: '1', Nom: 'a', OTRA: 'z' }, 'kO', 'o1')
    const ejo = fDe('o1').ejecutados().at(-1)
    check('Oracle: por nombre, citado con sus comillas, repetido una vez, sin la que sobra', ro.ok && JSON.stringify(ejo?.binds) === JSON.stringify({ ID: '1', '"Nom"': 'a' }), JSON.stringify(ejo?.binds))
    await ejecutarCon(e.gestor, 'EXEC p(:x)', { X: '7' }, 'kO', 'o1')
    const eje = fDe('o1').ejecutados().at(-1)
    check('EXEC p(:x) -> BEGIN p(:x); END; con su bind', eje?.sql === 'BEGIN p(:x); END;' && JSON.stringify(eje.binds) === '{"X":"7"}', `${eje?.sql} ${JSON.stringify(eje?.binds)}`)
    await ejecutarCon(e.gestor, 'CREATE OR REPLACE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN :new.a := 1; END;', { NEW: 'x' }, 'kO', 'o1')
    const ejt = fDe('o1').ejecutados().filter((x) => /TRIGGER/.test(x.sql)).at(-1)
    check('el :new de un disparador no es un parámetro: sin binds', ejt !== undefined && ejt.binds === undefined, JSON.stringify(ejt?.binds))
    await ejecutarCon(e.gestor, 'select 1 from dual', { X: '1' }, 'kO', 'o1')
    check('sin parámetros en la sentencia: sin binds aunque lleguen valores', fDe('o1').ejecutados().at(-1)?.binds === undefined, 'sin binds')
    const rro = await ejecutarCon(e.gestor, 'update t set a = $1', undefined, 'kR', 'r1')
    check('solo lectura rechaza ANTES de mirar los parámetros', !rro.ok && rro.error.motivo === 'soloLectura', JSON.stringify(rro))

    // Lectores: «más» (PG re-ejecuta) y Contar llevan los MISMOS binds.
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && /^select \* from grande/.test(p.sql)) {
        const salto = p.opciones.saltarFilas ?? 0
        return rFilas(Math.min(1234 - salto, p.opciones.maxFilas), { hayMas: 1234 - salto > p.opciones.maxFilas })
      }
      if (p.op === 'ejecutar' && /^SELECT COUNT/.test(p.sql)) return rFilas(1, { filasJson: '[["1234"]]' })
      return respuestaPorDefecto(p, f)
    }
    const rl = await ejecutarCon(e.gestor, 'select * from grande where a > $1', { '1': '0' }, 'kL', 'c1')
    const lector = rl.ok && rl.valor.tipo === 'filas' ? rl.valor.lector : null
    await e.gestor.leerMas(lector as string, 500)
    const reej = fDe('c1').ejecutados().filter((x) => /^select \* from grande/.test(x.sql)).at(-1)
    check('PG «más»: re-ejecuta con los mismos binds', reej?.opciones.saltarFilas === 500 && JSON.stringify(reej.binds) === '["0"]', JSON.stringify(reej?.binds))
    await e.gestor.contar(lector as string, 'cuenta-b')
    const cnt = fDe('c1').ejecutados().find((x) => /^SELECT COUNT/.test(x.sql))
    check('Contar: los mismos binds (los marcadores no cambian al envolver)', JSON.stringify(cnt?.binds) === '["0"]', JSON.stringify(cnt?.binds))

    // Exportar la consulta: sin sus parámetros se rechaza ANTES del diálogo; con ellos viajan.
    let rechazo: ErrorGestor | null = null
    try {
      e.gestor.validarExportacionConsulta({ perfilId: 'perfil1', consolaId: 'kL', conexionId: 'c1' }, 'select * from grande where a > $1', null)
    } catch (err) {
      if (err instanceof ErrorGestor) rechazo = err
    }
    check('exportar sin los parámetros: «parametros» antes del diálogo', rechazo?.error.motivo === 'parametros', JSON.stringify(rechazo?.error))
    const val = e.gestor.validarExportacionConsulta({ perfilId: 'perfil1', consolaId: 'kL', conexionId: 'c1' }, 'select * from grande where a > $1', null, { '1': '9' })
    check('exportar con ellos: los binds salen de la validación', JSON.stringify(val.binds) === '["9"]', JSON.stringify(val.binds))
  }

  hr('(24) Historial: SOLO lo que llegó al servidor, con su texto y su esquema de antes')
  {
    const e = entorno([conexion('c1'), conexion('r1', { readonly: true })])
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && /no_existe/.test(p.sql)) throw fallo('servidor', { codigo: '42P01', mensaje: 'no existe' })
      if (p.op === 'ejecutar' && /pg_sleep/.test(p.sql)) return new Diferido()
      return respuestaPorDefecto(p, f)
    }
    await ejecutar(e.gestor, '  -- comentario\nselect * from t;  ', 'kH')
    const h0 = e.historial[0]
    check(
      'ok: texto de la sentencia sin el ;, filas, ms, esquema, perfil, conexión y consola',
      e.historial.length === 1 && h0.resultado === 'ok' && h0.filas === 2 && /^(-- comentario\n)?select \* from t$/.test(h0.sql) && h0.esquema === 'public' && h0.perfilId === 'perfil1' && h0.conexionId === 'c1' && h0.consolaId === 'kH' && typeof h0.ms === 'number',
      JSON.stringify(h0)
    )
    await ejecutar(e.gestor, 'update t set a = 1 where b = 2', 'kH')
    check('afectadas: sus filas', e.historial[1]?.filas === 1 && e.historial[1].resultado === 'ok', JSON.stringify(e.historial[1]))
    await ejecutar(e.gestor, 'select * from no_existe', 'kH')
    check('error del servidor: «error»', e.historial[2]?.resultado === 'error' && e.historial[2].filas === undefined, JSON.stringify(e.historial[2]))
    const vuelo = e.gestor.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'kH', conexionId: 'c1', ejecucionId: 'stop-h', sql: 'select pg_sleep(30)', maxFilas: 10 })
    await esperarA(() => e.falsos[0].ejecutados().some((x) => /pg_sleep/.test(x.sql)))
    const ocupada = await ejecutar(e.gestor, 'select 1', 'kH')
    e.gestor.cancelar({ rol: 'consola', perfilId: 'perfil1', consolaId: 'kH', ejecucionId: 'stop-h' })
    await vuelo
    check('Stop: «cancelada»', e.historial[3]?.resultado === 'cancelada', JSON.stringify(e.historial[3]))
    await ejecutar(e.gestor, 'update t set a = 1', 'kR', 'r1')
    await ejecutarCon(e.gestor, 'select $1', {}, 'kH')
    await ejecutar(e.gestor, 'select 1; select 2', 'kH')
    check(
      'lo que NO llegó (ocupada, solo lectura, parámetros, dos sentencias) no se anota',
      !ocupada.ok && e.historial.length === 4,
      `${e.historial.length} entradas: ${e.historial.map((x) => x.resultado).join(',')}`
    )
    await ejecutar(e.gestor, "ALTER USER x WITH PASSWORD 'secreto'", 'kH')
    check('el gestor pasa el texto TAL CUAL (tapar es del store, que no se lo salta nadie)', /secreto/.test(e.historial[4]?.sql ?? ''), 'tapa el HistorialStore')
  }

  hr('(25) Explain de Oracle: solo lectura, escritura con y sin transacción, thin y thick')
  {
    const e = entorno([
      conexion('ro', { motor: 'oracle', readonly: true }),
      conexion('rw', { motor: 'oracle' }),
      conexion('tk', { motor: 'oracle' })
    ])
    const FILAS_PLAN = [
      [0, null, 'SELECT STATEMENT', null, null, null, 2, 1, 2, null, null],
      [1, 0, 'TABLE ACCESS', 'FULL', 'SYS', 'DUAL', 2, 1, 2, null, '"DUMMY"=:X']
    ]
    let txDeRw: DbEstadoTx = 'ninguna'
    let falloExplain: FalloTrabajador | null = null
    let explainEnVuelo: Diferido | null = null
    e.responder.actual = (p, f) => {
      if (p.op === 'abrir' && f.conexion.id === 'tk') return { ...(respuestaPorDefecto(p, f) as object), modo: 'thick' }
      if (p.op === 'tx' && p.accion === 'estado' && f.conexion.id === 'rw') return { tx: txDeRw }
      if (p.op === 'ejecutar' && p.sql.startsWith('EXPLAIN PLAN')) {
        if (falloExplain) throw falloExplain
        if (explainEnVuelo) return explainEnVuelo
        return { tipo: 'hecho', comando: null, ms: 3, tx: 'pendiente' }
      }
      if (p.op === 'ejecutar' && p.sql === SQL_NODOS_ORACLE) return rFilas(0, { filasJson: JSON.stringify(FILAS_PLAN), nFilas: 2 })
      if (p.op === 'ejecutar' && p.sql === SQL_TEXTO_ORACLE) return rFilas(0, { filasJson: JSON.stringify([['Plan hash value: 1'], ['| 0 | SELECT STATEMENT |']]), nFilas: 2, tx: txDeRw })
      return respuestaPorDefecto(p, f)
    }
    const fDe = (id: string): TrabajadorFalso => e.falsos.find((f) => f.conexion.id === id) as TrabajadorFalso
    const nombreDe = (sql: string): string =>
      sql.startsWith('EXPLAIN PLAN') ? 'EXPLAIN' : sql === SQL_NODOS_ORACLE ? 'PLAN_TABLE' : sql === SQL_TEXTO_ORACLE ? 'DBMS_XPLAN' : sql.slice(0, 20)
    const desde = (f: TrabajadorFalso, n: number): string[] =>
      f.mensajes.slice(n).filter((m) => m.op === 'tx' || m.op === 'ejecutar').map((m) => (m.op === 'tx' ? `tx:${m.accion}` : m.op === 'ejecutar' ? nombreDe(m.sql) : ''))

    // Solo lectura (thin): ROLLBACK, EXPLAIN sin candado ni autocommit, dos lecturas, ROLLBACK.
    await ejecutar(e.gestor, 'select 1 from dual', 'kr', 'ro')
    const fro = fDe('ro')
    const n0 = fro.mensajes.length
    const pr = await explicar(e.gestor, 'select * from dual where dummy = :x and :y is null', 'kr', 'ro', { X: 'X' })
    const seq = desde(fro, n0)
    check(
      'RO: rollback, EXPLAIN, PLAN_TABLE, DBMS_XPLAN, rollback (en ese orden)',
      JSON.stringify(seq) === JSON.stringify(['tx:rollback', 'EXPLAIN', 'PLAN_TABLE', 'DBMS_XPLAN', 'tx:rollback']),
      JSON.stringify(seq)
    )
    const exRo = fro.ejecutados().find((x) => x.sql.startsWith('EXPLAIN PLAN'))
    check(
      'RO: el EXPLAIN va SIN candado y SIN autocommit (txManual), y la sentencia tras el FOR',
      exRo?.opciones.candadoRO === false && exRo.opciones.txManual === true && exRo.opciones.proposito === 'usuario' && exRo.sql.endsWith('FOR\nselect * from dual where dummy = :x and :y is null'),
      JSON.stringify(exRo?.opciones)
    )
    check('thin: todos los binds, los que faltan como NULL', JSON.stringify(exRo?.binds) === JSON.stringify({ X: 'X', Y: null }), JSON.stringify(exRo?.binds))
    check(
      'el plan llega con sus nodos y su texto, el aviso de «bind peeking» y la consola sin transacción',
      pr.ok && pr.valor.nodos.length === 2 && pr.valor.nodos[1].objeto === 'SYS.DUAL' && /Plan hash value/.test(pr.valor.texto) && (pr.valor.avisos ?? []).indexOf(AVISO_BINDS_ORACLE) >= 0 && e.gestor.estadoConsola('perfil1', 'kr')?.tx === 'ninguna' && e.gestor.estadoConsola('perfil1', 'kr')?.fase === 'lista',
      JSON.stringify(pr.ok ? { nodos: pr.valor.nodos.length, avisos: pr.valor.avisos } : pr)
    )
    check('no se anota en el historial', e.historial.every((h) => !/dummy = :x/.test(h.sql)), `${e.historial.length} entradas`)

    // Escritura sin transacción: estado exacto, EXPLAIN con autocommit y NINGÚN rollback.
    txDeRw = 'ninguna'
    await ejecutar(e.gestor, 'select 1 from dual', 'kw', 'rw')
    const frw = fDe('rw')
    const n1 = frw.mensajes.length
    const pw = await explicar(e.gestor, 'update t set a = 1 where id = 2', 'kw', 'rw')
    const seqW = desde(frw, n1)
    const exW = frw.ejecutados().find((x) => x.sql.startsWith('EXPLAIN PLAN'))
    check(
      'RW sin tx: tx:estado y el EXPLAIN con autocommit (txManual false); ningún rollback; un DML se explica',
      pw.ok && seqW[0] === 'tx:estado' && seqW.indexOf('tx:rollback') < 0 && exW?.opciones.txManual === false && exW.opciones.candadoRO === false,
      JSON.stringify(seqW)
    )
    check('sin parámetros: sin binds y sin aviso', exW?.binds === undefined && pw.ok && pw.valor.avisos === undefined, JSON.stringify(pw.ok && pw.valor.avisos))
    // Escritura CON transacción pendiente: todo sin autocommit y la tx sigue.
    txDeRw = 'pendiente'
    const n2 = frw.mensajes.length
    const pw2 = await explicar(e.gestor, 'select * from t', 'kw', 'rw')
    const seqW2 = desde(frw, n2)
    const exW2 = frw.ejecutados().filter((x) => x.sql.startsWith('EXPLAIN PLAN')).at(-1)
    const lecturas = frw.ejecutados().slice(-2)
    check(
      'RW con tx pendiente: NINGÚN rollback, todo con txManual y la transacción sigue pendiente',
      pw2.ok && seqW2.indexOf('tx:rollback') < 0 && exW2?.opciones.txManual === true && lecturas.every((x) => x.opciones.txManual === true) && e.gestor.estadoConsola('perfil1', 'kw')?.tx === 'pendiente',
      JSON.stringify({ seq: seqW2, tx: e.gestor.estadoConsola('perfil1', 'kw')?.tx })
    )
    txDeRw = 'ninguna'

    // Thick: el EXPLAIN no admite binds (ORA-01036): no se manda ninguno.
    await explicar(e.gestor, 'select * from t where id = :id', 'kt', 'tk', { ID: '1' })
    const exT = fDe('tk').ejecutados().find((x) => x.sql.startsWith('EXPLAIN PLAN'))
    check('thick: EXPLAIN sin binds aunque la sentencia los tenga', exT !== undefined && exT.binds === undefined, JSON.stringify(exT?.binds))

    // Lo que no se explica, ocupada, error con posición y Stop.
    const nAntes = fro.ejecutados().length
    const pb = await explicar(e.gestor, 'begin null; end;', 'kr', 'ro')
    const pd = await explicar(e.gestor, 'select 1 from dual; select 2 from dual', 'kr', 'ro')
    check('un bloque PL/SQL o dos sentencias: rechazados sin enviar nada', !pb.ok && !pd.ok && pb.error.motivo === 'interno' && fro.ejecutados().length === nAntes, `${JSON.stringify(pb)} ${JSON.stringify(pd)}`)
    const sentencia = 'select nada_de_nada from dual'
    falloExplain = fallo('servidor', { codigo: 'ORA-00904', mensaje: 'ORA-00904: "NADA_DE_NADA": invalid identifier', offsetCp: 0 })
    // El offset del servidor es relativo al texto ENVIADO (prefijo + sentencia): 7 dentro de la sentencia.
    const prefijoLargo = "EXPLAIN PLAN SET STATEMENT_ID = 'TESSERA_XX_YYYYYYYY' INTO PLAN_TABLE FOR\n".length
    e.responder.actual = ((anterior) => (p: PeticionSinId, f: TrabajadorFalso) => {
      if (p.op === 'ejecutar' && p.sql.startsWith('EXPLAIN PLAN') && falloExplain) {
        const prefijo = p.sql.length - sentencia.length
        throw fallo('servidor', { codigo: 'ORA-00904', mensaje: 'ORA-00904: "NADA_DE_NADA": invalid identifier', offsetCp: prefijo + 7 })
      }
      return anterior(p, f)
    })(e.responder.actual)
    const n3 = fro.mensajes.length
    const perr = await explicar(e.gestor, sentencia, 'kr', 'ro')
    check(
      'error del servidor: ok:false «servidor», posición DENTRO de la sentencia (sin el prefijo), y en RO se revierte',
      !perr.ok && perr.error.motivo === 'servidor' && perr.error.codigo === 'ORA-00904' && perr.error.posicion === 7 && desde(fro, n3).at(-1) === 'tx:rollback' && prefijoLargo > 0,
      JSON.stringify(perr)
    )
    falloExplain = null
    // Un fallo DESPUÉS del EXPLAIN (leer un PLAN_TABLE antiguo, sin ACCESS_PREDICATES)
    // trae el offset de SU texto, no del EXPLAIN: restarle el prefijo lo pintaba dentro de
    // la sentencia del usuario (medido: posición 29 en esta). Va sin posición.
    const larga =
      'select e.empno, e.ename, e.sal, d.dname, d.loc from emp e join dept d on d.deptno = e.deptno where e.sal > 1000 order by e.ename'
    let falloLectura = true
    e.responder.actual = ((anterior) => (p: PeticionSinId, f: TrabajadorFalso) => {
      if (p.op === 'ejecutar' && p.sql === SQL_NODOS_ORACLE && falloLectura) {
        throw fallo('servidor', {
          codigo: 'ORA-00904',
          mensaje: 'ORA-00904: "ACCESS_PREDICATES": invalid identifier',
          offsetCp: SQL_NODOS_ORACLE.indexOf('access_predicates')
        })
      }
      return anterior(p, f)
    })(e.responder.actual)
    const n4 = fro.mensajes.length
    const plec = await explicar(e.gestor, larga, 'kr', 'ro')
    check(
      'error al LEER el plan (no del EXPLAIN): ok:false con su código, SIN posición, y en RO se revierte',
      !plec.ok && plec.error.codigo === 'ORA-00904' && plec.error.posicion === undefined && desde(fro, n4).at(-1) === 'tx:rollback',
      JSON.stringify({ r: plec, seq: desde(fro, n4) })
    )
    const n5 = frw.mensajes.length
    const plecW = await explicar(e.gestor, larga, 'kw', 'rw')
    check(
      '… y en escritura, sin posición y sin ningún rollback',
      !plecW.ok && plecW.error.codigo === 'ORA-00904' && plecW.error.posicion === undefined && desde(frw, n5).indexOf('tx:rollback') < 0,
      JSON.stringify({ r: plecW, seq: desde(frw, n5) })
    )
    falloLectura = false
    check(
      'Oracle: nunca un SAVEPOINT (un error solo revierte la sentencia, y el punto dejaría transactionInProgress)',
      [fro, frw, fDe('tk')].every((x) => x.ejecutados().every((m) => !/SAVEPOINT/i.test(m.sql))),
      'ninguno'
    )
    explainEnVuelo = new Diferido()
    const vuelo = explicar(e.gestor, 'select * from t', 'kr', 'ro', undefined, 'stop-x')
    await esperarA(() => fro.ejecutados().filter((x) => x.sql.startsWith('EXPLAIN PLAN')).length >= 4)
    const otra = await ejecutar(e.gestor, 'select 1 from dual', 'kr', 'ro')
    check('mientras explica, la consola está ocupada', !otra.ok && otra.error.motivo === 'ocupada', JSON.stringify(otra))
    e.gestor.cancelar({ rol: 'consola', perfilId: 'perfil1', consolaId: 'kr', ejecucionId: 'stop-x' })
    const pstop = await vuelo
    explainEnVuelo = null
    check('Stop (cancelar de consola): cancelada, y la consola vuelve a estar lista', !pstop.ok && pstop.error.motivo === 'cancelada' && e.gestor.estadoConsola('perfil1', 'kr')?.fase === 'lista', JSON.stringify(pstop))
  }

  hr('(26) Explain de PG: EXPLAIN (FORMAT JSON) sin ANALYZE, con sus binds')
  {
    const e = entorno([conexion('c1'), conexion('r1', { readonly: true })])
    const plan = [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 't', Alias: 't', 'Startup Cost': 0, 'Total Cost': 1.5, 'Plan Rows': 10, 'Plan Width': 8, Filter: '(id = $1)' } }]
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.sql.startsWith(PREFIJO_EXPLICAR_PG)) return rFilas(1, { filasJson: JSON.stringify([[JSON.stringify(plan)]]), comando: 'EXPLAIN' })
      return respuestaPorDefecto(p, f)
    }
    const pp = await explicar(e.gestor, 'select * from t where id = $1', 'kp', 'c1', { '1': '5' })
    const ex = e.falsos[0].ejecutados().at(-1)
    check(
      'el texto, los binds, sin BEGIN, y la celda con tope grande',
      ex?.sql === PREFIJO_EXPLICAR_PG + 'select * from t where id = $1' && JSON.stringify(ex.binds) === '["5"]' && ex.opciones.sinBegin === true && (ex.opciones.topeCelda ?? 0) > 64 * 1024 && ex.opciones.candadoRO === false,
      JSON.stringify(ex?.opciones)
    )
    check(
      'el plan: nodo con su objeto, coste y filas, y el texto de PG',
      pp.ok && pp.valor.nodos[0].operacion === 'Seq Scan' && pp.valor.nodos[0].objeto === 't' && pp.valor.nodos[0].filas === 10 && /^Seq Scan on t {2}\(cost=0\.00\.\.1\.50 rows=10 width=8\)\n {2}Filter: \(id = \$1\)$/.test(pp.valor.texto),
      JSON.stringify(pp.ok ? pp.valor : pp)
    )
    const antes = e.falsos[0].ejecutados().length
    const pf = await explicar(e.gestor, 'select * from t where id = $1', 'kp', 'c1')
    check('PG exige los valores: «parametros» sin enviar nada', !pf.ok && pf.error.motivo === 'parametros' && e.falsos[0].ejecutados().length === antes, JSON.stringify(pf))
    await explicar(e.gestor, 'delete from t', 'kq', 'r1')
    const exRo = e.falsos.find((f) => f.conexion.id === 'r1')?.ejecutados().at(-1)
    check('solo lectura: un DELETE se EXPLICA (no se ejecuta) dentro del envoltorio RO', exRo?.sql === PREFIJO_EXPLICAR_PG + 'delete from t' && exRo.opciones.candadoRO === true, JSON.stringify(exRo?.opciones))
    const pa = await explicar(e.gestor, 'explain analyze delete from t', 'kp', 'c1')
    check('un EXPLAIN ANALYZE del usuario NO se cuela (lo ejecutaría)', !pa.ok && pa.error.motivo === 'interno', JSON.stringify(pa))
    check('explicar no anota historial', e.historial.length === 0, `${e.historial.length}`)
  }

  hr('(26b) Explain de PG con una transacción abierta: SAVEPOINT, y ROLLBACK TO si falla o se para')
  {
    const e = entorno([conexion('c1'), conexion('r1', { readonly: true })])
    const plan = JSON.stringify([{ Plan: { 'Node Type': 'Result', 'Startup Cost': 0, 'Total Cost': 0.01, 'Plan Rows': 1, 'Plan Width': 4 } }])
    // Un PG de mentira con lo justo de su máquina de transacciones: un error dentro de un
    // bloque lo aborta (25P02 en lo que venga), SAVEPOINT fuera de un bloque es 25P01, y
    // ROLLBACK TO vuelve al estado de cuando se puso el punto.
    const srv = {
      tx: 'ninguna' as DbEstadoTx,
      puntos: [] as DbEstadoTx[],
      modo: 'bien' as 'bien' | 'falla' | 'espera',
      cancelTardio: false
    }
    const abortar = (): void => {
      if (srv.tx !== 'ninguna') srv.tx = 'fallida'
    }
    const abortada = (): FalloTrabajador =>
      fallo('servidor', { codigo: '25P02', mensaje: 'current transaction is aborted, commands ignored until end of transaction block' })
    e.responder.actual = (p, f) => {
      if (p.op === 'tx') {
        if (p.accion !== 'estado') {
          srv.tx = 'ninguna'
          srv.puntos = []
        }
        return { tx: srv.tx }
      }
      if (p.op !== 'ejecutar') return respuestaPorDefecto(p, f)
      const sql = p.sql
      if (sql === SQL_PUNTO_PG) {
        if (srv.tx === 'ninguna') throw fallo('servidor', { codigo: '25P01', mensaje: 'SAVEPOINT can only be used in transaction blocks' })
        if (srv.tx === 'fallida') throw abortada()
        srv.puntos.push(srv.tx)
        return { tipo: 'hecho', comando: 'SAVEPOINT', ms: 1, tx: 'pendiente' }
      }
      if (sql === SQL_VOLVER_AL_PUNTO_PG) {
        const antes = srv.puntos.at(-1)
        if (antes === undefined) throw fallo('servidor', { codigo: '3B001', mensaje: 'savepoint "tessera_explicar" does not exist' })
        srv.tx = antes
        return { tipo: 'hecho', comando: 'ROLLBACK', ms: 1, tx: 'pendiente' }
      }
      if (sql === SQL_SOLTAR_PUNTO_PG) {
        if (srv.cancelTardio) {
          // Un Stop que llegó tarde cae en el RELEASE: aborta la tx, el punto sigue vivo.
          srv.cancelTardio = false
          abortar()
          throw fallo('timeout', { codigo: '57014', mensaje: 'canceling statement due to user request' })
        }
        if (srv.tx === 'fallida') throw abortada()
        srv.puntos.pop()
        return { tipo: 'hecho', comando: 'RELEASE', ms: 1, tx: srv.tx }
      }
      if (sql.startsWith(PREFIJO_EXPLICAR_PG)) {
        if (srv.tx === 'fallida') throw abortada()
        if (srv.modo === 'falla') {
          abortar()
          throw fallo('servidor', { codigo: '42P01', mensaje: 'relation "no_existe" does not exist', offsetCp: PREFIJO_EXPLICAR_PG.length + 14 })
        }
        if (srv.modo === 'espera') {
          // Esperando un bloqueo: el Stop (o un statement_timeout) la aborta.
          const d = new Diferido()
          d.promesa.catch(abortar)
          return d
        }
        return rFilas(1, { filasJson: JSON.stringify([[plan]]), comando: 'EXPLAIN', tx: srv.tx === 'ninguna' ? 'ninguna' : 'pendiente' })
      }
      // Lo del usuario: el BEGIN perezoso del Manual, un BEGIN a mano, UPDATE y un error.
      if (srv.tx === 'fallida') throw abortada()
      if (p.opciones.txManual === true && p.opciones.sinBegin !== true && srv.tx === 'ninguna') srv.tx = 'abierta'
      if (/^begin$/i.test(sql)) srv.tx = 'abierta'
      if (/^select rota/i.test(sql)) {
        abortar()
        throw fallo('servidor', { codigo: '42703', mensaje: 'column "rota" does not exist', offsetCp: 7 })
      }
      if (/^update/i.test(sql)) {
        if (srv.tx !== 'ninguna') srv.tx = 'pendiente'
        return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: srv.tx }
      }
      return { tipo: 'hecho', comando: null, ms: 1, tx: srv.tx }
    }
    const fc = (): TrabajadorFalso => e.falsos.find((x) => x.conexion.id === 'c1') as TrabajadorFalso
    const nombre = (sql: string): string =>
      sql === SQL_PUNTO_PG
        ? 'SAVEPOINT'
        : sql === SQL_VOLVER_AL_PUNTO_PG
          ? 'ROLLBACK TO'
          : sql === SQL_SOLTAR_PUNTO_PG
            ? 'RELEASE'
            : sql.startsWith(PREFIJO_EXPLICAR_PG)
              ? 'EXPLAIN'
              : sql.slice(0, 12)
    const desde = (n: number): string[] =>
      fc()
        .mensajes.slice(n)
        .filter((m) => m.op === 'tx' || m.op === 'ejecutar')
        .map((m) => (m.op === 'tx' ? `tx:${m.accion}` : m.op === 'ejecutar' ? nombre(m.sql) : ''))
    const txDe = (): DbEstadoTx | undefined => e.gestor.estadoConsola('perfil1', 'kx')?.tx
    // Leído por función: tras `srv.tx = 'ninguna'` TS lo estrecharía para el resto del bloque.
    const txSrv = (): DbEstadoTx => srv.tx
    const ref = refConsola('kx')

    // (a) Manual con un UPDATE pendiente y un Explain con una errata.
    await e.gestor.modoTx(ref, 'manual')
    await ejecutar(e.gestor, 'update t set v = 11', 'kx')
    check('Manual + UPDATE: transacción pendiente', txDe() === 'pendiente' && srv.tx === 'pendiente', `${txDe()}`)
    srv.modo = 'falla'
    let n = fc().mensajes.length
    const pa = await explicar(e.gestor, 'select * from no_existe', 'kx', 'c1')
    check(
      'un Explain que FALLA en la tx: SAVEPOINT, EXPLAIN, ROLLBACK TO y RELEASE (y la sonda)',
      JSON.stringify(desde(n)) === JSON.stringify(['SAVEPOINT', 'EXPLAIN', 'ROLLBACK TO', 'RELEASE', 'tx:estado']),
      JSON.stringify(desde(n))
    )
    check(
      '… el error sale con su posición en la sentencia y la transacción SIGUE pendiente (no fallida)',
      !pa.ok && pa.error.motivo === 'servidor' && pa.error.codigo === '42P01' && pa.error.posicion === 14 && txDe() === 'pendiente' && srv.tx === 'pendiente' && srv.puntos.length === 0,
      JSON.stringify({ r: pa, tx: txDe(), srv: srv.tx })
    )
    const tras = await ejecutar(e.gestor, 'update t set v = 12', 'kx')
    check('… y la siguiente sentencia de la tx va bien (sin 25P02)', tras.ok && tras.valor.tipo === 'afectadas' && txDe() === 'pendiente', JSON.stringify(tras))

    // (b) Un Explain que sale bien en la tx: el RELEASE da el estado exacto.
    srv.modo = 'bien'
    n = fc().mensajes.length
    const pb = await explicar(e.gestor, 'select 1', 'kx', 'c1')
    const [sp, ex, rel] = fc().ejecutados().slice(-3)
    check(
      'un Explain que sale bien en la tx: SAVEPOINT, EXPLAIN y RELEASE; el plan llega y sigue pendiente',
      JSON.stringify(desde(n)) === JSON.stringify(['SAVEPOINT', 'EXPLAIN', 'RELEASE']) && pb.ok && pb.valor.nodos[0]?.operacion === 'Result' && txDe() === 'pendiente',
      JSON.stringify({ seq: desde(n), tx: txDe() })
    )
    check(
      'el punto es SQL de Tessera (catalogo, sin BEGIN ni candado: un Stop no lo corta); el estado lo lee el RELEASE',
      [sp, rel].every((m) => m.opciones.proposito === 'catalogo' && m.opciones.sinBegin === true && m.opciones.candadoRO === false) &&
        sp.opciones.comprobarTx === false &&
        rel.opciones.comprobarTx === true &&
        ex.opciones.comprobarTx === false &&
        ex.opciones.proposito === 'usuario',
      JSON.stringify([sp.opciones, ex.opciones, rel.opciones])
    )

    // (c) Stop mientras el EXPLAIN espera un bloqueo.
    srv.modo = 'espera'
    n = fc().mensajes.length
    const vuelo = explicar(e.gestor, 'select * from bloqueada', 'kx', 'c1', undefined, 'stop-pg')
    await esperarA(() => desde(n).indexOf('EXPLAIN') >= 0)
    e.gestor.cancelar({ rol: 'consola', perfilId: 'perfil1', consolaId: 'kx', ejecucionId: 'stop-pg' })
    const pc = await vuelo
    check(
      'Stop durante el EXPLAIN: cancelada, ROLLBACK TO + RELEASE, y la transacción sigue pendiente',
      !pc.ok && pc.error.motivo === 'cancelada' && JSON.stringify(desde(n)) === JSON.stringify(['SAVEPOINT', 'EXPLAIN', 'ROLLBACK TO', 'RELEASE', 'tx:estado']) && txDe() === 'pendiente' && srv.tx === 'pendiente',
      JSON.stringify({ r: pc, seq: desde(n), tx: txDe() })
    )

    // (d) Un cancel tardío que cae en el RELEASE: el punto sigue vivo y se repite.
    srv.modo = 'bien'
    srv.cancelTardio = true
    n = fc().mensajes.length
    const pd = await explicar(e.gestor, 'select 1', 'kx', 'c1')
    check(
      'un 57014 en el RELEASE: ROLLBACK TO + RELEASE una vez más, el plan llega y la tx sigue pendiente',
      pd.ok && JSON.stringify(desde(n)) === JSON.stringify(['SAVEPOINT', 'EXPLAIN', 'RELEASE', 'ROLLBACK TO', 'RELEASE']) && txDe() === 'pendiente' && srv.tx === 'pendiente',
      JSON.stringify({ ok: pd.ok, seq: desde(n), tx: txDe() })
    )

    // (e) El estado del main iba por detrás: el servidor ya no tiene transacción.
    srv.tx = 'ninguna'
    srv.puntos = []
    n = fc().mensajes.length
    const pe = await explicar(e.gestor, 'select 1', 'kx', 'c1')
    const exE = fc().ejecutados().at(-1)
    check(
      'SAVEPOINT con 25P01 (no había tx): se sigue sin punto, el EXPLAIN lee el estado y no hay error',
      pe.ok && JSON.stringify(desde(n)) === JSON.stringify(['SAVEPOINT', 'EXPLAIN']) && exE?.opciones.comprobarTx === true && txDe() === 'ninguna',
      JSON.stringify({ r: pe.ok ? 'ok' : pe, seq: desde(n), tx: txDe() })
    )

    // (f) Una transacción ya fallida: sin punto (daría 25P02), el EXPLAIN dice lo mismo.
    await ejecutar(e.gestor, 'update t set v = 13', 'kx')
    await ejecutar(e.gestor, 'select rota', 'kx')
    n = fc().mensajes.length
    const pf = await explicar(e.gestor, 'select 1', 'kx', 'c1')
    check(
      'tx fallida: ningún SAVEPOINT; el 25P02 del EXPLAIN y sigue fallida',
      txDe() === 'fallida' && !pf.ok && pf.error.codigo === '25P02' && desde(n).indexOf('SAVEPOINT') < 0,
      JSON.stringify({ r: pf, seq: desde(n), tx: txDe() })
    )

    // (g) Auto con un BEGIN a mano: `abierta` también se protege, y sigue `abierta`.
    await e.gestor.modoTx(ref, 'auto', 'rollback')
    await ejecutar(e.gestor, 'begin', 'kx')
    srv.modo = 'falla'
    n = fc().mensajes.length
    const pg = await explicar(e.gestor, 'select * from no_existe', 'kx', 'c1')
    check(
      'Auto + BEGIN a mano: el Explain que falla va con punto y la tx sigue ABIERTA',
      txDe() === 'abierta' && txSrv() === 'abierta' && !pg.ok && pg.error.codigo === '42P01' && desde(n)[0] === 'SAVEPOINT' && desde(n).indexOf('ROLLBACK TO') >= 0,
      JSON.stringify({ seq: desde(n), tx: txDe(), srv: txSrv() })
    )

    // (h) Sin transacción: como siempre, sin punto (el error no tiene nada que abortar).
    await e.gestor.txConsola(ref, 'rollback')
    n = fc().mensajes.length
    const ph = await explicar(e.gestor, 'select * from no_existe', 'kx', 'c1')
    check(
      'Auto sin transacción: ningún SAVEPOINT, y el error con su posición',
      txDe() === 'ninguna' && !ph.ok && ph.error.posicion === 14 && JSON.stringify(desde(n)) === JSON.stringify(['EXPLAIN', 'tx:estado']),
      JSON.stringify({ seq: desde(n), tx: txDe() })
    )

    // (i) Solo lectura: el envoltorio BEGIN READ ONLY … ROLLBACK ya lo aísla.
    srv.modo = 'bien'
    await explicar(e.gestor, 'select 1', 'kr1', 'r1')
    const fr = e.falsos.find((x) => x.conexion.id === 'r1')
    check(
      'solo lectura: ningún SAVEPOINT',
      fr !== undefined && fr.ejecutados().some((m) => m.sql.startsWith(PREFIJO_EXPLICAR_PG)) && fr.ejecutados().every((m) => !/SAVEPOINT/i.test(m.sql)),
      JSON.stringify(fr?.ejecutados().map((m) => nombre(m.sql)))
    )
  }

  hr('(27) PRODUCCIÓN en la consola: Manual al nacer, confirmación de cada escritura')
  {
    const e = entorno([
      conexion('pr', { alias: 'ALFA-PROD', entorno: 'produccion' }),
      conexion('pro', { alias: 'ALFA-PROD-RO', entorno: 'produccion', readonly: true }),
      conexion('dv', { alias: 'ALFA-DEV', entorno: 'desarrollo' }),
      conexion('pd', { alias: 'ALFA-PROD-A-DEV', entorno: 'produccion' })
    ])
    // sin sesión, null y NADA inventado. Una sesión «cerrada» con el modo con
    // el que nacería la leía el renderer UNA vez al montar, y como no existe,
    // `alCambiarConexion` no la tocaba: la barra se quedaba en Manual tras pasar la
    // conexión a desarrollo (y la primera escritura nacía en Auto y confirmaba sola). Sin
    // sesión, la barra pinta ese modo en vivo con `modoTxInicial` (la regla compartida).
    check(
      'sin sesión todavía: null (la barra pinta el modo en vivo), sin lanzar nada',
      e.gestor.estadoConsola('perfil1', 'kp') === null && e.falsos.length === 0 && e.gestor.sesiones().length === 0,
      JSON.stringify(e.gestor.estadoConsola('perfil1', 'kp'))
    )
    // Una escritura sin confirmar: rechazada SIN lanzar el proceso.
    const up = await ejecutar(e.gestor, 'update t set a = 1 where id = 1', 'kp', 'pr')
    check(
      "UPDATE en producción sin `confirmado`: ok:false 'produccion' con el alias, sin enviar nada",
      !up.ok && up.error.motivo === 'produccion' && up.error.mensaje.includes('ALFA-PROD') && e.falsos.length === 0,
      JSON.stringify(up)
    )
    const commitSql = await ejecutar(e.gestor, 'commit', 'kp', 'pr')
    check('COMMIT escrito en la consola, sin confirmar: rechazado', !commitSql.ok && commitSql.error.motivo === 'produccion' && e.falsos.length === 0, JSON.stringify(commitSql))
    const sel = await ejecutar(e.gestor, 'select 1', 'kp', 'pr')
    const f = e.falsos[0]
    const abrir = f?.ops('abrir')[0] as PeticionSinIdDe<'abrir'> | undefined
    check('un SELECT no pide confirmación y la consola ABRE en Manual (autoCommit false)', sel.ok && abrir?.opciones.autoCommit === false, JSON.stringify(abrir?.opciones))
    check('y su estado dice Manual', e.gestor.estadoConsola('perfil1', 'kp')?.txModo === 'manual', String(e.gestor.estadoConsola('perfil1', 'kp')?.txModo))
    const rb = await ejecutar(e.gestor, 'rollback', 'kp', 'pr')
    check('NEGATIVO: ROLLBACK no pide confirmación (no escribe)', rb.ok, JSON.stringify(rb.ok ? 'ok' : rb))
    const antes = f.ejecutados().length
    const upOk = await e.gestor.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'kp', conexionId: 'pr', ejecucionId: 'conf1', sql: 'update t set a = 1 where id = 1', maxFilas: 500, confirmado: true })
    check('con `confirmado`: se envía', upOk.ok && f.ejecutados().length === antes + 1 && f.ejecutados()[antes].opciones.txManual === true, JSON.stringify(upOk.ok))
    // El botón Commit: en producción exige confirmado; el Rollback no.
    const nTx = f.ops('tx').length
    const tx1 = await e.gestor.txConsola(refConsola('kp', 'pr'), 'commit')
    check("botón Commit sin confirmar: 'produccion' y ningún COMMIT enviado", !tx1.ok && tx1.error.motivo === 'produccion' && f.ops('tx').length === nTx, JSON.stringify(tx1))
    const tx2 = await e.gestor.txConsola(refConsola('kp', 'pr'), 'rollback')
    check('NEGATIVO: el botón Rollback no la pide', tx2.ok, JSON.stringify(tx2.ok ? 'ok' : tx2))
    // Solo lectura manda sobre producción.
    const upRo = await ejecutar(e.gestor, 'update t set a = 1', 'kr', 'pro')
    check("solo lectura MANDA: un UPDATE en producción de solo lectura es 'soloLectura'", !upRo.ok && upRo.error.motivo === 'soloLectura', JSON.stringify(upRo))
    const upDev = await ejecutar(e.gestor, 'update t set a = 1 where id = 1', 'kd', 'dv')
    check('NEGATIVO: en desarrollo no se pide nada', upDev.ok, JSON.stringify(upDev.ok ? 'ok' : upDev))
    check('NEGATIVO: una consola de desarrollo nace en Auto', e.gestor.estadoConsola('perfil1', 'kd')?.txModo === 'auto', String(e.gestor.estadoConsola('perfil1', 'kd')?.txModo))

    // Pasar una conexión a PRODUCCIÓN: sus consolas cerradas, a Manual; y NO al revés.
    const conDv = e.conexiones.get('dv') as DbConnection
    const aProd = { ...conDv, entorno: 'produccion' as const }
    e.conexiones.set('dv', aProd)
    e.gestor.alCambiarConexion(conDv, aProd)
    await esperarA(() => e.gestor.estadoConsola('perfil1', 'kd')?.fase === 'cerrada')
    check('desarrollo -> producción: la consola (ya cerrada) pasa a Manual', e.gestor.estadoConsola('perfil1', 'kd')?.txModo === 'manual', JSON.stringify(e.gestor.estadoConsola('perfil1', 'kd')))
    await e.gestor.modoTx(refConsola('kd', 'dv'), 'auto')
    const renombrada = { ...aProd, alias: 'ALFA-DEV-2' }
    e.conexiones.set('dv', renombrada)
    e.gestor.alCambiarConexion(aProd, renombrada)
    await tic()
    check(
      'NEGATIVO: si ya era producción y el usuario la puso en Auto, editar el alias no se lo deshace',
      e.gestor.estadoConsola('perfil1', 'kd')?.txModo === 'auto',
      String(e.gestor.estadoConsola('perfil1', 'kd')?.txModo)
    )

    // El caso, del lado del main: una consola de producción SIN sesión cuya
    // conexión pasa a desarrollo. Nada que emitir (no hay sesión: por eso el renderer no
    // puede quedarse con una inventada), sigue en null, y la primera escritura nace con
    // el modo de la conexión de AHORA; el evento que la da a conocer lo dice.
    const conPd = e.conexiones.get('pd') as DbConnection
    const aDev = { ...conPd, entorno: 'desarrollo' as const }
    e.conexiones.set('pd', aDev)
    const nEv = e.eventos.length
    e.gestor.alCambiarConexion(conPd, aDev)
    check(
      'consola de producción sin sesión que pasa a desarrollo: ningún evento y sigue en null',
      e.eventos.length === nEv && e.gestor.estadoConsola('perfil1', 'kpd') === null,
      JSON.stringify(e.eventos.slice(nEv))
    )
    const upPd = await ejecutar(e.gestor, 'update t set a = 1 where id = 1', 'kpd', 'pd')
    const evPd = e.eventos.slice(nEv).filter((x) => x.ref.rol === 'consola' && x.ref.consolaId === 'kpd')
    check(
      '… su primera escritura nace en Auto (la conexión de ahora) y el evento lo dice',
      upPd.ok && e.gestor.estadoConsola('perfil1', 'kpd')?.txModo === 'auto' && evPd.length > 0 && evPd.every((x) => x.txModo === 'auto'),
      JSON.stringify({ ok: upPd.ok, modos: evPd.map((x) => x.txModo) })
    )
  }

  hr('(27b) una consola OCUPADA cuando su conexión pasa a producción, a Manual')
  {
    // Antes: `retirar` solo cerraba las ociosas y `alCambiarConexion` solo ponía Manual a
    // las 'cerrada'/'perdida' de ese momento. Una que estaba ejecutando acababa perdida
    // (o seguía viva) conservando Auto, y renacía en Auto contra PRODUCCIÓN.
    const e = entorno([conexion('dx', { alias: 'ALFA-DEV' }), conexion('dy', { alias: 'ALFA-DEV-2' }), conexion('dz', { alias: 'ALFA-DEV-3' })])
    const puertas = new Map<string, Diferido<unknown>>()
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        const d = puertas.get(p.sql)
        if (d) return d
      }
      return respuestaPorDefecto(p, f)
    }
    const aProd = (id: string): DbConnection => {
      const antes = e.conexiones.get(id) as DbConnection
      const despues = { ...antes, entorno: 'produccion' as const }
      e.conexiones.set(id, despues)
      e.gestor.alCambiarConexion(antes, despues)
      return despues
    }
    const modo = (consolaId: string): string | undefined => e.gestor.estadoConsola('perfil1', consolaId)?.txModo

    // 1) El proceso de la conexión se va con la consola ejecutando. Como el real, DESPUÉS
    //    del cambio: `salir` pide al trabajador que cierre y el aviso de salida llega luego
    //    (el de pruebas moría dentro de la propia llamada, antes de que se mirara la consola).
    await ejecutar(e.gestor, 'select 0', 'kx', 'dx')
    const larga = new Diferido<unknown>()
    puertas.set('select larga', larga)
    const enCurso = ejecutar(e.gestor, 'select larga', 'kx', 'dx')
    await esperarA(() => e.gestor.estadoConsola('perfil1', 'kx')?.fase === 'ocupada')
    const fx = e.falsos[0]
    fx.salir = async (): Promise<void> => {
      fx.mensajes.push({ op: 'salir' })
      await tic()
      fx.morir(0, null)
    }
    aProd('dx')
    check('en el momento del cambio sigue ocupada y en Auto (no se le puede cambiar el modo a media sentencia)', e.gestor.estadoConsola('perfil1', 'kx')?.fase === 'ocupada' && modo('kx') === 'auto', String(modo('kx')))
    await enCurso
    const trasMorir = e.gestor.estadoConsola('perfil1', 'kx')
    check(
      'la consola que EJECUTABA al pasar a producción y se pierde con el proceso: queda en Manual',
      trasMorir?.fase === 'perdida' && trasMorir.txModo === 'manual',
      JSON.stringify(trasMorir && { fase: trasMorir.fase, txModo: trasMorir.txModo })
    )
    const nAbrir = e.falsos.length
    const upx = await e.gestor.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'kx', conexionId: 'dx', ejecucionId: 'kx-up', sql: 'update t set a = 1 where id = 1', maxFilas: 500, confirmado: true })
    const fx2 = e.falsos[e.falsos.length - 1]
    const abrirX = (fx2.ops('abrir') as Array<PeticionSinIdDe<'abrir'>>).find((a) => a.sesion === 'consola:kx')
    const upEnviado = fx2.ejecutados().find((m) => m.sql.startsWith('update t'))
    check(
      '… y RENACE en Manual: abre sin autocommit y su primera escritura va en transacción (no se confirma sola)',
      upx.ok && e.falsos.length === nAbrir + 1 && abrirX?.opciones.autoCommit === false && upEnviado?.opciones.txManual === true && modo('kx') === 'manual',
      JSON.stringify({ ok: upx.ok, abrir: abrirX?.opciones, txManual: upEnviado?.opciones.txManual })
    )

    // 2) El proceso NO se va enseguida: la consola termina viva, `lista`, en el proceso
    //    retirado. En cuanto deja de estar ocupada, Manual; y el evento lo dice.
    await ejecutar(e.gestor, 'select 0', 'ky', 'dy')
    const fy = e.falsos[e.falsos.length - 1]
    fy.salir = async (): Promise<void> => {
      fy.mensajes.push({ op: 'salir' })
    }
    const larga2 = new Diferido<unknown>()
    puertas.set('select larga 2', larga2)
    const enCurso2 = ejecutar(e.gestor, 'select larga 2', 'ky', 'dy')
    await esperarA(() => e.gestor.estadoConsola('perfil1', 'ky')?.fase === 'ocupada')
    aProd('dy')
    check('mientras ejecuta no se toca (la máquina rechaza cambiar el modo ocupada)', modo('ky') === 'auto', String(modo('ky')))
    const nEv = e.eventos.length
    larga2.resolver(rFilas(1))
    await enCurso2
    const evY = e.eventos.slice(nEv).filter((x) => x.ref.rol === 'consola' && x.ref.consolaId === 'ky')
    check(
      'al TERMINAR, Manual, y el evento que lo cuenta lleva Manual',
      e.gestor.estadoConsola('perfil1', 'ky')?.fase === 'lista' && modo('ky') === 'manual' && evY.length > 0 && evY[evY.length - 1].txModo === 'manual',
      JSON.stringify(evY.map((x) => [x.fase, x.txModo]))
    )

    // 3) NEGATIVO: si la conexión vuelve a desarrollo antes de que termine, nada.
    await ejecutar(e.gestor, 'select 0', 'kz', 'dz')
    const fz = e.falsos[e.falsos.length - 1]
    fz.salir = async (): Promise<void> => {
      fz.mensajes.push({ op: 'salir' })
    }
    const larga3 = new Diferido<unknown>()
    puertas.set('select larga 3', larga3)
    const enCurso3 = ejecutar(e.gestor, 'select larga 3', 'kz', 'dz')
    await esperarA(() => e.gestor.estadoConsola('perfil1', 'kz')?.fase === 'ocupada')
    const prodZ = aProd('dz')
    const devZ = { ...prodZ, entorno: 'desarrollo' as const }
    e.conexiones.set('dz', devZ)
    e.gestor.alCambiarConexion(prodZ, devZ)
    larga3.resolver(rFilas(1))
    await enCurso3
    check('NEGATIVO: vuelve a desarrollo antes de terminar: sigue en Auto (salir de producción no decide por el usuario)', modo('kz') === 'auto', String(modo('kz')))
    // 4) NEGATIVO: editar una conexión que YA era de producción no fuerza Manual a una
    //    consola ocupada que el usuario puso en Auto.
    const conZ = e.conexiones.get('dz') as DbConnection
    const prodZ2 = { ...conZ, entorno: 'produccion' as const }
    e.conexiones.set('dz', prodZ2)
    e.gestor.alCambiarConexion(conZ, prodZ2)
    await e.gestor.modoTx(refConsola('kz', 'dz'), 'auto')
    const larga4 = new Diferido<unknown>()
    puertas.set('select larga 4', larga4)
    const enCurso4 = ejecutar(e.gestor, 'select larga 4', 'kz', 'dz')
    await esperarA(() => e.gestor.estadoConsola('perfil1', 'kz')?.fase === 'ocupada')
    const renombrada = { ...prodZ2, alias: 'ALFA-PROD-3' }
    e.conexiones.set('dz', renombrada)
    e.gestor.alCambiarConexion(prodZ2, renombrada)
    larga4.resolver(rFilas(1))
    await enCurso4
    check('NEGATIVO: renombrar una que YA era de producción no deshace el Auto elegido, aunque estuviera ocupada', modo('kz') === 'auto', String(modo('kz')))
    for (const d of puertas.values()) d.resolver(rFilas(1))

    // 5) Revisión: una consola en Manual que está CONFIRMANDO su paso a Auto (el COMMIT de
    //    `modoTx('auto', 'commit')` en vuelo) cuando la conexión pasa a producción. En ese
    //    momento aún dice Manual, pero el COMMIT la deja en Auto al terminar: sin la marca,
    //    acababa en Auto contra producción.
    const e5 = entorno([conexion('dw', { alias: 'ALFA-DEV-4' })])
    const puertaTx = new Diferido<unknown>()
    let retenerTx = false
    e5.responder.actual = (p, f) => {
      if (p.op === 'tx' && retenerTx) return puertaTx
      if (p.op === 'ejecutar' && /^update/i.test(p.sql)) return { tipo: 'afectadas', filas: 1, comando: 'UPDATE', ms: 1, tx: 'pendiente' }
      return respuestaPorDefecto(p, f)
    }
    await ejecutar(e5.gestor, 'select 0', 'kw', 'dw')
    const fw = e5.falsos[0]
    fw.salir = async (): Promise<void> => {
      fw.mensajes.push({ op: 'salir' })
    }
    await e5.gestor.modoTx(refConsola('kw', 'dw'), 'manual')
    await ejecutar(e5.gestor, 'update t set a = 1 where id = 1', 'kw', 'dw')
    const modoW = (): string | undefined => e5.gestor.estadoConsola('perfil1', 'kw')?.txModo
    const txW = e5.gestor.estadoConsola('perfil1', 'kw')?.tx
    retenerTx = true
    const aAuto = e5.gestor.modoTx(refConsola('kw', 'dw'), 'auto', 'commit')
    await esperarA(() => e5.gestor.estadoConsola('perfil1', 'kw')?.fase === 'ocupada')
    const antesW = e5.conexiones.get('dw') as DbConnection
    const prodW = { ...antesW, entorno: 'produccion' as const }
    e5.conexiones.set('dw', prodW)
    e5.gestor.alCambiarConexion(antesW, prodW)
    const enElCambio = modoW()
    puertaTx.resolver({ tx: 'ninguna' })
    await aAuto
    check(
      'confirmando el paso de Manual a Auto cuando la conexión pasa a producción: al terminar el COMMIT, Manual (no Auto)',
      txW === 'pendiente' && enElCambio === 'manual' && e5.gestor.estadoConsola('perfil1', 'kw')?.fase === 'lista' && modoW() === 'manual',
      JSON.stringify({ txW, enElCambio, final: modoW() })
    )

    // 6) una conexión de producción de SOLO LECTURA que pasa a
    //    producción de ESCRITURA con la consola ocupada. La marca se aplicaba con el
    //    `soloLectura` de la sesión (el de cuando se abrió, true): la máquina rechazaba el
    //    Manual ('soloLectura'), la marca se borraba igual y la consola renacía en Auto
    //    contra producción, cada escritura confirmada sola.
    const e6 = entorno([
      conexion('rp', { alias: 'ALFA-PROD-RO', entorno: 'produccion', readonly: true }),
      conexion('rq', { alias: 'ALFA-PROD-RO-2', entorno: 'produccion', readonly: true })
    ])
    const puertas6 = new Map<string, Diferido<unknown>>()
    e6.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        const d = puertas6.get(p.sql)
        if (d) return d
      }
      return respuestaPorDefecto(p, f)
    }
    const aEscritura = (id: string): void => {
      const antes = e6.conexiones.get(id) as DbConnection
      const despues = { ...antes, readonly: false }
      e6.conexiones.set(id, despues)
      e6.gestor.alCambiarConexion(antes, despues)
    }
    const estado6 = (consolaId: string): DbEstadoSesion | null => e6.gestor.estadoConsola('perfil1', consolaId)
    // a) Se pierde con el proceso, como en 1).
    await ejecutar(e6.gestor, 'select 0', 'kr', 'rp')
    check('la consola de una producción de solo lectura va en Auto', estado6('kr')?.txModo === 'auto' && estado6('kr')?.soloLectura === true, JSON.stringify(estado6('kr')))
    const largaR = new Diferido<unknown>()
    puertas6.set('select larga ro', largaR)
    const enCursoR = ejecutar(e6.gestor, 'select larga ro', 'kr', 'rp')
    await esperarA(() => estado6('kr')?.fase === 'ocupada')
    const fr = e6.falsos[0]
    fr.salir = async (): Promise<void> => {
      fr.mensajes.push({ op: 'salir' })
      await tic()
      fr.morir(0, null)
    }
    aEscritura('rp')
    await enCursoR
    const trasR = estado6('kr')
    check(
      'solo lectura -> producción de ESCRITURA con la consola ocupada, y se pierde con el proceso: Manual (y ya sin solo lectura)',
      trasR?.fase === 'perdida' && trasR.txModo === 'manual' && trasR.soloLectura === false,
      JSON.stringify(trasR && { fase: trasR.fase, txModo: trasR.txModo, soloLectura: trasR.soloLectura })
    )
    const nR = e6.falsos.length
    const upR = await e6.gestor.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'kr', conexionId: 'rp', ejecucionId: 'kr-up', sql: 'update t set a = 1 where id = 1', maxFilas: 500, confirmado: true })
    const fr2 = e6.falsos[e6.falsos.length - 1]
    const abrirR = (fr2.ops('abrir') as Array<PeticionSinIdDe<'abrir'>>).find((a) => a.sesion === 'consola:kr')
    const upREnviado = fr2.ejecutados().find((m) => m.sql.startsWith('update t'))
    check(
      '… y RENACE en Manual: abre sin autocommit y su primera escritura va en transacción (no se confirma sola)',
      upR.ok && e6.falsos.length === nR + 1 && abrirR?.opciones.autoCommit === false && upREnviado?.opciones.txManual === true && estado6('kr')?.txModo === 'manual',
      JSON.stringify({ ok: upR.ok, abrir: abrirR?.opciones, txManual: upREnviado?.opciones.txManual })
    )
    // b) Termina VIVA en el proceso retirado, como en 2).
    await ejecutar(e6.gestor, 'select 0', 'kq', 'rq')
    const fq = e6.falsos[e6.falsos.length - 1]
    fq.salir = async (): Promise<void> => {
      fq.mensajes.push({ op: 'salir' })
    }
    const largaQ = new Diferido<unknown>()
    puertas6.set('select larga ro 2', largaQ)
    const enCursoQ = ejecutar(e6.gestor, 'select larga ro 2', 'kq', 'rq')
    await esperarA(() => estado6('kq')?.fase === 'ocupada')
    aEscritura('rq')
    largaQ.resolver(rFilas(1))
    await enCursoQ
    const trasQ = estado6('kq')
    check(
      '… y si termina VIVA: Manual al terminar, sin solo lectura',
      trasQ?.fase === 'lista' && trasQ.txModo === 'manual' && trasQ.soloLectura === false,
      JSON.stringify(trasQ && { fase: trasQ.fase, txModo: trasQ.txModo, soloLectura: trasQ.soloLectura })
    )
    for (const d of puertas6.values()) d.resolver(rFilas(1))
  }

  hr('(28) «Enviar» de la rejilla: todo o nada en una sesión efímera propia')
  {
    const envio = (sentencias: Array<{ sql: string; binds?: Array<string | null> }>, extra: { peticionId?: string; confirmado?: boolean; conexionId?: string } = {}): ReturnType<GestorSesiones['enviarCambios']> =>
      e.gestor.enviarCambios({
        conexionId: extra.conexionId ?? 'c1',
        peticionId: extra.peticionId ?? `env${++ejecucion}`,
        ...(extra.confirmado !== undefined ? { confirmado: extra.confirmado } : {}),
        sentencias: sentencias.map((s) => ({ tipo: /^delete/i.test(s.sql) ? 'borrar' : /^insert/i.test(s.sql) ? 'insertar' : 'actualizar', sql: s.sql, binds: s.binds ?? [] }))
      })
    const e = entorno([
      conexion('c1'),
      conexion('ro', { readonly: true }),
      conexion('pr', { alias: 'ALFA-PROD', entorno: 'produccion' })
    ])
    /** Filas que «toca» cada DML, por su texto (1 por defecto). */
    const filas = new Map<string, number>()
    const fallan = new Map<string, FalloTrabajador>()
    e.responder.actual = (p, t) => {
      if (p.op === 'ejecutar' && /^(update|insert|delete)/i.test(p.sql)) {
        const falla = fallan.get(p.sql)
        if (falla) throw falla
        return { tipo: 'afectadas', filas: filas.get(p.sql) ?? 1, comando: null, ms: 1, tx: 'pendiente' }
      }
      return respuestaPorDefecto(p, t)
    }
    const S = [
      { sql: 'UPDATE "public"."t" SET "a" = $1 WHERE "id" = $2', binds: ['x', '1'] },
      { sql: 'INSERT INTO "public"."t" ("id") VALUES ($1)', binds: ['2'] },
      { sql: 'DELETE FROM "public"."t" WHERE "id" = $1', binds: ['3'] }
    ]
    const r = await envio(S, { peticionId: 'uno' })
    const f = e.falsos[0]
    const abrir = f.ops('abrir') as Array<PeticionSinIdDe<'abrir'>>
    const ej = f.ejecutados()
    check('todo bien: hecho con los 3 cambios', r.ok && r.valor.tipo === 'hecho' && r.valor.cambios === 3, JSON.stringify(r))
    check(
      'en una sesión PROPIA (no `datos`), marcada «enviar»',
      abrir.length === 1 && abrir[0].sesion === 'edicion:uno' && abrir[0].rol === 'datos' && abrir[0].opciones.accion === 'enviar' && !abrir.some((a) => a.sesion === 'datos'),
      JSON.stringify(abrir.map((a) => [a.sesion, a.opciones.accion]))
    )
    const dml = ej.slice(1)
    check(
      'cada DML: de usuario (Stop), Manual con BEGIN perezoso, sin candado, esDml, con sus binds',
      dml.length === 3 && dml.every((m) => m.opciones.proposito === 'usuario' && m.opciones.txManual === true && m.opciones.sinBegin === false && m.opciones.candadoRO === false && m.opciones.esDml === true) && JSON.stringify(dml[0].binds) === JSON.stringify(['x', '1']),
      JSON.stringify(dml.map((m) => m.opciones))
    )
    // PG espera un bloqueo con TOPE, no para siempre. El SET LOCAL va DENTRO de
    // la transacción del envío (tras el BEGIN perezoso, sin `sinBegin`), y la primera.
    check(
      "PG, lo primero de la transacción: SET LOCAL lock_timeout = '10s' (Manual, tras el BEGIN, no es DML)",
      ej[0]?.sql === TOPE_ESPERA_PG && ej[0].opciones.txManual === true && ej[0].opciones.sinBegin === false && ej[0].opciones.esDml === false && ej.filter((m) => m.sql === TOPE_ESPERA_PG).length === 1,
      JSON.stringify(ej[0])
    )
    check('NEGATIVO: en PG ninguna sentencia lleva el SELECT … FOR UPDATE de Oracle', !ej.some((m) => /FOR UPDATE/i.test(m.sql)), JSON.stringify(ej.map((m) => m.sql)))
    const secuencia = f.mensajes.filter((m) => 'sesion' in m && m.sesion === 'edicion:uno').map((m) => (m.op === 'tx' ? `tx:${(m as PeticionSinIdDe<'tx'>).accion}` : m.op))
    check('la secuencia: abrir, el SET y 3 ejecutar, COMMIT y cerrar', JSON.stringify(secuencia) === JSON.stringify(['abrir', 'ejecutar', 'ejecutar', 'ejecutar', 'ejecutar', 'tx:commit', 'cerrar']), JSON.stringify(secuencia))
    check('la efímera ni se lista ni se emite, y se olvida', !e.gestor.sesiones().some((s) => s.ref.rol === 'datos') && !e.eventos.some((x) => x.ref.rol === 'datos'), JSON.stringify(e.gestor.sesiones().map((s) => s.ref)))

    // Un cambio que toca 0 filas (la fila cambió): ROLLBACK, sin COMMIT, y el resto no sale.
    filas.set(S[1].sql, 0)
    let n = f.mensajes.length
    const r0 = await envio(S, { peticionId: 'cero' })
    const tras0 = f.mensajes.slice(n).map((m) => (m.op === 'tx' ? `tx:${(m as PeticionSinIdDe<'tx'>).accion}` : m.op))
    check(
      '0 filas en el 2.º (un INSERT): error en el índice 1 con filas 0 y TESSERA-FILAS',
      r0.ok && r0.valor.tipo === 'error' && r0.valor.indice === 1 && r0.valor.filas === 0 && r0.valor.error.codigo === 'TESSERA-FILAS' && /no se insertó/.test(r0.valor.error.mensaje),
      JSON.stringify(r0)
    )
    check('… ROLLBACK, ningún COMMIT, el 3.º no se envía, y se cierra', JSON.stringify(tras0) === JSON.stringify(['abrir', 'ejecutar', 'ejecutar', 'ejecutar', 'tx:rollback', 'cerrar']), JSON.stringify(tras0))
    filas.set(S[1].sql, 2)
    const r2 = await envio(S, { peticionId: 'dos' })
    check('2 filas (la clave no identifica): error con filas 2, revertido', r2.ok && r2.valor.tipo === 'error' && r2.valor.indice === 1 && r2.valor.filas === 2 && /2 filas/.test(r2.valor.error.mensaje), JSON.stringify(r2))
    filas.delete(S[1].sql)

    // Un error del servidor en el 3.º: todo se revierte y la respuesta trae su código.
    fallan.set(S[2].sql, fallo('servidor', { codigo: '23503', mensaje: 'viola la clave ajena' }))
    n = f.mensajes.length
    const rs = await envio(S, { peticionId: 'srv' })
    const trasS = f.mensajes.slice(n).map((m) => (m.op === 'tx' ? `tx:${(m as PeticionSinIdDe<'tx'>).accion}` : m.op))
    check('error del servidor en el 3.º: índice 2 con su código, y ROLLBACK', rs.ok && rs.valor.tipo === 'error' && rs.valor.indice === 2 && rs.valor.error.codigo === '23503' && trasS.indexOf('tx:rollback') >= 0 && trasS.indexOf('tx:commit') < 0, JSON.stringify({ rs, trasS }))
    fallan.clear()

    // El COMMIT que falla (restricción diferida): índice -1, nada aplicado.
    const respAntes = e.responder.actual
    e.responder.actual = (p, t) => {
      if (p.op === 'tx' && p.accion === 'commit') throw fallo('servidor', { codigo: '23503', mensaje: 'restricción diferida' }, 'tx')
      return respAntes(p, t)
    }
    const rc = await envio(S, { peticionId: 'commit' })
    check(
      'COMMIT que falla por el servidor: índice -1 y el mensaje dice que no se aplicó nada',
      rc.ok && rc.valor.tipo === 'error' && rc.valor.indice === -1 && /COMMIT/.test(rc.valor.error.mensaje) && /No se aplicó nada/.test(rc.valor.error.mensaje),
      JSON.stringify(rc)
    )
    // la conexión se PIERDE con el COMMIT en camino. El servidor pudo
    // confirmarlo antes de que se cortara la respuesta: decir «no se aplicó nada»
    // invitaba a repetir el envío (y un INSERT repetido duplica filas).
    e.responder.actual = (p, t) => {
      if (p.op === 'tx' && p.accion === 'commit') throw fallo('perdida', { codigo: 'ORA-03113', mensaje: 'end-of-file on communication channel' }, 'tx')
      return respAntes(p, t)
    }
    const rcp = await envio(S, { peticionId: 'commit-perdido' })
    check(
      'COMMIT PERDIDO: índice -1, sesionPerdida, y el mensaje dice que NO SE SABE si se aplicó (nunca «no se aplicó nada»)',
      rcp.ok && rcp.valor.tipo === 'error' && rcp.valor.indice === -1 && rcp.valor.error.motivo === 'sesionPerdida' && /No se sabe/.test(rcp.valor.error.mensaje) && !/No se aplicó nada/i.test(rcp.valor.error.mensaje),
      JSON.stringify(rcp)
    )
    e.responder.actual = respAntes

    // Solo lectura y producción: rechazados SIN lanzar nada.
    const procesos = e.falsos.length
    const rro = await envio(S, { conexionId: 'ro' })
    check(
      "solo lectura: 'soloLectura' sin lanzar el proceso, con el MISMO texto que el controlador (`MOTIVO_SOLO_LECTURA`)",
      !rro.ok && rro.error.motivo === 'soloLectura' && rro.error.mensaje === MOTIVO_SOLO_LECTURA && e.falsos.length === procesos,
      JSON.stringify(rro)
    )
    const rpr = await envio(S, { conexionId: 'pr' })
    check("producción sin confirmar: 'produccion' con el alias, sin lanzar el proceso", !rpr.ok && rpr.error.motivo === 'produccion' && rpr.error.mensaje.includes('ALFA-PROD') && e.falsos.length === procesos, JSON.stringify(rpr))
    const rprOk = await envio(S, { conexionId: 'pr', confirmado: true })
    check('producción CON confirmado: se aplica', rprOk.ok && rprOk.valor.tipo === 'hecho', JSON.stringify(rprOk))
    const vacio = await envio([])
    check('NEGATIVO: sin sentencias no se abre nada', !vacio.ok && vacio.error.motivo === 'interno', JSON.stringify(vacio))

    // Stop con la sentencia EN VUELO: el trabajador la interrumpe, ROLLBACK, cancelada.
    const puerta = new Diferido<unknown>()
    e.responder.actual = (p, t) => (p.op === 'ejecutar' && p.sql === S[1].sql ? puerta : respAntes(p, t))
    n = f.mensajes.length
    const enVuelo = envio(S, { peticionId: 'stop1' })
    await esperarA(() => f.ejecutados().some((m) => m.sql === S[1].sql && f.mensajes.indexOf(m) >= n))
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop1' })
    const rStop = await enVuelo
    const trasStop = f.mensajes.slice(n).map((m) => (m.op === 'tx' ? `tx:${(m as PeticionSinIdDe<'tx'>).accion}` : m.op))
    check(
      'Stop en vuelo: el trabajador recibe «cancelar», error cancelado en el índice 1, ROLLBACK y sin COMMIT',
      rStop.ok && rStop.valor.tipo === 'error' && rStop.valor.indice === 1 && rStop.valor.error.motivo === 'cancelada' && trasStop.indexOf('cancelar') >= 0 && trasStop.indexOf('tx:rollback') >= 0 && trasStop.indexOf('tx:commit') < 0,
      JSON.stringify({ rStop, trasStop })
    )
    // Stop ENTRE dos sentencias: la 1.ª acaba y el Stop llega antes de mandar la 2.ª.
    const puerta2 = new Diferido<unknown>()
    e.responder.actual = (p, t) => (p.op === 'ejecutar' && p.sql === S[0].sql ? puerta2 : respAntes(p, t))
    n = f.mensajes.length
    const entre = envio(S, { peticionId: 'stop2' })
    await esperarA(() => f.mensajes.slice(n).some((m) => m.op === 'ejecutar' && (m as PeticionSinIdDe<'ejecutar'>).sql === S[0].sql))
    puerta2.resolver({ tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' })
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop2' })
    const rEntre = await entre
    const trasEntre = f.mensajes.slice(n).filter((m) => m.op === 'ejecutar' && (m as PeticionSinIdDe<'ejecutar'>).sql !== TOPE_ESPERA_PG).length
    check(
      'Stop ENTRE dos sentencias: la 2.ª no sale, error cancelado en el índice 1 y ROLLBACK',
      rEntre.ok && rEntre.valor.tipo === 'error' && rEntre.valor.indice === 1 && rEntre.valor.error.motivo === 'cancelada' && trasEntre === 1,
      JSON.stringify({ rEntre, ejecutados: trasEntre })
    )
    // el Stop cae con la ÚLTIMA en vuelo y el trabajador ya no la alcanza
    // (terminó antes de que llegara el cancel). El bucle no vuelve a mirar `cancelada`, y
    // sin mirarla antes del COMMIT se confirmaba lo que el usuario pidió parar. El índice
    // es el de esa última, no -1: el -1 es un COMMIT que falló, y la rejilla diría «no se
    // sabe si se aplicó».
    const puerta4 = new Diferido<unknown>()
    e.responder.actual = (p, t) => (p.op === 'ejecutar' && p.sql === S[2].sql ? puerta4 : respAntes(p, t))
    n = f.mensajes.length
    const ultima = envio(S, { peticionId: 'stop-ultima' })
    await esperarA(() => f.ejecutados().some((m) => m.sql === S[2].sql && f.mensajes.indexOf(m) >= n))
    puerta4.resolver({ tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' })
    e.gestor.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop-ultima' })
    const rUltima = await ultima
    const trasUltima = f.mensajes.slice(n).map((m) => (m.op === 'tx' ? `tx:${(m as PeticionSinIdDe<'tx'>).accion}` : m.op))
    check(
      'Stop con la ÚLTIMA en vuelo que termina igual: ningún COMMIT, ROLLBACK, y cancelada en el índice 2 (no -1)',
      rUltima.ok && rUltima.valor.tipo === 'error' && rUltima.valor.indice === 2 && rUltima.valor.error.motivo === 'cancelada' && trasUltima.indexOf('tx:commit') < 0 && trasUltima.indexOf('tx:rollback') >= 0,
      JSON.stringify({ rUltima, trasUltima })
    )
    e.responder.actual = respAntes

    // Pérdida de la sesión a media: el servidor revirtió; nada se confirmó.
    fallan.set(S[1].sql, fallo('perdida', { codigo: 'ORA-03113', mensaje: 'end-of-file on communication channel' }))
    const rp = await envio(S, { peticionId: 'perd' })
    check('pérdida en el 2.º: sesionPerdida en el índice 1, y dice que no se aplicó nada', rp.ok && rp.valor.tipo === 'error' && rp.valor.indice === 1 && rp.valor.error.motivo === 'sesionPerdida' && /no se aplicó nada/.test(rp.valor.error.mensaje), JSON.stringify(rp))
    fallan.clear()
    // Dos envíos con el mismo id a la vez: el segundo, ocupada.
    const puerta3 = new Diferido<unknown>()
    e.responder.actual = (p, t) => (p.op === 'ejecutar' && p.sql === S[0].sql ? puerta3 : respAntes(p, t))
    const primero = envio(S, { peticionId: 'mismo' })
    await tic()
    const segundo = await envio(S, { peticionId: 'mismo' })
    puerta3.resolver({ tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' })
    const rPrimero = await primero
    check('el mismo peticionId a la vez: ocupada, y el primero termina', !segundo.ok && segundo.error.motivo === 'ocupada' && rPrimero.ok && rPrimero.valor.tipo === 'hecho', JSON.stringify(segundo))
    e.responder.actual = respAntes
    const cerradas = f.ops('cerrar').filter((m) => (m as PeticionSinIdDe<'cerrar'>).sesion.startsWith('edicion:')).length
    const abiertas = f.ops('abrir').filter((m) => (m as PeticionSinIdDe<'abrir'>).sesion.startsWith('edicion:')).length
    check('cada sesión efímera que se abrió se cerró (también las que fallaron)', abiertas > 0 && cerradas === abiertas, `abiertas=${abiertas} cerradas=${cerradas}`)
    check('ninguna queda en el gestor', !e.gestor.sesiones().some((s) => s.ref.rol === 'datos'), 'ok')
  }

  hr('(28b) «Enviar» espera un bloqueo con TOPE, y dice qué pasa')
  {
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })])
    type Clave = { tabla: string; columnas: string[]; binds: string[] }
    type Sent = { tipo: 'actualizar' | 'insertar' | 'borrar'; sql: string; binds: string[]; bloqueo?: Clave }
    const envio = (conexionId: string, sentencias: Sent[], peticionId = `b${++ejecucion}`): ReturnType<GestorSesiones['enviarCambios']> =>
      e.gestor.enviarCambios({ conexionId, peticionId, sentencias })
    const pasos = (f: TrabajadorFalso, desde: number, sesion: string): string[] =>
      f.mensajes
        .slice(desde)
        .filter((m) => 'sesion' in m && m.sesion === sesion)
        .map((m) => (m.op === 'tx' ? `tx:${(m as PeticionSinIdDe<'tx'>).accion}` : m.op === 'ejecutar' ? `ejecutar:${(m as PeticionSinIdDe<'ejecutar'>).sql.slice(0, 6)}` : m.op))
    let responderBloqueo: ((p: PeticionSinIdDe<'ejecutar'>) => unknown) | null = null
    let responderDml: ((p: PeticionSinIdDe<'ejecutar'>) => unknown) | null = null
    e.responder.actual = (p, t) => {
      if (p.op === 'ejecutar' && /FOR UPDATE (WAIT|NOWAIT)/.test(p.sql)) return responderBloqueo ? responderBloqueo(p) : rFilas(1)
      if (p.op === 'ejecutar' && /^(update|insert|delete)/i.test(p.sql)) {
        const r = responderDml?.(p)
        return r !== undefined ? r : { tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' }
      }
      return respuestaPorDefecto(p, t)
    }
    const esperaVencida = (): FalloTrabajador => fallo('servidor', { codigo: 'ORA-30006', mensaje: 'ORA-30006: resource busy; acquire with WAIT timeout expired' })
    const ocupadaYa = (): FalloTrabajador => fallo('servidor', { codigo: 'ORA-00054', mensaje: 'ORA-00054: resource busy and acquire with NOWAIT specified' })
    const conBind = (p: PeticionSinIdDe<'ejecutar'>, v: string): boolean => (p.binds as unknown[]).includes(v)
    // Oracle: lo que prepara `prepararEnvio` (ver test-edicion-rejilla): cada UPDATE y
    // DELETE con la identidad de su fila; el INSERT, sin. El gestor las bloquea POR LOTES.
    const clave = (rowid: string): Clave => ({ tabla: '"HR"."T"', columnas: ['ROWID'], binds: [rowid] })
    const O: Sent[] = [
      { tipo: 'actualizar', sql: 'UPDATE "HR"."T" SET "V" = :1 WHERE ROWID = :2', binds: ['x', 'AAA'], bloqueo: clave('AAA') },
      { tipo: 'insertar', sql: 'INSERT INTO "HR"."T" ("V") VALUES (:1)', binds: ['n'] },
      { tipo: 'borrar', sql: 'DELETE FROM "HR"."T" WHERE ROWID = :1', binds: ['BBB'], bloqueo: clave('BBB') }
    ]
    const ro = await envio('o1', O, 'ora-ok')
    const fo = e.falsos.find((x) => x.conexion.id === 'o1') as TrabajadorFalso
    const bloqueos = fo.ejecutados().filter((m) => /FOR UPDATE/.test(m.sql))
    check(
      'Oracle: UN candado con las filas de sus UPDATE y DELETE ANTES de ningún DML, el INSERT sin él, y el COMMIT al final',
      ro.ok && ro.valor.tipo === 'hecho' &&
        JSON.stringify(pasos(fo, 0, 'edicion:ora-ok')) === JSON.stringify(['abrir', 'ejecutar:SELECT', 'ejecutar:UPDATE', 'ejecutar:INSERT', 'ejecutar:DELETE', 'tx:commit', 'cerrar']),
      JSON.stringify(pasos(fo, 0, 'edicion:ora-ok'))
    )
    check(
      'Oracle: el candado lleva las claves de sus filas (ROWID IN, WAIT 10), en la transacción del envío (Manual), de usuario (Stop) y sin contar como DML',
      bloqueos.length === 1 && bloqueos[0].sql === 'SELECT 1 FROM "HR"."T" WHERE ROWID IN (:1, :2) FOR UPDATE WAIT 10' && JSON.stringify(bloqueos[0].binds) === '["AAA","BBB"]' &&
        bloqueos.every((m) => m.opciones.txManual === true && m.opciones.sinBegin === false && m.opciones.proposito === 'usuario' && m.opciones.esDml === false),
      JSON.stringify(bloqueos.map((m) => [m.sql, m.binds, m.opciones]))
    )
    check('NEGATIVO: en Oracle no hay SET LOCAL (eso es de PG)', !fo.ejecutados().some((m) => m.sql === TOPE_ESPERA_PG), 'ok')

    // Vence la espera (ORA-30006) del lote: el lote no dice qué fila. La bisección con
    // NOWAIT la encuentra (la del 3.º) y el error va en SU índice, sin ningún DML.
    responderBloqueo = (p) => {
      if (/NOWAIT/.test(p.sql)) {
        if (conBind(p, 'BBB')) throw ocupadaYa()
        return rFilas(1)
      }
      throw esperaVencida()
    }
    let n = fo.mensajes.length
    const rb = await envio('o1', O, 'ora-bloq')
    check(
      'ORA-30006 en el lote, con la fila del 3.º bloqueada: error en el índice 2 con el mensaje de la fila bloqueada (y el código del lote)',
      rb.ok && rb.valor.tipo === 'error' && rb.valor.indice === 2 && rb.valor.error.codigo === 'ORA-30006' && rb.valor.error.mensaje === mensajeFilaBloqueada('borrar'),
      JSON.stringify(rb)
    )
    check(
      '… la búsqueda son dos NOWAIT (una mitad y la otra), ningún DML sale, ROLLBACK y ningún COMMIT',
      JSON.stringify(pasos(fo, n, 'edicion:ora-bloq')) === JSON.stringify(['abrir', 'ejecutar:SELECT', 'ejecutar:SELECT', 'ejecutar:SELECT', 'tx:rollback', 'cerrar']) &&
        fo.ejecutados().slice(-2).every((m) => /FOR UPDATE NOWAIT$/.test(m.sql)),
      JSON.stringify(pasos(fo, n, 'edicion:ora-bloq'))
    )
    // La otra transacción la soltó mientras se buscaba: ninguna mitad falla ya. No se puede
    // señalar: el primer cambio del lote, y el mensaje lo dice.
    responderBloqueo = (p) => {
      if (/NOWAIT/.test(p.sql)) return rFilas(1)
      throw esperaVencida()
    }
    const rs = await envio('o1', O, 'ora-suelta')
    check(
      'si al buscarla ya no falla ninguna mitad: el índice del PRIMER cambio del lote y la nota de que no se pudo saber cuál',
      rs.ok && rs.valor.tipo === 'error' && rs.valor.indice === 0 && rs.valor.error.codigo === 'ORA-30006' &&
        rs.valor.error.mensaje === `${mensajeFilaBloqueada('actualizar')} ${notaSinCulpable(0, 2, true)}`,
      JSON.stringify(rs)
    )
    // El lote vence la espera, pero la fila del 1.º tiene además un ROWID mal formado: se
    // señala con SU error (el de su sonda), no con el de la espera del lote.
    responderBloqueo = (p) => {
      if (/NOWAIT/.test(p.sql)) {
        if (conBind(p, 'AAA')) throw fallo('servidor', { codigo: 'ORA-01410', mensaje: 'ORA-01410: invalid ROWID' })
        if (conBind(p, 'BBB')) throw ocupadaYa()
        return rFilas(1)
      }
      throw esperaVencida()
    }
    const rpropio = await envio('o1', O, 'ora-propio')
    check(
      'la fila señalada va con SU error: el ORA-01410 de su sonda en el índice 0, no «bloqueada» (el ORA-00054 del NOWAIT sí sería la espera)',
      rpropio.ok && rpropio.valor.tipo === 'error' && rpropio.valor.indice === 0 && rpropio.valor.error.codigo === 'ORA-01410' && /invalid ROWID/.test(rpropio.valor.error.mensaje),
      JSON.stringify(rpropio)
    )
    // Un Stop DURANTE la búsqueda la corta: detenido, sin más sondas.
    responderBloqueo = (p) => {
      if (/NOWAIT/.test(p.sql)) {
        e.gestor.cancelar({ rol: 'datos', conexionId: 'o1', peticionId: 'ora-stop-busca' })
        return rFilas(1)
      }
      throw esperaVencida()
    }
    n = fo.mensajes.length
    const rsb = await envio('o1', O, 'ora-stop-busca')
    const pasosSb = pasos(fo, n, 'edicion:ora-stop-busca').filter((x) => x !== 'cancelar')
    check(
      'un Stop mientras se busca la fila: «Envío detenido», sin más sondas ni DML',
      rsb.ok && rsb.valor.tipo === 'error' && rsb.valor.error.motivo === 'cancelada' && rsb.valor.indice === 0 &&
        JSON.stringify(pasosSb) === JSON.stringify(['abrir', 'ejecutar:SELECT', 'ejecutar:SELECT', 'tx:rollback', 'cerrar']),
      JSON.stringify({ rsb, pasos: pasosSb })
    )
    // Una pérdida en el candado (o en la búsqueda) es del lote entero: su primer cambio, «no
    // se aplicó nada», y sin buscar nada.
    responderBloqueo = () => {
      throw fallo('perdida', { codigo: 'ORA-03113', mensaje: 'end-of-file on communication channel' })
    }
    n = fo.mensajes.length
    const rp0 = await envio('o1', O, 'ora-perdida')
    check(
      'NEGATIVO: la sesión perdida en el candado no se busca: sesionPerdida en el índice 0, sin DML',
      rp0.ok && rp0.valor.tipo === 'error' && rp0.valor.indice === 0 && rp0.valor.error.motivo === 'sesionPerdida' && /no se aplicó nada/.test(rp0.valor.error.mensaje) &&
        fo.ejecutados().filter((m) => m.sesion === 'edicion:ora-perdida').length === 1,
      JSON.stringify(rp0)
    )
    // La fila ya no está (o cambió según sus originales): el candado no la encuentra y no
    // pasa nada; su DML toca 0 filas, y el error es el de «0 filas» en su índice.
    responderBloqueo = null
    responderDml = (p) => (conBind(p, 'AAA') ? { tipo: 'afectadas', filas: 0, comando: null, ms: 1, tx: 'pendiente' } : undefined)
    n = fo.mensajes.length
    const r0 = await envio('o1', O, 'ora-cero')
    responderDml = null
    check(
      'la fila ya no está: el candado pasa, su UPDATE toca 0 filas: TESSERA-FILAS en el índice 0 y ROLLBACK',
      r0.ok && r0.valor.tipo === 'error' && r0.valor.indice === 0 && r0.valor.filas === 0 && r0.valor.error.codigo === 'TESSERA-FILAS' &&
        JSON.stringify(pasos(fo, n, 'edicion:ora-cero')) === JSON.stringify(['abrir', 'ejecutar:SELECT', 'ejecutar:UPDATE', 'tx:rollback', 'cerrar']),
      JSON.stringify({ r0, pasos: pasos(fo, n, 'edicion:ora-cero') })
    )

    // EL MOTIVO DEL CAMBIO: 2500 UPDATE eran 2500 candados más, uno por
    // fila y en serie. Ahora, tres (1000 + 1000 + 500).
    const G: Sent[] = Array.from({ length: 2500 }, (_, i) => ({
      tipo: 'actualizar' as const,
      sql: 'UPDATE "HR"."T" SET "V" = :1 WHERE ROWID = :2',
      binds: ['x', `R${i}`],
      bloqueo: clave(`R${i}`)
    }))
    n = fo.mensajes.length
    const rg = await envio('o1', G, 'ora-grande')
    const ejG = fo.mensajes.slice(n).filter((m): m is PeticionSinIdDe<'ejecutar'> => m.op === 'ejecutar')
    const candadosG = ejG.filter((m) => /FOR UPDATE/.test(m.sql))
    check(
      '2500 UPDATE: 3 candados (1000, 1000 y 500 filas) y 2500 DML: 2503 viajes, no 5000',
      rg.ok && rg.valor.tipo === 'hecho' && candadosG.length === 3 && ejG.length === 2503 &&
        JSON.stringify(candadosG.map((m) => (m.binds as unknown[]).length)) === '[1000,1000,512]' &&
        ejG.slice(0, 3).every((m) => /FOR UPDATE WAIT 10$/.test(m.sql)),
      JSON.stringify({ candados: candadosG.map((m) => (m.binds as unknown[]).length), viajes: ejG.length })
    )
    // Y la fila bloqueada en el SEGUNDO lote: se encuentra dentro de él, en su índice.
    responderBloqueo = (p) => {
      const tiene = conBind(p, 'R1700')
      if (/NOWAIT/.test(p.sql)) {
        if (tiene) throw ocupadaYa()
        return rFilas(1)
      }
      if (tiene) throw esperaVencida()
      return rFilas(1)
    }
    n = fo.mensajes.length
    const rg2 = await envio('o1', G, 'ora-grande-bloq')
    const ejG2 = fo.mensajes.slice(n).filter((m): m is PeticionSinIdDe<'ejecutar'> => m.op === 'ejecutar')
    const sondasG2 = ejG2.filter((m) => /NOWAIT/.test(m.sql)).length
    check(
      'la fila del cambio 1701 bloqueada: el 1.º lote pasa, el 2.º vence, y la bisección da el índice 1700 en ≤ 20 sondas, sin DML',
      rg2.ok && rg2.valor.tipo === 'error' && rg2.valor.indice === 1700 && rg2.valor.error.codigo === 'ORA-30006' &&
        sondasG2 > 0 && sondasG2 <= 20 && !ejG2.some((m) => /^UPDATE/.test(m.sql)),
      JSON.stringify({ indice: rg2.ok && rg2.valor.tipo === 'error' ? rg2.valor.indice : rg2, sondas: sondasG2 })
    )
    // Stop con la espera en vuelo: el trabajador recibe «cancelar»; si el servidor no lo
    // atiende (la 12c+ no interrumpe una espera) y la fila se suelta, el DML ya no sale.
    const puerta = new Diferido<unknown>()
    responderBloqueo = () => puerta
    n = fo.mensajes.length
    const enVuelo = envio('o1', O, 'ora-stop')
    await esperarA(() => fo.mensajes.slice(n).some((m) => m.op === 'ejecutar' && /FOR UPDATE WAIT/.test((m as PeticionSinIdDe<'ejecutar'>).sql)))
    // El trabajador de pruebas interrumpe lo que esté en suspenso al recibir «cancelar»:
    // aquí se simula la 12c+, que no lo atiende y acaba la espera cuando la fila se suelta.
    const original = fo.enviar.bind(fo)
    fo.enviar = (async (peticion: PeticionSinId) => {
      if (peticion.op === 'cancelar') {
        fo.mensajes.push(JSON.parse(JSON.stringify(peticion)) as PeticionSinId)
        setImmediate(() => puerta.resolver(rFilas(1)))
        return { cancelada: true }
      }
      return original(peticion as PeticionSinIdDe<OpTrabajador>)
    }) as TrabajadorFalso['enviar']
    e.gestor.cancelar({ rol: 'datos', conexionId: 'o1', peticionId: 'ora-stop' })
    const rStop = await enVuelo
    fo.enviar = original
    check(
      'Stop esperando la fila que el servidor no atiende (12c+): cancelada en el índice 0 y su UPDATE NO sale',
      rStop.ok && rStop.valor.tipo === 'error' && rStop.valor.indice === 0 && rStop.valor.error.motivo === 'cancelada' &&
        JSON.stringify(pasos(fo, n, 'edicion:ora-stop').filter((x) => x !== 'cancelar')) === JSON.stringify(['abrir', 'ejecutar:SELECT', 'tx:rollback', 'cerrar']),
      JSON.stringify({ rStop, pasos: pasos(fo, n, 'edicion:ora-stop') })
    )
    responderBloqueo = null

    // PG: vence el lock_timeout (55P03) en el UPDATE o en un INSERT.
    const P: Sent[] = [
      { tipo: 'actualizar', sql: 'UPDATE "public"."t" SET "v" = $1 WHERE "id" = $2', binds: ['x', '1'] },
      { tipo: 'insertar', sql: 'INSERT INTO "public"."t" ("id") VALUES ($1)', binds: ['2'] }
    ]
    responderDml = (p) => {
      if (/^UPDATE/.test(p.sql)) throw fallo('servidor', { codigo: '55P03', mensaje: 'canceling statement due to lock timeout' })
      return undefined
    }
    const rp = await envio('c1', P, 'pg-bloq')
    const fp = e.falsos.find((x) => x.conexion.id === 'c1') as TrabajadorFalso
    check(
      'PG, 55P03 en el UPDATE: el mensaje de la fila bloqueada en el índice 0, ROLLBACK',
      rp.ok && rp.valor.tipo === 'error' && rp.valor.indice === 0 && rp.valor.error.codigo === '55P03' && rp.valor.error.mensaje === mensajeFilaBloqueada('actualizar') &&
        pasos(fp, 0, 'edicion:pg-bloq').indexOf('tx:rollback') >= 0 && pasos(fp, 0, 'edicion:pg-bloq').indexOf('tx:commit') < 0,
      JSON.stringify({ rp, pasos: pasos(fp, 0, 'edicion:pg-bloq') })
    )
    responderDml = (p) => {
      if (/^INSERT/.test(p.sql)) throw fallo('servidor', { codigo: '55P03', mensaje: 'canceling statement due to lock timeout' })
      return undefined
    }
    const ri = await envio('c1', P, 'pg-ins')
    check('PG, 55P03 en un INSERT (una clave sin confirmar de otra sesión): su propio texto, índice 1', ri.ok && ri.valor.tipo === 'error' && ri.valor.indice === 1 && ri.valor.error.mensaje === mensajeFilaBloqueada('insertar'), JSON.stringify(ri))
    responderDml = (p) => {
      if (/^UPDATE/.test(p.sql)) throw fallo('servidor', { codigo: '40P01', mensaje: 'deadlock detected' })
      return undefined
    }
    const rd = await envio('c1', P, 'pg-deadlock')
    check('NEGATIVO: un interbloqueo (40P01) no es la espera vencida: el error del servidor tal cual', rd.ok && rd.valor.tipo === 'error' && rd.valor.error.codigo === '40P01' && /deadlock/.test(rd.valor.error.mensaje), JSON.stringify(rd))
    responderDml = null
  }

  hr('(29) ROWID de Oracle: la pestaña y sus páginas de respaldo llevan la columna oculta')
  {
    const e = entorno([conexion('o1', { motor: 'oracle' })])
    await e.gestor.leerTabla({ conexionId: 'o1', peticionId: 'r1', objeto: { esquema: 'HR', nombre: 'SIN_PK' }, pk: [], maxFilas: 500, rowid: true })
    const f = e.falsos[0]
    const primera = f.ejecutados()[0]
    check('la primera página: SELECT "HR"."SIN_PK".*, ROWIDTOCHAR(ROWID)', /^SELECT "HR"\."SIN_PK"\.\*, ROWIDTOCHAR\(ROWID\) AS "__TESSERA_ROWID" FROM "HR"\."SIN_PK"/.test(primera.sql), primera.sql)
    await e.gestor.leerTabla({ conexionId: 'o1', peticionId: 'r2', objeto: { esquema: 'HR', nombre: 'CON_PK' }, pk: ['ID'], maxFilas: 500 })
    check('NEGATIVO: sin `rowid`, el SELECT * de siempre', f.ejecutados()[1].sql === 'SELECT * FROM "HR"."CON_PK"', f.ejecutados()[1].sql)
  }

  hr('(30) un candado de solo lectura nuevo no cae en la rama de otro')
  {
    // `fueraDeEnvoltorio` miraba `candadoSoloLectura === 'envoltorioRollback'`: con un tercer
    // candado (inyectado aquí a propósito, y restaurado) el SET de la lista blanca salía
    // DENTRO de un envoltorio cuyo ROLLBACK lo deshacía, sin error. Ahora es un `switch` que
    // cierra con `nunca`: la sentencia no sale y el log dice qué caso falta.
    const e = entorno([conexion('r1', { readonly: true })])
    await ejecutar(e.gestor, 'select 1', 'kc', 'r1')
    const sesionPg = MOTORES.postgres.sesion as { candadoSoloLectura: string }
    const candado = sesionPg.candadoSoloLectura
    let r: Awaited<ReturnType<typeof ejecutar>>
    try {
      sesionPg.candadoSoloLectura = 'otroCandado'
      r = await ejecutar(e.gestor, 'SET search_path TO ventas', 'kc', 'r1')
    } finally {
      sesionPg.candadoSoloLectura = candado
    }
    const salio = e.falsos[0].ejecutados().some((m) => /^SET search_path/.test(m.sql))
    check(
      'no se envía nada, la respuesta es un error y el log nombra el caso sin contemplar',
      !r.ok && !salio && e.logs.some((l) => /Caso sin contemplar en sesionFueraDelCandado: «otroCandado»/.test(l)),
      JSON.stringify({ r, salio, logs: e.logs.filter((l) => /Caso/.test(l)) })
    )
    const e2 = entorno([conexion('r1', { readonly: true })])
    const bien = await ejecutar(e2.gestor, 'SET search_path TO ventas', 'kc', 'r1')
    const set = e2.falsos[0].ejecutados().find((m) => /^SET search_path/.test(m.sql))
    check('NEGATIVO: con el candado de verdad (PG), el SET sale FUERA del envoltorio, como siempre', bien.ok && set?.opciones.fueraDeEnvoltorio === true, JSON.stringify(set?.opciones))
  }

  hr('(31) los errores de compilación los lee el motor que los guarda')
  {
    // Si tras un CREATE hay algo que leer lo dice la sesión del motor
    // (`sqlErroresCompilacion`), no la bandera léxica `bloquesPlsql` del dialecto.
    const lecturas = (f: TrabajadorFalso): string[] => f.ejecutados().filter((m) => m.opciones.proposito === 'catalogo').map((m) => m.sql)
    const o = entorno([conexion('o1', { motor: 'oracle' })])
    const ro = await ejecutar(o.gestor, 'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;', 'kc', 'o1')
    check(
      'Oracle: tras el CREATE de un PROCEDURE, ALL_ERRORS en la misma sesión y como catálogo',
      ro.ok && lecturas(o.falsos[0]).some((s) => /FROM all_errors/.test(s)),
      JSON.stringify(lecturas(o.falsos[0]))
    )
    const pg = entorno([conexion('c1')])
    const rp = await ejecutar(pg.gestor, 'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$', 'kc')
    check('NEGATIVO: PG, tras su CREATE FUNCTION, no lee nada (falla en el acto o compila)', rp.ok && !lecturas(pg.falsos[0]).some((s) => /all_errors/i.test(s)), JSON.stringify(lecturas(pg.falsos[0])))
    // Y el gestor manda lo que diga el motor: con la consulta de PG cambiada a propósito (y
    // restaurada), la manda tal cual.
    const sesionPg = MOTORES_EXPLORADOR.postgres.sesion as { sqlErroresCompilacion: (st: unknown) => unknown }
    const deVerdad = sesionPg.sqlErroresCompilacion
    const pg2 = entorno([conexion('c1')])
    try {
      sesionPg.sqlErroresCompilacion = () => ({ sql: 'SELECT 1 AS errores_de_prueba', binds: [] })
      await ejecutar(pg2.gestor, 'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$', 'kc')
    } finally {
      sesionPg.sqlErroresCompilacion = deVerdad
    }
    check('el gestor lee con la consulta del motor (cambiada a propósito)', lecturas(pg2.falsos[0]).indexOf('SELECT 1 AS errores_de_prueba') >= 0, JSON.stringify(lecturas(pg2.falsos[0])))
  }

  hr('(S) SQLite — un proceso por consola, Stop = matar, límites y bloqueo del archivo (y la tx que solo leyó en WAL/rollback y el aviso de `:a` con `?1`)')
  {
    const RUTA = 'C:\\datos\\base.db'
    const sqlite = (id: string, extra: Partial<DbConnection> = {}): DbConnection =>
      conexion(id, { motor: 'sqlite', host: '', port: 0, user: '', database: undefined, tieneSecreto: false, archivoVisible: 'base.db', ...extra })
    const mapa = new Map<string, DbConnection>([
      ['s1', sqlite('s1')],
      ['s2', sqlite('s2', { alias: 'OTRA' })],
      ['s3', sqlite('s3')],
      ['s4', sqlite('s4', { archivoVisible: 'otra.db' })]
    ])
    const rutas = new Map<string, string>([
      ['s1', RUTA],
      ['s2', RUTA],
      ['s4', 'C:\\datos\\otra.db']
    ])
    const falsos: TrabajadorFalso[] = []
    const responder = { actual: respuestaPorDefecto as Responder }
    const logs: string[] = []
    const g = new GestorSesiones({
      lanzar: (con) => {
        const f = new TrabajadorFalso(con, (p, t) => responder.actual(p, t))
        falsos.push(f)
        return f
      },
      conexion: (id) => mapa.get(id),
      // Nadie debería pedirlo: SQLite no tiene credenciales.
      secreto: () => {
        throw new Error('se pidió un secreto a SQLite')
      },
      rutaArchivo: (id) => rutas.get(id) ?? null,
      nombreConsola: async (_perfil, consolaId) => `nombre-${consolaId}`,
      ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
      emitirSesion: () => {},
      log: (l) => logs.push(l)
    })
    const r1 = await ejecutar(g, 'select 1', 'q1', 's1')
    const abrir = falsos[0]?.ops('abrir')[0] as PeticionSinIdDe<'abrir'> | undefined
    check('abre sin secreto (texto vacío) y con la RUTA del registro en la conexión', r1.ok && abrir?.secreto === '' && abrir.conexion.archivo === RUTA && abrir.conexion.motor === 'sqlite', JSON.stringify(abrir?.conexion))
    await ejecutar(g, 'select 1', 'q2', 's1')
    await g.catalogo('s1', (ctx) => ctx.consultar({ sql: "SELECT 'main'", binds: [] }))
    const deQ1 = falsos.filter((f) => f.ops('abrir').some((m) => (m as PeticionSinIdDe<'abrir'>).sesion === 'consola:q1'))
    const deMeta = falsos.filter((f) => f.ops('abrir').some((m) => (m as PeticionSinIdDe<'abrir'>).rol === 'meta'))
    check('cada consola SU proceso, y meta el de la conexión (3 procesos)', falsos.length === 3 && deQ1.length === 1 && deMeta.length === 1 && deQ1[0] !== deMeta[0], `${falsos.length} procesos`)
    // Stop con la sentencia en el trabajador: se MATA el proceso de ESA consola.
    const pendiente = new Diferido()
    responder.actual = (p, t) => (p.op === 'ejecutar' && /larga/.test(p.sql) ? pendiente : respuestaPorDefecto(p, t))
    const larga = g.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'q1', conexionId: 's1', ejecucionId: 'L1', sql: 'select larga', maxFilas: 10 })
    await esperarA(() => deQ1[0].ejecutados().some((m) => /larga/.test(m.sql)))
    g.cancelar({ rol: 'consola', perfilId: 'perfil1', consolaId: 'q1', ejecucionId: 'L1' })
    const rl = await larga
    const eL = rl.ok && rl.valor.tipo === 'error' ? rl.valor.error : null
    check('Stop: el proceso de la consola muere y la sentencia vuelve «cancelada»', !deQ1[0].vivo && eL?.motivo === 'cancelada' && eL.codigo === 'TESSERA-DETENIDA' && deQ1[0].ops('cancelar').length === 0, JSON.stringify(eL))
    check('…sin tocar el de la otra consola ni el de la conexión', falsos.filter((f) => f.vivo).length === 2, `${falsos.filter((f) => f.vivo).length} vivos`)
    const est = g.estadoConsola('perfil1', 'q1')
    check("la sesión queda 'cerrada' sin aviso (no 'perdida')", est?.fase === 'cerrada' && est.aviso === undefined, JSON.stringify(est && { fase: est.fase, aviso: est.aviso }))
    responder.actual = respuestaPorDefecto
    const tras = await ejecutar(g, 'select 2', 'q1', 's1')
    check('la siguiente relanza su proceso (perezoso) y va bien', tras.ok && falsos.length === 4 && falsos[3].vivo, `${falsos.length} procesos`)
    // Con cambios pendientes, el Stop NO mata (queda «Forzar»).
    responder.actual = (p, t) => {
      if (p.op === 'ejecutar' && /^insert/i.test(p.sql)) return { tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' }
      if (p.op === 'ejecutar' && /larga/.test(p.sql)) return pendiente2
      return respuestaPorDefecto(p, t)
    }
    const pendiente2 = new Diferido()
    await ejecutar(g, 'insert into t values (1)', 'q2', 's1')
    const larga2 = g.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'q2', conexionId: 's1', ejecucionId: 'L2', sql: 'select larga', maxFilas: 10 })
    const deQ2 = falsos.find((f) => f.ops('abrir').some((m) => (m as PeticionSinIdDe<'abrir'>).sesion === 'consola:q2')) as TrabajadorFalso
    await esperarA(() => deQ2.ejecutados().some((m) => /larga/.test(m.sql)))
    g.cancelar({ rol: 'consola', perfilId: 'perfil1', consolaId: 'q2', ejecucionId: 'L2' })
    await tic()
    const sigueVivo = deQ2.vivo
    pendiente2.resolver(rFilas(1, { tx: 'pendiente' }))
    const rl2 = await larga2
    check('con cambios pendientes: el Stop no mata, la consulta termina y el registro lo dice', sigueVivo && rl2.ok && rl2.valor.tipo === 'filas' && logs.some((l) => /cambios pendientes, no se mata/.test(l)), JSON.stringify({ sigueVivo, tipo: rl2.ok ? rl2.valor.tipo : rl2 }))
    // «Enviar» por OTRA conexión al MISMO archivo: dice qué consola lo bloquea.
    const env = await g.enviarCambios({ conexionId: 's2', peticionId: 'env1', sentencias: [{ tipo: 'actualizar', sql: 'UPDATE t SET a = ?1', binds: ['x'] }] })
    check(
      '«Enviar» con una consola que bloquea el mismo archivo: txPendiente con su nombre y su conexión, sin abrir nada',
      !env.ok && env.error.motivo === 'txPendiente' && env.error.mensaje.startsWith('La consola «nombre-q2» (ALIAS-s1) tiene cambios sin confirmar') && !falsos.some((f) => f.conexion.id === 's2'),
      JSON.stringify(env)
    )
    const env4 = await g.enviarCambios({ conexionId: 's4', peticionId: 'env4', sentencias: [{ tipo: 'actualizar', sql: 'UPDATE t SET a = ?1', binds: ['x'] }] })
    check('…y en otro archivo no bloquea nada', env4.ok && env4.valor.tipo === 'hecho', JSON.stringify(env4))
    // Sin ruta guardada: no se abre, y lo dice.
    const sinRuta = await ejecutar(g, 'select 1', 'q9', 's3')
    const eSin = sinRuta.ok ? null : sinRuta.error
    check('sin archivo guardado: no abre y lo dice', eSin !== null && /archivo de base guardado/.test(eSin.mensaje), JSON.stringify(sinRuta))
    // «Forzar» con la consola: solo el proceso de ESA consola.
    const vivosAntes = falsos.filter((f) => f.vivo).length
    g.forzar('s1', { perfilId: 'perfil1', consolaId: 'q2' })
    await tic()
    check(
      'Forzar con la consola: mata SOLO su proceso (la de q2, con cambios); el de q1 y el de la conexión siguen',
      !deQ2.vivo && falsos.filter((f) => f.vivo).length === vivosAntes - 1 && falsos[3].vivo && deMeta[0].vivo && g.estadoConsola('perfil1', 'q2')?.fase === 'perdida',
      JSON.stringify({ vivosAntes, ahora: falsos.filter((f) => f.vivo).length, fase: g.estadoConsola('perfil1', 'q2')?.fase })
    )
    g.forzar('s1', { perfilId: 'perfil1', consolaId: 'sin-proceso' })
    await tic()
    check(
      '…y una consola sin proceso propio NO hace caer la conexión entera (la UI solo confirmó perder esa)',
      falsos.filter((f) => f.vivo).length === vivosAntes - 1 && logs.some((l) => /no tiene proceso propio vivo/.test(l)),
      `${falsos.filter((f) => f.vivo).length} vivos`
    )
    // Límite de procesos de consola: al pasar de MAX_PROCESOS_CONSOLA se expulsa el ocioso.
    responder.actual = respuestaPorDefecto
    for (let i = 0; i < MAX_PROCESOS_CONSOLA + 2; i++) await ejecutar(g, 'select 1', `lim${i}`, i % 2 === 0 ? 's4' : 's1')
    await tic()
    const deConsolaVivos = falsos.filter((f) => f.vivo && f.ops('abrir').every((m) => (m as PeticionSinIdDe<'abrir'>).rol === 'consola')).length
    check(`nunca más de ${MAX_PROCESOS_CONSOLA} procesos de consola vivos (expulsa el ocioso)`, deConsolaVivos <= MAX_PROCESOS_CONSOLA && logs.some((l) => /límite de 8 procesos/.test(l)), `${deConsolaVivos} vivos`)
    // Oracle y PG no cambian: un proceso por conexión aunque haya dos consolas.
    const pg = entorno([conexion('c1')])
    await ejecutar(pg.gestor, 'select 1', 'a1')
    await ejecutar(pg.gestor, 'select 1', 'a2')
    check('PG: dos consolas, UN proceso (el de siempre)', pg.falsos.length === 1, `${pg.falsos.length}`)
    await g.cerrarTodo(100)
    await pg.gestor.cerrarTodo(100)

    // --- una tx que solo LEYÓ bloquea «Enviar» según el diario.
    // Medido con dos procesos: en rollback el COMMIT del otro espera el busy_timeout y falla;
    // en WAL entra al instante. La cabecera decide (bytes 18 y 19: 2 = WAL).
    const cabecera = (diario: 1 | 2): Uint8Array => {
      const b = new Uint8Array(100)
      const magia = 'SQLite format 3\u0000'
      for (let i = 0; i < magia.length; i++) b[i] = magia.charCodeAt(i)
      b[18] = diario
      b[19] = diario
      return b
    }
    let laCabecera: Uint8Array | null = cabecera(2)
    const leidas: string[] = []
    const falsos2: TrabajadorFalso[] = []
    const responder2 = { actual: respuestaPorDefecto as Responder }
    const g2 = new GestorSesiones({
      lanzar: (con) => {
        const f = new TrabajadorFalso(con, (p, t) => responder2.actual(p, t))
        falsos2.push(f)
        return f
      },
      conexion: (id) => mapa.get(id),
      secreto: () => null,
      rutaArchivo: (id) => rutas.get(id) ?? null,
      leerCabecera: (ruta) => {
        leidas.push(ruta)
        return laCabecera
      },
      nombreConsola: async (_perfil, consolaId) => `nombre-${consolaId}`,
      ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
      emitirSesion: () => {},
      log: () => {}
    })
    responder2.actual = (p, t) => (p.op === 'ejecutar' && /lee/.test(p.sql) ? rFilas(1, { tx: 'abierta' }) : respuestaPorDefecto(p, t))
    await ejecutar(g2, 'select lee', 'q-lee', 's1')
    check('la consola que solo leyó queda con la tx ABIERTA (el BEGIN perezoso de Tx Manual)', g2.estadoConsola('perfil1', 'q-lee')?.tx === 'abierta', JSON.stringify(g2.estadoConsola('perfil1', 'q-lee')?.tx))
    const enviar2 = (id: string): ReturnType<GestorSesiones['enviarCambios']> =>
      g2.enviarCambios({ conexionId: 's2', peticionId: id, sentencias: [{ tipo: 'actualizar', sql: 'UPDATE t SET a = ?1', binds: ['x'] }] })
    const wal = await enviar2('w1')
    check('WAL: una tx que solo leyó NO bloquea «Enviar» (se envía)', wal.ok && wal.valor.tipo === 'hecho' && leidas.includes(RUTA), JSON.stringify(wal))
    laCabecera = cabecera(1)
    const rb = await enviar2('w2')
    check(
      'rollback: SÍ lo bloquea, y el mensaje dice «transacción abierta» (no «cambios sin confirmar»)',
      !rb.ok && rb.error.motivo === 'txPendiente' && rb.error.mensaje.startsWith('La consola «nombre-q-lee» (ALIAS-s1) tiene una transacción abierta'),
      JSON.stringify(rb)
    )
    laCabecera = null
    const sinCab = await enviar2('w3')
    check('sin cabecera legible: por prudencia, bloquea', !sinCab.ok && sinCab.error.motivo === 'txPendiente', JSON.stringify(sinCab))
    laCabecera = cabecera(2)
    responder2.actual = (p, t) => (p.op === 'ejecutar' && /^insert/i.test(p.sql) ? { tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' } : respuestaPorDefecto(p, t))
    await ejecutar(g2, 'insert into t values (1)', 'q-lee', 's1')
    const walPend = await enviar2('w4')
    check('WAL con CAMBIOS pendientes: bloquea (un solo escritor)', !walPend.ok && walPend.error.motivo === 'txPendiente' && /cambios sin confirmar/.test(walPend.error.mensaje), JSON.stringify(walPend))

    // --- Pendiente (c): `:a` y `?1` son el mismo hueco en SQLite; el aviso sale con ESE
    // resultado y, si la sentencia falla, no se queda pegado a la siguiente.
    responder2.actual = (p, t) => {
      if (p.op === 'ejecutar' && /falla/.test(p.sql)) throw fallo('servidor')
      return respuestaPorDefecto(p, t)
    }
    // Los avisos solo existen en los resultados que no son error: se leen sin estrechar el tipo.
    const avisosDe = (r: Awaited<ReturnType<typeof ejecutar>>): string[] => (r.ok ? ((r.valor as { avisos?: string[] }).avisos ?? []) : [])
    const par = await ejecutarCon(g2, 'select :a, ?1', { a: 'A', '1': 'uno' }, 'q-par', 's1')
    check('con `:a, ?1`: se ejecuta y el resultado AVISA de que ?1 no se usó', par.ok && avisosDe(par).some((a) => /\?1 y :a son el MISMO parámetro/.test(a)), JSON.stringify(par))
    const siguiente = await ejecutar(g2, 'select 2', 'q-par', 's1')
    check('…y la siguiente sentencia ya no lo lleva', siguiente.ok && !avisosDe(siguiente).some((a) => /MISMO parámetro/.test(a)), JSON.stringify(avisosDe(siguiente)))
    const rFalla = await ejecutarCon(g2, 'select falla, :a, ?1', { a: 'A', '1': 'uno' }, 'q-par', 's1')
    const trasFallo = await ejecutar(g2, 'select 3', 'q-par', 's1')
    check(
      'si la sentencia con el aviso FALLA, el aviso no sale pegado a la siguiente',
      rFalla.ok && rFalla.valor.tipo === 'error' && trasFallo.ok && trasFallo.valor.tipo === 'filas' && !avisosDe(trasFallo).some((a) => /MISMO parámetro/.test(a)),
      JSON.stringify({ falla: rFalla.ok ? rFalla.valor.tipo : rFalla, tras: avisosDe(trasFallo) })
    )
    await g2.cerrarTodo(100)
  }

  hr('(32) ajustes de Configuración — Tx al abrir e inactividad de la consola')
  {
    const e = entorno([
      conexion('c1'),
      conexion('ro', { readonly: true }),
      conexion('pr', { alias: 'PROD', entorno: 'produccion' })
    ])
    const modo = (consolaId: string): string | undefined => e.gestor.estadoConsola('perfil1', consolaId)?.txModo
    // Sin ajustes: lo de siempre (Auto fuera de producción).
    await ejecutar(e.gestor, 'select 1', 'a0')
    check('sin ajustes, una consola nueva nace en Auto (lo de siempre)', modo('a0') === 'auto', String(modo('a0')))
    // La preferencia por `fijarAjustes` (lo que manda el main al arrancar y al guardar).
    e.gestor.fijarAjustes({ txInicial: 'manual', inactividadConsolaMs: 30 * 60_000 })
    await ejecutar(e.gestor, 'select 1', 'm1')
    check('con la preferencia Manual, la consola NUEVA nace en Manual', modo('m1') === 'manual', String(modo('m1')))
    check('…y la que ya tenía sesión conserva su modo', modo('a0') === 'auto', String(modo('a0')))
    await ejecutar(e.gestor, 'select 1', 'ro1', 'ro')
    check('NEGATIVO: en SOLO LECTURA nace en Auto aunque la preferencia sea Manual', modo('ro1') === 'auto', String(modo('ro1')))
    // La que trae la PETICIÓN manda sobre la del main (es la que pinta la barra).
    const conTx = (consolaId: string, txInicial: unknown): ReturnType<GestorSesiones['ejecutarConsola']> =>
      e.gestor.ejecutarConsola({
        perfilId: 'perfil1',
        consolaId,
        conexionId: 'c1',
        ejecucionId: `e${++ejecucion}`,
        sql: 'select 1',
        maxFilas: 500,
        txInicial: txInicial as DbTxModo
      })
    await conTx('p-auto', 'auto')
    check('la preferencia de la PETICIÓN manda sobre la del main (Auto)', modo('p-auto') === 'auto', String(modo('p-auto')))
    e.gestor.fijarAjustes({ txInicial: 'auto', inactividadConsolaMs: 30 * 60_000 })
    await conTx('p-man', 'manual')
    check('…y al revés: el main en Auto y la petición en Manual -> Manual', modo('p-man') === 'manual', String(modo('p-man')))
    await explicar(e.gestor, 'select 1', 'x-main', 'c1')
    check('explicar sin preferencia en la petición usa la del main (Auto)', modo('x-main') === 'auto', String(modo('x-main')))
    await e.gestor.explicar({
      perfilId: 'perfil1',
      consolaId: 'x-pet',
      conexionId: 'c1',
      ejecucionId: `x${++ejecucion}`,
      sql: 'select 1',
      txInicial: 'manual'
    })
    check('explicar CON preferencia en la petición la respeta (Manual)', modo('x-pet') === 'manual', String(modo('x-pet')))
    await conTx('p-raro', 'MANUAL')
    check('una preferencia de petición inválida se ignora (manda la del main, Auto)', modo('p-raro') === 'auto', String(modo('p-raro')))
    await ejecutar(e.gestor, 'select 1', 'pr1', 'pr')
    check('NEGATIVO: producción nace en Manual con la preferencia en Auto (no cambia)', modo('pr1') === 'manual', String(modo('pr1')))

    // Inactividad: «Nunca» no cierra; 15 min cierra a los 16; un umbral roto vuelve a 30.
    const sesionesCerradas = (f: TrabajadorFalso): string[] =>
      f.ops('cerrar').map((m) => (m as PeticionSinIdDe<'cerrar'>).sesion)
    const f1 = e.falsos.find((x) => x.conexion.id === 'c1') as TrabajadorFalso
    e.gestor.fijarAjustes({ txInicial: 'auto', inactividadConsolaMs: Number.POSITIVE_INFINITY })
    e.gestor.barrer(e.reloj.t + 24 * 3600_000)
    check(
      '«Nunca»: a las 24 h ninguna consola se ha cerrado',
      !sesionesCerradas(f1).some((c) => c.startsWith('consola:')) &&
        e.gestor.estadoConsola('perfil1', 'm1')?.fase === 'lista',
      sesionesCerradas(f1).join(',') || 'ninguna'
    )
    const e2 = entorno([conexion('c1')])
    e2.gestor.fijarAjustes({ txInicial: 'auto', inactividadConsolaMs: 15 * 60_000 })
    await ejecutar(e2.gestor, 'select 1', 'q1')
    const u0 = e2.reloj.t
    e2.gestor.barrer(u0 + 14 * 60_000)
    const a14 = sesionesCerradas(e2.falsos[0]).includes('consola:q1')
    e2.gestor.barrer(u0 + 16 * 60_000)
    check(
      '15 min: a los 14 sigue abierta y a los 16 se cierra, con aviso de inactividad',
      !a14 &&
        sesionesCerradas(e2.falsos[0]).includes('consola:q1') &&
        e2.gestor.estadoConsola('perfil1', 'q1')?.aviso?.tipo === 'inactividad',
      `14 min: ${a14 ? 'cerrada' : 'abierta'} · ${sesionesCerradas(e2.falsos[0]).join(',')}`
    )
    const e3 = entorno([conexion('c1')])
    e3.gestor.fijarAjustes({ txInicial: 'auto', inactividadConsolaMs: Number.NaN })
    await ejecutar(e3.gestor, 'select 1', 'n1')
    const v0 = e3.reloj.t
    e3.gestor.barrer(v0 + 29 * 60_000)
    const a29 = sesionesCerradas(e3.falsos[0]).includes('consola:n1')
    e3.gestor.barrer(v0 + 31 * 60_000)
    check(
      'un umbral NaN se sanea a 30 min (ni «Nunca» sin pedirlo ni cerrar en cada barrido)',
      !a29 && sesionesCerradas(e3.falsos[0]).includes('consola:n1'),
      `29 min: ${a29 ? 'cerrada' : 'abierta'} · ${sesionesCerradas(e3.falsos[0]).join(',')}`
    )
    await e.gestor.cerrarTodo(100)
    await e2.gestor.cerrarTodo(100)
    await e3.gestor.cerrarTodo(100)
  }

  hr('(33) la Tx de Configuración en TODAS las peticiones que crean sesión, y al dejar el solo lectura')
  {
    // --- el main tiene una copia DESFASADA (Auto) y la barra dice Manual.
    const e = entorno([conexion('c1'), conexion('ro', { readonly: true })])
    e.gestor.fijarAjustes({ txInicial: 'auto', inactividadConsolaMs: 30 * 60_000 })
    const modo = (consolaId: string): string | undefined => e.gestor.estadoConsola('perfil1', consolaId)?.txModo
    const conTx = (consolaId: string): RefConsola => ({ ...refConsola(consolaId), txInicial: 'manual' })
    const rEsq = await e.gestor.fijarEsquemaConsola(conTx('h-esquema'), 'ventas')
    check(
      'fijar el ESQUEMA de una consola sin sesión la crea con la Tx de la PETICIÓN (Manual), no con la del main',
      rEsq.ok && rEsq.valor.txModo === 'manual' && modo('h-esquema') === 'manual',
      String(modo('h-esquema'))
    )
    const rRb = await e.gestor.txConsola(conTx('h-tx'), 'rollback')
    check('Commit/Rollback sin sesión: la crea en Manual', rRb.ok && modo('h-tx') === 'manual', String(modo('h-tx')))
    await e.gestor.leerValor({ conexionId: 'c1', sql: 'SELECT 1', binds: [], topes: {}, consola: conTx('h-valor') })
    check('leer el valor de una celda sin sesión: la crea en Manual', modo('h-valor') === 'manual', String(modo('h-valor')))
    try {
      await e.gestor.exportarConsulta({ ...conTx('h-exp'), sql: 'select 1', peticionId: 'exp-h', topes: {} }, async () => {}, () => false)
    } catch {
      // Lo que se fija es con qué modo nació la sesión, no la exportación.
    }
    check('exportar una consulta sin sesión: la crea en Manual', modo('h-exp') === 'manual', String(modo('h-exp')))
    const rMod = await e.gestor.modoTx(conTx('h-modo'), 'auto')
    check('NEGATIVO: cambiar el modo manda el modo PEDIDO (Auto), traiga la petición lo que traiga', rMod.ok && modo('h-modo') === 'auto', String(modo('h-modo')))
    await e.gestor.fijarEsquemaConsola(refConsola('h-sin'), 'ventas')
    check('NEGATIVO: sin `txInicial` en la petición, manda la del main (Auto)', modo('h-sin') === 'auto', String(modo('h-sin')))
    await e.gestor.fijarEsquemaConsola({ ...refConsola('h-raro'), txInicial: 'MANUAL' as DbTxModo }, 'ventas')
    check('NEGATIVO: una `txInicial` inválida se ignora (manda la del main)', modo('h-raro') === 'auto', String(modo('h-raro')))
    await e.gestor.fijarEsquemaConsola({ ...refConsola('h-ro', 'ro'), txInicial: 'manual' }, 'ventas')
    check('NEGATIVO: en SOLO LECTURA nace en Auto aunque la petición diga Manual', modo('h-ro') === 'auto', String(modo('h-ro')))
    await e.gestor.fijarEsquemaConsola({ ...refConsola('h-esquema'), txInicial: 'auto' }, 'compras')
    check('NEGATIVO: con la sesión ya creada, la `txInicial` de la petición no cuenta', modo('h-esquema') === 'manual', String(modo('h-esquema')))
    await e.gestor.cerrarTodo(100)

    // --- una conexión que DEJA de ser de solo lectura, con «Transacción al abrir» = Manual.
    const e2 = entorno([
      conexion('rc', { readonly: true }),
      conexion('rl', { readonly: true }),
      conexion('rb', { readonly: true }),
      conexion('ra', { readonly: true }),
      conexion('rw')
    ])
    e2.gestor.fijarAjustes({ txInicial: 'manual', inactividadConsolaMs: 30 * 60_000 })
    const modo2 = (consolaId: string): string | undefined => e2.gestor.estadoConsola('perfil1', consolaId)?.txModo
    const quitarRo = (id: string): void => {
      const antes = e2.conexiones.get(id) as DbConnection
      const despues = { ...antes, readonly: false }
      e2.conexiones.set(id, despues)
      e2.gestor.alCambiarConexion(antes, despues)
    }
    // (a) Cerrada por inactividad mientras era de solo lectura.
    await ejecutar(e2.gestor, 'select 1', 'kc', 'rc')
    await ejecutar(e2.gestor, 'select 1', 'kl', 'rl')
    await ejecutar(e2.gestor, 'select 1', 'kw', 'rw')
    await e2.gestor.modoTx(refConsola('kw', 'rw'), 'auto')
    e2.gestor.barrer(e2.reloj.t + 31 * 60_000)
    await ejecutar(e2.gestor, 'select 1', 'kl', 'rl')
    check(
      'de partida: las de solo lectura en Auto (forzado), una cerrada y otra viva',
      modo2('kc') === 'auto' && e2.gestor.estadoConsola('perfil1', 'kc')?.fase === 'cerrada' && modo2('kl') === 'auto' && e2.gestor.estadoConsola('perfil1', 'kl')?.fase === 'lista',
      JSON.stringify([e2.gestor.estadoConsola('perfil1', 'kc')?.fase, e2.gestor.estadoConsola('perfil1', 'kl')?.fase])
    )
    quitarRo('rc')
    await tic()
    const kc = e2.gestor.estadoConsola('perfil1', 'kc')
    check(
      'deja el solo lectura: la consola CERRADA pasa a la preferencia (Manual), ya sin solo lectura',
      kc?.txModo === 'manual' && kc.soloLectura === false,
      JSON.stringify(kc && { txModo: kc.txModo, soloLectura: kc.soloLectura })
    )
    quitarRo('rl')
    check('… y la que estaba VIVA (lista), también, al momento', modo2('kl') === 'manual', String(modo2('kl')))
    const nAbrir = e2.falsos.length
    await ejecutar(e2.gestor, 'select 1', 'kc', 'rc')
    const fc = e2.falsos.slice(nAbrir).find((f) => f.conexion.id === 'rc')
    const abrirKc = (fc?.ops('abrir') as Array<PeticionSinIdDe<'abrir'>> | undefined)?.find((a) => a.sesion === 'consola:kc')
    check('… y al reabrir, abre SIN autocommit (Manual de verdad, no solo en la barra)', abrirKc?.opciones.autoCommit === false, JSON.stringify(abrirKc?.opciones))

    // (b) Ocupada al dejar el solo lectura: se aplica al terminar.
    const puerta = new Diferido<unknown>()
    e2.responder.actual = (p, f) => (p.op === 'ejecutar' && p.sql === 'select larga' ? puerta : respuestaPorDefecto(p, f))
    await ejecutar(e2.gestor, 'select 0', 'kb', 'rb')
    const fb = e2.falsos.find((f) => f.conexion.id === 'rb') as TrabajadorFalso
    fb.salir = async (): Promise<void> => {
      fb.mensajes.push({ op: 'salir' })
    }
    const enCurso = ejecutar(e2.gestor, 'select larga', 'kb', 'rb')
    await esperarA(() => e2.gestor.estadoConsola('perfil1', 'kb')?.fase === 'ocupada')
    quitarRo('rb')
    check('ocupada al dejar el solo lectura: no se toca a media sentencia', modo2('kb') === 'auto', String(modo2('kb')))
    puerta.resolver(rFilas(1))
    await enCurso
    check('… y al TERMINAR, la preferencia (Manual)', modo2('kb') === 'manual', String(modo2('kb')))

    // (c) NEGATIVOS.
    e2.gestor.fijarAjustes({ txInicial: 'auto', inactividadConsolaMs: 30 * 60_000 })
    await ejecutar(e2.gestor, 'select 1', 'ka', 'ra')
    quitarRo('ra')
    await tic()
    check('NEGATIVO: con la preferencia en Auto, dejar el solo lectura no cambia nada', modo2('ka') === 'auto', String(modo2('ka')))
    e2.gestor.fijarAjustes({ txInicial: 'manual', inactividadConsolaMs: 30 * 60_000 })
    const rw = e2.conexiones.get('rw') as DbConnection
    const rw2 = { ...rw, alias: 'otro alias' }
    e2.conexiones.set('rw', rw2)
    e2.gestor.alCambiarConexion(rw, rw2)
    await tic()
    check(
      'NEGATIVO: en una conexión que YA era de escritura, editarla no deshace el Auto que eligió el usuario',
      modo2('kw') === 'auto',
      String(modo2('kw'))
    )
    await e2.gestor.cerrarTodo(100)
  }

  // La casilla «Solo lectura» de la conexión es SOLO de
  // los agentes (`tdb`). El gestor del PRODUCTO (sin `soloLecturaImpuesta`) no la mira: con
  // ella marcada, el usuario escribe, pasa a Manual, confirma y envía cambios de la rejilla.
  hr('(34) El gestor del producto: la casilla «Solo lectura» de los agentes no limita al usuario')
  {
    const e = entorno(
      [
        conexion('c1', { readonly: true }),
        conexion('o1', { motor: 'oracle', readonly: true }),
        conexion('pr', { alias: 'ALFA-PROD', entorno: 'produccion', readonly: true })
      ],
      { soloLecturaImpuesta: null }
    )
    e.responder.actual = (p, t) =>
      p.op === 'ejecutar' && /^(update|insert|delete)/i.test(p.sql)
        ? { tipo: 'afectadas', filas: 1, comando: null, ms: 1, tx: 'pendiente' }
        : respuestaPorDefecto(p, t)
    const up = await ejecutar(e.gestor, 'update t set a = 1 where id = 1', 'k1', 'c1')
    const f1 = e.falsos.find((f) => f.conexion.id === 'c1') as TrabajadorFalso | undefined
    const dml = f1?.ejecutados().find((m) => /^update/i.test(m.sql))
    check('un UPDATE en una conexión con la casilla marcada SALE al servidor', up.ok && dml !== undefined, JSON.stringify(up.ok ? up.valor.tipo : up.error))
    check('… sin el candado de solo lectura ni fuera del envoltorio', dml?.opciones.candadoRO === false && dml.opciones.fueraDeEnvoltorio === false, JSON.stringify(dml?.opciones))
    const abrir = f1?.ops('abrir')[0] as PeticionSinIdDe<'abrir'> | undefined
    check('el trabajador recibe la conexión SIN solo lectura (SQLite la abriría en lectura-escritura)', abrir?.conexion.readonly === false, JSON.stringify(abrir?.conexion))
    const est = e.gestor.estadoConsola('perfil1', 'k1')
    check('el estado de la consola no dice solo lectura', est?.soloLectura === false, JSON.stringify(est && { soloLectura: est.soloLectura }))
    const man = await e.gestor.modoTx(refConsola('k1', 'c1'), 'manual')
    check('pasar a Manual SE PUEDE', man.ok && man.valor.txModo === 'manual', JSON.stringify(man))
    const bloque = await ejecutar(e.gestor, 'begin null; end;', 'k3', 'o1')
    check('Oracle: un bloque PL/SQL SE EJECUTA', bloque.ok, JSON.stringify(bloque.ok ? 'ok' : bloque.error))
    const env = await e.gestor.enviarCambios({
      conexionId: 'c1',
      peticionId: 'env-ro',
      sentencias: [{ tipo: 'actualizar', sql: 'UPDATE "public"."t" SET "a" = $1 WHERE "id" = $2', binds: ['x', '1'] }]
    })
    check('«Enviar» de la rejilla SE APLICA', env.ok && env.valor.tipo === 'hecho' && env.valor.cambios === 1, JSON.stringify(env))
    // Producción con la casilla marcada: pide confirmación (informa, no prohíbe), como toda
    // producción; y sus consolas nacen en Manual.
    const sinConf = await ejecutar(e.gestor, 'update t set a = 1', 'kp', 'pr')
    check("producción marcada: una escritura sin confirmar es 'produccion', no 'soloLectura'", !sinConf.ok && sinConf.error.motivo === 'produccion', JSON.stringify(sinConf))
    check('… y su consola nace en Manual', e.gestor.estadoConsola('perfil1', 'kp')?.txModo === 'manual', JSON.stringify(e.gestor.estadoConsola('perfil1', 'kp')?.txModo))
    const conConf = await e.gestor.ejecutarConsola({ perfilId: 'perfil1', consolaId: 'kp', conexionId: 'pr', ejecucionId: `e${++ejecucion}`, sql: 'update t set a = 1', maxFilas: 500, confirmado: true })
    check('… y confirmada, sale', conConf.ok, JSON.stringify(conConf.ok ? 'ok' : conConf.error))
    await e.gestor.cerrarTodo(100)
  }

  // El humo remoto (`test-db-oracle-lectura.mts`) corre contra una base REAL: su primer candado
  // es la solo lectura IMPUESTA en todas las conexiones, que ya NO depende de la casilla. Aquí,
  // con una conexión de ESCRITURA en el registro y el centinela del humo (`vetarPeticion`)
  // mirando cada mensaje: todo lo que sale pasa, y lo que escribe ni sale. Y la mitad negativa:
  // el gestor del producto, con la misma conexión, SÍ haría vetar al centinela (el humo sin su
  // imposición falla, no escribe).
  hr('(35) La solo lectura del humo remoto no depende de la casilla: el centinela no veta nada')
  {
    const e = entorno([conexion('o1', { motor: 'oracle', readonly: false })], { soloLecturaImpuesta: soloLecturaEnTodas })
    const up = await ejecutar(e.gestor, 'update t set a = 1', 'k1', 'o1')
    check("un UPDATE se rechaza en el main ('soloLectura') sin lanzar nada", !up.ok && up.error.motivo === 'soloLectura' && e.falsos.length === 0, JSON.stringify(up))
    const sel = await ejecutar(e.gestor, 'select 1 from dual', 'k1', 'o1')
    await e.gestor.catalogo('o1', (ctx) => ctx.consultar({ sql: 'SELECT 1 FROM dual', binds: [] }))
    const man = await e.gestor.modoTx(refConsola('k1', 'o1'), 'manual')
    const env = await e.gestor.enviarCambios({ conexionId: 'o1', peticionId: 'env-h', sentencias: [{ tipo: 'actualizar', sql: 'UPDATE t SET a = :1', binds: ['x'] }] })
    const mensajes = e.falsos.flatMap((f) => f.mensajes)
    const vetos = mensajes.map((m) => vetarPeticion(m)).filter((v): v is string => v !== null)
    check(
      'el SELECT sale, Manual y «Enviar» se rechazan, y el centinela no veta NINGÚN mensaje',
      sel.ok && !man.ok && man.error.motivo === 'soloLectura' && !env.ok && env.error.motivo === 'soloLectura' && vetos.length === 0 && mensajes.some((m) => m.op === 'abrir'),
      JSON.stringify({ sel: sel.ok, man: man.ok, env: env.ok, vetos, ops: mensajes.map((m) => m.op) })
    )
    const abrir = e.falsos[0]?.ops('abrir')[0] as PeticionSinIdDe<'abrir'> | undefined
    const deUsuario = e.falsos[0]?.ejecutados().filter((m) => m.opciones.proposito === 'usuario') ?? []
    check(
      'la sesión se abre en solo lectura y cada sentencia de usuario lleva el candado',
      abrir?.conexion.readonly === true && deUsuario.length > 0 && deUsuario.every((m) => m.opciones.candadoRO === true),
      JSON.stringify({ readonly: abrir?.conexion.readonly, candados: deUsuario.map((m) => m.opciones.candadoRO) })
    )
    await e.gestor.cerrarTodo(100)

    const p = entorno([conexion('o1', { motor: 'oracle', readonly: true })], { soloLecturaImpuesta: null })
    await ejecutar(p.gestor, 'select 1 from dual', 'k1', 'o1')
    const vetosProducto = p.falsos.flatMap((f) => f.mensajes).map((m) => vetarPeticion(m)).filter((v): v is string => v !== null)
    check(
      'NEGATIVO: sin la imposición (el gestor del producto), aun con la casilla marcada, el centinela VETA (el humo fallaría, no escribiría)',
      vetosProducto.length > 0,
      JSON.stringify(vetosProducto)
    )
    await p.gestor.cerrarTodo(100)
  }

  hr('(36) el filtro guiado viaja a «más», Contar y exportar; su error vuelve con la condición')
  {
    const e = entorno([conexion('c1'), conexion('o1', { motor: 'oracle' })])
    e.responder.actual = (p, f) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') {
        if (p.sql.startsWith('SELECT COUNT(*)')) return rFilas(1, { filasJson: '[["42"]]' })
        if (p.sql.includes('"NOEXISTE"')) {
          const cp = [...p.sql.slice(0, p.sql.indexOf('"NOEXISTE"'))].length
          throw fallo('servidor', { codigo: '42703', mensaje: 'column "NOEXISTE" does not exist', offsetCp: cp })
        }
        return rFilas(2, { hayMas: true, lector: f.conexion.motor === 'oracle' ? (p.opciones.lector ?? null) : null })
      }
      return respuestaPorDefecto(p, f)
    }
    const filtro: DbFiltroGuiado = {
      union: 'todas',
      condiciones: [
        { columna: 'nombre', categoria: 'texto', operador: 'igual', valor: 'Ana' },
        { columna: 'alta', categoria: 'fecha', operador: 'igual', valor: '2026-09-28' }
      ]
    }
    const orden: DbOrdenColumna[] = [{ columna: 'alta', dir: 'desc' }]
    const base: PeticionTabla = { conexionId: 'c1', peticionId: 'g1', objeto: { esquema: 'public', nombre: 't' }, pk: ['id'], maxFilas: 2, filtro, orden }
    const t = await e.gestor.leerTabla(base)
    const lector = t.ok && t.valor.tipo === 'filas' ? t.valor.lector : null
    const f = e.falsos[0]
    const e1 = f.ejecutados()[0]
    check(
      'PG: la primera página con el filtro compilado, el orden de la cabecera y `LIMIT $4 OFFSET $5`',
      e1 !== undefined && e1.sql.includes('"nombre" = $1') && e1.sql.includes('ORDER BY "alta" DESC\nLIMIT $4 OFFSET $5') && JSON.stringify(e1.binds) === '["Ana","2026-09-28","2026-09-29",3,0]',
      JSON.stringify(e1 && { sql: e1.sql, binds: e1.binds })
    )
    check('con orden de la cabecera, sin la píldora de orden no estable', t.ok && t.valor.tipo === 'filas' && t.valor.avisos === undefined, JSON.stringify(t.ok && t.valor.tipo === 'filas' ? t.valor.avisos : t))
    await e.gestor.leerMas(lector as string, 2)
    const e2 = f.ejecutados()[1]
    check('«más» repite el MISMO filtro y orden, con el OFFSET siguiente', e2 !== undefined && e2.sql === e1?.sql && JSON.stringify(e2.binds) === '["Ana","2026-09-28","2026-09-29",3,2]', JSON.stringify(e2?.binds))
    const cnt = await e.gestor.contar(lector as string, 'cuenta-g')
    const e3 = f.ejecutados()[2]
    check(
      'Contar: el filtro con sus binds y sin ORDER BY',
      cnt.ok && cnt.valor === 42 && e3 !== undefined && e3.sql.startsWith('SELECT COUNT(*) FROM "public"."t"\nWHERE (\n"nombre" = $1') && !e3.sql.includes('ORDER BY') && JSON.stringify(e3.binds) === '["Ana","2026-09-28","2026-09-29"]',
      JSON.stringify(e3 && { sql: e3.sql, binds: e3.binds, cnt })
    )

    // Exportar (PG, sin límite): los del filtro DELANTE de `[null, 0]`.
    const expSql: string[] = []
    e.responder.actual = (p, fx) => {
      if (p.op === 'ejecutar' && p.opciones.mantenerCursor === true) {
        expSql.push(JSON.stringify(p.binds))
        return rFilas(1, { lector: p.opciones.lector ?? null })
      }
      return respuestaPorDefecto(p, fx)
    }
    await e.gestor.exportarTabla({ ...base, peticionId: 'exp-g' }, async () => {}, () => false)
    check('exportar PG: `[…filtro, null, 0]` (antes `[null, 0]` a secas)', expSql[0] === '["Ana","2026-09-28","2026-09-29",null,0]', JSON.stringify(expSql))

    // Oracle: cursor con binds por nombre; el respaldo ROWNUM, con `:hasta`/`:desde` junto a ellos.
    e.responder.actual = (p, fx) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario') return rFilas(2, { hayMas: true, lector: p.opciones.lector ?? null })
      if (p.op === 'leer') throw fallo('protocolo', { codigo: CODIGO_LECTOR_DESCONOCIDO, mensaje: 'expulsado' }, 'leer')
      return respuestaPorDefecto(p, fx)
    }
    const tO = await e.gestor.leerTabla({ ...base, conexionId: 'o1', peticionId: 'g2', objeto: { esquema: 'HR', nombre: 'T' }, pk: ['ID'] })
    const fo = e.falsos.find((x) => x.conexion.id === 'o1') as TrabajadorFalso
    const o1 = fo.ejecutados()[0]
    check(
      'Oracle cursor: binds POR NOMBRE `{ f1, f2, f3 }`',
      o1 !== undefined && JSON.stringify(o1.binds) === '{"f1":{"entrada":"char","valor":"Ana"},"f2":"2026-09-28 00:00:00","f3":"2026-09-29 00:00:00"}' && o1.sql.includes('"nombre" = :f1'),
      JSON.stringify(o1 && { sql: o1.sql, binds: o1.binds })
    )
    const lO = tO.ok && tO.valor.tipo === 'filas' ? tO.valor.lector : null
    const mO = await e.gestor.leerMas(lO as string, 2)
    const o2 = fo.ejecutados()[1]
    check(
      'Oracle «más» tras expulsar el cursor: ROWNUM con el filtro y `{ …, hasta, desde }`',
      mO.ok && o2 !== undefined && o2.sql.includes('ROWNUM') && o2.sql.includes('"nombre" = :f1') && JSON.stringify(o2.binds) === '{"f1":{"entrada":"char","valor":"Ana"},"f2":"2026-09-28 00:00:00","f3":"2026-09-29 00:00:00","hasta":5,"desde":2}',
      JSON.stringify(o2 && { binds: o2.binds, mO })
    )

    // Un error del servidor dentro de una condición -> `campo: 'filtro'` + `condicion`.
    e.responder.actual = (p, fx) => {
      if (p.op === 'ejecutar' && p.opciones.proposito === 'usuario' && p.sql.includes('"NOEXISTE"')) {
        const cp = [...p.sql.slice(0, p.sql.indexOf('"NOEXISTE"'))].length
        throw fallo('servidor', { codigo: '42703', mensaje: 'column "NOEXISTE" does not exist', offsetCp: cp })
      }
      return respuestaPorDefecto(p, fx)
    }
    const conMala: DbFiltroGuiado = { union: 'cualquiera', condiciones: [filtro.condiciones[0], { columna: 'NOEXISTE', categoria: 'texto', operador: 'vacio' }] }
    const rMal = await e.gestor.leerTabla({ ...base, peticionId: 'g3', filtro: conMala })
    const em = rMal.ok && rMal.valor.tipo === 'error' ? rMal.valor.error : null
    check('columna inexistente en la 2.ª condición -> `campo: "filtro"`, `condicion: 1`, sin posición', em?.campo === 'filtro' && em.condicion === 1 && em.posicion === undefined, JSON.stringify(em))
    const antes = f.ejecutados().length
    const rInv = await e.gestor.leerTabla({ ...base, peticionId: 'g4', filtro: { union: 'todas', condiciones: [{ columna: 'n', categoria: 'numero', operador: 'igual', valor: 'doce' }] } })
    const ei = rInv.ok && rInv.valor.tipo === 'error' ? rInv.valor.error : null
    check('un valor inválido: error de la condición 0 SIN ir al servidor', ei?.campo === 'filtro' && ei.condicion === 0 && f.ejecutados().length === antes, JSON.stringify(ei))
    const rEx = await e.gestor.leerTabla({ ...base, peticionId: 'g5', where: 'a = 1' })
    check('filtro + WHERE libre: rechazado sin campo', !rEx.ok && rEx.error.motivo === 'interno', JSON.stringify(rEx))
    await e.gestor.cerrarTodo(100)
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
