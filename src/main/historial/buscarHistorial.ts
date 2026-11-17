// =============================================================================
// La búsqueda en las conversaciones de un proyecto: los transcripts de las bases que dio el alcance, del más
// reciente al más antiguo, leídos enteros por líneas; de cada uno, solo los mensajes de texto del usuario y del
// agente (los del traspaso). Devuelve las `max` coincidencias de fecha de mensaje más reciente, ordenadas, con
// el título del panel, y dice si hay más o si la cortó un tope (bytes, tiempo o archivos). Sin electron: recibe
// el resumen del lector.
// Decisiones: docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
import path from 'node:path'
import type { AgenteConversacion, ResumenConversacion } from '../../shared/conversations-ipc'
import { analizarMarcaTiempo } from '../conversaciones/LectorConversaciones.ts'
import { basenameSuelto, esDelProyecto } from '../conversaciones/slugProyecto.ts'
import { conFechas, transcripcionesCodex, transcripcionesClaude } from '../transcripts/listadoTranscripciones.ts'
import { esRepetido, mensajeDeLinea, type MensajeTexto } from '../traspaso/armarTraspaso.ts'
import { coincide, normalizarBusqueda, trozoAlrededor, type Consulta } from './coincidencia.ts'
import { recorrerLineas, type Presupuesto } from './lineasTranscripcion.ts'

/** Una base de conversaciones: la carpeta de una cuenta de un agente, con cómo se llama la cuenta. */
export interface FuenteHistorial {
  agente: AgenteConversacion
  base: string
  /** El nombre de la cuenta de Docker; null es la del sistema (nativa). */
  cuenta: string | null
}

/** Topes de una búsqueda. */
export interface TopesBusqueda {
  /** Coincidencias que se devuelven como mucho. */
  max: number
  /** Bytes de JSONL leídos como mucho, entre todos los archivos. */
  bytes: number
  /** Tiempo como mucho, desde que empieza (listar incluido). */
  ms: number
  /** Conversaciones del proyecto leídas como mucho. */
  archivos: number
}

export const MAX_RESULTADOS_DEFECTO = 8
export const MAX_RESULTADOS_TOPE = 20
/** Por debajo del tope de espera de `tctx` (`TOPE_BUSCAR_MS` de `tctxOrdenes.cjs`), con margen. */
export const TOPES_DEFECTO: Omit<TopesBusqueda, 'max'> = { bytes: 64 * 1024 * 1024, ms: 8000, archivos: 300 }

/** Una coincidencia, tal como viaja a `tctx`. */
export interface Coincidencia {
  agente: AgenteConversacion
  cuenta: string | null
  /** Cuándo se escribió el mensaje (ms); sin marca de tiempo, la de la última escritura del archivo. */
  fecha: number
  /** La misma fecha en la hora local del equipo de Tessera (`AAAA-MM-DD HH:MM`): `tctx` puede correr en otra zona. */
  fechaLocal: string
  titulo: string
  rol: MensajeTexto['rol']
  trozo: string
}

export type CorteBusqueda = 'bytes' | 'tiempo' | 'archivos'

export interface ResultadoBusqueda {
  coincidencias: Coincidencia[]
  /** Hay más coincidencias que `max`. */
  hayMas: boolean
  /** El tope que la cortó antes de recorrerlo todo, o null. */
  corte: CorteBusqueda | null
}

/** Lo que necesita. */
export interface DependenciasBusqueda {
  /** El resumen del panel de un transcript (null si no tiene mensajes o es de un subagente). */
  resumenDe: (archivo: string, agente: AgenteConversacion) => Promise<ResumenConversacion | null>
  /** El nombre que el usuario le puso a la conversación, si se lo puso. */
  tituloPropio?: (agente: AgenteConversacion, id: string) => string | undefined
  ahora?: () => number
  log?: (mensaje: string) => void
}

interface Candidato {
  archivo: string
  fuente: FuenteHistorial
  mtimeMs: number
}

/** Los transcripts de una fuente que pueden ser del proyecto: en Claude Code, los de las carpetas cribadas por nombre. */
async function archivosDe(f: FuenteHistorial, proyecto: string): Promise<string[]> {
  if (f.agente === 'codex') return transcripcionesCodex(f.base, undefined, { comprimidos: true })
  // Sin respaldo: la criba por nombre es un superconjunto de lo que pasa `esDelProyecto`, y una base sin carpeta
  // de este proyecto no debe leer las de los demás.
  return transcripcionesClaude(f.base, { nombreProyecto: basenameSuelto(proyecto), respaldo: 'ninguna' })
}

const dosCifras = (n: number): string => String(n).padStart(2, '0')

/** La fecha en la hora local de este proceso, sin segundos. */
export function fechaLocalDe(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())} ${dosCifras(d.getHours())}:${dosCifras(d.getMinutes())}`
}

/** Los candidatos de todas las fuentes, del más reciente al más antiguo; una carpeta repetida cuenta una vez. */
async function candidatos(fuentes: readonly FuenteHistorial[], proyecto: string): Promise<Candidato[]> {
  const vistos = new Set<string>()
  const fuera: Candidato[] = []
  for (const f of fuentes) {
    const archivos = (await archivosDe(f, proyecto)).filter((a) => {
      const clave = path.resolve(a).toLowerCase()
      if (vistos.has(clave)) return false
      vistos.add(clave)
      return true
    })
    for (const { archivo, st } of await conFechas(archivos)) fuera.push({ archivo, fuente: f, mtimeMs: st.mtimeMs })
  }
  return fuera.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** Una coincidencia aún sin trozo: el trozo solo se calcula para las que se devuelven. */
interface Hallazgo {
  texto: string
  rol: MensajeTexto['rol']
  fecha: number
}

/** Un hallazgo con de qué conversación es. */
interface HallazgoDe extends Hallazgo, Pick<Coincidencia, 'agente' | 'cuenta' | 'titulo'> {}

/**
 * Las coincidencias de un transcript: guarda las `cuantas` últimas (las más recientes) y cuenta todas. Si un
 * tope corta la lectura, se queda con lo leído.
 */
async function buscarEnArchivo(c: Candidato, consulta: Consulta, cuantas: number, p: Presupuesto): Promise<{ ultimas: Hallazgo[]; total: number; fin: string }> {
  const ultimas: Hallazgo[] = []
  let total = 0
  let previo: MensajeTexto | null = null
  const fin = await recorrerLineas(c.archivo, p, (l) => {
    const m = mensajeDeLinea(c.fuente.agente, l)
    if (!m || esRepetido(previo, m)) return
    previo = m
    if (!coincide(normalizarBusqueda(m.texto), consulta)) return
    total++
    ultimas.push({ texto: m.texto, rol: m.rol, fecha: analizarMarcaTiempo(l.timestamp) || Math.round(c.mtimeMs) })
    if (ultimas.length > cuantas) ultimas.shift()
  })
  return { ultimas, total, fin }
}

/**
 * El resumen del candidato si su conversación es del proyecto y no salió ya; si no, null. Dos cuentas pueden
 * tener la misma conversación (la copia de «Continuar en…»): vale la más reciente, que va antes.
 */
async function conversacionNueva(c: Candidato, proyecto: string, vistas: Set<string>, d: DependenciasBusqueda): Promise<ResumenConversacion | null> {
  const resumen = await d.resumenDe(c.archivo, c.fuente.agente)
  if (!resumen || !esDelProyecto(resumen.rutaProyecto, proyecto)) return null
  const clave = `${resumen.agente}:${resumen.id}`
  if (vistas.has(clave)) return null
  vistas.add(clave)
  return resumen
}

/** Busca `consulta` en las conversaciones del proyecto `proyecto` de las `fuentes`. */
export async function buscarEnHistorial(
  fuentes: readonly FuenteHistorial[],
  proyecto: string,
  consulta: Consulta,
  topes: TopesBusqueda,
  d: DependenciasBusqueda
): Promise<ResultadoBusqueda> {
  const ahora = d.ahora ?? Date.now
  const p: Presupuesto = { bytes: topes.bytes, limite: ahora() + topes.ms, ahora }
  // Las `max` de fecha de mensaje más reciente de todo lo leído, de la más reciente a la más antigua: la
  // fecha de un archivo no dice la de sus mensajes, así que no se corta al llenarla sino al acabar o al tope.
  const mejores: HallazgoDe[] = []
  const conversaciones = new Set<string>()
  let leidos = 0
  let hayMas = false
  let corte: CorteBusqueda | null = null
  for (const c of await candidatos(fuentes, proyecto)) {
    if (ahora() >= p.limite) {
      corte = 'tiempo'
      break
    }
    const resumen = await conversacionNueva(c, proyecto, conversaciones, d)
    if (!resumen) continue
    if (leidos >= topes.archivos) {
      corte = 'archivos'
      break
    }
    leidos++
    const r = await buscarEnArchivo(c, consulta, topes.max, p).catch((err: unknown) => {
      d.log?.(`búsqueda: no se pudo leer ${c.archivo}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    })
    if (!r) continue
    const titulo = d.tituloPropio?.(resumen.agente, resumen.id) ?? resumen.titulo
    if (r.total > r.ultimas.length) hayMas = true
    for (const h of r.ultimas) mejores.push({ ...h, agente: c.fuente.agente, cuenta: c.fuente.cuenta, titulo })
    mejores.sort((a, b) => b.fecha - a.fecha)
    if (mejores.length > topes.max) {
      mejores.length = topes.max
      hayMas = true
    }
    if (r.fin === 'bytes' || r.fin === 'tiempo') {
      corte = r.fin
      break
    }
  }
  const coincidencias = mejores.map(
    (h): Coincidencia => ({ agente: h.agente, cuenta: h.cuenta, fecha: h.fecha, fechaLocal: fechaLocalDe(h.fecha), titulo: h.titulo, rol: h.rol, trozo: trozoAlrededor(h.texto, consulta) })
  )
  return { coincidencias, hayMas, corte }
}
