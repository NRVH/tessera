#!/usr/bin/env node
// =============================================================================
// Prueba del orquestador de «actualizar los agentes de tu equipo»: `planificar`
// (P1-P11) y `ejecutar` (E1-E20 y variantes).
// (node src/renderer/src/features/agentes/test-actualizacion-nativa.mts)
// Con falsos que apuntan cada llamada en un registro común, para afirmar por posición
// el orden entre `preparar`, `instalar`, `detener` y `relanzar`.
// Decisiones: docs/decisiones/agentes/actualizacion-nativa.md
// =============================================================================

import type { AgentDetenerVariasResult, AgentKind } from '../../../../shared/agent-terminal-ipc.ts'
import type {
  EstadoAgentesNativos,
  EstadoCli,
  InstalarRequest,
  InstalarResultado,
  SesionNativa
} from '../../../../shared/agentes-nativos-ipc.ts'
import { ejecutar, MOTIVO, planificar, TOPE_RELANZAMIENTOS } from './actualizacionNativa.ts'
import type {
  ApiAgentePane,
  DepsActualizacion,
  EventoActualizacion,
  ResultadoRelanzar,
  ResultadoSesion,
  ResumenActualizacion
} from './tipos.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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
// Fixtures
// ---------------------------------------------------------------------------
function cli(agente: AgentKind, extra: Partial<EstadoCli> = {}): EstadoCli {
  return {
    agente,
    instalada: '1.0.0',
    ultima: '1.0.0',
    canal: null,
    metodo: 'npm',
    instalable: true,
    requiereParar: false,
    ordenManual: null,
    hayNueva: false,
    bloqueadores: [],
    error: null,
    comprobadoEn: 0,
    ...extra
  }
}

function sesion(sessionId: string, agente: AgentKind, extra: Partial<SesionNativa> = {}): SesionNativa {
  return {
    sessionId,
    profileId: 'perfil',
    projectHostPath: `C:/proyectos/${sessionId}`,
    agente,
    versionLanzada: '1.0.0',
    atrasada: false,
    trabajando: false,
    esperandoRespuesta: false,
    puedeTenerTextoSinEnviar: false,
    ...extra
  }
}

function estado(extra: Partial<EstadoAgentesNativos> = {}): EstadoAgentesNativos {
  return {
    plataforma: 'windows',
    claude: cli('claude-code'),
    codex: cli('codex'),
    sesiones: [],
    instalando: null,
    ...extra
  }
}

/** Claude con versión nueva que se instala con las sesiones vivas (fase A). */
const CLAUDE_NUEVA = cli('claude-code', { instalada: '2.1.280', ultima: '2.1.281', hayNueva: true, metodo: 'nativo' })
/** Codex con versión nueva que exige parar sus sesiones (fase B, Windows). */
const CODEX_NUEVA = cli('codex', { instalada: '0.156.0', ultima: '0.156.1', hayNueva: true, requiereParar: true })

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface Contador {
  enVuelo: number
  maximo: number
}

/** Pane falso: apunta cada llamada en `log` y lee su estado en el momento. */
class PaneFalso implements ApiAgentePane {
  readonly clave: string
  readonly agente: AgentKind
  readonly profileId = 'perfil'
  readonly projectHostPath: string
  id: string | null
  nativo = true
  preparado = false
  resultado: ResultadoRelanzar = 'ok'
  lanza = false
  retardo = 0
  banner: { banner: string; error?: boolean } | null = null
  private readonly log: string[]
  private readonly contador: Contador

  constructor(id: string, agente: AgentKind, log: string[], contador: Contador) {
    this.id = id
    this.agente = agente
    this.clave = `perfil|${id}|${agente}`
    this.projectHostPath = `C:/proyectos/${id}`
    this.log = log
    this.contador = contador
  }
  sessionId(): string | null {
    return this.id
  }
  hostMode(): boolean {
    return this.nativo
  }
  preparar(): void {
    this.preparado = true
    this.log.push(`preparar:${this.id}`)
  }
  liberar(): void {
    this.preparado = false
    this.log.push(`liberar:${this.id}`)
  }
  // La actualización nativa no lo usa: es de la hibernación por inactividad.
  reanudarCon(): void {}
  async relanzar(opts: { banner: string; error?: boolean }): Promise<ResultadoRelanzar> {
    this.log.push(`relanzar:${this.id}`)
    this.banner = opts
    this.contador.enVuelo++
    this.contador.maximo = Math.max(this.contador.maximo, this.contador.enVuelo)
    try {
      if (this.retardo > 0) await dormir(this.retardo)
      if (this.lanza) throw new Error('pane roto')
      this.preparado = false
      return this.resultado
    } finally {
      this.contador.enVuelo--
    }
  }
}

interface Escenario {
  /** Fotos que devuelve `comprobar`, en orden (la última se repite). */
  estados: EstadoAgentesNativos[]
  sesiones: Array<[string, AgentKind]>
  instalar?: (req: InstalarRequest, panes: PaneFalso[]) => InstalarResultado | Promise<InstalarResultado>
  detener?: (ids: string[]) => AgentDetenerVariasResult
  comprobarRompe?: boolean
  /** `comprobar` rompe a partir de esa llamada (0 = la compuerta, 1 = el re-sondeo). */
  comprobarRompeDesde?: number
  onEventoRompe?: boolean
}

interface Montaje {
  log: string[]
  eventos: EventoActualizacion[]
  panes: PaneFalso[]
  deps: DepsActualizacion
  contador: Contador
  pane(id: string): PaneFalso
}

function montar(e: Escenario): Montaje {
  const log: string[] = []
  const eventos: EventoActualizacion[] = []
  const contador: Contador = { enVuelo: 0, maximo: 0 }
  const panes = e.sesiones.map(([id, agente]) => new PaneFalso(id, agente, log, contador))
  let n = 0
  const deps: DepsActualizacion = {
    plataforma: 'windows',
    comprobar: async () => {
      log.push('comprobar')
      const i = n++
      if (e.comprobarRompe || (e.comprobarRompeDesde !== undefined && i >= e.comprobarRompeDesde)) {
        throw new Error('IPC caído')
      }
      return e.estados[Math.min(i, e.estados.length - 1)]
    },
    instalar: async (req) => {
      log.push(`instalar:${req.agente}:[${req.detener.join(',')}]`)
      if (e.instalar) return await e.instalar(req, panes)
      return { ok: true, agente: req.agente, antes: '1.0.0', despues: '1.0.1', detenidas: [...req.detener] }
    },
    detener: async (ids) => {
      log.push(`detener:[${ids.join(',')}]`)
      return e.detener ? e.detener(ids) : { ok: true, detenidas: [...ids] }
    },
    panes: () => panes,
    onEvento: (ev) => {
      eventos.push(ev)
      if (e.onEventoRompe) throw new Error('oyente roto')
    }
  }
  return {
    log,
    eventos,
    panes,
    deps,
    contador,
    pane: (id) => {
      const p = panes.find((x) => x.clave === `perfil|${id}|${x.agente}`)
      if (!p) throw new Error(`no hay pane ${id}`)
      return p
    }
  }
}

function pos(log: string[], entrada: string): number {
  return log.indexOf(entrada)
}
function sesionDe(r: ResumenActualizacion, id: string): ResultadoSesion | undefined {
  return r.sesiones.find((s) => s.sessionId === id)
}
function ninguno(log: string[], prefijos: string[]): boolean {
  return !log.some((l) => prefijos.some((p) => l.startsWith(p)))
}
function fmtSesiones(r: ResumenActualizacion): string {
  return r.sesiones.map((s) => `${s.sessionId}=${s.resultado}${s.motivo ? `(${s.motivo})` : ''}`).join(' ')
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  hr('planificar')

  {
    const p = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        codex: CODEX_NUEVA,
        sesiones: [sesion('k1', 'claude-code'), sesion('c1', 'codex')]
      })
    )
    const a = p.instalar.find((i) => i.agente === 'claude-code')
    const b = p.instalar.find((i) => i.agente === 'codex')
    check(
      '(P1) Claude en fase A y Codex en fase B, con de/a',
      a?.fase === 'A' && a.de === '2.1.280' && a.a === '2.1.281' && b?.fase === 'B' && b.de === '0.156.0' && b.a === '0.156.1',
      JSON.stringify(p.instalar)
    )
  }
  {
    const p = planificar(
      estado({
        codex: cli('codex', { hayNueva: true, ultima: '0.157.0', instalable: false, metodo: 'gestor', ordenManual: 'x update codex' }),
        sesiones: [sesion('c1', 'codex')]
      })
    )
    check(
      '(P2) no instalable → manuales con su orden; ni se instala ni se reinicia por ello',
      p.instalar.length === 0 && p.manuales.length === 1 && p.manuales[0].orden === 'x update codex' && p.manuales[0].motivo.length > 0 && p.reiniciar.length === 0,
      JSON.stringify({ manuales: p.manuales, reiniciar: p.reiniciar.length })
    )
  }
  {
    const bloq = { pid: 42, nombre: 'codex.exe', ruta: 'C:/npm/codex.exe', esDemonio: false }
    const p = planificar(
      estado({
        codex: cli('codex', { ...CODEX_NUEVA, bloqueadores: [bloq] }),
        sesiones: [sesion('c1', 'codex'), sesion('c2', 'codex', { atrasada: true })]
      })
    )
    check(
      '(P3) con bloqueadores no se instala ese CLI; sólo se reinician sus atrasadas',
      p.instalar.length === 0 &&
        p.bloqueadores.length === 1 &&
        p.bloqueadores[0].procesos[0].pid === 42 &&
        p.reiniciar.map((s) => s.sessionId).join() === 'c2',
      JSON.stringify({ bloqueadores: p.bloqueadores.length, reiniciar: p.reiniciar.map((s) => s.sessionId) })
    )
  }
  {
    const p = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        sesiones: [
          sesion('k1', 'claude-code', { atrasada: true }),
          sesion('k1', 'claude-code', { atrasada: true }),
          sesion('k2', 'claude-code'),
          sesion('c1', 'codex', { atrasada: true }),
          sesion('c2', 'codex')
        ]
      })
    )
    check(
      '(P4) reiniciar = las del agente que se instala + las atrasadas, sin duplicados',
      p.reiniciar.map((s) => s.sessionId).join() === 'k1,k2,c1',
      p.reiniciar.map((s) => s.sessionId).join()
    )
  }
  {
    const p = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        sesiones: [
          sesion('k1', 'claude-code', { trabajando: true }),
          sesion('k2', 'claude-code', { trabajando: true }),
          sesion('c1', 'codex', { trabajando: true })
        ]
      })
    )
    check(
      '(P5) bloqueantes = reiniciar ∩ trabajando; «Espera: 2 agentes trabajando»',
      !p.puedeEjecutar && p.bloqueantes.length === 2 && p.motivoNoEjecutar === 'Espera: 2 agentes trabajando',
      `${p.motivoNoEjecutar} bloqueantes=${p.bloqueantes.map((s) => s.sessionId)}`
    )
    const uno = planificar(estado({ claude: CLAUDE_NUEVA, sesiones: [sesion('k1', 'claude-code', { trabajando: true })] }))
    check('(P5b) en singular: «Espera: 1 agente trabajando»', uno.motivoNoEjecutar === 'Espera: 1 agente trabajando', String(uno.motivoNoEjecutar))
  }
  {
    const p = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        sesiones: [
          sesion('k1', 'claude-code', { puedeTenerTextoSinEnviar: true }),
          sesion('k2', 'claude-code'),
          sesion('c1', 'codex', { puedeTenerTextoSinEnviar: true })
        ]
      }),
      { sinRevisar: new Set(['k2', 'c1']) }
    )
    const txt = p.avisos.map((a) => `${a.sessionId}:${a.tipo}`).join()
    check(
      '(P6) avisos sólo sobre lo que se reinicia (c1 no se toca: sin aviso)',
      txt === 'k1:texto-sin-enviar,k2:sin-revisar' && p.puedeEjecutar,
      txt
    )
  }
  {
    const p = planificar(estado({ claude: CLAUDE_NUEVA, sesiones: [sesion('k1', 'claude-code')], instalando: 'codex' }))
    check('(P7) otra instalación en curso cierra la compuerta', !p.puedeEjecutar && p.motivoNoEjecutar === 'Ya hay una actualización en curso', String(p.motivoNoEjecutar))
  }
  {
    const p = planificar(estado({ sesiones: [sesion('k1', 'claude-code')] }))
    check(
      '(P8) nada nuevo ni atrasado: todo al día y nada que ejecutar',
      p.todoAlDia && !p.puedeEjecutar && p.motivoNoEjecutar === 'No hay nada que actualizar ni reiniciar' && !p.forzado,
      JSON.stringify({ todoAlDia: p.todoAlDia, motivo: p.motivoNoEjecutar })
    )
  }
  {
    const e = estado({ claude: CLAUDE_NUEVA, sesiones: [sesion('k1', 'claude-code'), sesion('c1', 'codex')] })
    const p = planificar(e, { forzado: true })
    check(
      '(P9) forzado: todas las sesiones, sin instalar nada, y lo dice',
      p.forzado && p.instalar.length === 0 && p.reiniciar.length === 2 && !p.todoAlDia && p.puedeEjecutar,
      JSON.stringify({ forzado: p.forzado, instalar: p.instalar.length, reiniciar: p.reiniciar.length, todoAlDia: p.todoAlDia })
    )
  }
  {
    const p = planificar(estado({ claude: cli('claude-code', { hayNueva: true, ultima: null }) }))
    const q = planificar(estado({ sesiones: [sesion('k1', 'claude-code', { atrasada: true })] }))
    check(
      '(P10) `hayNueva` sin `ultima` no promete nada; una atrasada quita el «todo al día»',
      p.instalar.length === 0 && p.todoAlDia && !q.todoAlDia && q.puedeEjecutar,
      `p.instalar=${p.instalar.length} q.todoAlDia=${q.todoAlDia}`
    )
  }
  {
    // Un diálogo de permiso: el turno sigue abierto en el transcript con el pty callado.
    const uno = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        sesiones: [sesion('k1', 'claude-code', { esperandoRespuesta: true }), sesion('c1', 'codex', { esperandoRespuesta: true })]
      })
    )
    check(
      '(P11) esperar tu respuesta bloquea como trabajar, y lo dice aparte: «Espera: 1 agente espera tu respuesta»',
      !uno.puedeEjecutar &&
        uno.bloqueantes.map((s) => s.sessionId).join() === 'k1' &&
        uno.motivoNoEjecutar === 'Espera: 1 agente espera tu respuesta',
      `${uno.motivoNoEjecutar} bloqueantes=${uno.bloqueantes.map((s) => s.sessionId)}`
    )
    const dos = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        sesiones: [sesion('k1', 'claude-code', { esperandoRespuesta: true }), sesion('k2', 'claude-code', { esperandoRespuesta: true })]
      })
    )
    check('(P11b) en plural: «Espera: 2 agentes esperan tu respuesta»', dos.motivoNoEjecutar === 'Espera: 2 agentes esperan tu respuesta', String(dos.motivoNoEjecutar))
    const mixto = planificar(
      estado({
        claude: CLAUDE_NUEVA,
        sesiones: [
          sesion('k1', 'claude-code', { trabajando: true }),
          sesion('k2', 'claude-code', { trabajando: true }),
          sesion('k3', 'claude-code', { esperandoRespuesta: true }),
          // Las dos cosas a la vez cuenta como trabajando (es lo que pasa ahora).
          sesion('k4', 'claude-code', { trabajando: true, esperandoRespuesta: true })
        ]
      })
    )
    check(
      '(P11c) mezcla: «Espera: 3 agentes trabajando y 1 que espera tu respuesta»',
      mixto.bloqueantes.length === 4 && mixto.motivoNoEjecutar === 'Espera: 3 agentes trabajando y 1 que espera tu respuesta',
      String(mixto.motivoNoEjecutar)
    )
    const forzado = planificar(estado({ sesiones: [sesion('k1', 'claude-code', { esperandoRespuesta: true })] }), { forzado: true })
    check(
      '(P11d) «Reiniciar igualmente» también espera a que le contestes',
      !forzado.puedeEjecutar && forzado.motivoNoEjecutar === 'Espera: 1 agente espera tu respuesta',
      String(forzado.motivoNoEjecutar)
    )
  }

  // -------------------------------------------------------------------------
  hr('ejecutar: compuerta')

  {
    const m = montar({
      estados: [estado({ codex: CODEX_NUEVA, sesiones: [sesion('c1', 'codex', { trabajando: true }), sesion('c2', 'codex')] })],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ]
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E1) una afectada trabaja → abortado y NADA más llamado',
      r.abortado === 'Espera: 1 agente trabajando' && m.log.join() === 'comprobar' && r.sesiones.length === 0 && r.instalaciones.length === 0 && !r.ok,
      `abortado=${r.abortado} log=${m.log.join()}`
    )
  }
  {
    const m = montar({
      estados: [estado({ claude: CLAUDE_NUEVA, sesiones: [sesion('k1', 'claude-code')], instalando: 'codex' })],
      sesiones: [['k1', 'claude-code']]
    })
    const r = await ejecutar({}, m.deps)
    check('(E1b) instalación en curso → abortado sin tocar nada', r.abortado === 'Ya hay una actualización en curso' && m.log.join() === 'comprobar', `log=${m.log.join()}`)
  }
  {
    const m = montar({ estados: [], sesiones: [['k1', 'claude-code']], comprobarRompe: true })
    const r = await ejecutar({}, m.deps)
    check(
      '(E1c) `comprobar` rompe → abortado con el motivo, sin rechazar',
      r.abortado !== null && r.abortado.includes('IPC caído') && m.log.join() === 'comprobar',
      String(r.abortado)
    )
  }
  {
    const m = montar({
      estados: [estado({ codex: CODEX_NUEVA, sesiones: [sesion('c1', 'codex', { esperandoRespuesta: true }), sesion('c2', 'codex')] })],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ]
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E1d) una afectada espera tu respuesta → abortado con su motivo y NADA más llamado',
      r.abortado === 'Espera: 1 agente espera tu respuesta' && m.log.join() === 'comprobar' && r.sesiones.length === 0,
      `abortado=${r.abortado} log=${m.log.join()}`
    )
  }

  // -------------------------------------------------------------------------
  hr('ejecutar: fase A (instalar con las sesiones vivas)')

  {
    const antes = estado({
      claude: CLAUDE_NUEVA,
      sesiones: [sesion('k1', 'claude-code', { versionLanzada: '2.1.280' }), sesion('k2', 'claude-code', { versionLanzada: '2.1.280' })]
    })
    const despues = estado({
      claude: cli('claude-code', { instalada: '2.1.281', ultima: '2.1.281', metodo: 'nativo' }),
      sesiones: [
        sesion('k1', 'claude-code', { versionLanzada: '2.1.280', atrasada: true }),
        sesion('k2', 'claude-code', { versionLanzada: '2.1.280', atrasada: true })
      ]
    })
    const m = montar({
      estados: [antes, despues],
      sesiones: [
        ['k1', 'claude-code'],
        ['k2', 'claude-code']
      ],
      instalar: (req) => ({ ok: true, agente: req.agente, antes: '2.1.280', despues: '2.1.281', detenidas: [] })
    })
    const r = await ejecutar({}, m.deps)
    const iInst = pos(m.log, 'instalar:claude-code:[]')
    check(
      '(E2) fase A: instala sin parar nada y ANTES de preparar ningún pane',
      iInst >= 0 && iInst < pos(m.log, 'preparar:k1') && iInst < pos(m.log, 'preparar:k2'),
      m.log.join(' ')
    )
    check(
      '(E3) cada sesión se para sola (preparar → detener → relanzar)',
      pos(m.log, 'preparar:k1') < pos(m.log, 'detener:[k1]') &&
        pos(m.log, 'detener:[k1]') < pos(m.log, 'relanzar:k1') &&
        pos(m.log, 'detener:[k2]') < pos(m.log, 'relanzar:k2'),
      m.log.join(' ')
    )
    check(
      '(E4) banner «── Claude Code 2.1.280 → 2.1.281 ──» y resumen ok',
      m.pane('k1').banner?.banner === '── Claude Code 2.1.280 → 2.1.281 ──' &&
        !m.pane('k1').banner?.error &&
        r.ok &&
        r.sesiones.every((s) => s.resultado === 'relanzada'),
      `${JSON.stringify(m.pane('k1').banner)} ${fmtSesiones(r)}`
    )
    const fases = m.eventos.filter((e) => e.tipo === 'fase').map((e) => (e.tipo === 'fase' ? e.fase : ''))
    check(
      '(E5) eventos: fases en orden y la instalación anunciada',
      fases.join() === 'comprobando,instalando,comprobando,relanzando,terminado' &&
        m.eventos.some((e) => e.tipo === 'instalacion') &&
        m.eventos.filter((e) => e.tipo === 'sesion').length === 2,
      fases.join()
    )
  }
  {
    // Red caída: `claude update` no cambia nada y el re-sondeo no da a nadie atrasado.
    const antes = estado({ claude: CLAUDE_NUEVA, sesiones: [sesion('k1', 'claude-code', { versionLanzada: '2.1.280' })] })
    const m = montar({
      estados: [antes, antes],
      sesiones: [['k1', 'claude-code']],
      instalar: (req) => ({ ok: false, agente: req.agente, antes: '2.1.280', despues: '2.1.280', motivo: 'fallo', detalle: 'sin red', detenidas: [] })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E6) fallo de red en A → no se reinicia nada de ese agente',
      ninguno(m.log, ['preparar:', 'detener:', 'relanzar:']) &&
        sesionDe(r, 'k1')?.resultado === 'saltada' &&
        sesionDe(r, 'k1')?.motivo === 'no se pudo actualizar Claude Code' &&
        !r.ok,
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('ejecutar: fase B (parar antes de instalar)')

  const estadoB = estado({
    codex: CODEX_NUEVA,
    sesiones: [sesion('c1', 'codex', { versionLanzada: '0.156.0' }), sesion('c2', 'codex', { versionLanzada: '0.156.0' })]
  })
  {
    // Tras parar, el main ya no las lista (pty muerto): se relanzan igual.
    const despues = estado({ codex: cli('codex', { instalada: '0.156.1', ultima: '0.156.1' }), sesiones: [] })
    const m = montar({
      estados: [estadoB, despues],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: (req) => ({ ok: true, agente: req.agente, antes: '0.156.0', despues: '0.156.1', detenidas: [...req.detener] })
    })
    const r = await ejecutar({}, m.deps)
    const iInst = pos(m.log, 'instalar:codex:[c1,c2]')
    check(
      '(E7) orden B: preparar → instalar (con la parada dentro) → relanzar',
      iInst > pos(m.log, 'preparar:c1') &&
        iInst > pos(m.log, 'preparar:c2') &&
        iInst < pos(m.log, 'relanzar:c1') &&
        iInst < pos(m.log, 'relanzar:c2') &&
        ninguno(m.log, ['detener:']),
      m.log.join(' ')
    )
    check(
      '(E8) banner «── Codex 0.156.0 → 0.156.1 ──» y todo ok',
      m.pane('c1').banner?.banner === '── Codex 0.156.0 → 0.156.1 ──' && !m.pane('c1').banner?.error && r.ok,
      `${JSON.stringify(m.pane('c1').banner)} ${fmtSesiones(r)}`
    )
  }
  {
    const m = montar({
      estados: [estadoB, estado({ codex: cli('codex', { instalada: '0.156.0', ultima: '0.156.1' }), sesiones: [] })],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: (req) => ({ ok: false, agente: req.agente, antes: '0.156.0', despues: '0.156.0', motivo: 'fallo', detalle: 'EBUSY', detenidas: [...req.detener] })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E9) npm falla → las paradas se relanzan IGUAL, con el banner de error',
      pos(m.log, 'relanzar:c1') >= 0 &&
        pos(m.log, 'relanzar:c2') >= 0 &&
        m.pane('c1').banner?.banner === '── Codex sigue en 0.156.0: no se pudo actualizar ──' &&
        m.pane('c1').banner?.error === true &&
        !r.ok &&
        r.sesiones.every((s) => s.resultado === 'relanzada'),
      `${JSON.stringify(m.pane('c1').banner)} ${fmtSesiones(r)}`
    )
  }
  {
    const m = montar({
      estados: [estadoB, estado({ codex: cli('codex', { instalada: '0.156.0' }), sesiones: [] })],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: (req) => ({ ok: false, agente: req.agente, antes: '0.156.0', despues: '0.156.0', motivo: 'tope', detenidas: [...req.detener] })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E9b) tope vencido → también vuelven las dos',
      r.sesiones.filter((s) => s.resultado === 'relanzada').length === 2 && m.pane('c2').banner?.error === true,
      fmtSesiones(r)
    )
  }
  {
    // El CLI desaparece tras instalar: el re-sondeo no lo encuentra.
    const m = montar({
      estados: [estadoB, estado({ codex: cli('codex', { instalada: null, ultima: '0.156.1' }), sesiones: [] })],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: (req) => ({ ok: true, agente: req.agente, antes: '0.156.0', despues: null, detenidas: [...req.detener] })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E10) instalada = null tras instalar → las paradas se relanzan igual (el pane dirá el error)',
      pos(m.log, 'relanzar:c1') >= 0 &&
        pos(m.log, 'relanzar:c2') >= 0 &&
        m.pane('c1').banner?.error === true &&
        (m.pane('c1').banner?.banner ?? '').includes('Codex'),
      `${JSON.stringify(m.pane('c1').banner)} ${fmtSesiones(r)}`
    )
  }
  {
    const m = montar({
      estados: [estadoB],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: (req) => ({
        ok: false,
        agente: req.agente,
        antes: '0.156.0',
        despues: '0.156.0',
        motivo: 'trabajando',
        rechazos: [{ sessionId: 'c2', causa: 'trabajando' }],
        detenidas: []
      })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E11) «trabajando» en B → se liberan y se saltan, sin relanzar ni parar nada',
      pos(m.log, 'liberar:c1') > pos(m.log, 'instalar:codex:[c1,c2]') &&
        pos(m.log, 'liberar:c2') >= 0 &&
        ninguno(m.log, ['relanzar:', 'detener:']) &&
        sesionDe(r, 'c1')?.resultado === 'saltada' &&
        sesionDe(r, 'c2')?.motivo === MOTIVO.empezoATrabajar &&
        m.panes.every((p) => !p.preparado),
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // La parada del lote la rechaza OTRA sesión, que espera tu respuesta.
    const m = montar({
      estados: [estadoB],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: (req) => ({
        ok: false,
        agente: req.agente,
        antes: '0.156.0',
        despues: '0.156.0',
        motivo: 'trabajando',
        rechazos: [{ sessionId: 'c2', causa: 'esperando-respuesta' }],
        detenidas: []
      })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E11b) «espera tu respuesta» en B → la suya lo dice, y la otra dice por quién se saltó',
      sesionDe(r, 'c2')?.motivo === MOTIVO.esperaRespuesta &&
        sesionDe(r, 'c1')?.motivo === 'otra sesión de Codex espera tu respuesta' &&
        ninguno(m.log, ['relanzar:', 'detener:']) &&
        m.panes.every((p) => !p.preparado),
      fmtSesiones(r)
    )
  }

  // Las inciertas: la respuesta de `instalar` se pierde y no se sabe si el lote llegó
  // a pararse. `AgentesNativos.instalar` no rechaza nunca, así que en la vida real un
  // rechazo aquí es del IPC y las sesiones siguen VIVAS.
  const instalarRompe = (): InstalarResultado => {
    throw new Error('canal cerrado')
  }
  const vivasB = estado({ codex: cli('codex', { instalada: '0.156.0' }), sesiones: estadoB.sesiones })
  {
    // El main no paró nada: su `detener` las para ahora (el falso por defecto da ok).
    const m = montar({
      estados: [estadoB, vivasB],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: instalarRompe
    })
    let rechazo: unknown = null
    let r: ResumenActualizacion | null = null
    try {
      r = await ejecutar({}, m.deps)
    } catch (e) {
      rechazo = e
    }
    check(
      '(E12) `instalar` rompe en B → no rechaza; las inciertas se PARAN antes de relanzarse (nunca `exit` sobre una viva)',
      rechazo === null &&
        r !== null &&
        r.instalaciones[0]?.ok === false &&
        pos(m.log, 'detener:[c1]') >= 0 &&
        pos(m.log, 'detener:[c1]') < pos(m.log, 'relanzar:c1') &&
        pos(m.log, 'detener:[c2]') >= 0 &&
        pos(m.log, 'detener:[c2]') < pos(m.log, 'relanzar:c2') &&
        r.sesiones.every((s) => s.resultado === 'relanzada') &&
        m.panes.every((p) => !p.preparado),
      `${m.log.join(' ')} | ${r ? fmtSesiones(r) : String(rechazo)}`
    )
    check(
      '(E12a) una incierta ya preparada en B no se vuelve a preparar en C',
      m.log.filter((l) => l === 'preparar:c1').length === 1 && m.log.filter((l) => l === 'preparar:c2').length === 1,
      m.log.join(' ')
    )
  }
  {
    // El main SÍ las paró en B: su parada contesta «ocupada» (siguen marcadas como
    // paradas hasta el `reload`), y el re-sondeo ya no las lista.
    const m = montar({
      estados: [estadoB, estado({ codex: cli('codex', { instalada: '0.156.0' }), sesiones: [] })],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: instalarRompe,
      detener: (ids) => ({ ok: false, rechazos: ids.map((id) => ({ sessionId: id, causa: 'ocupada' as const })) })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E12b) incierta + «ocupada» = el main sí la paró → se relanza igual (nunca se queda muerta)',
      pos(m.log, 'detener:[c1]') < pos(m.log, 'relanzar:c1') &&
        pos(m.log, 'detener:[c2]') < pos(m.log, 'relanzar:c2') &&
        r.sesiones.length === 2 &&
        r.sesiones.every((s) => s.resultado === 'relanzada') &&
        m.panes.every((p) => !p.preparado),
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    const m = montar({
      estados: [estadoB, vivasB],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: instalarRompe,
      detener: (ids) => ({ ok: false, rechazos: ids.map((id) => ({ sessionId: id, causa: 'trabajando' as const })) })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E12c) incierta + otra causa (trabajando) → liberada y saltada, sin relanzar',
      ninguno(m.log, ['relanzar:']) &&
        pos(m.log, 'liberar:c1') > pos(m.log, 'detener:[c1]') &&
        sesionDe(r, 'c1')?.resultado === 'saltada' &&
        sesionDe(r, 'c1')?.motivo === MOTIVO.empezoATrabajar &&
        sesionDe(r, 'c2')?.resultado === 'saltada' &&
        m.panes.every((p) => !p.preparado),
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // IPC roto de verdad: rompen `instalar` Y el re-sondeo. Sin «ahora», la única
    // comprobación que queda es la parada del main, y es la que decide.
    const m = montar({
      estados: [estadoB],
      sesiones: [
        ['c1', 'codex'],
        ['c2', 'codex']
      ],
      instalar: instalarRompe,
      comprobarRompeDesde: 1,
      detener: (ids) => ({ ok: false, rechazos: ids.map((id) => ({ sessionId: id, causa: 'trabajando' as const })) })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E12d) sin re-sondeo y con la parada rechazando por trabajando → no se relanza ninguna',
      m.eventos.some((e) => e.tipo === 'aviso') &&
        pos(m.log, 'detener:[c1]') >= 0 &&
        pos(m.log, 'detener:[c2]') >= 0 &&
        ninguno(m.log, ['relanzar:']) &&
        r.sesiones.every((s) => s.resultado === 'saltada') &&
        m.panes.every((p) => !p.preparado),
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // La guarda de las inciertas no afloja la de las demás: «ocupada» en una sesión
    // que nadie paró es otro reinicio en marcha, y ése no es nuestro.
    const m = montar({
      estados: [estado({ sesiones: [sesion('k1', 'claude-code', { atrasada: true })] })],
      sesiones: [['k1', 'claude-code']],
      detener: (ids) => ({ ok: false, rechazos: ids.map((id) => ({ sessionId: id, causa: 'ocupada' as const })) })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E12e) «ocupada» fuera de las inciertas sigue siendo rechazo → saltada, sin relanzar',
      ninguno(m.log, ['relanzar:']) && sesionDe(r, 'k1')?.motivo === 'estaba a mitad de otro reinicio' && !m.pane('k1').preparado,
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('ejecutar: fase C (lo que cambió mientras tanto)')

  {
    const sesiones = [
      sesion('k1', 'claude-code', { versionLanzada: '2.1.280' }),
      sesion('k2', 'claude-code', { versionLanzada: '2.1.280' }),
      sesion('k3', 'claude-code', { versionLanzada: '2.1.280' }),
      sesion('k4', 'claude-code', { versionLanzada: '2.1.280' })
    ]
    const despues = estado({
      claude: cli('claude-code', { instalada: '2.1.281' }),
      sesiones: sesiones.map((s) => ({ ...s, atrasada: true }))
    })
    const m = montar({
      estados: [estado({ claude: CLAUDE_NUEVA, sesiones }), despues],
      sesiones: [
        ['k1', 'claude-code'],
        ['k2', 'claude-code'],
        ['k3', 'claude-code'],
        ['k4', 'claude-code']
      ],
      instalar: (req, panes) => {
        // Durante la instalación: k1 reanuda otra conversación, k2 pasa a Docker y
        // el pane de k3 se desmonta.
        const k1 = panes.find((p) => p.id === 'k1')
        const k2 = panes.find((p) => p.id === 'k2')
        if (k1) k1.id = 'k1-otra'
        if (k2) k2.nativo = false
        const i3 = panes.findIndex((p) => p.id === 'k3')
        if (i3 >= 0) panes.splice(i3, 1)
        return { ok: true, agente: req.agente, antes: '2.1.280', despues: '2.1.281', detenidas: [] }
      }
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E13) cambió de id, de modo o desapareció → saltada, sin preparar ni parar',
      ['k1', 'k2', 'k3'].every((id) => sesionDe(r, id)?.resultado === 'saltada' && sesionDe(r, id)?.motivo === MOTIVO.panelCambio) &&
        ninguno(m.log, ['preparar:k1', 'detener:[k1]', 'detener:[k2]', 'detener:[k3]', 'relanzar:k1-otra']) &&
        sesionDe(r, 'k4')?.resultado === 'relanzada',
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    const sesiones = [sesion('k1', 'claude-code', { versionLanzada: '2.1.280' }), sesion('k2', 'claude-code', { versionLanzada: '2.1.280' })]
    const m = montar({
      estados: [
        estado({ claude: CLAUDE_NUEVA, sesiones }),
        estado({
          claude: cli('claude-code', { instalada: '2.1.281' }),
          sesiones: [
            { ...sesiones[0], atrasada: true, trabajando: true },
            { ...sesiones[1], atrasada: true }
          ]
        })
      ],
      sesiones: [
        ['k1', 'claude-code'],
        ['k2', 'claude-code']
      ],
      instalar: (req) => ({ ok: true, agente: req.agente, antes: '2.1.280', despues: '2.1.281', detenidas: [] })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E14) empezó a trabajar antes de C → saltada y sin detener; la otra sí vuelve',
      sesionDe(r, 'k1')?.resultado === 'saltada' &&
        sesionDe(r, 'k1')?.motivo === MOTIVO.empezoATrabajar &&
        ninguno(m.log, ['preparar:k1', 'detener:[k1]', 'relanzar:k1']) &&
        sesionDe(r, 'k2')?.resultado === 'relanzada',
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // La parada del main tiene la última palabra (atómica): si rechaza, se suelta.
    const sesiones = [sesion('k1', 'claude-code', { atrasada: true })]
    const m = montar({
      estados: [estado({ sesiones })],
      sesiones: [['k1', 'claude-code']],
      detener: (ids) => ({ ok: false, rechazos: ids.map((id) => ({ sessionId: id, causa: 'trabajando' as const })) })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E14b) la parada del main rechaza → liberar y saltada, sin relanzar',
      pos(m.log, 'liberar:k1') > pos(m.log, 'detener:[k1]') &&
        ninguno(m.log, ['relanzar:']) &&
        sesionDe(r, 'k1')?.motivo === MOTIVO.empezoATrabajar &&
        !m.pane('k1').preparado,
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }

  // Fase A con dos Claude: la compuerta (`foto0`) y el re-sondeo que se le pase.
  const k12 = [sesion('k1', 'claude-code', { versionLanzada: '2.1.280' }), sesion('k2', 'claude-code', { versionLanzada: '2.1.280' })]
  const conResondeo = (foto0: SesionNativa[], k1Ahora: Partial<SesionNativa>): Montaje =>
    montar({
      estados: [
        estado({ claude: CLAUDE_NUEVA, sesiones: foto0 }),
        estado({
          claude: cli('claude-code', { instalada: '2.1.281' }),
          sesiones: [
            { ...foto0[0], atrasada: true, ...k1Ahora },
            { ...foto0[1], atrasada: true }
          ]
        })
      ],
      sesiones: [
        ['k1', 'claude-code'],
        ['k2', 'claude-code']
      ],
      instalar: (req) => ({ ok: true, agente: req.agente, antes: '2.1.280', despues: '2.1.281', detenidas: [] })
    })
  {
    // Durante `claude update` le salió un diálogo de permiso.
    const m = conResondeo(k12, { esperandoRespuesta: true })
    const r = await ejecutar({}, m.deps)
    check(
      '(E14c) se quedó esperando tu respuesta antes de C → saltada con su motivo, sin tocarla; la otra vuelve',
      sesionDe(r, 'k1')?.resultado === 'saltada' &&
        sesionDe(r, 'k1')?.motivo === MOTIVO.esperaRespuesta &&
        ninguno(m.log, ['preparar:k1', 'detener:[k1]', 'relanzar:k1']) &&
        sesionDe(r, 'k2')?.resultado === 'relanzada',
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // El re-sondeo aún no lo veía; la parada del main, sí.
    const m = montar({
      estados: [estado({ sesiones: [sesion('k1', 'claude-code', { atrasada: true })] })],
      sesiones: [['k1', 'claude-code']],
      detener: (ids) => ({ ok: false, rechazos: ids.map((id) => ({ sessionId: id, causa: 'esperando-respuesta' as const })) })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E14d) la parada del main rechaza por «esperando-respuesta» → saltada con «espera tu respuesta»',
      ninguno(m.log, ['relanzar:']) && sesionDe(r, 'k1')?.motivo === MOTIVO.esperaRespuesta && !m.pane('k1').preparado,
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // Empezó a escribir en k1 DESPUÉS de confirmar: nadie le avisó de ese borrador.
    const m = conResondeo(k12, { puedeTenerTextoSinEnviar: true })
    const r = await ejecutar({}, m.deps)
    check(
      '(E14e) borrador NUEVO antes de C → saltada con su motivo, sin preparar, parar ni relanzar; la otra vuelve',
      sesionDe(r, 'k1')?.resultado === 'saltada' &&
        sesionDe(r, 'k1')?.motivo === MOTIVO.textoNuevo &&
        ninguno(m.log, ['preparar:k1', 'detener:[k1]', 'relanzar:k1']) &&
        sesionDe(r, 'k2')?.resultado === 'relanzada',
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // El borrador ya estaba en la compuerta: el usuario vio el aviso y confirmó.
    const conAviso = [{ ...k12[0], puedeTenerTextoSinEnviar: true }, k12[1]]
    const m = conResondeo(conAviso, { puedeTenerTextoSinEnviar: true })
    const r = await ejecutar({}, m.deps)
    check(
      '(E14f) borrador YA avisado en la compuerta → se respeta la confirmación y se relanza',
      sesionDe(r, 'k1')?.resultado === 'relanzada' &&
        pos(m.log, 'preparar:k1') < pos(m.log, 'detener:[k1]') &&
        pos(m.log, 'detener:[k1]') < pos(m.log, 'relanzar:k1') &&
        sesionDe(r, 'k2')?.resultado === 'relanzada',
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }
  {
    // Sólo atrasada (Claude se auto-actualizó en disco): no se instala nada.
    const s = sesion('k1', 'claude-code', { versionLanzada: '2.1.280', atrasada: true })
    const m = montar({
      estados: [estado({ claude: cli('claude-code', { instalada: '2.1.281', ultima: '2.1.281' }), sesiones: [s] })],
      sesiones: [['k1', 'claude-code']]
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E15) sólo atrasada: sin instalar, banner «── Claude Code 2.1.280 → 2.1.281 ──»',
      ninguno(m.log, ['instalar:']) && m.pane('k1').banner?.banner === '── Claude Code 2.1.280 → 2.1.281 ──' && r.ok,
      `${m.log.join(' ')} | ${JSON.stringify(m.pane('k1').banner)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('ejecutar: forzado, concurrencia y limpieza')

  {
    const ids = ['k1', 'k2', 'k3', 'k4', 'k5', 'c1', 'c2', 'c3']
    const sesiones = ids.map((id) => sesion(id, id.startsWith('k') ? 'claude-code' : 'codex'))
    const m = montar({
      estados: [estado({ claude: CLAUDE_NUEVA, sesiones })],
      sesiones: ids.map((id) => [id, id.startsWith('k') ? 'claude-code' : 'codex'] as [string, AgentKind])
    })
    for (const p of m.panes) p.retardo = 15
    const r = await ejecutar({ forzado: true }, m.deps)
    check(
      '(E16) forzado: reinicia TODAS sin instalar, con «── X reiniciado ──»',
      ninguno(m.log, ['instalar:']) &&
        r.sesiones.length === ids.length &&
        r.sesiones.every((s) => s.resultado === 'relanzada') &&
        m.pane('k1').banner?.banner === '── Claude Code reiniciado ──' &&
        m.pane('c1').banner?.banner === '── Codex reiniciado ──',
      `${fmtSesiones(r)} | ${JSON.stringify(m.pane('c1').banner)}`
    )
    check(
      `(E17) concurrencia: nunca más de ${TOPE_RELANZAMIENTOS} en vuelo (y se llega a ${TOPE_RELANZAMIENTOS})`,
      m.contador.maximo === TOPE_RELANZAMIENTOS,
      `máximo en vuelo = ${m.contador.maximo}`
    )
  }
  {
    const sesiones = [sesion('k1', 'claude-code', { atrasada: true }), sesion('k2', 'claude-code', { atrasada: true }), sesion('k3', 'claude-code', { atrasada: true })]
    const m = montar({
      estados: [estado({ claude: cli('claude-code', { instalada: '1.0.1' }), sesiones })],
      sesiones: [
        ['k1', 'claude-code'],
        ['k2', 'claude-code'],
        ['k3', 'claude-code']
      ],
      onEventoRompe: true
    })
    m.pane('k1').lanza = true
    m.pane('k2').resultado = 'saltada'
    m.pane('k3').resultado = 'fallo'
    let rechazo: unknown = null
    let r: ResumenActualizacion | null = null
    try {
      r = await ejecutar({}, m.deps)
    } catch (e) {
      rechazo = e
    }
    check(
      '(E18) `relanzar` rompe → fallo, y el `finally` libera ese pane (con un oyente roto)',
      rechazo === null &&
        r !== null &&
        sesionDe(r, 'k1')?.resultado === 'fallo' &&
        pos(m.log, 'liberar:k1') > pos(m.log, 'relanzar:k1') &&
        !m.pane('k1').preparado,
      `${m.log.join(' ')} | ${r ? fmtSesiones(r) : String(rechazo)}`
    )
    check(
      '(E19) hibernado/cambiado al relanzar → saltada; fallo del pane → fallo; resumen no ok',
      r !== null &&
        sesionDe(r, 'k2')?.resultado === 'saltada' &&
        sesionDe(r, 'k3')?.resultado === 'fallo' &&
        !r.ok &&
        m.panes.every((p) => !p.preparado),
      r ? fmtSesiones(r) : 'sin resumen'
    )
  }
  {
    // Una sesión abierta DURANTE la actualización no pasó por la compuerta.
    const sesiones = [sesion('k1', 'claude-code', { versionLanzada: '2.1.280' })]
    const m = montar({
      estados: [
        estado({ claude: CLAUDE_NUEVA, sesiones }),
        estado({
          claude: cli('claude-code', { instalada: '2.1.281' }),
          sesiones: [
            { ...sesiones[0], atrasada: true },
            sesion('k9', 'claude-code', { versionLanzada: '2.1.279', atrasada: true })
          ]
        })
      ],
      sesiones: [
        ['k1', 'claude-code'],
        ['k9', 'claude-code']
      ],
      instalar: (req) => ({ ok: true, agente: req.agente, antes: '2.1.280', despues: '2.1.281', detenidas: [] })
    })
    const r = await ejecutar({}, m.deps)
    check(
      '(E20) nunca se tocan sesiones fuera del plan, aunque el re-sondeo las dé atrasadas',
      ninguno(m.log, ['preparar:k9', 'detener:[k9]', 'relanzar:k9']) && sesionDe(r, 'k9') === undefined && sesionDe(r, 'k1')?.resultado === 'relanzada',
      `${m.log.join(' ')} | ${fmtSesiones(r)}`
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
