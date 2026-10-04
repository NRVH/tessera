#!/usr/bin/env node
// =============================================================================
// Prueba de la parada de una sesión de agente nativo (`TerminalService.detenerSesion`), con
// procesos reales y sin Docker.
// (node src/main/terminals/test-detener-sesion.mts) El agente es `agenteFalsoDetener.mjs`, lanzado
// por la shell nativa real.
// Cubre la salida elegante y la forzada, que la parada no avise a los exitListeners ni deje pasar
// un `exit`, que la sesión se pueda relanzar y cerrar, que se rechacen las sesiones que no toca y
// que dos paradas simultáneas vayan de una en una.
// Escrito para las dos plataformas; en macOS queda sin verificar desde Windows.
// =============================================================================

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TerminalService } from './TerminalService.ts'
import type { SandboxManager } from '../sandbox/SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'
import { esWindows } from '../../shared/plataforma.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const AGENTE = path.join(MODULE_DIR, 'agenteFalsoDetener.mjs')

const PERFIL: Profile = {
  id: 'detenerqa',
  nombre: 'DetenerQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/detenerqa/claude' }],
  sandbox: { habilitado: false }
}

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
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const limite = Date.now() + ms
  while (!cond()) {
    if (Date.now() > limite) return false
    await sleep(50)
  }
  return true
}

/** Sandbox que no debe tocarse: una sesión nativa no tiene contenedor. */
const SANDBOX_FALSO = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`una sesión nativa no debe tocar el sandbox (pidió ${String(prop)})`)
    }
  }
) as unknown as SandboxManager

/** Línea de arranque del agente falso para la shell nativa de ESTA plataforma. */
function lineaAgente(modo: 'A' | 'B', registro: string): string {
  const partes = [process.execPath, AGENTE, modo, registro]
  return esWindows()
    ? '& ' + partes.map(citarPowerShell).join(' ')
    : partes.map(citarSh).join(' ')
}

interface Registro {
  pids: number[]
  rx: string
  salidas: string[]
  /** Hora (reloj de pared del agente) de la PRIMERA salida por su cuenta; null si no salió. */
  msSalida: number | null
  /** Hora del primer trozo recibido que traía un `^C`; null si no le llegó ninguno. */
  msPrimerCtrlC: number | null
}
function leerRegistro(ruta: string): Registro {
  let texto = ''
  try {
    texto = readFileSync(ruta, 'utf8')
  } catch {
    /* aún no existe */
  }
  const reg: Registro = { pids: [], rx: '', salidas: [], msSalida: null, msPrimerCtrlC: null }
  for (const linea of texto.split('\n')) {
    const inicio = /^INICIO pid=(\d+)/.exec(linea)
    const tiempo = /^TIEMPO (\d+) (.*)$/.exec(linea)
    if (inicio) reg.pids.push(Number(inicio[1]))
    else if (linea.startsWith('RX ')) reg.rx += JSON.parse(linea.slice(3)) as string
    else if (linea.startsWith('SALIDA ')) reg.salidas.push(linea.slice(7))
    else if (tiempo) {
      // La gemela con hora que el agente falso escribe detrás de cada evento.
      const ms = Number(tiempo[1])
      const evento = tiempo[2]
      if (evento.startsWith('SALIDA ') && reg.msSalida === null) reg.msSalida = ms
      else if (evento.startsWith('RX ') && reg.msPrimerCtrlC === null && contarCtrlC(JSON.parse(evento.slice(3)) as string) > 0) {
        reg.msPrimerCtrlC = ms
      }
    }
  }
  return reg
}

/**
 * pids que ya se vieron MUERTOS. Un proceso no resucita: si ese número vuelve a
 * responder, es el sistema que se lo ha dado a otro. Windows reutiliza pids en cuestión
 * de segundos, y costó un falso «huérfano» en la limpieza (1 de cada ~20 pasadas): el
 * agente de la primera parada del PASO 5, muerto ~1,5 s antes, «seguía vivo»; y la
 * limpieza, además de fallar, le habría mandado un kill a ese proceso ajeno.
 */
const pidsVistosMuertos = new Set<number>()
function vivo(pid: number): boolean {
  if (pidsVistosMuertos.has(pid)) return false
  let responde: boolean
  try {
    process.kill(pid, 0)
    responde = true
  } catch (err) {
    responde = (err as NodeJS.ErrnoException).code === 'EPERM'
  }
  if (!responde) pidsVistosMuertos.add(pid)
  return responde
}

function contarCtrlC(texto: string): number {
  return [...texto].filter((c) => c === String.fromCharCode(3)).length
}

/** Datos recibidos por un listener, etiquetados con la fase en que llegaron. */
interface Trozo {
  fase: string
  data: string
}
function textoDe(trozos: Trozo[], filtro?: (fase: string) => boolean): string {
  return trozos
    .filter((t) => !filtro || filtro(t.fase))
    .map((t) => t.data)
    .join('')
}

async function lanza(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-detener-'))
  const term = new TerminalService(SANDBOX_FALSO)
  const pidsAgente: number[] = []

  try {
    // -------------------------------------------------------------------------
    hr('PASO 1 - Variante A: el agente sale con el segundo ^C (cierre elegante)')
    const regA = path.join(tmp, 'agente-a.log')
    const a = await term.createSession(PERFIL, {
      project: tmp,
      host: true,
      launch: lineaAgente('A', regA)
    })
    const idA = a.id
    let faseA = 'arranque'
    const datosA: Trozo[] = []
    term.onData(idA, (data) => datosA.push({ fase: faseA, data }))
    const exitsA: Array<{ fase: string; code: number | null }> = []
    term.onExit(idA, (code) => exitsA.push({ fase: faseA, code }))

    const listoA = await esperarHasta(() => textoDe(datosA).includes('LISTO'), 20000)
    pidsAgente.push(...leerRegistro(regA).pids)
    check(
      '(a0) el agente falso arranca con la tty en crudo',
      listoA,
      listoA
        ? `LISTO recibido; registro=${JSON.stringify(leerRegistro(regA))}`
        : `sin LISTO; salida=${JSON.stringify(textoDe(datosA).slice(-300))}`
    )
    const pidA1 = term.pidDe(idA)
    check(
      '(a1) antes de parar: viva, no ocupada y con pid',
      term.estaViva(idA) && !term.estaOcupada(idA) && pidA1 !== null,
      `estaViva=${term.estaViva(idA)} estaOcupada=${term.estaOcupada(idA)} pidDe=${pidA1}`
    )

    faseA = 'parada'
    const t0 = Date.now()
    const enVuelo = term.detenerSesion(idA)
    const vivaEnVuelo = term.estaViva(idA)
    const ocupadaEnVuelo = term.estaOcupada(idA)
    const segundo = await lanza(() => term.detenerSesion(idA))
    const rA = await enVuelo
    const msA = Date.now() - t0
    faseA = 'tras-parada'
    await sleep(800) // ventana para un EXIT o unos datos tardíos que no deben llegar

    check(
      '(a2) elegante: true (salió con los ^C, sin kill)',
      rA.elegante === true,
      `resultado=${JSON.stringify(rA)} en ${msA} ms`
    )
    check(
      '(a3) durante la parada: no viva, ocupada, y un segundo detenerSesion LANZA',
      !vivaEnVuelo && ocupadaEnVuelo && segundo !== null,
      `estaViva=${vivaEnVuelo} estaOcupada=${ocupadaEnVuelo} segundo=${JSON.stringify(segundo)}`
    )
    check(
      '(a4) la parada NO dispara ningún exitListener',
      exitsA.length === 0,
      `eventos=${JSON.stringify(exitsA)}`
    )
    const durante = textoDe(datosA, (f) => f === 'parada' || f === 'tras-parada')
    check(
      '(a5) nada de lo que pinta el agente durante la parada llega a los listeners',
      durante === '',
      `datos durante/tras la parada=${JSON.stringify(durante.slice(0, 200))}`
    )
    const regA1 = leerRegistro(regA)
    const ctrlCA = contarCtrlC(regA1.rx)
    check(
      '(a6) el agente salió POR SU CUENTA con el segundo ^C (y no recibió más de tres)',
      regA1.salidas.includes('CTRL-C') && ctrlCA >= 2 && ctrlCA <= 3,
      `salidas=${JSON.stringify(regA1.salidas)} ^C recibidos=${ctrlCA}`
    )
    check(
      '(a7) tras la parada: ni viva ni con pid, sigue ocupada (parada) y fuera de listSessions',
      !term.estaViva(idA) &&
        term.estaOcupada(idA) &&
        term.pidDe(idA) === null &&
        term.listSessions().every((s) => s.id !== idA),
      `estaViva=${term.estaViva(idA)} estaOcupada=${term.estaOcupada(idA)} pidDe=${term.pidDe(idA)}`
    )
    const sobreParada = await lanza(() => term.detenerSesion(idA))
    check(
      '(a8) detenerSesion sobre una sesión YA parada lanza',
      sobreParada !== null,
      `error=${JSON.stringify(sobreParada)}`
    )

    // -------------------------------------------------------------------------
    hr('PASO 2 - reloadSession tras la parada: proceso NUEVO, y SU salida real sí avisa')
    faseA = 'relanzada'
    const rel = await term.reloadSession(idA)
    const pidA2 = term.pidDe(idA)
    check(
      '(r1) mismo id, pid de pty DISTINTO, viva y ya no ocupada',
      rel.id === idA && pidA2 !== null && pidA2 !== pidA1 && term.estaViva(idA) && !term.estaOcupada(idA),
      `id=${rel.id} pid antes=${pidA1} después=${pidA2} ` +
        `estaViva=${term.estaViva(idA)} estaOcupada=${term.estaOcupada(idA)}`
    )
    const listoA2 = await esperarHasta(
      () => textoDe(datosA, (f) => f === 'relanzada').includes('LISTO'),
      20000
    )
    const regA2 = leerRegistro(regA)
    pidsAgente.push(...regA2.pids)
    check(
      '(r2) el proceso nuevo arranca y su salida SÍ llega a los listeners',
      listoA2 && regA2.pids.length === 2 && regA2.pids[0] !== regA2.pids[1],
      `LISTO=${listoA2} pids del agente=${JSON.stringify(regA2.pids)}`
    )
    faseA = 'salida-real'
    term.write(idA, 'Q')
    await esperarHasta(() => exitsA.length > 0, 10000)
    await sleep(300)
    check(
      '(r3) la salida REAL del proceso relanzado avisa a los exitListeners, UNA vez',
      exitsA.length === 1 && exitsA[0].fase === 'salida-real',
      `eventos=${JSON.stringify(exitsA)}`
    )
    const regA3 = leerRegistro(regA)
    check(
      '(r4) el agente NUNCA recibió los bytes `exit` (en ninguno de sus dos procesos)',
      !regA3.rx.includes('exit') && regA3.salidas.includes('Q'),
      `rx=${JSON.stringify(regA3.rx)} salidas=${JSON.stringify(regA3.salidas)}`
    )
    await term.closeSession(idA)

    // -------------------------------------------------------------------------
    hr('PASO 3 - Variante B: el agente ignora ^C (kill de reserva)')
    const regB = path.join(tmp, 'agente-b.log')
    const b = await term.createSession(PERFIL, {
      project: tmp,
      host: true,
      launch: lineaAgente('B', regB)
    })
    const idB = b.id
    let faseB = 'arranque'
    const datosB: Trozo[] = []
    term.onData(idB, (data) => datosB.push({ fase: faseB, data }))
    const exitsB: Array<{ fase: string; code: number | null }> = []
    term.onExit(idB, (code) => exitsB.push({ fase: faseB, code }))
    const listoB = await esperarHasta(() => textoDe(datosB).includes('LISTO'), 20000)
    const pidAgenteB = leerRegistro(regB).pids[0] ?? -1
    pidsAgente.push(pidAgenteB)
    check('(b0) el agente B arranca', listoB && pidAgenteB > 0, `LISTO=${listoB} pid del agente=${pidAgenteB}`)

    faseB = 'parada'
    const t1 = Date.now()
    const rB = await term.detenerSesion(idB)
    const msB = Date.now() - t1
    faseB = 'tras-parada'
    const agenteMuerto = await esperarHasta(() => !vivo(pidAgenteB), 3000)
    await sleep(500)

    check(
      '(b1) elegante: false (hizo falta el kill de reserva)',
      rB.elegante === false,
      `resultado=${JSON.stringify(rB)} en ${msB} ms`
    )
    check(
      '(b2) el proceso del AGENTE está muerto, no sólo la shell (árbol entero)',
      agenteMuerto,
      `pid ${pidAgenteB} vivo=${vivo(pidAgenteB)}`
    )
    check('(b3) la parada NO dispara ningún exitListener', exitsB.length === 0, `eventos=${JSON.stringify(exitsB)}`)
    const duranteB = textoDe(datosB, (f) => f !== 'arranque')
    check(
      '(b4) los avisos del agente a los ^C no llegan a los listeners',
      duranteB === '',
      `datos=${JSON.stringify(duranteB.slice(0, 200))}`
    )
    const regB1 = leerRegistro(regB)
    check(
      '(b5) recibió los tres ^C, nunca `exit`, y no salió por su cuenta',
      contarCtrlC(regB1.rx) === 3 && !regB1.rx.includes('exit') && regB1.salidas.length === 0,
      `^C=${contarCtrlC(regB1.rx)} rx=${JSON.stringify(regB1.rx)} salidas=${JSON.stringify(regB1.salidas)}`
    )
    const t2 = Date.now()
    await term.closeSession(idB)
    const msCierre = Date.now() - t2
    check(
      '(c1) closeSession tras la parada vuelve enseguida (no espera un onExit)',
      msCierre < 500 && !term.estaViva(idB) && !term.estaOcupada(idB) && term.pidDe(idB) === null,
      `closeSession en ${msCierre} ms; tras cerrar estaViva=${term.estaViva(idB)} estaOcupada=${term.estaOcupada(idB)}`
    )

    // -------------------------------------------------------------------------
    hr('PASO 4 - Mitad negativa: la shell interactiva nativa (sin launch) no se detiene')
    const sh = await term.createSession(PERFIL, { project: tmp, host: true })
    let salidaSh = ''
    term.onData(sh.id, (data) => {
      salidaSh += data
    })
    const exitsSh: Array<number | null> = []
    term.onExit(sh.id, (code) => exitsSh.push(code))
    await esperarHasta(() => salidaSh.length > 0, 20000)
    await sleep(1500) // que el perfil del usuario termine de cargar antes de teclear

    const errSh = await lanza(() => term.detenerSesion(sh.id))
    check(
      '(n1) detenerSesion LANZA con una shell sin launch, y la sesión sigue viva y libre',
      errSh !== null && term.estaViva(sh.id) && !term.estaOcupada(sh.id),
      `error=${JSON.stringify(errSh)} estaViva=${term.estaViva(sh.id)} estaOcupada=${term.estaOcupada(sh.id)}`
    )
    // El comando NO contiene la marca literal, sólo su resultado: así el eco de lo
    // tecleado no puede pasar por la respuesta.
    const orden = esWindows() ? "Write-Output ('MARCA' + '-VIVA')\r" : 'echo "MARCA""-VIVA"\r'
    term.write(sh.id, orden)
    const responde = await esperarHasta(() => salidaSh.includes('MARCA-VIVA'), 15000)
    check(
      '(n2) …y sigue respondiendo (no se le mandó ningún ^C)',
      responde && exitsSh.length === 0,
      `respuesta=${responde} exits=${JSON.stringify(exitsSh)}`
    )
    const errDesconocida = await lanza(() => term.detenerSesion('term-no-existe-1'))
    check('(n3) un id desconocido lanza', errDesconocida !== null, `error=${JSON.stringify(errDesconocida)}`)
    await term.closeSession(sh.id)

    // -------------------------------------------------------------------------
    hr('PASO 5 - Dos paradas pedidas A LA VEZ: comprobaciones síncronas, gestos de uno en uno')
    // Regresión del 0xC0000005 de node-pty en Windows: varios ptys muriendo en el mismo
    // milisegundo tumbaban el main (ver «DE UNA EN UNA» en `detenerSesion`). No se
    // provoca el crash —sería una prueba que tumba el proceso una de cada tres veces—:
    // se comprueba lo que lo evita, que el gesto de la segunda no empieza hasta que la
    // primera ha salido. Las horas salen de las gemelas `TIEMPO` del agente falso.
    const regS1 = path.join(tmp, 'agente-s1.log')
    const regS2 = path.join(tmp, 'agente-s2.log')
    const s1 = await term.createSession(PERFIL, { project: tmp, host: true, launch: lineaAgente('A', regS1) })
    const s2 = await term.createSession(PERFIL, { project: tmp, host: true, launch: lineaAgente('A', regS2) })
    let faseS = 'arranque'
    const datosS1: Trozo[] = []
    const datosS2: Trozo[] = []
    term.onData(s1.id, (data) => datosS1.push({ fase: faseS, data }))
    term.onData(s2.id, (data) => datosS2.push({ fase: faseS, data }))
    const exitsS: string[] = []
    term.onExit(s1.id, () => exitsS.push(`${s1.id}@${faseS}`))
    term.onExit(s2.id, () => exitsS.push(`${s2.id}@${faseS}`))
    const listosS = await esperarHasta(
      () => textoDe(datosS1).includes('LISTO') && textoDe(datosS2).includes('LISTO'),
      20000
    )
    const pidAgenteS1 = leerRegistro(regS1).pids[0] ?? -1
    const pidAgenteS2 = leerRegistro(regS2).pids[0] ?? -1
    pidsAgente.push(pidAgenteS1, pidAgenteS2)
    check(
      '(s0) los dos agentes arrancan',
      listosS && pidAgenteS1 > 0 && pidAgenteS2 > 0,
      `LISTO=${listosS} pids del agente=${JSON.stringify([pidAgenteS1, pidAgenteS2])}`
    )

    // ¿Está el agente muerto en cuanto SU parada resuelve? Se mira en el `.then`, a
    // milisegundos de soltar el turno: así además queda anotado como muerto antes de que
    // el sistema pueda reutilizar su pid (ver `pidsVistosMuertos`).
    const muertoAlResolver = new Map<string, boolean>()
    const parar = (id: string, pidAgente: number): Promise<{ elegante: boolean }> =>
      term.detenerSesion(id).then((r) => {
        muertoAlResolver.set(id, !vivo(pidAgente))
        return r
      })

    // Las TRES llamadas en el mismo tick, sin un solo await entre ellas: las dos
    // paradas y una segunda sobre la primera. `parar` y `lanza` llaman a
    // `detenerSesion` en síncrono.
    faseS = 'parada'
    const t3 = Date.now()
    const ambas = Promise.all([parar(s1.id, pidAgenteS1), parar(s2.id, pidAgenteS2)])
    const repetida = lanza(() => term.detenerSesion(s1.id))
    const ocupadasYa = term.estaOcupada(s1.id) && term.estaOcupada(s2.id)
    const vivasYa = term.estaViva(s1.id) || term.estaViva(s2.id)
    const [errRepetida, [rS1, rS2]] = await Promise.all([repetida, ambas])
    const msS = Date.now() - t3
    faseS = 'tras-parada'
    await sleep(500) // ventana para un EXIT tardío que no debe llegar

    check(
      '(s1) las dos paradas salen elegantes (sin kill)',
      rS1.elegante === true && rS2.elegante === true,
      `s1=${JSON.stringify(rS1)} s2=${JSON.stringify(rS2)} en ${msS} ms`
    )
    const regS1b = leerRegistro(regS1)
    const regS2b = leerRegistro(regS2)
    const hueco =
      regS1b.msSalida !== null && regS2b.msPrimerCtrlC !== null ? regS2b.msPrimerCtrlC - regS1b.msSalida : null
    check(
      '(s2) el primer ^C de la segunda llega DESPUÉS de que la primera saliera (no se solapan)',
      regS1b.salidas.includes('CTRL-C') && regS2b.salidas.includes('CTRL-C') && hueco !== null && hueco > 0,
      `salida de la 1.ª=${regS1b.msSalida} primer ^C de la 2.ª=${regS2b.msPrimerCtrlC} ` +
        `hueco=${hueco} ms; primer ^C de la 1.ª=${regS1b.msPrimerCtrlC} ` +
        `salidas=${JSON.stringify([regS1b.salidas, regS2b.salidas])}`
    )
    check(
      '(s3) las comprobaciones son SÍNCRONAS: la segunda llamada sobre la primera, antes de ningún await, LANZA «ya parada»',
      errRepetida !== null && errRepetida.includes('ya está parada'),
      `error=${JSON.stringify(errRepetida)}`
    )
    check(
      '(s4) …y el lote se marca entero en el mismo tick: las dos ocupadas y ninguna viva, aunque la segunda espere turno',
      ocupadasYa && !vivasYa,
      `ocupadas=${ocupadasYa} alguna viva=${vivasYa}`
    )
    check(
      '(s5) ninguna de las dos paradas dispara un exitListener, ni pinta nada en los listeners',
      exitsS.length === 0 &&
        textoDe(datosS1, (f) => f !== 'arranque') === '' &&
        textoDe(datosS2, (f) => f !== 'arranque') === '',
      `exits=${JSON.stringify(exitsS)}`
    )
    check(
      '(s6) cada agente está muerto en cuanto su parada resuelve (el turno se suelta con él ya fuera)',
      muertoAlResolver.get(s1.id) === true && muertoAlResolver.get(s2.id) === true,
      `muerto al resolver=${JSON.stringify(Object.fromEntries(muertoAlResolver))}`
    )
    await term.closeSession(s1.id)
    await term.closeSession(s2.id)
  } finally {
    hr('LIMPIEZA')
    for (const s of term.listSessions()) await term.closeSession(s.id)
    // Red de seguridad: ningún agente falso debe sobrevivir a la prueba.
    const huerfanos = pidsAgente.filter((pid) => pid > 0 && vivo(pid))
    for (const pid of huerfanos) {
      try {
        process.kill(pid)
      } catch {
        /* ya muerto */
      }
    }
    check(
      '(limpieza) sin sesiones vivas ni agentes huérfanos',
      term.listSessions().length === 0 && huerfanos.length === 0,
      `huérfanos=${JSON.stringify(huerfanos)}`
    )
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* la carpeta temporal la recoge el sistema */
    }
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

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
