#!/usr/bin/env node
// =============================================================================
// Prueba del cierre por árbol de una sesión de agente nativo
// (`TerminalService.cerrarConArbol`, npm run test:cerrar-arbol), con procesos reales y sin
// Docker. El agente es `agenteFalsoDetener.mjs` en modo N: ignora los `^C` y lanza dos nietos.
// Cubre que mueren el agente y sus nietos SIN teclear nada, que un cierre o un reinicio
// simultáneos esperan y tampoco teclean, que las muertes van de una en una con las paradas,
// que una sesión ya muerta no dispara ningún kill y los rechazos.
// Escrito para las dos plataformas; en macOS queda sin verificar desde Windows.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
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
  id: 'arbolqa',
  nombre: 'ArbolQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/arbolqa/claude' }],
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
async function lanza(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
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
function lineaAgente(modo: 'B' | 'N', registro: string): string {
  const partes = [process.execPath, AGENTE, modo, registro]
  return esWindows() ? '& ' + partes.map(citarPowerShell).join(' ') : partes.map(citarSh).join(' ')
}

interface Registro {
  pids: number[]
  nietos: number[]
  rx: string
  salidas: string[]
}
function leerRegistro(ruta: string): Registro {
  let texto = ''
  try {
    texto = readFileSync(ruta, 'utf8')
  } catch {
    /* aún no existe */
  }
  const reg: Registro = { pids: [], nietos: [], rx: '', salidas: [] }
  for (const linea of texto.split('\n')) {
    const inicio = /^INICIO pid=(\d+)/.exec(linea)
    const nieto = /^NIETO pid=(\d+)/.exec(linea)
    if (inicio) reg.pids.push(Number(inicio[1]))
    else if (nieto) reg.nietos.push(Number(nieto[1]))
    else if (linea.startsWith('RX ')) reg.rx += JSON.parse(linea.slice(3)) as string
    else if (linea.startsWith('SALIDA ')) reg.salidas.push(linea.slice(7))
  }
  return reg
}

/** pids ya vistos muertos: el sistema los reutiliza y uno reciclado no es un superviviente. */
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

/** El servicio con su kill de árbol a la vista, para espiarlo o neutralizarlo. */
type ConArbol = { matarArbol: (record: unknown) => Promise<void> }

interface Lanzada {
  id: string
  registro: string
  datos: string[]
  exits: Array<number | null>
  procesos: () => number[]
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-arbol-'))
  const term = new TerminalService(SANDBOX_FALSO)
  const todos: number[] = []
  let n = 0

  /** Lanza un agente falso y espera a que esté listo, con sus nietos ya apuntados. */
  async function lanzar(modo: 'B' | 'N'): Promise<Lanzada> {
    const registro = path.join(tmp, `agente-${++n}.log`)
    const s = await term.createSession(PERFIL, { project: tmp, host: true, launch: lineaAgente(modo, registro) })
    const datos: string[] = []
    const exits: Array<number | null> = []
    term.onData(s.id, (d) => datos.push(d))
    term.onExit(s.id, (c) => exits.push(c))
    const nietosEsperados = modo === 'N' ? 2 : 0
    await esperarHasta(() => datos.join('').includes('LISTO') && leerRegistro(registro).nietos.length === nietosEsperados, 20000)
    const procesos = (): number[] => {
      const r = leerRegistro(registro)
      return [...r.pids, ...r.nietos]
    }
    todos.push(...procesos())
    return { id: s.id, registro, datos, exits, procesos }
  }
  const muertos = (l: Lanzada): Promise<boolean> => esperarHasta(() => l.procesos().every((p) => !vivo(p)), 5000)

  try {
    // -------------------------------------------------------------------------
    hr('PASO 1 - Mueren el agente y sus dos nietos, y nadie tecleó nada')
    const a = await lanzar('N')
    const regA = leerRegistro(a.registro)
    check(
      '(a0) el agente arranca con un nieto en su consola y otro suelto',
      regA.pids.length === 1 && regA.nietos.length === 2 && a.procesos().every(vivo),
      `agente=${regA.pids} nietos=${regA.nietos}`
    )
    const datosAntes = a.datos.length
    const cierre = term.cerrarConArbol(a.id)
    // Sin ningún `await` por medio: la marca tiene que estar puesta ya.
    const ocupadaYa = term.estaOcupada(a.id)
    const vivaYa = term.estaViva(a.id)
    term.write(a.id, 'tecla-tardia')
    await cierre
    const murieron = await muertos(a)
    await sleep(500) // ventana para un EXIT o unos datos tardíos que no deben llegar
    check('(a1) en el mismo tick de la llamada: ocupada y ya no viva', ocupadaYa && !vivaYa, `estaOcupada=${ocupadaYa} estaViva=${vivaYa}`)
    check(
      '(a2) mueren el agente, el nieto de su consola y el nieto SUELTO',
      murieron,
      a.procesos().map((p) => `${p}:${vivo(p) ? 'vivo' : 'muerto'}`).join(' ')
    )
    const rxA = leerRegistro(a.registro).rx
    check('(a3) el agente no recibió NI UN byte: ni `^C`, ni `exit`, ni la tecla tardía', rxA === '', `rx=${JSON.stringify(rxA)}`)
    check('(a4) no avisa a los exitListeners ni entrega más datos', a.exits.length === 0 && a.datos.length === datosAntes, `exits=${a.exits.length} datos nuevos=${a.datos.length - datosAntes}`)
    check(
      '(a5) la sesión sale del servicio: ni ocupada, ni con pid, ni en la lista',
      !term.estaOcupada(a.id) && term.pidDe(a.id) === null && term.listSessions().every((s) => s.id !== a.id),
      `estaOcupada=${term.estaOcupada(a.id)} pidDe=${term.pidDe(a.id)}`
    )
    const repetir = await lanza(() => term.cerrarConArbol(a.id))
    const cerrarDespues = await lanza(() => term.closeSession(a.id))
    check('(a6) repetir el cierre, o un closeSession posterior, no hacen nada', repetir === null && cerrarDespues === null, `repetir=${repetir} closeSession=${cerrarDespues}`)

    // -------------------------------------------------------------------------
    hr('PASO 2 - Un closeSession simultáneo espera y NO teclea')
    const b = await lanzar('N')
    const cierreB = term.cerrarConArbol(b.id)
    const cerrarB = term.closeSession(b.id)
    const errores = [await lanza(() => cierreB), await lanza(() => cerrarB)]
    const murieronB = await muertos(b)
    const rxB = leerRegistro(b.registro).rx
    check('(b1) los dos terminan sin error y el árbol muere', errores.every((e) => e === null) && murieronB, `errores=${JSON.stringify(errores)} muertos=${murieronB}`)
    check('(b2) el `^C` y el `exit` de closeSession no llegaron al agente', rxB === '', `rx=${JSON.stringify(rxB)}`)

    // -------------------------------------------------------------------------
    hr('PASO 3 - Un reloadSession simultáneo se rechaza y no relanza nada')
    const c = await lanzar('N')
    const cierreC = term.cerrarConArbol(c.id)
    const recarga = await lanza(() => term.reloadSession(c.id))
    await cierreC
    const murieronC = await muertos(c)
    await sleep(500)
    const regC = leerRegistro(c.registro)
    check('(c1) el reinicio lanza en vez de dejar un pty fuera del mapa', recarga !== null, `error=${JSON.stringify(recarga)}`)
    check('(c2) no nació un segundo proceso y nadie tecleó', regC.pids.length === 1 && regC.rx === '' && murieronC, `pids=${regC.pids} rx=${JSON.stringify(regC.rx)}`)

    // -------------------------------------------------------------------------
    hr('PASO 4 - Las muertes van de una en una con las paradas')
    const lento = await lanzar('B') // ignora los `^C`: su parada tarda unos segundos
    const d = await lanzar('N')
    let finParada = 0
    let finCierre = 0
    const parada = term.detenerSesion(lento.id).then(() => (finParada = Date.now()))
    const cierreD = term.cerrarConArbol(d.id).then(() => (finCierre = Date.now()))
    await sleep(700)
    const vivosEnEspera = d.procesos().every(vivo)
    const ocupadaEnEspera = term.estaOcupada(d.id)
    await Promise.all([parada, cierreD])
    const murieronD = await muertos(d)
    check('(d1) mientras dura la parada ajena, el árbol sigue vivo pero la sesión ya está marcada', vivosEnEspera && ocupadaEnEspera, `vivos=${vivosEnEspera} ocupada=${ocupadaEnEspera}`)
    check('(d2) el cierre termina DESPUÉS de la parada que iba delante', finParada > 0 && finCierre >= finParada && murieronD, `parada=${finParada} cierre=${finCierre}`)
    check('(d3) y tampoco aquí recibió nada el agente', leerRegistro(d.registro).rx === '', `rx=${JSON.stringify(leerRegistro(d.registro).rx)}`)
    await term.closeSession(lento.id)

    // -------------------------------------------------------------------------
    hr('PASO 5 - Una sesión que ya salió por su cuenta no dispara ningún kill')
    const e = await lanzar('B')
    term.write(e.id, 'Q')
    await esperarHasta(() => e.exits.length > 0, 10000)
    const espia = term as unknown as ConArbol
    const original = espia.matarArbol
    let llamadas = 0
    espia.matarArbol = async () => {
      llamadas++
    }
    const cierreE = await lanza(() => term.cerrarConArbol(e.id))
    espia.matarArbol = original
    check(
      '(e1) con el proceso ya muerto no se mata ningún árbol (su pid puede ser de otro)',
      cierreE === null && llamadas === 0 && e.exits.length === 1,
      `error=${cierreE} llamadas=${llamadas}`
    )
    check('(e2) y la sesión sale igualmente del servicio', term.pidDe(e.id) === null && !term.estaOcupada(e.id), `estaOcupada=${term.estaOcupada(e.id)}`)

    // -------------------------------------------------------------------------
    hr('PASO 6 - Rechazos: lo que no es un agente nativo o está a mitad de otra cosa')
    const shell = await term.createSession(PERFIL, { project: tmp, host: true })
    const noAgente = await lanza(() => term.cerrarConArbol(shell.id))
    check('(f1) una shell interactiva se rechaza y sigue viva', noAgente !== null && term.estaViva(shell.id), `error=${JSON.stringify(noAgente)}`)
    await term.closeSession(shell.id)
    const f = await lanzar('B')
    const paradaF = term.detenerSesion(f.id)
    const enParada = await lanza(() => term.cerrarConArbol(f.id))
    await paradaF
    check('(f2) una sesión a mitad de una parada se rechaza', enParada !== null, `error=${JSON.stringify(enParada)}`)
    const yaParada = await lanza(() => term.cerrarConArbol(f.id))
    check('(f3) una sesión PARADA (a la espera de relanzarse) sí se puede cerrar, sin kill', yaParada === null && term.pidDe(f.id) === null && !term.estaOcupada(f.id), `error=${yaParada}`)
    const desconocida = await lanza(() => term.cerrarConArbol('no-existe'))
    check('(f4) un id desconocido no hace nada ni lanza', desconocida === null, `error=${desconocida}`)
  } finally {
    for (const s of term.listSessions()) await term.closeSession(s.id)
    // Red de seguridad: ningún agente falso ni ningún nieto debe sobrevivir a la prueba.
    const huerfanos = todos.filter((pid) => pid > 0 && vivo(pid))
    for (const pid of huerfanos) {
      try {
        process.kill(pid)
      } catch {
        /* ya muerto */
      }
    }
    check('(limpieza) sin sesiones vivas ni procesos huérfanos', term.listSessions().length === 0 && huerfanos.length === 0, `huérfanos=${JSON.stringify(huerfanos)}`)
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* la carpeta temporal la recoge el sistema */
    }
  }

  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
