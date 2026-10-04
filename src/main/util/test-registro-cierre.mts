#!/usr/bin/env node
// =============================================================================
// Prueba del REGISTRO DEL CIERRE (`registroCierre.ts`) y de su cableado en `iniciarCierre`
// (npm run test:registro-cierre). Cubre el formato de las líneas, `conTope` de `esperas.ts` (a tiempo, pasado el
// tope, fallo relanzado o absorbido, temporizador que no retiene el proceso, valor no promesa),
// el cronómetro (empieza y duración, nota, fallo escrito y RELANZADO, hitos y total), el archivo
// (sin `init` nada; rotación a `.old`; coste de una línea) y el cableado: el orden de las
// llamadas del cierre (con todas sus funciones extraídas) no cambió, cada etapa pasa por el
// cronómetro y las esperas de disco llevan tope. Si la prueba se queda esperando, sale con 1.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conTope, type RelojTope } from './esperas.ts'
import {
  CronometroCierre,
  TOPE_VACIAR_CONSOLAS_MS,
  TOPE_WORKSPACE_MS,
  initLogCierre,
  lineaEtapa,
  lineaLog,
  logCierre,
  mensajeCorto,
  notaTope,
  rutaLogCierre,
  textoProgreso
} from './registroCierre.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

/** Reloj de tope falso: se dispara a mano y apunta lo que se quita. */
function relojFalso(): RelojTope & { disparar(): void; quitados: number; puestos: number } {
  let pendiente: (() => void) | null = null
  const r = {
    quitados: 0,
    puestos: 0,
    poner(fn: () => void): unknown {
      r.puestos++
      pendiente = fn
      return r.puestos
    },
    quitar(): void {
      r.quitados++
      pendiente = null
    },
    disparar(): void {
      const f = pendiente
      pendiente = null
      f?.()
    }
  }
  return r
}

/** Deja correr las microtareas pendientes. */
const vaciarMicro = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function main(): Promise<void> {
  // -------------------------------------------------------------------------------------
  hr('(1) El formato')
  {
    const l = lineaLog(new Date(Date.UTC(2026, 8, 27, 10, 0, 0, 5)), 'docker: 12 ms')
    check('una línea: [hora ISO] mensaje y salto', l === '[2026-09-27T10:00:00.005Z] docker: 12 ms\n', j(l))
    const multi = lineaLog(new Date(0), 'falló: uno\r\n  dos\nTres')
    check('los saltos del mensaje se aplanan: sigue siendo UNA línea', multi.split('\n').length === 2 && multi.includes('uno | dos | Tres'), j(multi))
    check('lineaEtapa sin nota', lineaEtapa('archivos', 1.4) === 'archivos: 1 ms', lineaEtapa('archivos', 1.4))
    check('lineaEtapa con nota', lineaEtapa('docker', 60012.6, 'x') === 'docker: 60013 ms (x)', lineaEtapa('docker', 60012.6, 'x'))
    check('lineaEtapa con nota vacía o null: sin paréntesis', lineaEtapa('a', 0, '') === 'a: 0 ms' && lineaEtapa('a', 0, null) === 'a: 0 ms', lineaEtapa('a', 0, ''))
    const largo = mensajeCorto(new Error('x'.repeat(500)))
    check('mensajeCorto acota a 200 con puntos suspensivos', largo.length === 200 && largo.endsWith('…'), `${largo.length}`)
    check('mensajeCorto de algo que no es Error', mensajeCorto('EPERM\nsegunda') === 'EPERM | segunda', mensajeCorto('EPERM\nsegunda'))
    const p = textoProgreso({ phase: 'unmounting', done: 0, total: 2, label: 'Liberando montajes…' })
    check('textoProgreso', p === '«Liberando montajes…» [unmounting 0/2]', p)
    check('notaTope: nada si llegó, y lo que pasó si no', notaTope(5000)('a-tiempo') === null && notaTope(5000)('tope') === 'TOPE de 5000 ms: se sigue sin esperar', String(notaTope(5000)('tope')))
    check(
      'los topes de disco: 5 s, por encima del plazo del acuse (1 s)',
      TOPE_VACIAR_CONSOLAS_MS === 5000 && TOPE_WORKSPACE_MS === 5000,
      `${TOPE_VACIAR_CONSOLAS_MS}/${TOPE_WORKSPACE_MS}`
    )
  }

  // -------------------------------------------------------------------------------------
  hr('(2) conTope')
  {
    const noAtendidos: unknown[] = []
    const alNoAtendido = (e: unknown): void => {
      noAtendidos.push(e)
    }
    process.on('unhandledRejection', alNoAtendido)

    // Llega a tiempo, y el temporizador se quita.
    const r1 = relojFalso()
    let resolver1: () => void = () => undefined
    const d1 = conTope(new Promise<void>((res) => (resolver1 = res)), 1000, r1)
    resolver1()
    check('llega a tiempo: a-tiempo, y quita su temporizador', (await d1) === 'a-tiempo' && r1.quitados === 1, `${r1.quitados} quitado(s)`)

    // Se pasa del tope: se sigue sin esperar; y el que llega DESPUÉS no cambia nada.
    const r2 = relojFalso()
    let resolver2: () => void = () => undefined
    const d2 = conTope(new Promise<void>((res) => (resolver2 = res)), 1000, r2)
    r2.disparar()
    const v2 = await d2
    resolver2()
    await vaciarMicro()
    check('se pasa del tope: «tope», sin esperar a la promesa', v2 === 'tope', v2)

    // Un fallo A TIEMPO se relanza (el `catch` del cierre lo ve, como antes).
    const r3 = relojFalso()
    const err = new Error('EPERM')
    let visto: unknown = null
    try {
      await conTope(Promise.reject(err), 1000, r3)
    } catch (e) {
      visto = e
    }
    check('un fallo a tiempo se relanza (el MISMO error) y quita el temporizador', visto === err && r3.quitados === 1, String(visto))

    // Un fallo DESPUÉS del tope se absorbe: nadie lo espera y no es un unhandledRejection.
    const r4 = relojFalso()
    let rechazar4: (e: Error) => void = () => undefined
    const d4 = conTope(new Promise<void>((_, rej) => (rechazar4 = rej)), 1000, r4)
    r4.disparar()
    const v4 = await d4
    rechazar4(new Error('tarde'))
    await vaciarMicro()
    await vaciarMicro()
    check('un fallo DESPUÉS del tope no sale como unhandledRejection', v4 === 'tope' && noAtendidos.length === 0, `${v4}, ${noAtendidos.length} sin atender`)

    // El `undefined` de un `ref?.metodo()` sin ref: a tiempo.
    const r5 = relojFalso()
    check('un valor que no es promesa (undefined): a-tiempo', (await conTope(undefined, 1000, r5)) === 'a-tiempo', 'a-tiempo')

    // Con el reloj de verdad: el tope se cumple, y uno que llega no deja temporizador vivo.
    const t0 = performance.now()
    const dReal = await conTope(new Promise(() => undefined), 30)
    const ms = performance.now() - t0
    check('reloj real: una promesa que nunca llega sale por tope (~30 ms)', dReal === 'tope' && ms >= 25 && ms < 1000, `${dReal} en ${Math.round(ms)} ms`)
    const timeouts = (): number => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length
    const antes = timeouts()
    await conTope(Promise.resolve(), 60_000)
    const despues = timeouts()
    check('reloj real: al llegar, no queda el temporizador de 60 s vivo', despues === antes, `${antes} -> ${despues}`)
    process.off('unhandledRejection', alNoAtendido)
  }

  // -------------------------------------------------------------------------------------
  hr('(3) El cronómetro')
  {
    const lineas: string[] = []
    let t = 1000
    const c = new CronometroCierre((m) => lineas.push(m), () => t)
    c.empieza('v1.2.3, pid 42')
    const r = await c.etapa('vaciar-consolas', async () => {
      t += 12
      return 'tope' as const
    }, notaTope(5000))
    check('la etapa devuelve lo que devuelve su función', r === 'tope', r)
    const s = c.sincrona('archivos', () => {
      t += 3
      return 7
    })
    check('la síncrona también', s === 7, String(s))
    const errDisco = new Error('EPERM: operation not permitted')
    let relanzado: unknown = null
    try {
      await c.etapa('workspace-state', async () => {
        t += 5
        throw errDisco
      })
    } catch (e) {
      relanzado = e
    }
    check('un fallo se escribe y se RELANZA el mismo error', relanzado === errDisco, String(relanzado))
    let relanzadoSinc: unknown = null
    try {
      c.sincrona('jar', () => {
        throw new TypeError('x')
      })
    } catch (e) {
      relanzadoSinc = e
    }
    check('y en una síncrona igual (se salta las siguientes, como antes)', relanzadoSinc instanceof TypeError, String(relanzadoSinc))
    await c.etapa('docker', async () => {
      t += 220
      c.hito('docker', textoProgreso({ phase: 'stopping', done: 0, total: 0, label: 'Sin contenedores activos' }))
      t += 60000
      c.hito('docker', textoProgreso({ phase: 'verifying', done: 0, total: 0, label: 'Verificando…' }))
    })
    c.nota('plan de cierre: instalar (origen manual, relanzar sí)')
    c.termina('sale (plan ninguno: estado idle)')
    const esperado = [
      'cierre: empieza (v1.2.3, pid 42)',
      'vaciar-consolas: empieza',
      'vaciar-consolas: 12 ms (TOPE de 5000 ms: se sigue sin esperar)',
      'archivos: 3 ms',
      'workspace-state: empieza',
      'workspace-state: 5 ms (falló: EPERM: operation not permitted)',
      'jar: 0 ms (falló: x)',
      'docker: empieza',
      'docker · «Sin contenedores activos» [stopping 0/0]: +220 ms',
      'docker · «Verificando…» [verifying 0/0]: +60000 ms',
      'docker: 60220 ms',
      'plan de cierre: instalar (origen manual, relanzar sí)',
      'cierre: sale (plan ninguno: estado idle) — total 60240 ms'
    ]
    const distintas = esperado.map((e, i) => (lineas[i] === e ? null : `${i}: ${j(lineas[i])} != ${j(e)}`)).filter((x) => x !== null)
    check('las líneas, en orden y al byte', distintas.length === 0 && lineas.length === esperado.length, distintas.length ? distintas.join(' | ') : `${lineas.length} líneas`)
    check(
      'la etapa que cuelga es la que se queda con «empieza» y sin duración',
      lineas.filter((l) => l.endsWith(': empieza')).every((l) => lineas.some((m) => m.startsWith(l.replace(': empieza', ': ')) && / ms/.test(m))),
      'cada «empieza» tiene su duración aquí'
    )
  }

  // -------------------------------------------------------------------------------------
  hr('(4) El archivo')
  const logOriginal = console.log
  console.log = (): void => undefined // `logCierre` también escribe en la consola: fuera del informe
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-cierre-'))
  try {
    logCierre('antes de init')
    const sinInit = rutaLogCierre() === '' && !existsSync(path.join(dir, 'logs'))
    // Una `userData` que es un ARCHIVO: la carpeta no se puede crear; no lanza y no hay ruta.
    const comoArchivo = path.join(dir, 'soy-un-archivo')
    writeFileSync(comoArchivo, 'x')
    let lanzo = false
    try {
      initLogCierre(comoArchivo)
    } catch {
      lanzo = true
    }
    const rutaImposible = rutaLogCierre()
    const sinRuta = rutaImposible === ''
    logCierre('con la carpeta imposible')

    const userData = path.join(dir, 'userData')
    initLogCierre(userData)
    const ruta = rutaLogCierre()
    logCierre('cierre: empieza (v0.0.0, pid 1)')
    new CronometroCierre().sincrona('archivos', () => undefined)
    const texto = existsSync(ruta) ? readFileSync(ruta, 'utf8') : ''

    // Rotación: un archivo de más de 1 MiB pasa a `.old` al abrir.
    const userData2 = path.join(dir, 'userData2')
    mkdirSync(path.join(userData2, 'logs'), { recursive: true })
    const grande = path.join(userData2, 'logs', 'cierre.log')
    writeFileSync(grande, 'x'.repeat(1024 * 1024 + 1))
    initLogCierre(userData2)
    const rotado = existsSync(grande + '.old') && statSync(grande + '.old').size === 1024 * 1024 + 1 && !existsSync(grande)
    logCierre('tras rotar')
    const trasRotar = readFileSync(grande, 'utf8')

    // Coste: el de las ~25 líneas de un cierre, con margen.
    const N = 50
    const t0 = performance.now()
    for (let i = 0; i < N; i++) logCierre(`linea de prueba ${i}: 12 ms`)
    const total = performance.now() - t0
    console.log = logOriginal
    check('sin init: nada en disco (solo consola)', sinInit, sinInit ? 'sin carpeta logs' : 'escribió')
    check('una userData imposible no lanza y deja el registro apagado', !lanzo && sinRuta, `lanzó=${lanzo} ruta=${j(rutaImposible)}`)
    check('con init: la ruta es userData/logs/cierre.log', ruta === path.join(userData, 'logs', 'cierre.log'), ruta)
    check(
      'las líneas llegan al archivo, con su hora',
      /^\[\d{4}-\d\d-\d\dT[^\]]+Z\] cierre: empieza \(v0\.0\.0, pid 1\)\n\[[^\]]+\] archivos: \d+ ms\n$/.test(texto),
      j(texto)
    )
    check('pasado 1 MiB rota a .old (entero) y empieza uno nuevo', rotado && /tras rotar\n$/.test(trasRotar), `rotado=${rotado} nuevo=${j(trasRotar.slice(0, 60))}`)
    check(
      `el coste: ${N} líneas en menos de 500 ms (un cierre escribe unas 25)`,
      total < 500,
      `${total.toFixed(1)} ms en total, ${(total / N).toFixed(3)} ms por línea`
    )
  } finally {
    console.log = logOriginal
    rmSync(dir, { recursive: true, force: true })
  }

  // -------------------------------------------------------------------------------------
  hr('(5) El cableado en iniciarCierre (main/app/cierre.ts)')
  {
    // Sin `\r`: el checkout de Windows puede traer CRLF, y los patrones de abajo van con `\n`.
    const leerMain = (rel: string): string =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const fuente = leerMain('../app/cierre.ts')
    // El cierre está repartido en funciones del módulo: se reconstruye en ORDEN DE EJECUCIÓN
    // poniendo, delante de cada llamada a una función local, su cuerpo (recursivo).
    const funciones = new Map<string, string>()
    /** Lo que sigue a cada función extraída: tiene que ser otra declaración de nivel superior. */
    const despues = new Map<string, string>()
    for (const m of fuente.matchAll(/^(?:export )?(?:async )?function (\w+)\([\s\S]*?\n\}\n/gm)) {
      funciones.set(m[1], m[0])
      despues.set(m[1], fuente.slice((m.index ?? 0) + m[0].length).split('\n').find((l) => l.trim() !== '') ?? '')
    }
    // Guardia del extractor: solo ve `function` de nivel superior cerradas con `\n}\n`. Una
    // función local escrita como arrow, o un cuerpo cortado por un `}` a columna 0, faltaría del
    // texto reconstruido sin que ninguna aserción de abajo lo notara.
    const declaradas = new Set<string>()
    for (const m of fuente.matchAll(/^(?:export )?(?:async )?function\s*\*?\s*(\w+)/gm)) declaradas.add(m[1])
    for (const m of fuente.matchAll(/^(?:export )?(?:const|let|var) (\w+)\s*(?::[^=\n]+)?=\s*(?:async\b\s*)?(?:function\b|\(|\w+\s*=>)/gm)) {
      declaradas.add(m[1])
    }
    const cuenta = (texto: string, c: string): number => texto.split(c).length - 1
    const sinExtraer = [...declaradas].filter((n) => !funciones.has(n))
    const nivelSuperior = /^(?:$|\/\/|\/\*|export |async |function |const |let |var |type |interface |import |class )/
    const cortadas = [...funciones]
      .filter(([n, cuerpo]) => cuenta(cuerpo, '{') !== cuenta(cuerpo, '}') || !nivelSuperior.test(despues.get(n) ?? ''))
      .map(([n]) => n)
    check(
      'el extractor ve TODAS las funciones locales de cierre.ts, enteras',
      sinExtraer.length === 0 && cortadas.length === 0 && funciones.size === declaradas.size,
      sinExtraer.length || cortadas.length
        ? `sin extraer: ${sinExtraer.join(', ') || '-'}; cortadas: ${cortadas.join(', ') || '-'}`
        : `${funciones.size} funciones: ${[...funciones.keys()].join(', ')}`
    )
    const llamada = new RegExp(`\\b(${[...funciones.keys()].join('|')})\\(`, 'g')
    const expandir = (nombre: string, pila: string[]): string =>
      (funciones.get(nombre) ?? '').replace(llamada, (todo: string, otra: string) =>
        pila.includes(otra) ? todo : `${expandir(otra, [...pila, otra])}\n${todo}`
      )
    const cuerpo = expandir('iniciarCierre', ['iniciarCierre'])
    check('se encuentra iniciarCierre', cuerpo.length > 1000, `${cuerpo.length} caracteres`)
    // Las llamadas de SIEMPRE, en el orden de siempre (el de antes de este cambio).
    const LLAMADAS = [
      'confirmarSalida(',
      'cierreCanceladoAntesDeInstalar()',
      'vaciarConsolas(',
      'flushWorkspaceState()',
      'cerrarTodo(',
      'pararPuente()',
      'refs.archivos?.dispose()',
      'refs.jar?.dispose()',
      'refs.java?.dispose()',
      'refs.comprimidos?.dispose()',
      'refs.busqueda?.dispose()',
      'refs.vigilanteUso?.disposeAll()',
      'refs.vigilanteTurnos?.disposeAll()',
      'refs.agentesNativos?.parar()',
      'stopAutoUpdate()',
      'stopAllContainers(',
      'esperar(450)',
      'planDeCierre()',
      'forceKillPtys()',
      'runInstaller(',
      'openInstallerManually()',
      'reanudarTrasCierreAbortado()',
      'reanudarPuente()',
      'reportInstallAborted()'
    ]
    const pos = LLAMADAS.map((l) => cuerpo.indexOf(l))
    const fuera = LLAMADAS.filter((_, i) => pos[i] < 0 || (i > 0 && pos[i] < pos[i - 1]))
    check('las llamadas de siempre, todas y en su orden', fuera.length === 0, fuera.length ? `fuera de sitio: ${fuera.join(', ')}` : `${LLAMADAS.length} en orden`)
    // Cada etapa pasa por el cronómetro, en ese mismo orden.
    const ETAPAS = [
      "etapa('confirmar-salida'",
      "etapa(\n      'vaciar-consolas'",
      "etapa('workspace-state'",
      "etapa('sesiones-bd'",
      "sincrona('puente-bd'",
      "sincrona('archivos'",
      "sincrona('jar'",
      "sincrona('java'",
      "sincrona('comprimidos'",
      "sincrona('busqueda'",
      "sincrona('uso'",
      "sincrona('turnos'",
      "sincrona('agentes-nativos'",
      "sincrona('auto-update'",
      "etapa('docker'",
      "etapa('pausa-listo'",
      "'forzar-ptys'",
      "etapa('instalador'",
      "etapa('abrir-instalador'"
    ]
    const posE = ETAPAS.map((e) => cuerpo.indexOf(e))
    const malE = ETAPAS.filter((_, i) => posE[i] < 0 || (i > 0 && posE[i] < posE[i - 1]))
    check('cada etapa pasa por el cronómetro, en el mismo orden', malE.length === 0, malE.length ? `faltan o fuera de sitio: ${malE.join(', ')}` : `${ETAPAS.length} etapas`)
    // Cada llamada va DENTRO de su etapa: entre la apertura de la etapa y la siguiente.
    const pares: Array<[string, string]> = [
      ["etapa('confirmar-salida'", 'confirmarSalida('],
      ["'vaciar-consolas'", 'vaciarConsolas('],
      ["etapa('workspace-state'", 'flushWorkspaceState()'],
      ["etapa('sesiones-bd'", 'cerrarTodo('],
      ["etapa('docker'", 'stopAllContainers('],
      ["etapa('pausa-listo'", 'esperar(450)'],
      ["etapa('instalador'", 'runInstaller('],
      ["etapa('abrir-instalador'", 'openInstallerManually()']
    ]
    const sueltas = pares.filter(([e, l]) => {
      const a = cuerpo.indexOf(e)
      const b = cuerpo.indexOf(l, a)
      return a < 0 || b < 0 || b - a > 200
    })
    check('cada llamada asíncrona va dentro de su etapa', sueltas.length === 0, sueltas.length ? sueltas.map(([e]) => e).join(', ') : `${pares.length} pares`)
    check(
      'las dos esperas de disco llevan tope',
      /conTope\(refs\.explorador\?\.vaciarConsolas\(win, ACUSE_VACIADO_MS\), TOPE_VACIAR_CONSOLAS_MS\)/.test(cuerpo) &&
        /conTope\(flushWorkspaceState\(\), TOPE_WORKSPACE_MS\)/.test(cuerpo),
      'vaciarConsolas y flushWorkspaceState'
    )
    check('el progreso de Docker sigue llegando al overlay y deja su hito', /send\(p\)\s*\n\s*cierre\.hito\('docker', textoProgreso\(p\)\)/.test(cuerpo), 'send(p) y luego el hito')
    const arranque = leerMain('../app/arranque.ts')
    const iDb = arranque.indexOf("initDbLog(app.getPath('userData'))")
    const iCierre = arranque.indexOf("initLogCierre(app.getPath('userData'))")
    check('el registro se abre al arrancar, tras el de BD', iDb > 0 && iCierre > iDb && iCierre - iDb < 400, `${iDb} -> ${iCierre}`)
    // Cada `app.exit(0)` con SU «termina» en las tres líneas de antes (contarlos por
    // separado dejaría pasar una salida sin el suyo mientras sobraran de otras salidas).
    const lineasCuerpo = cuerpo.split('\n')
    const salidas = lineasCuerpo.flatMap((l, i) => (l.includes('app.exit(0)') ? [i] : []))
    const sinTermina = salidas.filter((i) => !lineasCuerpo.slice(Math.max(0, i - 3), i).some((l) => l.includes('cierre.termina(')))
    check(
      'cada salida del proceso (app.exit) va precedida de su «termina»',
      salidas.length === 3 && sinTermina.length === 0,
      `${salidas.length} salidas, ${sinTermina.length} sin su «termina»${sinTermina.length ? `: ${sinTermina.map((i) => lineasCuerpo[i].trim()).join(' | ')}` : ''}`
    )
    // Y los desenlaces que NO salen del proceso también cierran el registro: cancelar en
    // el diálogo, el cierre que ya iba por otra vía y el plan C (la app sigue abierta).
    const otrosDesenlaces = ["termina('cancelado en el diálogo de salida')", "termina('el cierre ya estaba en curso por otra vía')", "termina('abortado:"]
    const faltanDesenlaces = otrosDesenlaces.filter((t) => !cuerpo.includes(t))
    check('los desenlaces sin salida también escriben su «termina»', faltanDesenlaces.length === 0, faltanDesenlaces.length ? faltanDesenlaces.join(', ') : `${otrosDesenlaces.length} desenlaces`)
  }

  const pasadas = results.filter((r) => r.pass).length
  const allPass = pasadas === results.length
  hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

// Una prueba COLGADA también es un FAIL (revisión del grupo): una promesa que no llega
// nunca —un `conTope` sin manejador de rechazo, visto con una mutación— deja `main` a
// medias, el bucle de eventos se vacía sin pasar por el `process.exit` del VEREDICTO y
// Node salía con 0, en verde para quien solo mira el código de salida (`correr-tests`, la
// batería). 'beforeExit' solo se emite en ese caso: el final normal sale por
// `process.exit`, que no lo emite.
process.once('beforeExit', () => {
  console.error('[FAIL] la prueba se quedó esperando una promesa que no llegó: sin VEREDICTO')
  process.exit(1)
})

// Un fallo inesperado es un FAIL con su código de salida, no un silencio: (2) escucha
// `unhandledRejection` mientras mide, y con `void main()` un rechazo de `main` se lo
// tragaba ese oyente y el proceso salía con 0 sin VEREDICTO (visto con una mutación).
main().catch((e: unknown) => {
  console.error('[FAIL] la prueba se cortó:', e)
  process.exit(1)
})
