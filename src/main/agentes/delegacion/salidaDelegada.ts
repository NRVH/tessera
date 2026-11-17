// =============================================================================
// Lee la salida de una tarea delegada tal como llega del pty: los eventos JSON de cada CLI (una línea cada uno,
// `stream-json` de Claude Code y `--json` de Codex) entre avisos sueltos. Saca el id de la conversación, lo último
// que hizo en líneas legibles, el resultado o el error, y si faltaba la sesión o el uso de la cuenta. Puro.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { MAX_LINEAS_ACTIVIDAD, type AgenteDelegable } from '../../../shared/delegacion-ipc.ts'
import { sinAnsi } from '../../terminales/sesionSsh.ts'
import { MARCA_SIN_CREDENCIAL } from './lineaDelegada.ts'

/** Lo más que se guarda del resultado: es lo que imprime `tctx`, y un agente que lo lea entero no necesita más. */
export const MAX_RESULTADO = 256 * 1024
/** Lo que mide una línea de actividad. */
const MAX_LINEA = 200
/** Líneas sueltas (no JSON) que se guardan para explicar un fallo. */
const MAX_CRUDAS = 8
/** Una línea sin salto que pasa de esto se descarta: nada de lo que se lee es tan largo salvo un resultado enorme. */
const MAX_PENDIENTE = 4 * 1024 * 1024

const SIN_USO = /usage limit|rate limit|hit your limit|limit reached|quota exceeded|out of credits/i
/** Frases de los CLIs al faltar o caducar la sesión; enteras, para no confundirlas con un aviso cualquiera. */
const SIN_SESION = /not logged in|please run \/login|invalid api key|failed to authenticate|oauth session expired|\b401 unauthorized\b/i

export interface ResumenSalida {
  conversacion: string | null
  actividad: string[]
  /** Solo si el agente terminó su turno sin error. */
  resultado: string | null
  error: string | null
  sinCredencial: boolean
  sinUso: boolean
  /** Las últimas líneas sueltas, para explicar un fallo sin eventos. */
  crudas: string[]
}

type Evento = Record<string, unknown>

const obj = (v: unknown): Evento | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Evento) : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** La primera línea con texto, recortada. */
function primeraLinea(texto: string): string {
  const linea = texto.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? ''
  return linea.length > MAX_LINEA ? `${linea.slice(0, MAX_LINEA - 1)}…` : linea
}

/** Lo esencial de una herramienta de Claude Code: la orden, el archivo o el patrón. */
function resumenHerramienta(nombre: string, entrada: Evento | null): string {
  const clave = ['command', 'file_path', 'path', 'pattern', 'url', 'description'].map((k) => str(entrada?.[k])).find((v) => v)
  return primeraLinea(clave ? `${nombre}: ${clave}` : nombre)
}

/** Lo que empieza Codex y se cuenta al empezar: una orden o una herramienta de un servidor MCP. */
function lineaElementoEmpezado(tipo: string | null, elemento: Evento): string | null {
  if (tipo === 'command_execution') return `$ ${str(elemento.command) ?? ''}`
  if (tipo === 'mcp_tool_call') return `${str(elemento.server) ?? ''}: ${str(elemento.tool) ?? ''}`
  return null
}

/** Lo que se cuenta al terminar: los archivos que cambió. */
function lineaElementoCompleto(tipo: string | null, elemento: Evento): string | null {
  if (tipo !== 'file_change') return null
  const rutas = (Array.isArray(elemento.changes) ? elemento.changes : []).map((c) => str(obj(c)?.path)).filter((p): p is string => !!p)
  return rutas.join(', ')
}

class Lector {
  private pendiente = ''
  private readonly r: ResumenSalida = { conversacion: null, actividad: [], resultado: null, error: null, sinCredencial: false, sinUso: false, crudas: [] }
  /** El último mensaje de Codex: es su resultado cuando cierra el turno. */
  private ultimoMensaje: string | null = null

  private readonly agente: AgenteDelegable

  constructor(agente: AgenteDelegable) {
    this.agente = agente
  }

  /** Añade un trozo de la salida; `true` si trajo algo que contar como actividad. */
  alimentar(trozo: string): boolean {
    this.pendiente += trozo
    if (this.pendiente.length > MAX_PENDIENTE) this.pendiente = ''
    const lineas = this.pendiente.split('\n')
    this.pendiente = lineas.pop() ?? ''
    let hubo = false
    for (const l of lineas) hubo = this.linea(l) || hubo
    return hubo
  }

  /**
   * Lo leído. Mientras el proceso vive, una línea sin salto puede ser la mitad de un evento: solo la lectura `final`,
   * con el proceso ya muerto, la toma como completa.
   */
  resumen(final = false): ResumenSalida {
    if (final && this.pendiente !== '') {
      this.linea(this.pendiente)
      this.pendiente = ''
    }
    return { ...this.r, actividad: [...this.r.actividad], crudas: [...this.r.crudas] }
  }

  private actividad(texto: string): void {
    const l = primeraLinea(texto)
    if (l === '') return
    this.r.actividad.push(l)
    if (this.r.actividad.length > MAX_LINEAS_ACTIVIDAD) this.r.actividad.shift()
  }

  private linea(cruda: string): boolean {
    const l = sinAnsi(cruda).replace(/\r/g, '').trim()
    if (l === '') return false
    if (l.includes(MARCA_SIN_CREDENCIAL)) {
      this.r.sinCredencial = true
      return false
    }
    let ev: Evento | null = null
    if (l.startsWith('{')) {
      try {
        ev = obj(JSON.parse(l))
      } catch {
        ev = null
      }
    }
    if (!ev) {
      this.r.crudas.push(primeraLinea(l))
      if (this.r.crudas.length > MAX_CRUDAS) this.r.crudas.shift()
      if (SIN_SESION.test(l)) this.r.sinCredencial = true
      return true
    }
    return this.agente === 'claude-code' ? this.eventoClaude(ev) : this.eventoCodex(ev)
  }

  private eventoClaude(ev: Evento): boolean {
    const tipo = str(ev.type)
    const sesion = str(ev.session_id)
    if (sesion && !this.r.conversacion) this.r.conversacion = sesion
    if (tipo === 'assistant') return this.mensajeClaude(obj(ev.message)?.content)
    if (tipo === 'rate_limit_event' && obj(ev.rate_limit_info)?.status === 'rejected') this.r.sinUso = true
    if (tipo === 'result') return this.resultadoClaude(ev)
    return tipo === 'user'
  }

  /** Cada bloque de texto y cada herramienta del mensaje del agente es una línea de actividad. */
  private mensajeClaude(contenido: unknown): boolean {
    for (const bloque of Array.isArray(contenido) ? contenido : []) {
      const b = obj(bloque)
      if (b?.type === 'text') this.actividad(str(b.text) ?? '')
      else if (b?.type === 'tool_use') this.actividad(resumenHerramienta(str(b.name) ?? '', obj(b.input)))
    }
    return true
  }

  private resultadoClaude(ev: Evento): boolean {
    const texto = str(ev.result) ?? ''
    const subtipo = str(ev.subtype) ?? 'success'
    if (ev.is_error === true || subtipo !== 'success') this.fallo(texto || subtipo)
    else this.r.resultado = texto.slice(0, MAX_RESULTADO)
    return true
  }

  private eventoCodex(ev: Evento): boolean {
    const tipo = str(ev.type)
    if (tipo === 'thread.started') {
      this.r.conversacion = str(ev.thread_id) ?? this.r.conversacion
      return false
    }
    if (tipo === 'item.completed' || tipo === 'item.started') return this.procesarElementoCodex(obj(ev.item), tipo === 'item.completed')
    if (tipo === 'turn.completed') {
      this.r.resultado = (this.ultimoMensaje ?? '').slice(0, MAX_RESULTADO)
      // Un `error` de antes (una reconexión) no cortó el turno: si se completó, no era el final.
      this.r.error = null
      this.r.sinUso = false
      this.r.sinCredencial = false
      return true
    }
    if (tipo === 'turn.failed') this.fallo(str(obj(ev.error)?.message) ?? '')
    else if (tipo === 'error') this.fallo(str(ev.message) ?? '')
    return tipo === 'turn.started'
  }

  private procesarElementoCodex(elemento: Evento | null, completo: boolean): boolean {
    if (!elemento) return false
    const tipo = str(elemento.type)
    // Los avisos de configuración llegan como `error` y no cortan el turno: no son el fallo de la tarea.
    if (tipo === 'error' || tipo === 'reasoning') return false
    if (tipo === 'agent_message' && completo) {
      this.ultimoMensaje = str(elemento.text) ?? ''
      this.actividad(this.ultimoMensaje)
    } else {
      const linea = completo ? lineaElementoCompleto(tipo, elemento) : lineaElementoEmpezado(tipo, elemento)
      if (linea) this.actividad(linea)
    }
    return true
  }

  private fallo(texto: string): void {
    this.r.error = primeraLinea(texto) || this.r.error
    if (SIN_USO.test(texto)) this.r.sinUso = true
    if (SIN_SESION.test(texto)) this.r.sinCredencial = true
  }
}

export type LectorSalida = Pick<Lector, 'alimentar' | 'resumen'>

export function crearLectorSalida(agente: AgenteDelegable): LectorSalida {
  return new Lector(agente)
}
