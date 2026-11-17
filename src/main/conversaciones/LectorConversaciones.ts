// =============================================================================
// Lector de solo lectura de las conversaciones que Claude Code y Codex ya persisten en disco,
// bajo la carpeta de credenciales de cada cuenta, sin acoplarse al AlmacenCuentas.
//   - Claude Code: `<base>/projects/<proyecto>/<sessionId>.jsonl`.
//   - Codex: `<base>/sessions/AAAA/MM/DD/rollout-*.jsonl`, o `.jsonl.zst` si Codex lo comprimió.
// Dónde están lo dice `listadoTranscripciones`; `slugProyecto` filtra por proyecto. Lo usa
// `ServicioConversaciones`.
// =============================================================================
import { stat, rm } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import type { AgenteConversacion, ResumenConversacion } from '../../shared/conversations-ipc'
// Extensión explícita: `test-conversaciones.mts` corre con `node` a secas.
import { basenameSuelto, esDelProyecto } from './slugProyecto.ts'
import { conFechas, transcripcionesCodex, rutaPlana, transcripcionesClaude } from '../transcripts/listadoTranscripciones.ts'
import { leerCabezaJsonl } from '../transcripts/cabezaJsonl.ts'
import { TAMANO_SOSPECHOSO, avisarContrato, versionDeLinea } from '../transcripts/vigiaContratos.ts'
import { esTranscripcionCodexDeSubagente } from '../transcripts/formatoTranscripcion.ts'
import { recortarConElipsis } from './recorteTitulo.ts'
import { txMain } from '../textos.ts'

/** Directorio base de credenciales de una cuenta + su agente, a escanear en busca de transcripts. */
export interface BaseConversacion {
  /** Carpeta host de la cuenta (de AlmacenCuentas.dirHostDe): default, privada o global. */
  dir: string
  agente: AgenteConversacion
}

/**
 * Acotaciones opcionales del escaneo; omitirlas devuelve todo lo del agente. Existen porque el
 * camino caliente es auto-reanudar el último chat, que solo quiere un id.
 */
export interface OpcionesEscaneo {
  /**
   * Ruta COMPLETA del proyecto en el host. Criba las carpetas de `projects/` por su nombre
   * antes de abrir ficheros y filtra de verdad por el `cwd` del transcript. Se pasa entera y el
   * basename se deriva dentro: con solo el basename, dos proyectos con el mismo nombre
   * mezclaban su historial.
   */
  rutaProyecto?: string
  /**
   * Devolver solo la conversación más reciente: ordena por mtime y resume de uno en uno hasta
   * el primero válido, en vez de resumirlas todas para ordenar.
   */
  soloUltima?: boolean
}

/**
 * Bytes de cabeza que se leen de cada transcript para el listado: título, `cwd` y primer
 * timestamp viven al principio del JSONL. El `actualizadaEn` sale del mtime del archivo.
 */
const HEAD_BYTES = 256 * 1024
/**
 * Bytes que se leen como mucho de la cabeza: una línea gigante (una imagen pegada en base64)
 * se atraviesa sin guardarla, y esto acota cuánto cuesta un transcript raro.
 */
const LECTURA_MAX_CABEZA = 32 * 1024 * 1024
/** Longitud máxima del título en la lista, en caracteres visibles. */
const MAX_TITULO = 100

/** Entrada de caché de un resumen: válida mientras el archivo no cambie (mtime+size). */
interface ResumenEnCache {
  mtimeMs: number
  tamano: number
  resumen: ResumenConversacion | null
}

/** Lector de historial de conversaciones con caché de resúmenes por (mtime, size). */
export class LectorConversaciones {
  /**
   * Caché de resúmenes por ruta de transcript: un archivo que no cambió no se vuelve a tocar
   * al reabrir el panel. Vive lo que la app; un transcript reanudado cambia su mtime.
   */
  private readonly cache = new Map<string, ResumenEnCache>()

  /**
   * Lista las conversaciones de un conjunto de carpetas base (una por cuenta, de
   * AlmacenCuentas.dirHostDe), más recientes primero. Se escanea por cuenta y no por convención
   * de ruta: las cuentas globales viven fuera de `perfiles/<id>/`.
   */
  async listarConversaciones(
    bases: BaseConversacion[],
    opts: OpcionesEscaneo = {}
  ): Promise<ResumenConversacion[]> {
    const normalizado: OpcionesEscaneo = { ...opts }
    const salida: ResumenConversacion[] = []
    const vistos = new Set<string>()
    for (const { dir, agente } of bases) {
      const elementos =
        agente === 'codex' ? await this.listarCodexEn(dir, normalizado) : await this.listarClaudeEn(dir, normalizado)
      for (const elemento of elementos) {
        const clave = `${elemento.agente}:${elemento.id}`
        if (vistos.has(clave)) continue // dos cuentas pueden apuntar a la misma carpeta (default)
        vistos.add(clave)
        salida.push(elemento)
      }
    }
    salida.sort((a, b) => b.actualizadaEn - a.actualizadaEn)
    // `soloUltima` promete UNA conversación y cada base aporta la suya: el recorte va después
    // de ordenar para quedarse con la más reciente de todas.
    return opts.soloUltima === true ? salida.slice(0, 1) : salida
  }

  /**
   * Borra del disco el transcript de una conversación (por sessionId) dentro de la carpeta base
   * de una cuenta; en Claude Code, también la carpeta hermana `<sessionId>/`. Devuelve true si
   * borró algo. Irreversible: quien llama debe confirmar antes.
   */
  async borrarConversacion(dir: string, agente: AgenteConversacion, sesionId: string): Promise<boolean> {
    if (!/^[0-9a-fA-F-]{8,64}$/.test(sesionId)) return false // guarda: solo ids con forma de UUID
    const archivos =
      agente === 'codex'
        ? (await transcripcionesCodex(dir, undefined, { comprimidos: true })).filter((p) => sesionCodexIdDesdeNombre(p) === sesionId)
        : (await transcripcionesClaude(dir, { respaldo: 'todas' })).filter(
            (p) => path.basename(p, '.jsonl') === sesionId
          )
    let seBorro = false
    for (const archivo of archivos) {
      await rm(archivo, { force: true })
      // A medio comprimir conviven el plano y el `.zst`: se van los dos.
      if (agente === 'codex') await rm(`${rutaPlana(archivo)}.zst`, { force: true })
      this.cache.delete(archivo) // el resumen memorizado ya no aplica
      seBorro = true
      if (agente !== 'codex') {
        // Carpeta hermana con subagentes/snapshots de esa sesión, si existe.
        await rm(path.join(path.dirname(archivo), sesionId), { recursive: true, force: true }).catch(() => {})
      }
    }
    return seBorro
  }

  /** Resumen de un transcript suelto, o null si no tiene mensajes legibles. Lo usa la sonda de contratos. */
  resumenDe(archivo: string, agente: AgenteConversacion): Promise<ResumenConversacion | null> {
    return this.resumirConCache(archivo, agente)
  }

  private async listarClaudeEn(base: string, opts: OpcionesEscaneo = {}): Promise<ResumenConversacion[]> {
    // La criba solo mira el nombre de la carpeta; el filtro exacto usa la ruta entera. Si lo
    // cribado no da ningún transcript (el proyecto no tiene historial, o Claude Code cambió
    // cómo nombra sus carpetas), el camino caliente (`soloUltima`) responde vacío y arranca
    // una conversación nueva; el panel, que lo pide el usuario, prefiere mirarlo todo.
    const archivos = await transcripcionesClaude(base, {
      nombreProyecto: opts.rutaProyecto ? basenameSuelto(opts.rutaProyecto) : undefined,
      respaldo: opts.soloUltima === true ? 'ninguna' : 'todas'
    })
    return this.resumir(archivos, 'claude-code', opts)
  }

  /**
   * Resume una lista de transcripts. Con `soloUltima` ordena por mtime (el mismo `actualizadaEn`
   * del camino largo) y abre de uno en uno hasta el primero válido: hay que seguir buscando si
   * un transcript no tiene mensajes (`/clear`) o es de otro proyecto, porque la criba por
   * nombre es un superconjunto y Codex no tiene criba. Por eso se aplica también aquí el
   * filtro exacto del servicio.
   */
  private async resumir(
    archivos: string[],
    agente: AgenteConversacion,
    opts: OpcionesEscaneo
  ): Promise<ResumenConversacion[]> {
    if (opts.soloUltima !== true) {
      const salida: ResumenConversacion[] = []
      for (const archivo of archivos) {
        const s = await this.resumirConCache(archivo, agente)
        if (s) salida.push(s)
      }
      return salida
    }
    const quiero = opts.rutaProyecto ?? ''
    // Hay que tener todos los `stat` antes de ordenar; van en paralelo con tope.
    const conFecha = await conFechas(archivos)
    conFecha.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    for (const { archivo, st } of conFecha) {
      const s = await this.resumirConCache(archivo, agente, st)
      if (!s) continue
      if (quiero && !esDelProyecto(s.rutaProyecto, quiero)) continue
      return [s]
    }
    return []
  }

  /**
   * Resume un transcript reusando la caché por (mtime, size). Un stat fallido (archivo borrado
   * entre el walk y aquí) devuelve null sin lanzar.
   */
  private async resumirConCache(
    archivo: string,
    agente: AgenteConversacion,
    stYaHecho?: Stats
  ): Promise<ResumenConversacion | null> {
    let st: Stats
    if (stYaHecho) {
      // El camino de `soloUltima` ya hizo el stat para ordenar por mtime.
      st = stYaHecho
    } else {
      try {
        st = await stat(archivo)
      } catch {
        return null
      }
    }
    const coincidencia = this.cache.get(archivo)
    if (coincidencia && coincidencia.mtimeMs === st.mtimeMs && coincidencia.tamano === st.size) return coincidencia.resumen
    const resumen =
      agente === 'codex'
        ? await this.resumirCodex(archivo, st).catch(() => null)
        : await this.resumirClaude(archivo, st).catch(() => null)
    this.cache.set(archivo, { mtimeMs: st.mtimeMs, tamano: st.size, resumen })
    return resumen
  }

  private async resumirClaude(archivo: string, st: Stats): Promise<ResumenConversacion | null> {
    const lineas = await this.leerCabeza(archivo)
    const acc: AcumuladoClaude = {
      tituloIa: null,
      primerMensajeUsuario: null,
      cwd: '',
      primeraMarcaTiempo: 0,
      cantidadMensajes: 0,
      sesionId: path.basename(archivo, '.jsonl')
    }
    for (const obj of lineas) acumularClaude(acc, obj)
    if (acc.cantidadMensajes === 0) return sinMensajes('claude-code', lineas, st)
    const titulo = clip(acc.tituloIa ?? acc.primerMensajeUsuario ?? txMain().sinTitulo)
    return {
      id: acc.sesionId,
      agente: 'claude-code',
      titulo,
      proyecto: acc.cwd ? path.posix.basename(acc.cwd) : '',
      rutaProyecto: acc.cwd,
      // actualizadaEn del mtime (última escritura = última actividad): no hace falta leer el final.
      iniciadaEn: acc.primeraMarcaTiempo || Math.round(st.mtimeMs),
      actualizadaEn: Math.round(st.mtimeMs),
      cantidadMensajes: acc.cantidadMensajes
    }
  }

  // Codex no codifica el cwd en ninguna ruta (agrupa por fecha): no hay criba posible y se
  // recorre todo. `soloUltima` sí aplica, con la ruta como filtro exacto (ver `resumir`).
  private async listarCodexEn(base: string, opts: OpcionesEscaneo = {}): Promise<ResumenConversacion[]> {
    return this.resumir(await transcripcionesCodex(base, undefined, { comprimidos: true }), 'codex', opts)
  }

  private async resumirCodex(archivo: string, st: Stats): Promise<ResumenConversacion | null> {
    const lineas = await this.leerCabeza(archivo)
    const acc: AcumuladoCodex = { sesionId: '', cwd: '', primeraMarcaTiempo: 0, primerMensajeUsuario: null, cantidadMensajes: 0 }
    // Un subagente no es una conversación del usuario: ni se lista ni se reanuda, aunque
    // comparta el `cwd` del padre y escriba después que él.
    if (lineas.some((o) => o?.type === 'session_meta' && esTranscripcionCodexDeSubagente(o.payload ?? {}))) return null
    for (const obj of lineas) acumularCodex(acc, obj)
    if (acc.cantidadMensajes === 0) return sinMensajes('codex', lineas, st)
    if (!acc.sesionId) acc.sesionId = sesionCodexIdDesdeNombre(archivo)
    return {
      id: acc.sesionId,
      agente: 'codex',
      titulo: clip(acc.primerMensajeUsuario ?? txMain().sinTitulo),
      proyecto: acc.cwd ? path.posix.basename(acc.cwd) : '',
      rutaProyecto: acc.cwd,
      iniciadaEn: acc.primeraMarcaTiempo || Math.round(st.mtimeMs),
      actualizadaEn: Math.round(st.mtimeMs),
      cantidadMensajes: acc.cantidadMensajes
    }
  }

  /**
   * Lee la cabeza (hasta HEAD_BYTES guardados) de un JSONL y devuelve sus líneas parseadas. Una
   * línea gigante (una imagen pegada) no corta la lectura ni descarta la conversación: ver
   * `transcripts/cabezaJsonl.ts`. Las líneas inválidas se saltan.
   */
  private async leerCabeza(archivo: string): Promise<LineaJsonConversacion[]> {
    const crudas = await leerCabezaJsonl(archivo, { presupuesto: HEAD_BYTES, lecturaMax: LECTURA_MAX_CABEZA })
    const salida: LineaJsonConversacion[] = []
    for (const linea of crudas) {
      try {
        salida.push(JSON.parse(linea.trim()))
      } catch {
        // línea corrupta/truncada: se ignora, el resto del hilo sigue válido
      }
    }
    return salida
  }
}

/**
 * Una línea ya parseada de un `.jsonl` de agente. Los campos conocidos se declaran; el resto
 * es `unknown` y lo estrechan los helpers.
 */
export type LineaJsonConversacion = Record<string, unknown> & { type?: string; payload?: Record<string, unknown> }

/** Lo que se va recogiendo de la cabeza de un transcript de Claude Code. */
interface AcumuladoClaude {
  tituloIa: string | null
  primerMensajeUsuario: string | null
  cwd: string
  primeraMarcaTiempo: number
  cantidadMensajes: number
  sesionId: string
}

/** Lo que se va recogiendo de la cabeza de un rollout de Codex. */
interface AcumuladoCodex {
  sesionId: string
  cwd: string
  primeraMarcaTiempo: number
  primerMensajeUsuario: string | null
  cantidadMensajes: number
}

/**
 * Un transcript sin mensajes legibles no se lista. Si además es grande, no es un chat recién
 * abierto sino uno que el lector ya no entiende: se avisa al vigía.
 */
function sinMensajes(agente: AgenteConversacion, lineas: LineaJsonConversacion[], st: Stats): null {
  if (st.size >= TAMANO_SOSPECHOSO) {
    const version = lineas.map(versionDeLinea).find((v) => v !== undefined)
    avisarContrato(agente, 'historial', `transcript de ${Math.round(st.size / 1024)} KiB sin mensajes legibles`, version)
  }
  return null
}

/** Incorpora una línea de Claude Code al acumulado. */
function acumularClaude(acc: AcumuladoClaude, obj: LineaJsonConversacion): void {
  const tipo = obj?.type
  if (tipo === 'ai-title' && typeof obj.aiTitle === 'string') acc.tituloIa = obj.aiTitle
  if (typeof obj?.sessionId === 'string') acc.sesionId = obj.sessionId
  if (tipo === 'user' || tipo === 'assistant') acumularMensajeClaude(acc, obj, tipo)
}

/** Incorpora una línea `user` o `assistant` de Claude Code: fecha, cwd, cuenta y primer mensaje humano. */
function acumularMensajeClaude(acc: AcumuladoClaude, obj: LineaJsonConversacion, tipo: string): void {
  const ts = analizarMarcaTiempo(obj.timestamp)
  if (ts && !acc.primeraMarcaTiempo) acc.primeraMarcaTiempo = ts
  if (typeof obj?.cwd === 'string' && !acc.cwd) acc.cwd = obj.cwd
  const texto = textoMensajeClaude(obj)
  if (!texto) return
  acc.cantidadMensajes++
  if (tipo === 'user' && acc.primerMensajeUsuario === null && esUsuarioHumanoClaude(obj)) acc.primerMensajeUsuario = texto
}

/** Incorpora una línea de Codex al acumulado. */
function acumularCodex(acc: AcumuladoCodex, obj: LineaJsonConversacion): void {
  if (obj?.type === 'session_meta') {
    const p = obj.payload ?? {}
    if (typeof p.session_id === 'string') acc.sesionId = p.session_id
    if (typeof p.cwd === 'string') acc.cwd = p.cwd
  }
  const ts = analizarMarcaTiempo(obj?.timestamp)
  if (ts && !acc.primeraMarcaTiempo) acc.primeraMarcaTiempo = ts
  const m = mensajeEventoCodex(obj)
  if (!m) return
  acc.cantidadMensajes++
  if (m.rol === 'user' && acc.primerMensajeUsuario === null) acc.primerMensajeUsuario = m.texto
}

/** Valor anidado de `obj` siguiendo `ruta`; `undefined` si algún paso no es un objeto. */
function campo(obj: unknown, ...ruta: string[]): unknown {
  let actual = obj
  for (const clave of ruta) {
    if (actual === null || typeof actual !== 'object') return undefined
    actual = (actual as Record<string, unknown>)[clave]
  }
  return actual
}

/** Epoch ms desde un timestamp ISO o numérico; 0 si no se reconoce. */
export function analizarMarcaTiempo(v: unknown): number {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000 // seg -> ms si viene en segundos
  if (typeof v === 'string') {
    const n = Date.parse(v)
    if (!Number.isNaN(n)) return n
  }
  return 0
}

/** Recorta y colapsa espacios de un título de una línea. */
function clip(s: string): string {
  return recortarConElipsis(s.replace(/\s+/g, ' ').trim(), MAX_TITULO)
}

/** Texto inyectado por el CLI (no tecleado por el humano): caveats, hooks y wrappers de comandos. */
export function esTextoEnvoltorioCli(texto: string): boolean {
  return /^<(local-command|command-name|command-message|command-args|user-prompt-submit-hook)\b/.test(
    texto.trimStart()
  )
}

/** ¿La línea `user` de CC es un mensaje humano tecleado (no un tool_result ni un wrapper interno)? */
function esUsuarioHumanoClaude(obj: LineaJsonConversacion): boolean {
  const contenido = campo(obj, 'message', 'content')
  // Los wrappers del CLI vienen como string pero no los tecleó el usuario.
  if (typeof contenido === 'string' && esTextoEnvoltorioCli(contenido)) return false
  if (campo(obj, 'origin', 'kind') === 'human') return true
  if (campo(obj, 'promptSource') === 'typed') return true
  // Fallback: contenido string directo (los tool_result vienen como array de bloques).
  return typeof contenido === 'string'
}

/** Extrae el texto visible de un mensaje de CC (string directo o bloques `text`). */
export function textoMensajeClaude(obj: LineaJsonConversacion): string {
  const contenido = campo(obj, 'message', 'content')
  if (typeof contenido === 'string') return contenido.trim()
  if (Array.isArray(contenido)) {
    const partes: string[] = []
    for (const bloque of contenido) {
      const texto = campo(bloque, 'text')
      if (campo(bloque, 'type') === 'text' && typeof texto === 'string') partes.push(texto)
      // thinking / tool_use / tool_result / image: se omiten del hilo legible
    }
    return partes.join('\n').trim()
  }
  return ''
}

/**
 * Extrae {role,text} de un `event_msg` de Codex; null si no aplica. Codex escribe cada mensaje
 * de una de dos formas según su versión: `user_message`/`agent_message` con el texto en
 * `message`, o `item_completed` con un `UserMessage`/`AgentMessage` cuyo texto va en bloques.
 */
export function mensajeEventoCodex(obj: LineaJsonConversacion): { rol: 'user' | 'assistant'; texto: string } | null {
  if (obj?.type !== 'event_msg') return null
  const tipo = campo(obj, 'payload', 'type')
  if (tipo === 'item_completed') return mensajeElementoCodex(campo(obj, 'payload', 'item'))
  const mensaje = campo(obj, 'payload', 'message')
  if (typeof mensaje !== 'string') return null
  if (tipo !== 'user_message' && tipo !== 'agent_message') return null
  const texto = mensaje.trim()
  if (!texto) return null
  return { rol: tipo === 'user_message' ? 'user' : 'assistant', texto }
}

/** Mensaje de un `item_completed` de Codex: solo el texto de sus bloques (las imágenes no). */
function mensajeElementoCodex(elemento: unknown): { rol: 'user' | 'assistant'; texto: string } | null {
  const tipo = campo(elemento, 'type')
  if (tipo !== 'UserMessage' && tipo !== 'AgentMessage') return null
  const contenido = campo(elemento, 'content')
  if (!Array.isArray(contenido)) return null
  const partes: string[] = []
  for (const bloque of contenido) {
    const texto = campo(bloque, 'text')
    if (typeof texto === 'string') partes.push(texto)
  }
  const texto = partes.join('\n').trim()
  if (!texto) return null
  return { rol: tipo === 'UserMessage' ? 'user' : 'assistant', texto }
}

/** sessionId de Codex desde el nombre `rollout-<ts>-<uuid>.jsonl[.zst]` (fallback si falta session_meta). */
function sesionCodexIdDesdeNombre(archivo: string): string {
  const base = path.basename(rutaPlana(archivo), '.jsonl')
  const m = base.match(/rollout-.*?-([0-9a-fA-F-]{36})$/)
  return m ? m[1] : base
}
