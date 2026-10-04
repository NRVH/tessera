#!/usr/bin/env node
// =============================================================================
// Prueba del protocolo main <-> proceso de sesión (`protocoloTrabajador.ts` y el correlador que
// reexporta). El `Correlador` recibe un reloj falso y aquí se avanza el tiempo a mano: ids,
// respuestas fuera de orden, errores del trabajador, vigilantes por op, respuestas tardías,
// `rechazarTodo` y el ruido del canal. (npm run test:db-protocolo)
// =============================================================================

import {
  Correlador,
  FalloTrabajador,
  PLAZOS_TRABAJADOR_MS,
  clasificarMensaje,
  plazoDePeticion,
  type Reloj,
  type PeticionSinId
} from './protocoloTrabajador.ts'
import { entornoTrabajador, lineaParaLog } from './ProcesoTrabajador.ts'

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

// ---------------------------------------------------------------------------
// Reloj falso
// ---------------------------------------------------------------------------
class RelojFalso implements Reloj {
  ahora = 0
  private sig = 1
  tareas = new Map<number, { en: number; fn: () => void }>()
  programar(fn: () => void, ms: number): unknown {
    const id = this.sig++
    this.tareas.set(id, { en: this.ahora + ms, fn })
    return id
  }
  cancelar(asa: unknown): void {
    this.tareas.delete(asa as number)
  }
  avanzar(ms: number): void {
    this.ahora += ms
    const vencidas = [...this.tareas.entries()].filter(([, t]) => t.en <= this.ahora).sort((a, b) => a[1].en - b[1].en)
    for (const [id, t] of vencidas) {
      this.tareas.delete(id)
      t.fn()
    }
  }
}

/** Observa una promesa sin await: estado tras vaciar la cola de microtareas. */
function observar<T>(p: Promise<T>): { estado: 'pendiente' | 'resuelta' | 'rechazada'; valor?: T; error?: unknown } {
  const o: { estado: 'pendiente' | 'resuelta' | 'rechazada'; valor?: T; error?: unknown } = { estado: 'pendiente' }
  p.then(
    (v) => {
      o.estado = 'resuelta'
      o.valor = v
    },
    (e) => {
      o.estado = 'rechazada'
      o.error = e
    }
  )
  return o
}
const tic = (): Promise<void> => new Promise((r) => setImmediate(r))

const CONEXION = {
  id: 'c1',
  alias: 'QA',
  motor: 'postgres' as const,
  host: 'h',
  port: 5432,
  database: 'd',
  user: 'u',
  readonly: true
}
const CTX = { packs: [], externos: {}, driversDir: '', usuarioWindows: 'yo' }

function abrir(c: Correlador, sesion: string, rol: 'meta' | 'datos' | 'consola') {
  const r = c.preparar<'abrir'>({
    op: 'abrir',
    sesion,
    rol,
    conexion: CONEXION,
    secreto: 'x',
    ctx: CTX,
    opciones: { timeoutMs: 0 }
  })
  // Muchas aperturas de este test solo están para enseñarle el rol al correlador:
  // se observan para que su vencimiento no sea un rechazo sin manejar.
  observar(r.promesa)
  return r
}

async function main(): Promise<void> {
  hr('(1) ids crecientes y mensaje listo para enviar')
  {
    const c = new Correlador({ reloj: new RelojFalso() })
    const a = c.preparar<'iniciar'>({ op: 'iniciar', v: 1 })
    const b = c.preparar<'salir'>({ op: 'salir' })
    check('ids 1 y 2', a.mensaje.id === 1 && b.mensaje.id === 2, `${a.mensaje.id}, ${b.mensaje.id}`)
    check('el mensaje conserva op y campos', a.mensaje.op === 'iniciar' && a.mensaje.v === 1, JSON.stringify(a.mensaje))
    check('dos pendientes', c.pendientes === 2, String(c.pendientes))
  }

  hr('(2) respuestas fuera de orden')
  {
    const c = new Correlador({ reloj: new RelojFalso() })
    const a = c.preparar<'cancelar'>({ op: 'cancelar', sesion: 's1' })
    const b = c.preparar<'cerrar'>({ op: 'cerrar', sesion: 's2' })
    const oa = observar(a.promesa)
    const ob = observar(b.promesa)
    c.recibir({ id: b.mensaje.id, ok: true, r: { cerrada: true } })
    c.recibir({ id: a.mensaje.id, ok: true, r: { cancelada: false } })
    await tic()
    check('la segunda resuelve con lo suyo', ob.estado === 'resuelta' && (ob.valor as any).cerrada === true, JSON.stringify(ob))
    check('la primera resuelve con lo suyo', oa.estado === 'resuelta' && (oa.valor as any).cancelada === false, JSON.stringify(oa))
    check('no queda nada pendiente', c.pendientes === 0, String(c.pendientes))
  }

  hr('(3) error del trabajador -> FalloTrabajador')
  {
    const c = new Correlador({ reloj: new RelojFalso() })
    abrir(c, 'con1', 'consola')
    const e = c.preparar<'ejecutar'>({
      op: 'ejecutar',
      sesion: 'con1',
      sql: 'select',
      opciones: { proposito: 'usuario', maxFilas: 500 }
    })
    const o = observar(e.promesa)
    c.recibir({ id: e.mensaje.id, ok: false, error: { clase: 'servidor', mensaje: 'syntax error', codigo: '42601', offsetCp: 7 } })
    await tic()
    const err = o.error as FalloTrabajador
    check('rechaza con FalloTrabajador', o.estado === 'rechazada' && err instanceof FalloTrabajador, String(err))
    check('lleva clase, código, offset y op', err.error.clase === 'servidor' && err.error.codigo === '42601' && err.error.offsetCp === 7 && err.op === 'ejecutar', JSON.stringify(err.error))
  }

  hr('(4) vigilantes por op y rol')
  {
    const reloj = new RelojFalso()
    const vencidas: string[] = []
    const c = new Correlador({ reloj, alVencer: (op) => vencidas.push(op) })
    const ab = abrir(c, 'meta|c1', 'meta')
    const oab = observar(ab.promesa)
    reloj.avanzar(PLAZOS_TRABAJADOR_MS.abrir - 1)
    await tic()
    check('abrir sigue pendiente a 89,999 s', oab.estado === 'pendiente', oab.estado)
    reloj.avanzar(1)
    await tic()
    const eab = oab.error as FalloTrabajador
    check('abrir vence a los 90 s con clase timeout', oab.estado === 'rechazada' && eab.error.clase === 'timeout', eab?.message ?? '')
    check('y avisa a alVencer', vencidas.join(',') === 'abrir', vencidas.join(','))

    const meta = c.preparar<'ejecutar'>({ op: 'ejecutar', sesion: 'meta|c1', sql: 'q', opciones: { proposito: 'catalogo', maxFilas: 1 } })
    const om = observar(meta.promesa)
    reloj.avanzar(PLAZOS_TRABAJADOR_MS.meta)
    await tic()
    check('ejecutar en meta vence a los 75 s', om.estado === 'rechazada', om.estado)

    abrir(c, 'consola|k1', 'consola')
    abrir(c, 'datos|c1', 'datos')
    const ej = c.preparar<'ejecutar'>({ op: 'ejecutar', sesion: 'consola|k1', sql: 'select pg_sleep(99999)', opciones: { proposito: 'usuario', maxFilas: 500 } })
    const le = c.preparar<'leer'>({ op: 'leer', sesion: 'datos|c1', lector: 'l1', maxFilas: 500 })
    const tx = c.preparar<'tx'>({ op: 'tx', sesion: 'consola|k1', accion: 'rollback' })
    const oej = observar(ej.promesa)
    const ole = observar(le.promesa)
    const otx = observar(tx.promesa)
    reloj.avanzar(10 * 3600 * 1000)
    await tic()
    check('ejecutar en consola NO tiene vigilante (10 h)', oej.estado === 'pendiente', oej.estado)
    check('leer en datos NO tiene vigilante', ole.estado === 'pendiente', ole.estado)
    check('tx en consola NO tiene vigilante (un ROLLBACK largo es legítimo)', otx.estado === 'pendiente', otx.estado)

    const antes = reloj.tareas.size
    const ca = c.preparar<'cancelar'>({ op: 'cancelar', sesion: 'consola|k1' })
    c.recibir({ id: ca.mensaje.id, ok: true, r: { cancelada: true } })
    check('responder cancela el vigilante', reloj.tareas.size === antes, `${antes} -> ${reloj.tareas.size}`)
  }

  hr('(5) respuesta tardía tras vencer')
  {
    const reloj = new RelojFalso()
    const c = new Correlador({ reloj })
    const s = c.preparar<'salir'>({ op: 'salir' })
    const o = observar(s.promesa)
    reloj.avanzar(PLAZOS_TRABAJADOR_MS.salir)
    await tic()
    let lanzo = false
    let rec: any = null
    try {
      rec = c.recibir({ id: s.mensaje.id, ok: true, r: { saliendo: true } })
    } catch {
      lanzo = true
    }
    await tic()
    check('la tardía no lanza y se marca como no encontrada', !lanzo && rec?.tipo === 'respuesta' && rec.encontrada === false, JSON.stringify(rec))
    check('la promesa quedó rechazada por el vigilante, no resuelta', o.estado === 'rechazada', o.estado)
  }

  hr('(6) rechazarTodo al salir el proceso')
  {
    const c = new Correlador({ reloj: new RelojFalso() })
    abrir(c, 'consola|a', 'consola')
    const e1 = observar(c.preparar<'ejecutar'>({ op: 'ejecutar', sesion: 'consola|a', sql: 'x', opciones: { proposito: 'usuario', maxFilas: 1 } }).promesa)
    const e2 = observar(c.preparar<'tx'>({ op: 'tx', sesion: 'consola|a', accion: 'commit' }).promesa)
    const pendientesAntes = c.pendientes
    const n = c.rechazarTodo({ clase: 'perdida', mensaje: 'El proceso de la conexión terminó.' })
    await tic()
    check('rechaza todas las pendientes', n === pendientesAntes && c.pendientes === 0, `n=${n} antes=${pendientesAntes}`)
    const f1 = e1.error as FalloTrabajador
    const f2 = e2.error as FalloTrabajador
    check('con la clase dada y su op', f1?.error.clase === 'perdida' && f1.op === 'ejecutar' && f2?.op === 'tx', `${f1?.op}, ${f2?.op}`)
    check('olvida los roles', c.rolDe('consola|a') === undefined, String(c.rolDe('consola|a')))
  }

  hr('(7) clasificación de mensajes')
  {
    check('string -> ruido', clasificarMensaje('hola').tipo === 'ruido', 'ruido')
    check('array -> ruido', clasificarMensaje([1, 2]).tipo === 'ruido', 'ruido')
    check('id no numérico -> ruido', clasificarMensaje({ id: 'x', ok: true }).tipo === 'ruido', 'ruido')
    check('error sin forma -> ruido', clasificarMensaje({ id: 1, ok: false, error: 'boom' }).tipo === 'ruido', 'ruido')
    const p = clasificarMensaje({ ev: 'perdida', sesion: 's', error: { clase: 'perdida', mensaje: 'm', codigo: '57P01' } })
    check('evento perdida', p.tipo === 'evento' && p.evento.ev === 'perdida', JSON.stringify(p))
    const f = clasificarMensaje({ ev: 'fatal', mensaje: 'boom' })
    check('evento fatal', f.tipo === 'evento' && f.evento.ev === 'fatal', JSON.stringify(f))
    const c = new Correlador({ reloj: new RelojFalso() })
    const r = c.recibir({ ev: 'fatal', mensaje: 'x' })
    check('el correlador devuelve los eventos sin tocar pendientes', r.tipo === 'evento', JSON.stringify(r))
  }

  hr('(8) tabla de plazos, override y fallar')
  {
    const P = PLAZOS_TRABAJADOR_MS
    const casos: Array<[PeticionSinId, 'meta' | 'datos' | 'consola' | undefined, number | null]> = [
      [{ op: 'iniciar', v: 1 }, undefined, 15_000],
      [{ op: 'cancelar', sesion: 's' }, 'consola', 10_000],
      [{ op: 'cerrar', sesion: 's' }, 'consola', 10_000],
      [{ op: 'cerrarLector', sesion: 's', lector: 'l' }, 'datos', 10_000],
      [{ op: 'salir' }, undefined, 3_000],
      [{ op: 'autoCommit', sesion: 's', valor: true }, 'consola', 75_000],
      [{ op: 'tx', sesion: 's', accion: 'estado' }, 'meta', 75_000],
      [{ op: 'tx', sesion: 's', accion: 'commit' }, 'consola', null],
      [{ op: 'leer', sesion: 's', lector: 'l', maxFilas: 1 }, 'meta', 75_000],
      [{ op: 'leer', sesion: 's', lector: 'l', maxFilas: 1 }, 'consola', null],
      [{ op: 'ejecutar', sesion: 's', sql: 'x', opciones: { proposito: 'usuario', maxFilas: 1 } }, 'datos', null]
    ]
    let bien = 0
    const malos: string[] = []
    for (const [p, rol, esperado] of casos) {
      const v = plazoDePeticion(p, rol, P)
      if (v === esperado) bien++
      else malos.push(`${p.op}/${rol}: ${v} != ${esperado}`)
    }
    check(`tabla de plazos (${casos.length} casos)`, bien === casos.length, malos.join('; ') || 'todos')

    const reloj = new RelojFalso()
    const c = new Correlador({ reloj })
    const sin = observar(c.preparar<'salir'>({ op: 'salir' }, null).promesa)
    const corto = observar(c.preparar<'salir'>({ op: 'salir' }, 5).promesa)
    reloj.avanzar(3_000)
    await tic()
    check('override null: sin vigilante', sin.estado === 'pendiente', sin.estado)
    check('override 5 ms: vence', corto.estado === 'rechazada', corto.estado)

    const x = c.preparar<'cancelar'>({ op: 'cancelar', sesion: 's' })
    const ox = observar(x.promesa)
    const primera = c.fallar(x.mensaje.id, { clase: 'protocolo', mensaje: 'canal cerrado' })
    const segunda = c.fallar(x.mensaje.id, { clase: 'protocolo', mensaje: 'otra vez' })
    await tic()
    check('fallar rechaza una vez y solo una', primera && !segunda && ox.estado === 'rechazada', `${primera}/${segunda}`)

    const c2 = new Correlador({ reloj: new RelojFalso() })
    abrir(c2, 'k', 'consola')
    c2.preparar<'cerrar'>({ op: 'cerrar', sesion: 'k' })
    check('cerrar olvida el rol de la sesión', c2.rolDe('k') === undefined, String(c2.rolDe('k')))
  }

  hr('(9) Log y entorno del proceso (ProcesoTrabajador)')
  {
    const secreto = 's3cr3t0-largo'
    const conSecreto = lineaParaLog(`fallo al conectar con ${secreto} en host`, [secreto])
    check('el secreto se redacta', conSecreto !== null && !conSecreto.includes(secreto) && conSecreto.includes('***'), String(conSecreto))
    const sql = lineaParaLog('ejecutando SELECT nombre FROM cliente WHERE id = 1', [])
    check('una línea con pinta de SQL no se registra', sql === '[línea omitida: parece SQL]', String(sql))
    const larga = lineaParaLog('x'.repeat(500), [])
    check('se trunca a 200 caracteres', larga !== null && larga.length === 201 && larga.endsWith('…'), `largo=${larga?.length}`)
    check('una línea vacía no se registra', lineaParaLog('   \r', []) === null, 'null')
    check('CRLF se limpia', lineaParaLog('hola\r', []) === 'hola', 'hola')
    const env = entornoTrabajador({ PATH: '/bin', TESSERA_PROFILE: 'p', tessera_x: 'y', ELECTRON_RUN_AS_NODE: '0' })
    check(
      'entorno: sin TESSERA_*, con ELECTRON_RUN_AS_NODE=1 y UV_THREADPOOL_SIZE=16',
      env.PATH === '/bin' && !('TESSERA_PROFILE' in env) && !('tessera_x' in env) && env.ELECTRON_RUN_AS_NODE === '1' && env.UV_THREADPOOL_SIZE === '16',
      JSON.stringify(env)
    )
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
