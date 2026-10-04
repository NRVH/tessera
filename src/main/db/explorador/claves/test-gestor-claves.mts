#!/usr/bin/env node
// =============================================================================
// Prueba del `GestorClaves` (Redis) con un trabajador falso, sin servidor ni proceso: que hereda bien el núcleo común
// (`gestorFamilia.ts`, que `test-gestor-documentos.mts` fija a fondo) y lo suyo. El trabajador real lo ejercita `test-db-redis.mts`.
// (node src/main/db/explorador/claves/test-gestor-claves.mts  ·  npm run test:gestor-claves)
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbEstadoSesion } from '../../../../shared/db-explorador-ipc.ts'
import {
  CODIGO_DOCS_PRODUCCION,
  CODIGO_DOCS_SINTAXIS,
  CODIGO_DOCS_SOLO_LECTURA,
  CODIGO_NO_ADMITIDO,
  CODIGO_PELIGROSO,
  FalloTrabajador,
  type ErrorTrabajador,
  type EventoTrabajador,
  type OpTrabajador,
  type PeticionSinId,
  type PeticionSinIdDe,
  type PoliticaClaves,
  type RespuestasPorOp
} from '../protocoloTrabajador.ts'
import type { TrabajadorGestor } from '../GestorSesiones.ts'
import { MAX_PROCESOS } from '../limites.ts'
import { aConexionTrabajadorClaves, errorClaves, GestorClaves } from './GestorClaves.ts'
import { politicaClavesDe } from './ControladorClaves.ts'

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)
const tic = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// --- El trabajador falso ------------------------------------------------------------------

type Claves = Extract<PeticionSinId, { op: 'claves' }>
type Manejador = (p: PeticionSinId, t: TrabajadorFalso) => unknown

const bytes = (texto: string) => ({ texto, base64: Buffer.from(texto, 'utf8').toString('base64') })

function respuestaPorDefecto(p: PeticionSinId): unknown {
  switch (p.op) {
    case 'abrir':
      return { modo: 'nativo', driverId: null, version: '8.2.1', esquema: null, usuario: null }
    case 'cancelar':
      return { cancelada: true }
    case 'cerrar':
      return { cerrada: true }
    case 'claves': {
      const c = p as Claves
      switch (c.operacion) {
        case 'bases':
          return { total: 16, totalDelServidor: true, conClaves: [{ indice: 0, claves: 3, caducan: 0 }] }
        case 'escanear':
          return { cursor: '0', claves: [{ nombre: bytes('usuario:1'), tipo: 'hash', ttlMs: null }], ms: 1 }
        case 'valor':
          return { contenido: { tipo: 'string', valor: bytes('hola'), bytes: 4, truncado: false }, ttlMs: null, ms: 1 }
        case 'consola':
          return { respuesta: { tipo: 'simple', texto: 'OK' }, base: c.base, ms: 1 }
      }
    }
  }
  return {}
}

class TrabajadorFalso implements TrabajadorGestor {
  vivo = true
  pendientes = 0
  readonly peticiones: PeticionSinId[] = []
  private readonly enVuelo = new Map<string, number>()
  maxEnVueloPorSesion = 0
  salio = false
  matadoCon: ErrorTrabajador | undefined | null = null
  private readonly evs: Array<(e: EventoTrabajador) => void> = []
  private readonly salidas: Array<(s: { codigo: number | null; senal: string | null }) => void> = []
  manejar: Manejador

  constructor(manejar: Manejador = respuestaPorDefecto) {
    this.manejar = manejar
  }

  async arrancar(): Promise<unknown> {
    return { v: 1 }
  }

  async enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>, _plazoMs?: number | null): Promise<RespuestasPorOp[O]> {
    const p = peticion as PeticionSinId
    this.peticiones.push(p)
    const ses = 'sesion' in p && p.op !== 'cancelar' ? p.sesion : null
    if (ses) {
      const n = (this.enVuelo.get(ses) ?? 0) + 1
      this.enVuelo.set(ses, n)
      this.maxEnVueloPorSesion = Math.max(this.maxEnVueloPorSesion, n)
    }
    this.pendientes++
    try {
      return (await this.manejar(p, this)) as RespuestasPorOp[O]
    } finally {
      this.pendientes--
      if (ses) this.enVuelo.set(ses, (this.enVuelo.get(ses) ?? 1) - 1)
    }
  }

  onEvento(cb: (e: EventoTrabajador) => void): () => void {
    this.evs.push(cb)
    return () => undefined
  }

  onSalida(cb: (s: { codigo: number | null; senal: string | null }) => void): () => void {
    this.salidas.push(cb)
    return () => undefined
  }

  async salir(): Promise<void> {
    this.salio = true
    this.terminar()
  }

  matar(motivo?: ErrorTrabajador): void {
    this.matadoCon = motivo ?? undefined
    this.terminar()
  }

  private terminar(): void {
    if (!this.vivo) return
    this.vivo = false
    for (const cb of this.salidas) cb({ codigo: 0, senal: null })
  }

  claves(): Claves[] {
    return this.peticiones.filter((p): p is Claves => p.op === 'claves')
  }
}

function barrera(): { promesa: Promise<void>; abrir: () => void } {
  let abrir: () => void = () => undefined
  const promesa = new Promise<void>((r) => {
    abrir = r
  })
  return { promesa, abrir }
}

// --- El banco -----------------------------------------------------------------------------

const conDe = (id: string, extra: Partial<DbConnection> = {}): DbConnection => ({
  id,
  profileId: 'p1',
  alias: `Redis ${id}`,
  motor: 'redis',
  host: '127.0.0.1',
  port: 6479,
  user: 'tessera',
  tieneSecreto: true,
  readonly: false,
  ...extra
})

function banco(o: { manejar?: Manejador; conexiones?: DbConnection[]; secretos?: Record<string, string | null>; ahora?: () => number } = {}) {
  const conexiones = new Map<string, DbConnection>((o.conexiones ?? [conDe('c1')]).map((c) => [c.id, c]))
  const trabajadores: TrabajadorFalso[] = []
  const emitidas: DbEstadoSesion[] = []
  const logs: string[] = []
  const g = new GestorClaves({
    lanzar: () => {
      const t = new TrabajadorFalso(o.manejar)
      trabajadores.push(t)
      return t
    },
    conexion: (id) => conexiones.get(id),
    secreto: (id) => (o.secretos && id in o.secretos ? (o.secretos[id] ?? null) : 'clave'),
    ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
    emitirSesion: (e) => emitidas.push(e),
    ahora: o.ahora,
    log: (l) => logs.push(l)
  })
  return { g, conexiones, trabajadores, emitidas, logs }
}

const POL: PoliticaClaves = { soloLectura: false, produccion: false, confirmado: false, confirmadoPeligroso: false }
const consolaDe = (texto: string, extra: Partial<{ consolaId: string; peticionId: string; base: number; desplazamiento: number }> = {}) => ({
  perfilId: 'p1',
  consolaId: extra.consolaId ?? 'k1',
  conexionId: 'c1',
  base: extra.base ?? 0,
  texto,
  desplazamiento: extra.desplazamiento ?? 0,
  ...(extra.peticionId ? { peticionId: extra.peticionId } : {})
})

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------------------
  hr('(1) La conexión que viaja al trabajador')
  {
    const t1 = aConexionTrabajadorClaves(conDe('c1', { database: '1' }))
    check(
      'sin tls guardado: el efectivo de Redis (sin cifrar); con la base por defecto; sin secreto',
      j(t1.tls) === j({ cifrar: false, confiarCertificado: false }) && t1.database === '1' && t1.motor === 'redis' && !('secreto' in t1),
      j(t1)
    )
    const t2 = aConexionTrabajadorClaves(conDe('c2', { tls: { cifrar: true, confiarCertificado: true } }))
    check('el tls guardado manda (rediss://); sin base, no viaja', j(t2.tls) === j({ cifrar: true, confiarCertificado: true }) && !('database' in t2), j(t2))
    const t3 = aConexionTrabajadorClaves(conDe('c3', { srv: true, opcionesUri: 'x=1' }))
    check('un srv o unas opciones de MongoDB que se colaran: ni cifran ni viajan', j(t3.tls) === j({ cifrar: false, confiarCertificado: false }) && !('srv' in t3) && !('opcionesUri' in t3), j(t3))
  }

  // ---------------------------------------------------------------------------------------
  hr('(2) Secreto opcional')
  {
    const b = banco({ conexiones: [conDe('sin', { tieneSecreto: false, user: '' }), conDe('rota')], secretos: { rota: null } })
    const r1 = await b.g.bases({ conexionId: 'sin' })
    const abrir1 = b.trabajadores[0]?.peticiones.find((p) => p.op === 'abrir') as Extract<PeticionSinId, { op: 'abrir' }> | undefined
    check('sin contraseña guardada: se abre con secreto \'\'', r1.ok && abrir1?.secreto === '' && abrir1.conexion.motor === 'redis', j({ r1, abrir1 }))
    const r2 = await b.g.bases({ conexionId: 'rota' })
    check('guardada e ilegible: sinSecreto, y NO se lanza ningún proceso', !r2.ok && r2.error.motivo === 'sinSecreto' && b.trabajadores.length === 1, j({ r2, procesos: b.trabajadores.length }))
  }

  // ---------------------------------------------------------------------------------------
  hr('(3) Sesiones y la op `claves`')
  {
    const b = banco()
    const rb = await b.g.bases({ conexionId: 'c1' })
    const re = await b.g.escanear({ conexionId: 'c1', base: 1, patron: 'usuario:*', cursor: '0', cuenta: 500, tipo: 'hash' })
    const clave = bytes('a b')
    const rv = await b.g.valor({ conexionId: 'c1', base: 1, clave, desde: '0', cuantos: 50 })
    const rk = await b.g.ejecutarConsola(consolaDe('SELECT 3', { base: 2 }), POL)
    const t = b.trabajadores[0]
    const [pb, pe, pv, pk] = t.claves()
    check('las cuatro responden ok con lo del trabajador', rb.ok && re.ok && rv.ok && rk.ok && rb.valor.total === 16 && re.valor.cursor === '0', j({ rb, re, rv, rk }))
    check(
      'bases y escanear van a META; escanear lleva base, patrón, cursor, cuenta y tipo',
      pb?.sesion === 'meta' && pb.operacion === 'bases' && pe?.sesion === 'meta' && j(pe) === j({ op: 'claves', sesion: 'meta', operacion: 'escanear', base: 1, patron: 'usuario:*', cursor: '0', cuenta: 500, tipo: 'hash' }),
      j({ pb, pe })
    )
    check(
      'valor va a DATOS con la clave en BASE64 (solo los bytes), desde y cuantos',
      j(pv) === j({ op: 'claves', sesion: 'datos', operacion: 'valor', base: 1, clave: clave.base64, desde: '0', cuantos: 50 }),
      j(pv)
    )
    check('la consola va a SU sesión (consola:k1) con su base y el texto', pk?.sesion === 'consola:k1' && pk.operacion === 'consola' && (pk as Extract<Claves, { operacion: 'consola' }>).base === 2 && (pk as Extract<Claves, { operacion: 'consola' }>).texto === 'SELECT 3', j(pk))
    check('un solo proceso para la conexión', b.trabajadores.length === 1, String(b.trabajadores.length))
    check('ninguna petición lleva la op docs', !t.peticiones.some((p) => p.op === 'docs'), '')
    check('el registro dice «claves», nunca la clave ni el comando', b.logs.some((l) => l.includes('proceso de claves')) && !b.logs.some((l) => l.includes('SELECT') || l.includes('usuario:')), j(b.logs))
  }

  // ---------------------------------------------------------------------------------------
  hr('(4) Cancelar')
  {
    const blpop = barrera()
    const escaneo = barrera()
    const b = banco({
      manejar: async (p) => {
        if (p.op === 'claves' && (p as Claves).operacion === 'consola') await blpop.promesa
        if (p.op === 'claves' && (p as Claves).operacion === 'escanear') await escaneo.promesa
        return respuestaPorDefecto(p)
      }
    })
    const e1 = b.g.escanear({ conexionId: 'c1', base: 0, patron: '', cursor: '0', cuenta: 100, peticionId: 's1' })
    for (let i = 0; i < 6; i++) await tic()
    const e2 = b.g.escanear({ conexionId: 'c1', base: 0, patron: '', cursor: '0', cuenta: 100, peticionId: 's2' })
    await tic()
    const t = b.trabajadores[0]
    const quitada = b.g.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 's2' })
    const r2 = await e2
    const escaneos = () => t.claves().filter((c) => c.operacion === 'escanear').length
    check('la que ESPERA sale de la cola: cancelada, sin llegar al trabajador', quitada && !r2.ok && r2.error.motivo === 'cancelada' && escaneos() === 1, j({ r2, n: escaneos() }))
    const k = b.g.ejecutarConsola(consolaDe('BLPOP cola 0', { peticionId: 'e1' }), POL)
    for (let i = 0; i < 6; i++) await tic()
    const otra = b.g.cancelar({ rol: 'consola', perfilId: 'p1', consolaId: 'k2', ejecucionId: 'e1' })
    const esta = b.g.cancelar({ rol: 'consola', perfilId: 'p1', consolaId: 'k1', ejecucionId: 'e1' })
    await tic()
    const canc = t.peticiones.filter((p) => p.op === 'cancelar') as Array<{ sesion: string }>
    check('un BLPOP de consola que CORRE: op cancelar a consola:k1 (por perfil+consola+ejecucionId); otra consola no', !otra && esta && canc.length === 1 && canc[0].sesion === 'consola:k1', j(canc))
    const enCurso = b.g.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 's1' })
    await tic()
    const canc2 = t.peticiones.filter((p) => p.op === 'cancelar') as Array<{ sesion: string }>
    check('el escaneo que CORRE: op cancelar a meta', enCurso && canc2[canc2.length - 1].sesion === 'meta', j(canc2))
    blpop.abrir()
    escaneo.abrir()
    // Lo que corre lo termina el TRABAJADOR (el real responde 'cancelada'; este falso, ok).
    await Promise.all([k, e1])
  }

  // ---------------------------------------------------------------------------------------
  hr('(5) Mapeo de errores (errorClaves)')
  {
    const casos: Array<[string, ErrorTrabajador, Parameters<typeof errorClaves>[1], Record<string, unknown>]> = [
      ['producción', { clase: 'soloLectura', codigo: CODIGO_DOCS_PRODUCCION, mensaje: 'prod' }, {}, { motivo: 'produccion', codigo: CODIGO_DOCS_PRODUCCION }],
      ['solo lectura', { clase: 'soloLectura', codigo: CODIGO_DOCS_SOLO_LECTURA, mensaje: 'ro' }, {}, { motivo: 'soloLectura' }],
      ['peligroso', { clase: 'soloLectura', codigo: CODIGO_PELIGROSO, mensaje: 'FLUSHALL borra todas las bases' }, {}, { motivo: 'peligroso', codigo: CODIGO_PELIGROSO, mensaje: 'FLUSHALL borra todas las bases' }],
      ['no admitido (con su mensaje)', { clase: 'protocolo', codigo: CODIGO_NO_ADMITIDO, mensaje: 'SUBSCRIBE no se puede usar en la consola' }, {}, { motivo: 'servidor', mensaje: 'SUBSCRIBE no se puede usar en la consola' }],
      // «😀» son DOS unidades UTF-16 y UN punto de código: el offset 3 (cp) cae en la 4 (UTF-16).
      ['sintaxis (comillas sin cerrar) con desplazamiento y un astral', { clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'x', offsetCp: 3 }, { texto: 'a😀b"c', desplazamiento: 10 }, { motivo: 'servidor', posicion: 14 }],
      ['error del servidor (WRONGTYPE)', { clase: 'servidor', mensaje: 'WRONGTYPE Operation against a key holding the wrong kind of value' }, {}, { motivo: 'servidor' }],
      ['cancelada', { clase: 'cancelada', mensaje: 'c' }, {}, { motivo: 'cancelada' }],
      ['pérdida', { clase: 'perdida', mensaje: 'red' }, {}, { motivo: 'sesionPerdida' }],
      ['offset sin texto sobre el que contar: sin posición', { clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'x', offsetCp: 3 }, {}, { motivo: 'servidor', posicion: undefined }]
    ]
    for (const [nombre, et, ctx, esperado] of casos) {
      const e = errorClaves(et, ctx) as unknown as Record<string, unknown>
      const bien = Object.entries(esperado).every(([k, v]) => e[k] === v)
      check(`${nombre} → ${j(esperado)}`, bien, j(e))
    }
    const b = banco({
      manejar: (p) => {
        if (p.op === 'claves' && (p as Claves).operacion === 'consola') throw new FalloTrabajador({ clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'comillas sin cerrar', offsetCp: 4 }, 'claves')
        return respuestaPorDefecto(p)
      }
    })
    const r = await b.g.ejecutarConsola(consolaDe('GET "a', { desplazamiento: 20 }), POL)
    check('por el gestor: la sintaxis de la consola vuelve con posición + desplazamiento', !r.ok && r.error.motivo === 'servidor' && r.error.posicion === 24, j(r))
  }

  // ---------------------------------------------------------------------------------------
  hr('(6) Política')
  {
    const b = banco()
    const pol: PoliticaClaves = { soloLectura: true, produccion: true, confirmado: true, confirmadoPeligroso: true }
    await b.g.ejecutarConsola(consolaDe('FLUSHDB'), pol)
    const k = b.trabajadores[0].claves().find((c) => c.operacion === 'consola') as Extract<Claves, { operacion: 'consola' }> | undefined
    check('la política viaja TAL CUAL al trabajador', j(k?.politica) === j(pol), j(k))
    check(
      'politicaClavesDe: la solo lectura IMPUESTA → soloLectura; producción del entorno; las dos confirmaciones solo con true',
      j(politicaClavesDe({ entorno: 'produccion' }, false, true, true)) === j({ soloLectura: false, produccion: true, confirmado: true, confirmadoPeligroso: true }) &&
        j(politicaClavesDe({ entorno: 'pruebas' }, true, 'si', 1)) === j({ soloLectura: true, produccion: false, confirmado: false, confirmadoPeligroso: false }),
      ''
    )
    // la casilla `readonly` es de los AGENTES y no entra en la política; lo
    // peligroso se sigue confirmando (D5) con o sin ella.
    check(
      'la casilla de los agentes NO entra en la política; lo peligroso sigue sin confirmar hasta que se confirma',
      j(politicaClavesDe({ readonly: true, entorno: 'pruebas' } as DbConnection, false, false, false)) ===
        j({ soloLectura: false, produccion: false, confirmado: false, confirmadoPeligroso: false }),
      ''
    )
  }

  // ---------------------------------------------------------------------------------------
  hr('(7) Pérdida y reapertura')
  {
    let fallar = 0
    const b = banco({
      manejar: (p) => {
        if (p.op === 'claves' && fallar > 0) {
          fallar--
          throw new FalloTrabajador({ clase: 'perdida', mensaje: 'connection reset' }, 'claves')
        }
        return respuestaPorDefecto(p)
      }
    })
    fallar = 1
    const re = await b.g.escanear({ conexionId: 'c1', base: 0, patron: '', cursor: '0', cuenta: 10 })
    fallar = 1
    const rv = await b.g.valor({ conexionId: 'c1', base: 0, clave: bytes('k') })
    const t = b.trabajadores[0]
    const abrirMeta = t.peticiones.filter((p) => p.op === 'abrir' && p.sesion === 'meta').length
    const abrirDatos = t.peticiones.filter((p) => p.op === 'abrir' && p.sesion === 'datos').length
    check('el árbol y el visor que pierden la sesión se REINTENTAN una vez en una sesión nueva', re.ok && rv.ok && abrirMeta === 2 && abrirDatos === 2, j({ re, rv, abrirMeta, abrirDatos }))
    fallar = 1
    const k = await b.g.ejecutarConsola(consolaDe('INCR contador'), POL)
    const consolas = t.claves().filter((c) => c.operacion === 'consola').length
    check('la consola NO se reintenta (repetiría el comando): sesionPerdida', !k.ok && k.error.motivo === 'sesionPerdida' && consolas === 1, j({ k, consolas }))
  }

  // ---------------------------------------------------------------------------------------
  hr('(8) Desconectar, forzar, sesiones, tope de procesos, cerrarTodo y otra familia')
  {
    // Con la casilla de los AGENTES marcada: el explorador no la mira.
    const b = banco({ conexiones: [conDe('c1', { readonly: true })] })
    await b.g.bases({ conexionId: 'c1' })
    await b.g.valor({ conexionId: 'c1', base: 0, clave: bytes('k') })
    const ses = b.g.sesiones()
    const meta = ses.find((s) => s.ref.rol === 'meta')
    check(
      'sesiones(): meta y datos, txModo auto, tx ninguna, SIN solo lectura (la casilla es de los agentes) y la versión del servidor',
      ses.length === 2 && meta?.txModo === 'auto' && meta.tx === 'ninguna' && meta.soloLectura === false && meta.driver?.version === '8.2.1' && meta.fase === 'lista',
      j(ses)
    )
    const abrir0 = b.trabajadores[0].peticiones.find((p) => p.op === 'abrir') as { conexion?: { readonly?: boolean } } | undefined
    check('la conexión del trabajador viaja SIN solo lectura aunque la casilla esté marcada', abrir0?.conexion?.readonly === false, j(abrir0?.conexion))
    const t = b.trabajadores[0]
    await b.g.desconectar('c1')
    check('desconectar: el proceso sale y no quedan sesiones', t.salio && b.g.sesiones().length === 0, j(b.g.sesiones()))
    await b.g.bases({ conexionId: 'c1' })
    const t2 = b.trabajadores[1]
    b.g.forzar('c1')
    check('forzar: MATA el proceso (con motivo cancelada) y suelta las sesiones', t2 !== undefined && t2.matadoCon?.clase === 'cancelada' && b.g.sesiones().length === 0, j(t2?.matadoCon))
    await b.g.ejecutarConsola(consolaDe('PING', { consolaId: 'k9' }), POL)
    await b.g.cerrarConsola('p1', 'k9')
    const t3 = b.trabajadores[2]
    check('cerrarConsola: cierra la sesión de esa consola en el trabajador', t3?.peticiones.some((p) => p.op === 'cerrar' && p.sesion === 'consola:k9') === true, j(t3?.peticiones.map((p) => p.op)))

    let reloj = 1000
    const muchas = Array.from({ length: MAX_PROCESOS + 1 }, (_, i) => conDe(`m${i}`))
    const b2 = banco({ conexiones: muchas, ahora: () => reloj })
    for (const c of muchas.slice(0, MAX_PROCESOS)) {
      reloj += 10
      await b2.g.bases({ conexionId: c.id })
    }
    reloj += 10
    const ultima = await b2.g.bases({ conexionId: `m${MAX_PROCESOS}` })
    check(`tope de ${MAX_PROCESOS} procesos (de claves): la siguiente expulsa la más antigua ociosa`, ultima.ok && b2.trabajadores[0].salio && !b2.trabajadores[1].salio, j({ ultima }))

    const b4 = banco()
    await b4.g.bases({ conexionId: 'c1' })
    await b4.g.cerrarTodo(100)
    const tras = await b4.g.bases({ conexionId: 'c1' })
    check('cerrarTodo: los procesos salen y nada nuevo arranca', b4.trabajadores[0].salio && !tras.ok && tras.error.mensaje === 'Tessera se está cerrando.' && b4.trabajadores.length === 1, j(tras))
    b4.g.reanudarTrasCierreAbortado()
    const otraVez = await b4.g.bases({ conexionId: 'c1' })
    check('reanudarTrasCierreAbortado: vuelve a arrancar', otraVez.ok && b4.trabajadores.length === 2, j(otraVez))

    const b5 = banco({ conexiones: [{ ...conDe('mongo'), motor: 'mongodb' }, { ...conDe('ora'), motor: 'oracle' }] })
    const rm = await b5.g.bases({ conexionId: 'mongo' })
    const ro = await b5.g.bases({ conexionId: 'ora' })
    check(
      'una conexión de otra familia (MongoDB, SQL) no lanza el proceso de claves',
      !rm.ok && rm.error.motivo === 'interno' && rm.error.mensaje === 'MongoDB no es un motor de claves.' && !ro.ok && b5.trabajadores.length === 0,
      j({ rm, ro })
    )
  }

  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error('FALLO INESPERADO', e)
  process.exit(1)
})
