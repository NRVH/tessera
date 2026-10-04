#!/usr/bin/env node
// =============================================================================
// Prueba del `GestorDocumentos` (MongoDB) con un trabajador falso, sin servidor ni proceso: la conexión que viaja, el secreto
// opcional, la cola por sesión, los lectores del main y los errores. El trabajador real lo ejercita `test-db-mongo.mts`.
// (node src/main/db/explorador/documentos/test-gestor-documentos.mts  ·  npm run test:gestor-documentos)
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { DbEstadoSesion } from '../../../../shared/db-explorador-ipc.ts'
import type { DbDocPagina } from '../../../../shared/db-documentos-ipc.ts'
import {
  CODIGO_DOCS_PRODUCCION,
  CODIGO_DOCS_SIN_TRANSACCION,
  CODIGO_DOCS_SINTAXIS,
  CODIGO_DOCS_SOLO_LECTURA,
  CODIGO_LECTOR_DESCONOCIDO,
  FalloTrabajador,
  type ErrorTrabajador,
  type EventoTrabajador,
  type OpTrabajador,
  type PeticionSinId,
  type PeticionSinIdDe,
  type RespuestasPorOp
} from '../protocoloTrabajador.ts'
import type { TrabajadorGestor } from '../GestorSesiones.ts'
import { MENSAJE_SIN_LECTOR } from '../GestorSesiones.ts'
import { MAX_LECTORES_POR_SESION, MAX_PROCESOS } from '../limites.ts'
import { aConexionTrabajadorDocs, errorDocs, GestorDocumentos } from './GestorDocumentos.ts'
import { ControladorDocumentos, politicaDe } from './ControladorDocumentos.ts'
import { compilarFiltroDocs } from './filtroDocumentos.ts'
import type { DbFiltroGuiado } from '../../../../shared/filtroGuiado.ts'

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

type Docs = Extract<PeticionSinId, { op: 'docs' }>
type Manejador = (p: PeticionSinId, t: TrabajadorFalso) => unknown

function respuestaPorDefecto(p: PeticionSinId): unknown {
  switch (p.op) {
    case 'abrir':
      return { modo: 'nativo', driverId: null, version: '7.0.9', esquema: null, usuario: null }
    case 'cancelar':
      return { cancelada: true }
    case 'cerrar':
      return { cerrada: true }
    case 'docs': {
      const d = p as Docs
      switch (d.operacion) {
        case 'bases':
          return [{ nombre: 'pruebas' }]
        case 'colecciones':
          return [{ nombre: 'clientes', tipo: 'coleccion', documentosEstimados: 4 }]
        case 'detalle':
          return { indices: [], campos: [{ nombre: '_id', tipos: ['objectId'], presencia: 4 }, { nombre: 'nombre', tipos: ['string'], presencia: 4 }], muestra: 4 }
        case 'consultar':
          return { lector: 'w-cur', documentos: [], columnas: d.columnas, ms: 1 } satisfies DbDocPagina
        case 'mas':
          return { lector: null, documentos: [], columnas: [], ms: 1 } satisfies DbDocPagina
        case 'cerrarLector':
          return { cerrado: true }
        case 'consola':
          return { tipo: 'valor', texto: '4', base: d.base }
        case 'enviar':
          return { transaccion: true, aplicados: d.cambios.length }
      }
    }
  }
  return {}
}

class TrabajadorFalso implements TrabajadorGestor {
  vivo = true
  pendientes = 0
  readonly peticiones: PeticionSinId[] = []
  /** Operaciones EN VUELO por sesión (sin contar cancelar): el máximo visto. */
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

  emitir(e: EventoTrabajador): void {
    for (const cb of this.evs) cb(e)
  }

  private terminar(): void {
    if (!this.vivo) return
    this.vivo = false
    for (const cb of this.salidas) cb({ codigo: 0, senal: null })
  }

  docs(): Docs[] {
    return this.peticiones.filter((p): p is Docs => p.op === 'docs')
  }
}

/** Una promesa que se resuelve desde fuera (para parar el trabajador a mitad). */
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
  alias: `Mongo ${id}`,
  motor: 'mongodb',
  host: '127.0.0.1',
  port: 27117,
  user: 'tessera',
  database: 'pruebas',
  tieneSecreto: true,
  readonly: false,
  ...extra
})

function banco(
  o: {
    manejar?: Manejador
    conexiones?: DbConnection[]
    secretos?: Record<string, string | null>
    ahora?: () => number
    soloLecturaImpuesta?: (c: DbConnection) => boolean
  } = {}
) {
  const conexiones = new Map<string, DbConnection>((o.conexiones ?? [conDe('c1')]).map((c) => [c.id, c]))
  const trabajadores: TrabajadorFalso[] = []
  const emitidas: DbEstadoSesion[] = []
  const logs: string[] = []
  const g = new GestorDocumentos({
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
    log: (l) => logs.push(l),
    soloLecturaImpuesta: o.soloLecturaImpuesta
  })
  return { g, conexiones, trabajadores, emitidas, logs }
}

const consultaDe = (conexionId = 'c1', peticionId?: string) => ({
  conexionId,
  base: 'pruebas',
  coleccion: 'clientes',
  filtro: '',
  proyeccion: '',
  orden: '',
  maxDocumentos: 50,
  ...(peticionId ? { peticionId } : {})
})

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------------------
  hr('(1) La conexión que viaja al trabajador')
  {
    const t1 = aConexionTrabajadorDocs(conDe('c1'))
    check(
      'sin tls guardado: el efectivo de MongoDB (sin cifrar); sin srv ni opcionesUri; con la base',
      j(t1.tls) === j({ cifrar: false, confiarCertificado: false }) && !('srv' in t1) && !('opcionesUri' in t1) && t1.database === 'pruebas' && !('secreto' in t1),
      j(t1)
    )
    const t2 = aConexionTrabajadorDocs(conDe('c2', { srv: true, opcionesUri: ' authSource=admin ', database: undefined }))
    check(
      'con srv y sin tls: cifrar (mongodb+srv); opciones recortadas; sin base',
      t2.srv === true && j(t2.tls) === j({ cifrar: true, confiarCertificado: false }) && t2.opcionesUri === 'authSource=admin' && !('database' in t2),
      j(t2)
    )
    const t3 = aConexionTrabajadorDocs(conDe('c3', { tls: { cifrar: true, confiarCertificado: true }, srv: false, opcionesUri: '' }))
    check('el tls guardado manda; srv false y opcionesUri vacía no viajan', j(t3.tls) === j({ cifrar: true, confiarCertificado: true }) && !('srv' in t3) && !('opcionesUri' in t3), j(t3))
  }

  // ---------------------------------------------------------------------------------------
  hr('(2) Secreto opcional')
  {
    const b = banco({ conexiones: [conDe('sin', { tieneSecreto: false, user: '' }), conDe('con'), conDe('rota')], secretos: { con: 'shh', rota: null } })
    const r1 = await b.g.bases({ conexionId: 'sin' })
    const abrir1 = b.trabajadores[0]?.peticiones.find((p) => p.op === 'abrir') as Extract<PeticionSinId, { op: 'abrir' }> | undefined
    check('sin contraseña guardada: se abre con secreto \'\' (conecta sin autenticar)', r1.ok && abrir1?.secreto === '', j({ r1, secreto: abrir1?.secreto }))
    const r2 = await b.g.bases({ conexionId: 'con' })
    const abrir2 = b.trabajadores[1]?.peticiones.find((p) => p.op === 'abrir') as Extract<PeticionSinId, { op: 'abrir' }> | undefined
    check('con contraseña guardada: la clave', r2.ok && abrir2?.secreto === 'shh', j({ r2 }))
    const r3 = await b.g.bases({ conexionId: 'rota' })
    check(
      'guardada e ilegible: sinSecreto, y NO se lanza ningún proceso',
      !r3.ok && r3.error.motivo === 'sinSecreto' && b.trabajadores.length === 2,
      j({ r3, procesos: b.trabajadores.length })
    )
    check('el secreto no aparece en el log', !b.logs.some((l) => l.includes('shh')), j(b.logs))
  }

  // ---------------------------------------------------------------------------------------
  hr('(3) Cola por sesión')
  {
    const alto = barrera()
    const b = banco({
      manejar: async (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'colecciones') await alto.promesa
        return respuestaPorDefecto(p)
      }
    })
    const a = b.g.colecciones({ conexionId: 'c1', base: 'uno' })
    const c = b.g.colecciones({ conexionId: 'c1', base: 'dos' })
    await tic()
    await tic()
    const t = b.trabajadores[0]
    const enVueloMeta = t.docs().filter((d) => d.operacion === 'colecciones').length
    // `datos` corre en paralelo con `meta` ocupada.
    const d = await b.g.enviar({ conexionId: 'c1', base: 'pruebas', coleccion: 'clientes', cambios: [{ tipo: 'borrar', idEjson: '1' }] }, { soloLectura: false, produccion: false, confirmado: false })
    alto.abrir()
    const [ra, rc] = await Promise.all([a, c])
    check(
      'en meta, la segunda espera a la primera (1 en vuelo); datos corre mientras tanto; al soltar, las dos terminan',
      enVueloMeta === 1 && d.ok && ra.ok && rc.ok && t.maxEnVueloPorSesion === 1,
      j({ enVueloMeta, max: t.maxEnVueloPorSesion, d })
    )
    check('un solo proceso para la conexión (meta y datos en el mismo)', b.trabajadores.length === 1, String(b.trabajadores.length))
  }

  // ---------------------------------------------------------------------------------------
  hr('(4) Cancelar')
  {
    const alto = barrera()
    const b = banco({
      manejar: async (p) => {
        if (p.op === 'docs' && ((p as Docs).operacion === 'consultar' || (p as Docs).operacion === 'consola')) await alto.promesa
        return respuestaPorDefecto(p)
      }
    })
    // Primera consulta: su muestra (`detalle`) va en meta y luego consulta en datos.
    const q1 = b.g.consultar(consultaDe('c1', 'q1'))
    for (let i = 0; i < 6; i++) await tic()
    const q2 = b.g.consultar(consultaDe('c1', 'q2'))
    for (let i = 0; i < 6; i++) await tic()
    const t = b.trabajadores[0]
    const quitada = b.g.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'q2' })
    const r2 = await q2
    const consultas = () => t.docs().filter((d) => d.operacion === 'consultar').length
    check(
      'la que ESPERA sale de la cola: cancelada, sin llegar al trabajador',
      quitada && !r2.ok && r2.error.motivo === 'cancelada' && consultas() === 1,
      j({ r2, consultas: consultas() })
    )
    const enCurso = b.g.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'q1' })
    await tic()
    const canc = t.peticiones.filter((p) => p.op === 'cancelar') as Array<{ sesion: string }>
    check('la que CORRE: op cancelar a SU sesión (datos)', enCurso && canc.length === 1 && canc[0].sesion === 'datos', j(canc))
    check('cancelar otra petición u otra conexión no hace nada', !b.g.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'nada' }) && !b.g.cancelar({ rol: 'datos', conexionId: 'otra', peticionId: 'q1' }), '')
    // Consola: por perfil + consola + ejecucionId (= peticionId de DbDocEjecutar).
    const k = b.g.ejecutarConsola(
      { perfilId: 'p1', consolaId: 'k1', conexionId: 'c1', base: 'pruebas', texto: 'db.x.find()', desplazamiento: 0, peticionId: 'e1' },
      { soloLectura: false, produccion: false, confirmado: false }
    )
    for (let i = 0; i < 6; i++) await tic()
    const otraConsola = b.g.cancelar({ rol: 'consola', perfilId: 'p1', consolaId: 'k2', ejecucionId: 'e1' })
    const esta = b.g.cancelar({ rol: 'consola', perfilId: 'p1', consolaId: 'k1', ejecucionId: 'e1' })
    await tic()
    const canc2 = t.peticiones.filter((p) => p.op === 'cancelar') as Array<{ sesion: string }>
    check('consola: cancelar por perfil+consola+ejecucionId va a su sesión; otra consola no', !otraConsola && esta && canc2[canc2.length - 1].sesion === 'consola:k1', j(canc2))
    alto.abrir()
    await Promise.all([q1, k])
  }

  // ---------------------------------------------------------------------------------------
  hr('(5) Lectores')
  {
    let masCuenta = 0
    const b = banco({
      manejar: (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'mas') {
          masCuenta++
          const lector = (p as Extract<Docs, { operacion: 'mas' }>).lector
          if (lector === 'w-perdido') throw new FalloTrabajador({ clase: 'protocolo', codigo: CODIGO_LECTOR_DESCONOCIDO, mensaje: 'no existe' }, 'docs')
          return { lector: masCuenta === 1 ? lector : null, documentos: [], columnas: [], ms: 1 }
        }
        return respuestaPorDefecto(p)
      }
    })
    const r = await b.g.consultar(consultaDe())
    const idMain = r.ok ? r.valor.lector : null
    check('el lector que ve el renderer es del MAIN (docs:N), no el del trabajador', typeof idMain === 'string' && idMain.startsWith('docs:') && idMain !== 'w-cur', j(idMain))
    const m1 = await b.g.leerMas({ lector: idMain as string, maxDocumentos: 50 })
    const t = b.trabajadores[0]
    const pedida = t.docs().find((d) => d.operacion === 'mas') as Extract<Docs, { operacion: 'mas' }> | undefined
    check('más: va al trabajador con SU lector, en la sesión datos; mientras sigue, el mismo id del main', m1.ok && m1.valor.lector === idMain && pedida?.lector === 'w-cur' && pedida.maxDocumentos === 50, j({ m1, pedida }))
    const m2 = await b.g.leerMas({ lector: idMain as string, maxDocumentos: 50 })
    const m3 = await b.g.leerMas({ lector: idMain as string, maxDocumentos: 50 })
    check(
      'al agotarse (lector null) el id se olvida: pedir más es noReleible «vuelve a ejecutar»',
      m2.ok && m2.valor.lector === null && !m3.ok && m3.error.motivo === 'noReleible' && m3.error.mensaje === MENSAJE_SIN_LECTOR,
      j({ m2, m3 })
    )
    // Cerrar manda cerrarLector con el id del trabajador.
    const r2 = await b.g.consultar(consultaDe())
    await b.g.cerrarLector(r2.ok ? (r2.valor.lector as string) : '')
    const cerrados = t.docs().filter((d) => d.operacion === 'cerrarLector') as Array<Extract<Docs, { operacion: 'cerrarLector' }>>
    check('cerrarLector: manda cerrarLector con el lector del trabajador; uno que no existe no es error', cerrados.length === 1 && cerrados[0].lector === 'w-cur', j(cerrados))
    await b.g.cerrarLector('docs:999')
    // Tope por sesión: el más viejo se cierra.
    const ids: string[] = []
    for (let i = 0; i < MAX_LECTORES_POR_SESION + 1; i++) {
      const x = await b.g.consultar(consultaDe())
      if (x.ok && x.valor.lector) ids.push(x.valor.lector)
    }
    await tic()
    const viejo = await b.g.leerMas({ lector: ids[0], maxDocumentos: 5 })
    const cerradosTope = t.docs().filter((d) => d.operacion === 'cerrarLector').length
    check(
      `pasado el tope (${MAX_LECTORES_POR_SESION}) por sesión, el más viejo se cierra en el trabajador y su id deja de valer`,
      !viejo.ok && viejo.error.motivo === 'noReleible' && cerradosTope >= 2,
      j({ viejo, cerradosTope })
    )
    // Un lector que el trabajador ya no tiene (expulsado): noReleible y se olvida.
    const b2 = banco({
      manejar: (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'consultar') return { lector: 'w-perdido', documentos: [], columnas: [], ms: 1 }
        if (p.op === 'docs' && (p as Docs).operacion === 'mas') throw new FalloTrabajador({ clase: 'protocolo', codigo: CODIGO_LECTOR_DESCONOCIDO, mensaje: 'no existe' }, 'docs')
        return respuestaPorDefecto(p)
      }
    })
    const rp = await b2.g.consultar(consultaDe())
    const idp = rp.ok ? (rp.valor.lector as string) : ''
    const mp = await b2.g.leerMas({ lector: idp, maxDocumentos: 5 })
    const mp2 = await b2.g.leerMas({ lector: idp, maxDocumentos: 5 })
    check('un lector que el trabajador no conoce → noReleible, y el id se olvida', !mp.ok && mp.error.motivo === 'noReleible' && !mp2.ok && b2.trabajadores[0].docs().filter((d) => d.operacion === 'mas').length === 1, j({ mp, mp2 }))
  }

  // ---------------------------------------------------------------------------------------
  hr('(6) Mapeo de errores (errorDocs)')
  {
    const casos: Array<[string, ErrorTrabajador, Parameters<typeof errorDocs>[1], Record<string, unknown>]> = [
      ['producción', { clase: 'soloLectura', codigo: CODIGO_DOCS_PRODUCCION, mensaje: 'prod' }, {}, { motivo: 'produccion', codigo: CODIGO_DOCS_PRODUCCION }],
      ['solo lectura', { clase: 'soloLectura', codigo: CODIGO_DOCS_SOLO_LECTURA, mensaje: 'ro' }, {}, { motivo: 'soloLectura' }],
      ['sin transacción', { clase: 'servidor', codigo: CODIGO_DOCS_SIN_TRANSACCION, mensaje: 'sin tx' }, {}, { motivo: 'sinTransaccion' }],
      // «😀» son DOS unidades UTF-16 y UN punto de código: el offset 3 (cp) cae en la 4 (UTF-16).
      ['sintaxis en la consola (con desplazamiento y un astral)', { clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'x', offsetCp: 3 }, { texto: 'a😀bc', desplazamiento: 10 }, { motivo: 'servidor', posicion: 14 }],
      ['sintaxis en el filtro (relativa al campo, sin desplazamiento)', { clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'x', offsetCp: 2, campoDocs: 'filtro' }, { texto: 'zzz', desplazamiento: 50, campos: { filtro: '😀{a', proyeccion: '', orden: '' } }, { motivo: 'servidor', campo: 'filtro', posicion: 3 }],
      ['cancelada', { clase: 'cancelada', mensaje: 'c' }, {}, { motivo: 'cancelada' }],
      ['pérdida', { clase: 'perdida', mensaje: 'red' }, {}, { motivo: 'sesionPerdida' }],
      ['timeout', { clase: 'timeout', mensaje: 't' }, {}, { motivo: 'timeout' }],
      ['protocolo', { clase: 'protocolo', mensaje: 'p' }, {}, { motivo: 'interno' }],
      ['lector desconocido', { clase: 'protocolo', codigo: CODIGO_LECTOR_DESCONOCIDO, mensaje: 'p' }, {}, { motivo: 'noReleible', mensaje: MENSAJE_SIN_LECTOR }],
      ['offset sin texto sobre el que contar: sin posición', { clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'x', offsetCp: 3 }, {}, { motivo: 'servidor', posicion: undefined }]
    ]
    for (const [nombre, et, ctx, esperado] of casos) {
      const e = errorDocs(et, ctx) as unknown as Record<string, unknown>
      const bien = Object.entries(esperado).every(([k, v]) => e[k] === v)
      check(`${nombre} → ${j(esperado)}`, bien, j(e))
    }
    // Por el gestor: el error del trabajador llega mapeado con la posición de la consola.
    const b = banco({
      manejar: (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'consola') throw new FalloTrabajador({ clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'Token inesperado', offsetCp: 5 }, 'docs')
        return respuestaPorDefecto(p)
      }
    })
    const r = await b.g.ejecutarConsola(
      { perfilId: 'p1', consolaId: 'k1', conexionId: 'c1', base: null, texto: 'db.x.(', desplazamiento: 7 },
      { soloLectura: true, produccion: false, confirmado: false }
    )
    check('por el gestor: la sintaxis de la consola vuelve con posición + desplazamiento', !r.ok && r.error.motivo === 'servidor' && r.error.posicion === 12, j(r))
  }

  // ---------------------------------------------------------------------------------------
  hr('(7) Política')
  {
    const b = banco()
    const pol = { soloLectura: true, produccion: true, confirmado: false }
    await b.g.ejecutarConsola({ perfilId: 'p1', consolaId: 'k1', conexionId: 'c1', base: 'pruebas', texto: 'db.x.drop()', desplazamiento: 0 }, pol, 25)
    await b.g.enviar({ conexionId: 'c1', base: 'pruebas', coleccion: 'x', cambios: [{ tipo: 'borrar', idEjson: '1' }], confirmadoSinTransaccion: true }, pol)
    const t = b.trabajadores[0]
    const consola = t.docs().find((d) => d.operacion === 'consola') as Extract<Docs, { operacion: 'consola' }> | undefined
    const envio = t.docs().find((d) => d.operacion === 'enviar') as Extract<Docs, { operacion: 'enviar' }> | undefined
    check(
      'la política viaja TAL CUAL al trabajador (consola y enviar), con maxDocumentos y confirmadoSinTransaccion',
      j(consola?.politica) === j(pol) && consola?.maxDocumentos === 25 && consola.sesion === 'consola:k1' && j(envio?.politica) === j(pol) && envio?.confirmadoSinTransaccion === true && envio.sesion === 'datos',
      j({ consola, envio })
    )
    check(
      'politicaDe: la solo lectura IMPUESTA → soloLectura; entorno produccion → produccion; confirmado solo con true',
      j(politicaDe({ entorno: 'produccion' }, false, true)) === j({ soloLectura: false, produccion: true, confirmado: true }) &&
        j(politicaDe({ entorno: 'pruebas' }, true, 'si')) === j({ soloLectura: true, produccion: false, confirmado: false }),
      ''
    )
    // la casilla `readonly` es de los AGENTES. `politicaDe` ya no la recibe, y el
    // controlador, sin solo lectura impuesta, arma `soloLectura: false` también con ella marcada.
    check(
      'la casilla de los agentes NO entra en la política (una producción marcada pide confirmar, no rechaza)',
      j(politicaDe({ readonly: true, entorno: 'produccion' } as DbConnection, false, false)) === j({ soloLectura: false, produccion: true, confirmado: false }),
      ''
    )
  }

  // ---------------------------------------------------------------------------------------
  hr('(8) Pérdida y reapertura')
  {
    let fallar = 1
    const b = banco({
      manejar: (p) => {
        if (p.op === 'docs' && fallar > 0 && ((p as Docs).operacion === 'bases' || (p as Docs).operacion === 'consola')) {
          fallar--
          throw new FalloTrabajador({ clase: 'perdida', mensaje: 'connection reset' }, 'docs')
        }
        return respuestaPorDefecto(p)
      }
    })
    const r = await b.g.bases({ conexionId: 'c1' })
    const t = b.trabajadores[0]
    const abrirMeta = t.peticiones.filter((p) => p.op === 'abrir' && p.sesion === 'meta').length
    check('una lectura del árbol que pierde la sesión se REINTENTA una vez en una sesión nueva (dos abrir)', r.ok && abrirMeta === 2, j({ r, abrirMeta }))
    fallar = 1
    const k = await b.g.ejecutarConsola({ perfilId: 'p1', consolaId: 'k1', conexionId: 'c1', base: null, texto: 'db.x.insertOne({})', desplazamiento: 0 }, { soloLectura: false, produccion: false, confirmado: false })
    const consolas = t.docs().filter((d) => d.operacion === 'consola').length
    check('la consola NO se reintenta (sería repetir una escritura): sesionPerdida', !k.ok && k.error.motivo === 'sesionPerdida' && consolas === 1, j({ k, consolas }))
    const k2 = await b.g.ejecutarConsola({ perfilId: 'p1', consolaId: 'k1', conexionId: 'c1', base: null, texto: 'db.x.find()', desplazamiento: 0 }, { soloLectura: false, produccion: false, confirmado: false })
    const abrirK = t.peticiones.filter((p) => p.op === 'abrir' && p.sesion === 'consola:k1').length
    check('la siguiente operación de la consola la REABRE', k2.ok && abrirK === 2, j({ k2, abrirK }))
    // Evento de pérdida de una sesión ociosa.
    t.emitir({ ev: 'perdida', sesion: 'meta', error: { clase: 'perdida', mensaje: 'idle' } })
    const meta = b.g.sesiones().find((s) => s.ref.rol === 'meta')
    check('el evento de pérdida deja la sesión perdida con su aviso', meta?.fase === 'perdida' && meta.aviso?.tipo === 'perdida', j(meta))
    // El proceso que muere solo: las sesiones abiertas quedan perdidas ('caida') y se reabren en otro proceso.
    await b.g.bases({ conexionId: 'c1' })
    t.matar()
    const trasCaida = b.g.sesiones().find((s) => s.ref.rol === 'meta')
    const r3 = await b.g.bases({ conexionId: 'c1' })
    check('proceso caído: aviso «caida» y la siguiente operación lanza otro proceso', trasCaida?.aviso?.tipo === 'caida' && r3.ok && b.trabajadores.length === 2, j({ trasCaida, procesos: b.trabajadores.length }))
  }

  // ---------------------------------------------------------------------------------------
  hr('(9) Desconectar, forzar, sesiones, columnas, tope de procesos, timeout y cerrarTodo')
  {
    // Con la casilla de los AGENTES marcada: el explorador no la mira.
    const b = banco({ conexiones: [conDe('c1', { readonly: true })] })
    await b.g.bases({ conexionId: 'c1' })
    await b.g.consultar(consultaDe())
    const ses = b.g.sesiones()
    const meta = ses.find((s) => s.ref.rol === 'meta')
    check(
      'sesiones(): meta y datos, txModo auto, tx ninguna, SIN solo lectura (la casilla es de los agentes) y la versión del servidor',
      ses.length === 2 && meta?.txModo === 'auto' && meta.tx === 'ninguna' && meta.soloLectura === false && meta.driver?.version === '7.0.9' && meta.fase === 'lista',
      j(ses)
    )
    const abrir0 = b.trabajadores[0].peticiones.find((p) => p.op === 'abrir') as { conexion?: { readonly?: boolean } } | undefined
    check('la conexión del trabajador viaja SIN solo lectura aunque la casilla esté marcada', abrir0?.conexion?.readonly === false, j(abrir0?.conexion))
    // La mitad impuesta: con `soloLecturaImpuesta`, el estado y el trabajador la llevan.
    const bi = banco({ conexiones: [conDe('c1')], soloLecturaImpuesta: () => true })
    await bi.g.bases({ conexionId: 'c1' })
    const metaI = bi.g.sesiones().find((s) => s.ref.rol === 'meta')
    const abrirI = bi.trabajadores[0].peticiones.find((p) => p.op === 'abrir') as { conexion?: { readonly?: boolean } } | undefined
    check('con solo lectura IMPUESTA: la sesión dice soloLectura y el trabajador la recibe', metaI?.soloLectura === true && abrirI?.conexion?.readonly === true, j({ metaI, c: abrirI?.conexion }))
    check('se emitió el estado de las sesiones (abriendo → lista…)', b.emitidas.some((e) => e.fase === 'abriendo') && b.emitidas.some((e) => e.fase === 'lista'), j(b.emitidas.map((e) => e.fase)))
    const t = b.trabajadores[0]
    const detalles1 = t.docs().filter((d) => d.operacion === 'detalle').length
    const consulta1 = t.docs().find((d) => d.operacion === 'consultar') as Extract<Docs, { operacion: 'consultar' }> | undefined
    await b.g.consultar(consultaDe())
    const detalles2 = t.docs().filter((d) => d.operacion === 'detalle').length
    check('consultar pide la muestra UNA vez y manda sus columnas', detalles1 === 1 && detalles2 === 1 && j(consulta1?.columnas) === j(['_id', 'nombre']), j({ detalles1, detalles2, columnas: consulta1?.columnas }))
    await b.g.desconectar('c1')
    check('desconectar: el proceso sale y no quedan sesiones', t.salio && b.g.sesiones().length === 0, j(b.g.sesiones()))
    await b.g.bases({ conexionId: 'c1' })
    const t2 = b.trabajadores[1]
    b.g.forzar('c1')
    check('forzar: MATA el proceso (con motivo cancelada) y suelta las sesiones', t2 !== undefined && t2.matadoCon?.clase === 'cancelada' && b.g.sesiones().length === 0, j(t2?.matadoCon))

    // Tope de procesos: la conexión MAX+1 expulsa la ociosa más antigua.
    let reloj = 1000
    const muchas = Array.from({ length: MAX_PROCESOS + 1 }, (_, i) => conDe(`m${i}`))
    const b2 = banco({ conexiones: muchas, ahora: () => reloj })
    for (const c of muchas.slice(0, MAX_PROCESOS)) {
      reloj += 10
      await b2.g.bases({ conexionId: c.id })
    }
    reloj += 10
    const ultima = await b2.g.bases({ conexionId: `m${MAX_PROCESOS}` })
    check(`tope de ${MAX_PROCESOS} procesos: la siguiente expulsa la más antigua ociosa`, ultima.ok && b2.trabajadores[0].salio && !b2.trabajadores[1].salio, j({ ultima, salio0: b2.trabajadores[0].salio }))

    // Timeout: el trabajador sigue ocupado, así que se mata el proceso.
    const b3 = banco({
      manejar: (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'colecciones') throw new FalloTrabajador({ clase: 'timeout', codigo: 'TESSERA-PLAZO', mensaje: 'no respondió' }, 'docs')
        return respuestaPorDefecto(p)
      }
    })
    const rt = await b3.g.colecciones({ conexionId: 'c1', base: 'x' })
    check('un timeout mata el proceso (la sesión quedaría ocupada) y responde timeout', !rt.ok && rt.error.motivo === 'timeout' && b3.trabajadores[0].matadoCon !== null, j({ rt, matado: b3.trabajadores[0].matadoCon }))

    // cerrarTodo.
    const b4 = banco()
    await b4.g.bases({ conexionId: 'c1' })
    await b4.g.cerrarTodo(100)
    const tras = await b4.g.bases({ conexionId: 'c1' })
    check('cerrarTodo: los procesos salen y nada nuevo arranca', b4.trabajadores[0].salio && !tras.ok && tras.error.mensaje === 'Tessera se está cerrando.' && b4.trabajadores.length === 1, j(tras))
    b4.g.reanudarTrasCierreAbortado()
    const otraVez = await b4.g.bases({ conexionId: 'c1' })
    check('reanudarTrasCierreAbortado: vuelve a arrancar', otraVez.ok && b4.trabajadores.length === 2, j(otraVez))

    // Una conexión que no es de documentos no llega a lanzar nada.
    const b5 = banco({ conexiones: [{ ...conDe('ora'), motor: 'oracle' }] })
    const ro = await b5.g.bases({ conexionId: 'ora' })
    check('una conexión SQL no lanza el proceso de documentos', !ro.ok && ro.error.motivo === 'interno' && b5.trabajadores.length === 0, j(ro))
  }

  // ---------------------------------------------------------------------------------------
  hr('(10) Filtro guiado y orden de la cabecera')
  {
    const guiado: DbFiltroGuiado = {
      union: 'todas',
      condiciones: [
        { columna: 'edad', categoria: 'numero', operador: 'mayor', valor: '40' },
        { columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: 'lu' }
      ]
    }
    const compilado = compilarFiltroDocs(guiado)
    const b = banco()
    const r = await b.g.consultar({ ...consultaDe(), filtroGuiado: guiado, ordenColumnas: [{ columna: 'edad', dir: 'desc' }, { columna: 'nombre', dir: 'asc' }] })
    const enviada = b.trabajadores[0]?.docs().find((d) => d.operacion === 'consultar') as Extract<Docs, { operacion: 'consultar' }> | undefined
    check(
      'el trabajador recibe el filtro y el orden COMPILADOS por los campos de siempre',
      r.ok && compilado.ok && enviada?.filtro === compilado.valor.texto && enviada.orden === '{ "edad": -1, "nombre": 1 }' && enviada.proyeccion === '',
      j({ r, filtro: enviada?.filtro, orden: enviada?.orden })
    )

    const bm = banco()
    const malo = await bm.g.consultar({ ...consultaDe(), filtroGuiado: { union: 'todas', condiciones: [guiado.condiciones[0], { columna: '$where', categoria: 'texto', operador: 'igual', valor: 'x' }] } })
    check(
      'un filtro guiado que no compila no llega al trabajador: campo filtro + condición 1',
      !malo.ok && malo.error.campo === 'filtro' && malo.error.condicion === 1 && bm.trabajadores.length === 0,
      j({ malo, trabajadores: bm.trabajadores.length })
    )

    // El trabajador rechaza con una posición DENTRO de la segunda condición del compilado.
    const offset = compilado.ok ? compilado.valor.rangos[1].desde + 3 : 0
    const bs = banco({
      manejar: (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'consultar') {
          throw new FalloTrabajador({ clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'Error de sintaxis: x.', offsetCp: offset, campoDocs: 'filtro' }, 'docs')
        }
        return respuestaPorDefecto(p)
      }
    })
    const rs = await bs.g.consultar({ ...consultaDe(), filtroGuiado: guiado })
    check('un error del trabajador sobre el compilado: condición 1 y SIN posición', !rs.ok && rs.error.campo === 'filtro' && rs.error.condicion === 1 && rs.error.posicion === undefined, j(rs))
    const bt = banco({
      manejar: (p) => {
        if (p.op === 'docs' && (p as Docs).operacion === 'consultar') {
          throw new FalloTrabajador({ clase: 'servidor', codigo: CODIGO_DOCS_SINTAXIS, mensaje: 'Error de sintaxis: x.', offsetCp: 2, campoDocs: 'filtro' }, 'docs')
        }
        return respuestaPorDefecto(p)
      }
    })
    const rt = await bt.g.consultar({ ...consultaDe(), filtro: '{ a' })
    check('… y el mismo error con el filtro de TEXTO conserva su posición y no lleva condición', !rt.ok && rt.error.posicion === 2 && rt.error.condicion === undefined, j(rt))

    // El controlador valida en la ENTRADA (antes del gestor).
    const bc = banco()
    const ctl = new ControladorDocumentos({ conexiones: { get: (id) => bc.conexiones.get(id) }, gestor: bc.g })
    const pedir = (extra: Record<string, unknown>) => ctl.atender('CONSULTAR', { ...consultaDe(), ...extra })
    const e1 = await pedir({ filtroGuiado: { union: 'todas', condiciones: [{ columna: 'edad', categoria: 'numero', operador: 'igual', valor: 'doce' }] } })
    check('controlador: un número ilegible es error de la condición 0, sin lanzar el proceso', !e1.ok && e1.error.campo === 'filtro' && e1.error.condicion === 0 && e1.error.motivo === 'servidor' && bc.trabajadores.length === 0, j(e1))
    const e2 = await pedir({ filtro: '{ a: 1 }', filtroGuiado: guiado })
    check('controlador: guiado con condiciones + filtro de texto = Petición inválida', !e2.ok && e2.error.motivo === 'interno' && /Petición inválida/.test(e2.error.mensaje), j(e2))
    const e3 = await pedir({ ordenColumnas: [{ columna: 'b', dir: 'asc' }, { columna: '7', dir: 'asc' }] })
    check('controlador: un campo numérico detrás de otro en el orden es error de campo orden', !e3.ok && e3.error.campo === 'orden', j(e3))
    const e4 = await pedir({ ordenColumnas: 'edad' })
    check('controlador: un orden que no es una lista es error de campo orden', !e4.ok && e4.error.campo === 'orden', j(e4))
    const bien = await pedir({ filtroGuiado: guiado, ordenColumnas: [] })
    const llego = bc.trabajadores[0]?.docs().find((d) => d.operacion === 'consultar') as Extract<Docs, { operacion: 'consultar' }> | undefined
    check('controlador: uno válido llega al gestor y el trabajador recibe el compilado', bien.ok && compilado.ok && llego?.filtro === compilado.valor.texto && llego.orden === '', j({ bien, filtro: llego?.filtro }))
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
