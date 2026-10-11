#!/usr/bin/env node
// =============================================================================
// Prueba del registro de salud (npm run test:registro-salud): solo graba en alpha y con el
// ajuste encendido, la muestra y los sucesos (bloqueos con sus peticiones, ventana sin respuesta,
// monitores, GPU) salen en JSON por línea, lo que manda la ventana se sanea, rota al tope, apagar
// quita el temporizador y los oyentes, y un disco que falla no lanza. Todo con dependencias falsas.
// =============================================================================

import { TOPE_ARCHIVO_BYTES, type DepsRegistroSalud, type OyentesSalud } from '../../shared/salud.ts'
import { RegistroSalud, resumirProcesos } from './RegistroSalud.ts'
import { LlamadasIpc, TOPE_EN_BLOQUEO, TOPE_TERMINADAS } from './llamadasIpc.ts'
import { instrumentarIpc } from './ipc.ts'

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

interface Banco {
  deps: DepsRegistroSalud
  archivos: Map<string, string>
  movidos: Array<[string, string]>
  temporizadores: Array<{ fn: () => void; ms: number; vivo: boolean }>
  oyentes: { actual: OyentesSalud | null; quitados: number }
  fallaDisco: { activo: boolean }
  tamanoForzado: { valor: number | null }
}

function banco(version: string): Banco {
  const archivos = new Map<string, string>()
  const movidos: Array<[string, string]> = []
  const temporizadores: Banco['temporizadores'] = []
  const oyentes: Banco['oyentes'] = { actual: null, quitados: 0 }
  const fallaDisco = { activo: false }
  const tamanoForzado: { valor: number | null } = { valor: null }
  const deps: DepsRegistroSalud = {
    version,
    plataforma: 'windows',
    carpeta: 'logs',
    ahora: () => new Date('2026-10-09T10:00:00.000Z'),
    disco: {
      crearCarpeta: () => {
        if (fallaDisco.activo) throw new Error('disco')
      },
      anexar: (ruta, texto) => {
        if (fallaDisco.activo) throw new Error('disco lleno')
        archivos.set(ruta, (archivos.get(ruta) ?? '') + texto)
      },
      tamano: (ruta) => {
        if (tamanoForzado.valor !== null) return tamanoForzado.valor
        const a = archivos.get(ruta)
        if (a === undefined) throw new Error('no existe')
        return a.length
      },
      mover: (desde, hasta) => {
        movidos.push([desde, hasta])
        archivos.set(hasta, archivos.get(desde) ?? '')
        archivos.delete(desde)
        tamanoForzado.valor = null
      },
      unir: (c, n) => `${c}/${n}`
    },
    armar: (fn, ms) => {
      // Al dispararse, un temporizador de un solo disparo deja de estar vivo.
      const t = {
        fn: () => {
          t.vivo = false
          fn()
        },
        ms,
        vivo: true
      }
      temporizadores.push(t)
      return () => {
        t.vivo = false
      }
    },
    metricas: () => [
      { tipo: 'Browser', workingSetKb: 102400, cpuPct: 1.25 },
      { tipo: 'Tab', workingSetKb: 204800, cpuPct: 0.5 },
      { tipo: 'Tab', workingSetKb: 102400, cpuPct: 0.5 },
      { tipo: 'GPU', workingSetKb: 51200, cpuPct: 0 }
    ],
    memoriaMain: () => ({ heapMb: 40, externalMb: 10, rssMb: 150 }),
    ventana: async () => ({ heapMb: 80, nodos: 3000 }),
    sesiones: () => ({ terminales: 2, agentes: 1 }),
    suscribir: (o) => {
      oyentes.actual = o
      return () => {
        oyentes.actual = null
        oyentes.quitados += 1
      }
    },
    ahoraMs: () => 0,
    estadoVentana: () => ({ enfocada: true, visible: true, minimizada: false, maximizada: true, pantalla: { escala: 1.5, hz: 144, ancho: 2560, alto: 1440 } }),
    sistema: () => ({ libreMb: 6000, totalMb: 32000 }),
    monitores: () => 4,
    gpu: async () => null,
    ipcEn: () => [],
    ipcLentas: () => ({})
  }
  return { deps, archivos, movidos, temporizadores, oyentes, fallaDisco, tamanoForzado }
}

const lineas = (b: Banco): Array<Record<string, unknown>> =>
  (b.archivos.get('logs/salud.jsonl') ?? '')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
const vivos = (b: Banco): number => b.temporizadores.filter((t) => t.vivo).length

async function bloqueos(): Promise<void> {
  hr('(9) Bloqueos, ventana sin respuesta, monitores y GPU')
  const b = banco('0.76.2-alpha.3')
  let reloj = 1000
  b.deps.ahoraMs = () => reloj
  let pedido: [number, number] | null = null
  b.deps.ipcEn = (desde, hasta) => {
    pedido = [desde, hasta]
    return [{ canal: 'git:log', ms: 2400 }, { canal: 'files:listDir', ms: 900, enCurso: true }]
  }
  b.deps.gpu = async () => ({ aceleracion: { gpu_compositing: 'enabled' }, adaptadores: [{ vendor: 4318, device: 9860, activo: true, driver: '32.0.15.6094' }] })
  const r = new RegistroSalud(b.deps)
  r.fijarAjuste(true)
  await new Promise((res) => setTimeout(res, 5))
  b.oyentes.actual?.bloqueo(1834.6, 5000, 6834.6)
  const bl = lineas(b).find((l) => l.tipo === 'bloqueo-main') as Record<string, any>
  check(
    'bloqueo del main: cuánto, las peticiones del intervalo y el contexto (ventana, equipo, procesos)',
    bl.ms === 1835 && bl.ipc.length === 2 && bl.ipc[0].canal === 'git:log' && bl.ventana.pantalla.hz === 144 && bl.sistema.libreMb === 6000 && bl.procesos.main.mb === 100 && j(pedido) === j([5000, 6834.6]),
    JSON.stringify(bl)
  )
  b.oyentes.actual?.sinRespuesta()
  reloj = 9500
  b.oyentes.actual?.responde()
  const sr = lineas(b).filter((l) => l.tipo === 'sin-respuesta' || l.tipo === 'responde') as Array<Record<string, any>>
  check('sin respuesta y vuelta: dos líneas con contexto, y la vuelta dice cuánto duró', sr.length === 2 && sr[0].ms === undefined && sr[1].ms === 8500 && sr[1].ventana.enfocada === true, JSON.stringify(sr.map((l) => [l.tipo, l.ms])))
  b.oyentes.actual?.responde()
  const sinInicio = lineas(b).filter((l) => l.tipo === 'responde').pop() as Record<string, any>
  check('una vuelta sin «sin respuesta» antes no inventa la duración', sinInicio.ms === undefined, JSON.stringify(sinInicio))
  b.oyentes.actual?.pantalla('cambio-monitor')
  b.oyentes.actual?.ventana('minimizada')
  const pa = lineas(b).find((l) => l.tipo === 'pantalla') as Record<string, any>
  const ve = lineas(b).find((l) => l.tipo === 'ventana') as Record<string, any>
  check('cambio de monitor (con su escala y cuántos hay) y la ventana minimizada', pa.motivo === 'cambio-monitor' && pa.monitores === 4 && pa.ventana.pantalla.escala === 1.5 && ve.evento === 'minimizada', JSON.stringify([pa, ve]))
  const gpu = lineas(b).find((l) => l.tipo === 'gpu') as Record<string, any>
  check('la GPU, una línea al arrancar, por ids y sin nombres', gpu?.adaptadores[0].vendor === 4318 && gpu.aceleracion.gpu_compositing === 'enabled', JSON.stringify(gpu))
}

async function desdeLaVentana(): Promise<void> {
  hr('(10) Lo que manda la ventana se sanea')
  const b = banco('0.76.2-alpha.3')
  const r = new RegistroSalud(b.deps)
  r.anotarRenderer({ periodoS: 60, tareasLargas: { n: 3, maxMs: 812.4, totalMs: 1500 }, fotogramasLargos: { n: 1, maxMs: 450 }, entradasLentas: { n: 2, maxMs: 380 } })
  check('apagado no anota nada de la ventana', lineas(b).length === 0, String(lineas(b).length))
  r.fijarAjuste(true)
  r.anotarRenderer({ periodoS: 60, tareasLargas: { n: 3, maxMs: 812.4, totalMs: 1500 }, fotogramasLargos: { n: 1, maxMs: 450 }, entradasLentas: { n: 2, maxMs: 380 }, extra: '<script>' })
  const rl = lineas(b).find((l) => l.tipo === 'renderer-lento') as Record<string, any>
  check('el resumen sale redondeado y solo con sus números (lo demás se descarta)', rl.tareasLargas.maxMs === 812 && rl.entradasLentas.n === 2 && !('extra' in rl), JSON.stringify(rl))
  const antes = lineas(b).length
  r.anotarRenderer('basura')
  r.anotarRenderer({ tareasLargas: { n: -5, maxMs: Infinity }, fotogramasLargos: { n: 'x' } })
  r.anotarRenderer({ periodoS: 60, tareasLargas: { n: 0 }, fotogramasLargos: { n: 0 }, entradasLentas: { n: 0 } })
  check('basura, números inválidos o un resumen vacío: nada', lineas(b).length === antes, String(lineas(b).length - antes))
  r.anotarVisibilidad('tapada')
  r.anotarVisibilidad('borrar-todo')
  const vis = lineas(b).filter((l) => l.tipo === 'ventana')
  check('la visibilidad solo acepta «tapada» y «a-la-vista»', vis.length === 1 && vis[0].evento === 'tapada', JSON.stringify(vis))
}

async function llamadas(): Promise<void> {
  hr('(11) Las peticiones de la ventana')
  const ll = new LlamadasIpc()
  const a = ll.empezar('git:log', 100)
  const c = ll.empezar('files:listDir', 150)
  ll.terminar(a, 2600)
  const d = ll.empezar('db:consultar', 5000)
  ll.terminar(d, 5100)
  const en = ll.en(1000, 3000, 3000)
  check('en el intervalo: la que terminó dentro y la que sigue en curso, las más largas primero', j(en) === j([{ canal: 'files:listDir', ms: 2850, enCurso: true }, { canal: 'git:log', ms: 2500 }]), j(en))
  check('la que empezó después del intervalo no cuenta', !ll.en(1000, 3000, 6000).some((x) => x.canal === 'db:consultar'), '')
  ll.terminar(c, 3000)
  const lentas = ll.tomarLentas()
  check('las lentas (≥ 1 s) por canal, y se vacían al tomarlas', lentas['git:log']?.n === 1 && lentas['files:listDir']?.maxMs === 2850 && !('db:consultar' in lentas) && Object.keys(ll.tomarLentas()).length === 0, j(lentas))
  for (let i = 0; i < TOPE_TERMINADAS + 50; i++) ll.terminar(ll.empezar('x', i), i)
  check('el anillo de terminadas no crece sin tope', ll.en(0, 1e9, 1e9).length <= TOPE_EN_BLOQUEO, '')
  // instrumentarIpc: el handler sigue respondiendo lo mismo (o fallando igual) y la petición se apunta.
  const registrados = new Map<string, (...a: unknown[]) => Promise<unknown>>()
  const ipc = { handle: (canal: string, fn: (...a: unknown[]) => unknown) => void registrados.set(canal, fn as (...a: unknown[]) => Promise<unknown>) }
  const l2 = new LlamadasIpc()
  let t = 0
  instrumentarIpc(ipc as never, l2, () => (t += 1500))
  ipc.handle('eco', (_e: unknown, x: unknown) => x)
  ipc.handle('falla', () => {
    throw new Error('mal')
  })
  const v = await registrados.get('eco')?.({}, 42)
  check('instrumentado: el canal responde lo mismo', v === 42, String(v))
  const error = await registrados.get('falla')?.({}).then(
    () => 'no falló',
    (e: Error) => e.message
  )
  check('instrumentado: el error llega igual', error === 'mal', String(error))
  const lentasEco = l2.tomarLentas()
  check('instrumentado: las dos peticiones se apuntan (y, con 1,5 s, como lentas)', lentasEco.eco?.n === 1 && lentasEco.falla?.n === 1, j(lentasEco))
}

const j = (x: unknown): string => JSON.stringify(x)

async function main(): Promise<void> {
  hr('(1) Activo solo en alpha y con el ajuste')
  {
    const pub = banco('0.76.2')
    const r = new RegistroSalud(pub.deps)
    r.fijarAjuste(true)
    check('pública con ajuste: no graba, sin temporizador ni oyentes', !r.activo && vivos(pub) === 0 && pub.oyentes.actual === null && pub.archivos.size === 0, `activo=${r.activo}`)

    const apagado = banco('0.76.2-alpha.3')
    const r2 = new RegistroSalud(apagado.deps)
    r2.fijarAjuste(false)
    check('alpha con el ajuste apagado: no graba', !r2.activo && vivos(apagado) === 0 && apagado.archivos.size === 0, `activo=${r2.activo}`)

    const al = banco('0.76.2-alpha.3')
    const r3 = new RegistroSalud(al.deps)
    r3.fijarAjuste(true)
    const l = lineas(al)
    check(
      'alpha encendida: escribe el arranque con versión y plataforma y arma UN temporizador de 5 min',
      r3.activo && l.length === 1 && l[0].tipo === 'arranque' && l[0].version === '0.76.2-alpha.3' && l[0].plataforma === 'windows' && vivos(al) === 1 && al.temporizadores[0].ms === 300000,
      JSON.stringify(l[0])
    )
  }

  hr('(2) La muestra')
  {
    const b = banco('0.76.2-alpha.3')
    const r = new RegistroSalud(b.deps)
    r.fijarAjuste(true)
    await r.muestra()
    const m = lineas(b)[1] as Record<string, any>
    check('tipo muestra con marca ISO', m.tipo === 'muestra' && m.t === '2026-10-09T10:00:00.000Z', String(m.tipo))
    check(
      'procesos agrupados: main, ventana (2 Tab sumadas) y gpu, en MB',
      m.procesos.main.mb === 100 && m.procesos.ventana.n === 2 && m.procesos.ventana.mb === 300 && m.procesos.ventana.cpu === 1 && m.procesos.gpu.mb === 50,
      JSON.stringify(m.procesos)
    )
    check('main, ventana y sesiones abiertas', m.main.rssMb === 150 && m.ventana.nodos === 3000 && m.abierto.terminales === 2 && m.abierto.agentes === 1, JSON.stringify({ main: m.main, ventana: m.ventana, abierto: m.abierto }))
    check('la muestra no lleva rutas ni contenido: solo las claves esperadas', Object.keys(m).sort().join(',') === 'abierto,main,procesos,sistema,t,tipo,ventana', Object.keys(m).sort().join(','))
    check('lleva la memoria libre del equipo', m.sistema.libreMb === 6000 && m.sistema.totalMb === 32000, JSON.stringify(m.sistema))
    b.deps.ipcLentas = () => ({ 'git:status': { n: 3, maxMs: 4200 } })
    await r.muestra()
    const m2 = lineas(b)[2] as Record<string, any>
    check('con peticiones lentas desde la anterior, las lleva por canal', m2.ipcLentas['git:status'].n === 3 && m2.ipcLentas['git:status'].maxMs === 4200, JSON.stringify(m2.ipcLentas))
    check('resumirProcesos de nada es {}', Object.keys(resumirProcesos([])).length === 0, '{}')
  }

  hr('(3) El temporizador se re-arma tras cada muestra')
  {
    const b = banco('0.76.2-alpha.3')
    const r = new RegistroSalud(b.deps)
    r.fijarAjuste(true)
    b.temporizadores[0].fn()
    await new Promise((res) => setTimeout(res, 20))
    const muestras = lineas(b).filter((l) => l.tipo === 'muestra').length
    check('al disparar: una muestra y un temporizador nuevo vivo', muestras === 1 && b.temporizadores.filter((t) => t.vivo && t.ms === 300000).length === 1, `muestras=${muestras} vivos=${vivos(b)}`)
  }

  hr('(4) Ventana que no responde')
  {
    const b = banco('0.76.2-alpha.3')
    b.deps.ventana = () => new Promise(() => {})
    const r = new RegistroSalud(b.deps)
    r.fijarAjuste(true)
    const p = r.muestra()
    await new Promise((res) => setTimeout(res, 5))
    const tope = b.temporizadores.find((t) => t.vivo && t.ms === 3000)
    tope?.fn()
    await p
    const m = lineas(b)[1]
    check('con tope de tiempo: la muestra sale con ventana null', tope !== undefined && m.tipo === 'muestra' && m.ventana === null, JSON.stringify(m.ventana))
  }

  hr('(5) Sucesos')
  {
    const b = banco('0.76.2-alpha.3')
    const r = new RegistroSalud(b.deps)
    r.fijarAjuste(true)
    b.oyentes.actual?.suspend()
    b.oyentes.actual?.resume()
    await new Promise((res) => setTimeout(res, 20))
    b.oyentes.actual?.rendererCaido('crashed', 11)
    b.oyentes.actual?.hijoCaido('GPU', 'killed', 9)
    const tipos = lineas(b).map((l) => l.tipo).join(',')
    check('suspend, resume (con muestra inmediata) y las dos caídas', tipos === 'arranque,suspend,resume,muestra,gone,gone', tipos)
    const g = lineas(b).filter((l) => l.tipo === 'gone')
    check('la caída lleva proceso, reason y exitCode', g[0].proceso === 'renderer' && g[1].proceso === 'GPU' && g[1].reason === 'killed' && g[1].exitCode === 9, JSON.stringify(g))
  }

  hr('(6) Rotación a 5 MB')
  {
    const b = banco('0.76.2-alpha.3')
    const r = new RegistroSalud(b.deps)
    r.fijarAjuste(true)
    b.tamanoForzado.valor = TOPE_ARCHIVO_BYTES
    await r.muestra()
    check('al llegar al tope rota a salud.1.jsonl y sigue en salud.jsonl', b.movidos.length === 1 && b.movidos[0][0] === 'logs/salud.jsonl' && b.movidos[0][1] === 'logs/salud.1.jsonl' && lineas(b).length === 1, JSON.stringify(b.movidos))
    const c = banco('0.76.2-alpha.3')
    const r2 = new RegistroSalud(c.deps)
    r2.fijarAjuste(true)
    c.tamanoForzado.valor = TOPE_ARCHIVO_BYTES - 1
    await r2.muestra()
    check('por debajo del tope no rota', c.movidos.length === 0, String(c.movidos.length))
  }

  hr('(7) Apagar quita temporizador y oyentes')
  {
    const b = banco('0.76.2-alpha.3')
    const r = new RegistroSalud(b.deps)
    r.fijarAjuste(true)
    const antes = lineas(b).length
    r.fijarAjuste(false)
    check('apagar por ajuste: ni temporizador vivo ni oyentes', !r.activo && vivos(b) === 0 && b.oyentes.actual === null && b.oyentes.quitados === 1, `vivos=${vivos(b)} quitados=${b.oyentes.quitados}`)
    await r.muestra()
    check('apagado no escribe nada más', lineas(b).length === antes, String(lineas(b).length))
    r.fijarAjuste(true)
    r.detener()
    r.detener()
    check('reencender y detener (dos veces) también limpia', vivos(b) === 0 && b.oyentes.actual === null, `vivos=${vivos(b)}`)
  }

  hr('(8) Un disco que falla no lanza')
  {
    const b = banco('0.76.2-alpha.3')
    b.fallaDisco.activo = true
    const r = new RegistroSalud(b.deps)
    let lanzo = false
    try {
      r.fijarAjuste(true)
      await r.muestra()
      b.oyentes.actual?.suspend()
      b.oyentes.actual?.hijoCaido('GPU', 'killed')
    } catch {
      lanzo = true
    }
    check('encender, muestrear y registrar sucesos con el disco roto no lanza', !lanzo && b.archivos.size === 0, `lanzo=${lanzo}`)
    const c = banco('0.76.2-alpha.3')
    c.deps.metricas = () => {
      throw new Error('boom')
    }
    c.deps.ventana = () => Promise.reject(new Error('boom'))
    const r2 = new RegistroSalud(c.deps)
    r2.fijarAjuste(true)
    await r2.muestra()
    check('si fallan las métricas y la ventana, la muestra sale igual con lo que haya', lineas(c)[1]?.tipo === 'muestra' && lineas(c)[1].ventana === null, JSON.stringify(lineas(c)[1]))
  }

  await bloqueos()
  await desdeLaVentana()
  await llamadas()

  hr('RESULTADO (PASS/FAIL)')
  const ok = results.filter((r) => r.pass).length
  console.log(`VEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

void main()
