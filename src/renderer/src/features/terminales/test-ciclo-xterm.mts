#!/usr/bin/env node
// =============================================================================
// Prueba del ciclo de vida del xterm común a la terminal de shell y a la del agente
// (node src/renderer/src/features/terminales/test-ciclo-xterm.mts): el filtro por sesión
// de `conectarSesion`, el orden del desmontaje (despausar el pty antes de cerrar), el
// WebGL que se devuelve al desechar y la tabla de atajos en las dos plataformas.
// =============================================================================

import { conectarSesion, desmontarXterm, type CanalPty, type RefsXterm } from './sesionXterm.ts'
import { crearManejadorAtajos } from './atajosTerminal.ts'
import { desecharWebgl } from '../../util/gpuRenderer.ts'

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

// --- Dobles ------------------------------------------------------------------

interface Salida {
  sessionId: string
  exitCode: number
}

/** Canal falso que apunta en `log` lo que se le pide y deja emitir datos y fines. */
function canalFalso(log: string[]): CanalPty<Salida> & { datos: (id: string, d: string) => void; fin: (id: string) => void; oyentes: () => number } {
  let alDato: ((m: { sessionId: string; data: string }) => void) | null = null
  let alFin: ((m: Salida) => void) | null = null
  return {
    setFlow: (m) => log.push(`setFlow:${m.sessionId}:${m.paused}`),
    write: (m) => log.push(`write:${m.sessionId}:${m.data}`),
    onData: (cb) => {
      alDato = cb
      return () => {
        alDato = null
      }
    },
    onExit: (cb) => {
      alFin = cb
      return () => {
        alFin = null
      }
    },
    datos: (id, d) => alDato?.({ sessionId: id, data: d }),
    fin: (id) => alFin?.({ sessionId: id, exitCode: 3 }),
    oyentes: () => (alDato ? 1 : 0) + (alFin ? 1 : 0)
  }
}

/** Xterm falso: guarda lo escrito y NO llama al callback de `write` (pty que no drena). */
function xtermFalso(log: string[]): {
  write: (d: string, cb?: () => void) => void
  onData: (cb: (d: string) => void) => { dispose: () => void }
  teclear: (d: string) => void
  dispose: () => void
  escrito: string[]
} {
  let teclado: ((d: string) => void) | null = null
  const escrito: string[] = []
  return {
    write: (d) => escrito.push(d),
    onData: (cb) => {
      teclado = cb
      return { dispose: () => (teclado = null) }
    },
    teclear: (d) => teclado?.(d),
    dispose: () => log.push('term.dispose'),
    escrito
  }
}

/** Lienzo WebGL falso que apunta cuándo devuelve su contexto. */
function lienzoFalso(log: string[], n: number): HTMLCanvasElement {
  return {
    getContext: (tipo: string) =>
      tipo === 'webgl2' ? { getExtension: () => ({ loseContext: () => log.push(`loseContext:${n}`) }) } : null
  } as unknown as HTMLCanvasElement
}

function hostFalso(log: string[], lienzos: HTMLCanvasElement[]): HTMLDivElement {
  return {
    querySelectorAll: () => {
      log.push('querySelectorAll')
      return lienzos
    }
  } as unknown as HTMLDivElement
}

function refsFalsas(conWebgl: boolean): RefsXterm {
  return {
    host: { current: null },
    term: { current: {} as never },
    fit: { current: {} as never },
    search: { current: {} as never },
    webgl: { current: conWebgl ? ({} as never) : null },
    flow: { current: null },
    resizeTimer: { current: setTimeout(() => {}, 60_000) },
    appearance: { current: {} as never },
    accent: { current: null }
  }
}

// --- Pruebas -----------------------------------------------------------------

hr('(1) conectarSesion filtra por la sesión del momento')
{
  const log: string[] = []
  const canal = canalFalso(log)
  const term = xtermFalso(log)
  const refs = refsFalsas(false)
  let id: string | null = null
  const fines: Salida[] = []
  const { flow, desconectar } = conectarSesion(term, refs, canal, () => id, (m) => fines.push(m))
  check('deja el escritor en refs.flow', refs.flow.current === flow, 'refs.flow === flow')
  canal.datos('s1', 'antes')
  term.teclear('x')
  check('sin sesión: ni salida ni teclado', term.escrito.length === 0 && log.length === 0, JSON.stringify(log))
  id = 's1'
  canal.datos('s2', 'ajena')
  canal.datos('s1', 'nuestra')
  check('solo escribe la salida de NUESTRA sesión', term.escrito.join('|') === 'nuestra', term.escrito.join('|'))
  term.teclear('ls\r')
  check('el teclado va a nuestra sesión', log.includes('write:s1:ls\r'), JSON.stringify(log))
  canal.fin('s2')
  check('el fin de otra sesión no se atiende', fines.length === 0, `fines=${fines.length}`)
  canal.fin('s1')
  check('el fin de la nuestra llega a alSalir', fines.length === 1 && fines[0].exitCode === 3, JSON.stringify(fines))
  canal.datos('s1', 'x'.repeat(1_000_001))
  check('la contrapresión pausa el pty de nuestra sesión', log.includes('setFlow:s1:true'), JSON.stringify(log.slice(-1)))
  desconectar()
  term.teclear('y')
  check('desconectar retira salida, fin y teclado', canal.oyentes() === 0 && !log.includes('write:s1:y'), `oyentes=${canal.oyentes()}`)
  flow.reset()
}

hr('(2) desmontarXterm: despausa antes de cerrar, vacía refs antes de cerrar y suelta el WebGL')
{
  const log: string[] = []
  const canal = canalFalso(log)
  const term = xtermFalso(log)
  const refs = refsFalsas(true)
  let id: string | null = 's1'
  const { flow, desconectar } = conectarSesion(term, refs, canal, () => id, () => {})
  canal.datos('s1', 'x'.repeat(1_000_001)) // pty pausado: xterm no drenó
  desconectar()
  log.length = 0
  let termEnCierre: unknown = 'sin llamar'
  const host = hostFalso(log, [lienzoFalso(log, 1), lienzoFalso(log, 2)])
  desmontarXterm(host, term, flow, refs, () => {
    termEnCierre = refs.term.current
    log.push(`cerrar:${id}`)
    id = null
  })
  const orden = log.join(' > ')
  check(
    'reanuda el pty ANTES de cerrar la sesión, en la terminal de shell también',
    log.indexOf('setFlow:s1:false') !== -1 && log.indexOf('setFlow:s1:false') < log.indexOf('cerrar:s1'),
    orden
  )
  check('refs.term ya es null cuando se cierra (un open en vuelo lo detecta)', termEnCierre === null, String(termEnCierre))
  check(
    'lienzos recogidos antes de desechar y contextos devueltos después',
    log.indexOf('querySelectorAll') < log.indexOf('term.dispose') &&
      log.indexOf('term.dispose') < log.indexOf('loseContext:1') &&
      log.includes('loseContext:2'),
    orden
  )
  check(
    'refs vacías y temporizador cancelado',
    refs.fit.current === null && refs.search.current === null && refs.webgl.current === null &&
      refs.flow.current === null && refs.resizeTimer.current === null,
    'fit/search/webgl/flow/resizeTimer = null'
  )
}
{
  const log: string[] = []
  const term = xtermFalso(log)
  const refs = refsFalsas(false)
  const { flow } = conectarSesion(term, refs, canalFalso(log), () => null, () => {})
  desmontarXterm(hostFalso(log, [lienzoFalso(log, 1)]), term, flow, refs, () => log.push('cerrar'))
  check('sin WebGL no recoge lienzos', !log.includes('querySelectorAll') && log.includes('term.dispose'), log.join(' > '))
}

hr('(3) desecharWebgl')
{
  const log: string[] = []
  desecharWebgl(hostFalso(log, [lienzoFalso(log, 1)]), { dispose: () => log.push('dispose') })
  check('recoge, desecha y devuelve, en ese orden', log.join(' > ') === 'querySelectorAll > dispose > loseContext:1', log.join(' > '))
  const log2: string[] = []
  desecharWebgl(null, { dispose: () => log2.push('dispose') })
  check('sin hueco solo desecha', log2.join(' > ') === 'dispose', log2.join(' > '))
}

hr('(4) Atajos: la misma tabla para la terminal y el agente, en las dos plataformas')
{
  interface Tecla {
    key: string
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    type?: string
  }
  function probar(plataforma: 'windows' | 'mac', t: Tecla, opciones: { seleccion?: boolean; puedeBuscar?: boolean } = {}): string {
    const hechos: string[] = []
    const term = { hasSelection: () => opciones.seleccion ?? false, clearSelection: () => hechos.push('limpiar') }
    const manejar = crearManejadorAtajos(
      term,
      {
        abrirBuscador: () => hechos.push('buscar'),
        copiar: () => hechos.push('copiar'),
        pegar: () => hechos.push('pegar'),
        ...(opciones.puedeBuscar === undefined ? {} : { puedeBuscar: () => opciones.puedeBuscar as boolean })
      },
      plataforma
    )
    const e = {
      type: t.type ?? 'keydown',
      key: t.key,
      ctrlKey: t.ctrlKey ?? false,
      metaKey: t.metaKey ?? false,
      shiftKey: t.shiftKey ?? false,
      altKey: t.altKey ?? false,
      preventDefault: () => hechos.push('prevent')
    } as unknown as KeyboardEvent
    return `${manejar(e)}:${hechos.join(',')}`
  }
  for (const pl of ['windows', 'mac'] as const) {
    const mod = pl === 'mac' ? { metaKey: true } : { ctrlKey: true }
    const otro = pl === 'mac' ? { ctrlKey: true } : { metaKey: true }
    check(`${pl}: Mod+F abre el buscador`, probar(pl, { key: 'f', ...mod }) === 'false:prevent,buscar', probar(pl, { key: 'f', ...mod }))
    check(
      `${pl}: Mod+F con el selector de cuenta a la vista llega al pty`,
      probar(pl, { key: 'F', ...mod }, { puedeBuscar: false }) === 'true:',
      probar(pl, { key: 'F', ...mod }, { puedeBuscar: false })
    )
    check(`${pl}: el otro modificador + F no es nuestro`, probar(pl, { key: 'f', ...otro }) === 'true:', probar(pl, { key: 'f', ...otro }))
    check(
      `${pl}: Mod+C con selección copia y limpia`,
      probar(pl, { key: 'c', ...mod }, { seleccion: true }) === 'false:prevent,copiar,limpiar',
      probar(pl, { key: 'c', ...mod }, { seleccion: true })
    )
    check(`${pl}: Mod+C sin selección pasa`, probar(pl, { key: 'c', ...mod }) === 'true:', probar(pl, { key: 'c', ...mod }))
    check(
      `${pl}: Mod+Shift+C copia siempre (también con Alt)`,
      probar(pl, { key: 'C', shiftKey: true, altKey: true, ...mod }) === 'false:prevent,copiar',
      probar(pl, { key: 'C', shiftKey: true, altKey: true, ...mod })
    )
    check(`${pl}: Mod+Alt+C pasa`, probar(pl, { key: 'c', altKey: true, ...mod }) === 'true:', probar(pl, { key: 'c', altKey: true, ...mod }))
    check(
      `${pl}: Mod+V corta sin prevenir (llega el paste nativo)`,
      probar(pl, { key: 'v', ...mod }) === 'false:',
      probar(pl, { key: 'v', ...mod })
    )
    check(
      `${pl}: Mod+Shift+V pega por IPC`,
      probar(pl, { key: 'V', shiftKey: true, ...mod }) === 'false:prevent,pegar',
      probar(pl, { key: 'V', shiftKey: true, ...mod })
    )
    check(`${pl}: keyup no es nuestro`, probar(pl, { key: 'f', type: 'keyup', ...mod }) === 'true:', probar(pl, { key: 'f', type: 'keyup', ...mod }))
  }
}

hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const allPass = results.every((r) => r.pass)
hr(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
