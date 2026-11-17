// =============================================================================
// Lector del contexto de la conversación viva de un proyecto, desde el host: cuánto de la
// ventana del modelo ocupa el último turno del transcript (Claude Code) o del rollout (Codex).
// Elige el chat vivo con el ancla (`anclaConversacion.ts`), lee por la cola y estima la ventana
// de Claude por modelo. Lo usa `ServicioContexto`.
// Decisiones: docs/decisiones/agentes/contexto-de-la-conversacion.md
// =============================================================================
import path from 'node:path'
import type { AgenteContexto, FotoContexto } from '../../shared/context-ipc'
// Extensión explícita en los imports de valor: `test-contexto-conversacion.mts` corre con `node` a secas.
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { metaDeCabecera, type MetadatosTranscripcion } from '../transcripts/formatoTranscripcion.ts'
import { leerCabezaParseada } from '../transcripts/cabezaJsonl.ts'
import {
  claveAncla,
  elegirVivo,
  TOLERANCIA_EVENTO_MS,
  type Ancla,
  type CandidatoMedido,
  type RegistroAnclas
} from './anclaConversacion.ts'
import { basenameSuelto, esDelProyecto } from '../conversaciones/slugProyecto.ts'
import { conFechas, transcripcionesCodex, transcripcionesClaude } from '../transcripts/listadoTranscripciones.ts'
import { avisarContrato, versionDeLinea } from '../transcripts/vigiaContratos.ts'

/** Cola que se lee de cada transcript buscando el último turno con cuentas. */
const BYTES_COLA = 256 * 1024
/** Cabeza que se lee para averiguar el `cwd` del transcript (vive en las primeras líneas). */
const HEAD_BYTES = 64 * 1024
/** Bytes leídos como mucho de la cabeza: una primera línea con una imagen pegada (megas de
 *  base64) se compacta en vez de perder el `cwd`. Ver `transcripts/cabezaJsonl.ts`. */
const LECTURA_CABEZA_MAX = 32 * 1024 * 1024
/** Trozo de lectura: menor que el presupuesto, o `leerCabezaJsonl` pararía tras el primero. */
const TROZO_CABEZA = 16 * 1024
/**
 * Transcripts que se examinan, de mtime más reciente a más viejo: una criba, no el criterio.
 * El margen es holgado a propósito (lo medido se cachea) para que una racha de punteros
 * reescritos en chats muertos no deje fuera al vivo.
 */
const MAX_CANDIDATOS = 24

/** Frescura del dato: el vigilante del transcript es quien de verdad lo refresca. */
const TTL_MS = 5_000

/**
 * Escalones de ventana conocidos, para promocionar una estimación que se quedó
 * corta. No hay ninguno intermedio en la práctica: o 200 k, o 500 k, o 1 M.
 */
const ESCALONES_VENTANA_CLAUDE = [200_000, 500_000, 1_000_000]

/**
 * Ventana por modelo de Claude Code. Solo se listan los que se apartan del default;
 * el resto cae en 200 k, que es el tamaño clásico. Verificado contra transcripts
 * reales: una sesión de `claude-opus-5` se compactó automáticamente al pasar de
 * 1 000 000 de tokens (`compact_boundary.preTokens`), así que su ventana es de 1 M.
 */
const VENTANA_CLAUDE_POR_MODELO: Array<{ re: RegExp; tokens: number }> = [
  { re: /opus-5/, tokens: 1_000_000 },
  { re: /sonnet-5/, tokens: 1_000_000 },
  { re: /fable-5/, tokens: 1_000_000 },
  { re: /haiku-5/, tokens: 1_000_000 }
]
const VENTANA_CLAUDE_PREDETERMINADA = 200_000

/** Entrada de caché de un transcript ya medido: vale mientras el fichero no cambie. */
interface MedidaCacheada {
  mtimeMs: number
  tamano: number
  medida: MedidaContexto | null
}

/** Lo que se saca de la cola de un transcript: los tokens del último turno. */
interface MedidaContexto {
  /** Contexto ocupado. 0 = el transcript existe pero aún no tiene ningún turno. */
  tokensUsados: number
  /** Ventana declarada por la fuente (Codex); 0 si hay que estimarla (Claude Code). */
  tokensVentana: number
  modelo?: string
  sesionId?: string
  /**
   * Epoch ms del último evento FECHADO del transcript. Es la señal de vida con la que
   * se elige el chat vivo, y por eso se calcula aunque no haya ni un turno: un chat
   * recién abierto con `/clear` no tiene cuentas pero sí es el que está en marcha.
   */
  ultimoEventoEn: number
  /** Epoch ms del evento MEDIDO (el turno, o la compactación). 0 si no lo fecha. */
  turnoEn: number
  /** El número sale de una compactación recién hecha, no de un turno del agente. */
  compactado?: boolean
}

interface Candidate {
  ruta: string
  mtimeMs: number
  tamano: number
}

/**
 * Tope de la caché de metadatos. No se invalida nunca (el proyecto de un transcript no
 * cambia), así que sin tope crecería con cada fichero visto en toda la vida del proceso.
 */
const MAX_METAS = 4000

export class LectorContexto {
  /** Medidas por RUTA de transcript, invalidadas por (mtime, size). */
  private readonly medidas = new Map<string, MedidaCacheada>()
  /** Metadatos por RUTA. Sin invalidación: no cambian nunca (ver MAX_METAS). */
  private readonly metas = new Map<string, MetadatosTranscripcion>()
  /** Última respuesta por (base, agente, proyecto), para no re-escanear en cada sondeo. */
  private readonly fotos = new Map<string, { en: number; foto: FotoContexto }>()
  /** Lecturas en vuelo: N paneles de la misma cuenta no deben escanear N veces. */
  private readonly enCurso = new Map<string, Promise<FotoContexto>>()
  private readonly ahora: () => number
  /**
   * Anclas de conversación por (agente, base, proyecto). Null = nadie las alimenta
   * (tests, o el anillo consultado sin sesión abierta) y manda la heurística de
   * siempre. Ver `anclaConversacion.ts`.
   */
  private readonly anclas: RegistroAnclas | null

  constructor(ahora: () => number = Date.now, anclas: RegistroAnclas | null = null) {
    this.ahora = ahora
    this.anclas = anclas
  }

  /**
   * Contexto del chat vivo de `rutaProyecto` dentro de la carpeta de credenciales `base`.
   * `rutaProyecto` es la ruta completa del proyecto en el host (la misma con la que filtra el
   * historial), no su basename: dos proyectos con el mismo nombre compartirían anillo. Vacío =
   * no filtrar, se mide el chat más reciente que haya.
   */
  async leer(base: string, agente: AgenteContexto, rutaProyecto: string): Promise<FotoContexto> {
    // Misma clave que la del ancla: la misma tripleta (agente, carpeta, proyecto).
    const clave = claveAncla(agente, base, rutaProyecto)
    const coincidencia = this.fotos.get(clave)
    if (coincidencia && this.ahora() - coincidencia.en < TTL_MS) return coincidencia.foto

    const flying = this.enCurso.get(clave)
    if (flying) return flying

    const promesa = this.cargar(base, agente, rutaProyecto).then((foto) => {
      this.fotos.set(clave, { en: this.ahora(), foto })
      return foto
    })
    this.enCurso.set(clave, promesa)
    try {
      return await promesa
    } finally {
      this.enCurso.delete(clave)
    }
  }

  /** Marca lo cacheado como caducado (el agente acaba de escribir): la próxima lectura vuelve al disco. */
  invalidate(): void {
    this.fotos.clear()
  }

  private async cargar(base: string, agente: AgenteContexto, rutaProyecto: string): Promise<FotoContexto> {
    let candidatos: Candidate[]
    try {
      candidatos = await this.listarCandidatos(base, agente, rutaProyecto)
    } catch (e) {
      return sinContexto(agente, 'error', e instanceof Error ? e.message : 'no se pudo listar')
    }
    if (!candidatos.length) return sinContexto(agente, 'no-session')

    // Criba por mtime (barata); el vivo se decide después por el ancla o por la marca de
    // tiempo interna, no por cuál se tocó el último.
    candidatos.sort((a, b) => b.mtimeMs - a.mtimeMs)

    const ancla = this.anclas?.get(claveAncla(agente, base, rutaProyecto)) ?? null
    const examinar = candidatosAExaminar(candidatos, ancla)
    const { medidos, vioProyecto } = await this.medirCandidatos(examinar, agente, rutaProyecto)

    const cands: CandidatoMedido[] = medidos.map(({ archivo, medida }) => ({
      sesionId: medida.sesionId,
      nombre: path.basename(archivo.ruta),
      ultimoEventoEn: medida.ultimoEventoEn,
      mtimeMs: archivo.mtimeMs
    }))
    const eleccion = elegirVivo(cands, ancla, TOLERANCIA_EVENTO_MS)
    // «Este proyecto no tiene chats» y «los tiene, pero aún sin turnos» se dicen distinto.
    if (eleccion.indice < 0) return sinContexto(agente, vioProyecto ? 'no-data' : 'no-session')
    // Lo aprendido por evidencia se fija: la próxima lectura ya no depende de que el chat
    // siga siendo el más reciente.
    if (eleccion.aprender) {
      this.anclas?.aprender(claveAncla(agente, base, rutaProyecto), eleccion.aprender)
    }

    // No se retrocede al chat anterior: el vivo es este, y sin turnos es que acaba de empezar.
    const { archivo, medida } = medidos[eleccion.indice]
    const anclaje = eleccion.anclaje === 'sesion' ? 'sesion' : 'heuristica'
    if (medida.tokensUsados <= 0) return { ...sinContexto(agente, 'no-data'), anclaje }
    return fotoDeMedida(agente, medida, archivo, anclaje)
  }

  /** Mide los candidatos que son del proyecto (y no de un subagente); dice si vio alguno del proyecto. */
  private async medirCandidatos(
    examinar: Candidate[],
    agente: AgenteContexto,
    rutaProyecto: string
  ): Promise<{ medidos: Array<{ archivo: Candidate; medida: MedidaContexto }>; vioProyecto: boolean }> {
    let vioProyecto = false
    const medidos: Array<{ archivo: Candidate; medida: MedidaContexto }> = []
    for (const archivo of examinar) {
      if (rutaProyecto) {
        const meta = await this.metadatosDe(archivo.ruta, agente)
        if (meta.cwd === null) continue // sin `cwd` legible: no se puede atribuir
        if (meta.subagente) continue // rollout de subagente: es otra ventana
        if (!esDelProyecto(meta.cwd, rutaProyecto)) continue
      } else if ((await this.metadatosDe(archivo.ruta, agente)).subagente) {
        continue
      }
      vioProyecto = true
      const medida = await this.medirConCache(archivo, agente)
      if (!medida) continue // ilegible: no se puede ni fechar
      medidos.push({ archivo, medida })
    }
    return { medidos, vioProyecto }
  }

  /**
   * Transcripts de la cuenta que pueden ser el chat vivo, con su mtime y tamaño.
   *
   * En Claude Code se CRIBAN por el nombre de la carpeta antes de tocar los ficheros
   * (ver `conversaciones/slugProyecto`). Importa porque esto no se pide de vez en
   * cuando: el anillo lo refresca cada 60 s y, además, se invalida al TERMINAR CADA
   * TURNO del agente — justo cuando estás esperando la respuesta—. Sin la criba, cada
   * una de esas veces recorría los 481 transcripts de los 42 proyectos para acabar
   * midiendo uno.
   *
   * La criba es un superconjunto y el filtro por `cwd` de `load` sigue mandando, así
   * que esto no puede cambiar QUÉ conversación se elige, solo cuántas se miran.
   */
  private async listarCandidatos(
    base: string,
    agente: AgenteContexto,
    rutaProyecto: string
  ): Promise<Candidate[]> {
    // Codex: solo `sessions/` (`archived_sessions/` son chats ya cerrados, nunca el vivo) y
    // sin criba, porque no codifica el proyecto en la ruta. Claude: los transcripts de nivel
    // superior de `projects/<proyecto>/` (los hilos de subagente tienen su propia ventana),
    // cribados por carpeta. Si lo cribado no da nada se miran todos: aquí compensa, porque
    // no bloquea ninguna apertura y decir «sin sesión» habiendo una es un número mal puesto.
    const archivos =
      agente === 'codex'
        ? await transcripcionesCodex(base)
        : await transcripcionesClaude(base, {
            nombreProyecto: rutaProyecto ? basenameSuelto(rutaProyecto) : undefined,
            respaldo: 'todas'
          })
    const fechados = await conFechas(archivos)
    return fechados.map(({ archivo, st }) => ({ ruta: archivo, mtimeMs: st.mtimeMs, tamano: st.size }))
  }

  /**
   * Metadatos del transcript (de su CABEZA, cacheados por ruta): de qué proyecto es y
   * si es un rollout de subagente. Un fallo de lectura devuelve `cwd: null` y NO se
   * cachea: el fichero pudo borrarse entre el walk y esta llamada.
   */
  private async metadatosDe(archivo: string, agente: AgenteContexto): Promise<MetadatosTranscripcion> {
    const coincidencia = this.metas.get(archivo)
    if (coincidencia !== undefined) return coincidencia
    let cwd: string | null = null
    let subagente = false
    try {
      const lineas = await leerCabezaParseada(archivo, {
        presupuesto: HEAD_BYTES,
        lecturaMax: LECTURA_CABEZA_MAX,
        trozo: TROZO_CABEZA
      })
      const meta = metaDeCabecera(agente, lineas)
      cwd = meta.cwd
      subagente = meta.subagente
    } catch {
      return { cwd: null, subagente: false } // borrado entre el walk y aquí, o ilegible
    }
    if (cwd !== null) {
      // Tope: esta caché no se invalida nunca, así que sin él crecería con cada
      // transcript visto en toda la vida del proceso. Vaciarla entera es barato
      // (se repuebla leyendo cabeceras) y evita llevar una política de expulsión.
      if (this.metas.size >= MAX_METAS) this.metas.clear()
      this.metas.set(archivo, { cwd, subagente })
    }
    return { cwd, subagente }
  }

  /** Mide la cola del transcript re-usando la caché por (mtime, size). */
  private async medirConCache(archivo: Candidate, agente: AgenteContexto): Promise<MedidaContexto | null> {
    const coincidencia = this.medidas.get(archivo.ruta)
    if (coincidencia && coincidencia.mtimeMs === archivo.mtimeMs && coincidencia.tamano === archivo.tamano) return coincidencia.medida
    const medida = await (agente === 'codex'
      ? medirContextoCodex(archivo.ruta, archivo.tamano)
      : medirContextoClaude(archivo.ruta, archivo.tamano)
    ).catch(() => null)
    this.medidas.set(archivo.ruta, { mtimeMs: archivo.mtimeMs, tamano: archivo.tamano, medida })
    return medida
  }
}

/** Respuesta sin número que pintar: la UI apaga el anillo y explica el motivo. */
function sinContexto(
  agente: AgenteContexto,
  noDisponible: FotoContexto['noDisponible'],
  detalle?: string
): FotoContexto {
  return {
    agente,
    tokensUsados: 0,
    tokensVentana: 0,
    porcentaje: 0,
    observadoEn: 0,
    consultadoEn: Date.now(),
    noDisponible,
    detalle
  }
}

/**
 * Los candidatos a medir: los `MAX_CANDIDATOS` más recientes y, si hay ancla, el chat anclado
 * aunque quede fuera: un chat sin escribir queda enterrado bajo los punteros que el CLI
 * reescribe en otros y sin este rescate el ancla no lo encontraría.
 */
function candidatosAExaminar(candidatos: Candidate[], ancla: Ancla | null): Candidate[] {
  const examinar = candidatos.slice(0, MAX_CANDIDATOS)
  if (ancla?.estado.tipo === 'anclada') {
    const id = ancla.estado.sesionId
    if (!examinar.some((c) => nombreContieneSesion(c.ruta, id))) {
      const rescatado = candidatos.find((c) => nombreContieneSesion(c.ruta, id))
      if (rescatado) examinar.push(rescatado)
    }
  }
  return examinar
}

/** El snapshot de una medida con turnos; la ventana de Claude Code se estima por modelo. */
function fotoDeMedida(
  agente: AgenteContexto,
  medida: MedidaContexto,
  archivo: Candidate,
  anclaje: 'sesion' | 'heuristica'
): FotoContexto {
  const tokensVentana = medida.tokensVentana || estimarVentanaClaude(medida.modelo, medida.tokensUsados)
  const porcentaje = tokensVentana > 0 ? acotarPorcentajeContexto((medida.tokensUsados / tokensVentana) * 100) : 0
  return {
    agente,
    tokensUsados: medida.tokensUsados,
    tokensVentana,
    porcentaje,
    modelo: medida.modelo,
    sesionId: medida.sesionId,
    // Solo Claude Code estima: Codex publica su ventana en el propio evento.
    ...(medida.tokensVentana ? {} : { ventanaEstimada: true }),
    ...(medida.compactado ? { compactado: true } : {}),
    anclaje,
    observadoEn: Math.round(medida.turnoEn || archivo.mtimeMs),
    consultadoEn: Date.now()
  }
}

/**
 * Contexto ocupado según el último evento que lo cambió: un turno del asistente (suma de
 * `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` y `output_tokens`;
 * solo `input_tokens` daría casi cero porque en un chat largo todo viene de caché) o una
 * compactación (`compact_boundary`, con `postTokens`), que gana si es posterior al último turno.
 * Se saltan las líneas `isSidechain`: los subagentes tienen otra ventana.
 */
export async function medirContextoClaude(archivo: string, tamano: number): Promise<MedidaContexto | null> {
  const lineas = await leerLineasJsonl(archivo, tamano, BYTES_COLA, 'tail', mideContexto)
  const est: EstadoClaude = {
    ultimoEventoEn: 0,
    idxTurno: -1,
    tokensTurno: 0,
    turnoEn: 0,
    sesionId: undefined,
    idxCompactacion: -1,
    tokensCompactacion: 0,
    compactacionEn: 0,
    modelo: undefined,
    vioAsistente: false
  }
  for (let i = lineas.length - 1; i >= 0; i--) leerLineaClaude(est, lineas[i], i)
  if (est.vioAsistente && est.idxTurno < 0 && est.idxCompactacion < 0) {
    const version = lineas.map(versionDeLinea).find((v) => v !== undefined)
    avisarContrato('claude-code', 'contexto', 'turnos del asistente sin uso de tokens legible', version)
  }

  const compactado = est.idxCompactacion > est.idxTurno
  return {
    // Sin turno ni frontera queda en 0: transcript recién abierto, sin nada que medir.
    tokensUsados: compactado ? est.tokensCompactacion : est.tokensTurno,
    tokensVentana: 0, // el transcript no la publica: se estima por modelo
    modelo: est.modelo,
    sesionId: est.sesionId ?? path.basename(archivo, '.jsonl'),
    ultimoEventoEn: est.ultimoEventoEn,
    turnoEn: compactado ? est.compactacionEn : est.turnoEn,
    ...(compactado ? { compactado: true } : {})
  }
}

/**
 * ¿Basta esta línea para medir? Un turno del asistente con uso o una compactación. Mientras el modelo
 * piensa, la última línea es la petición entera a la API, que puede ocupar más que la cola: sin esto el
 * anillo caería a 0 hasta la respuesta.
 */
function mideContexto(obj: LineaJsonl): boolean {
  if (obj.type === 'system' && obj.subtype === 'compact_boundary') return tokensTrasCompactar(obj) !== null
  return obj.type === 'assistant' && obj.isSidechain !== true && tokensDelTurno(obj) > 0
}

/** Los tokens tras una compactación, o null si su línea no los trae (CLI viejo). */
function tokensTrasCompactar(obj: LineaJsonl): number | null {
  const meta = obj.compactMetadata as Record<string, unknown> | undefined
  return typeof meta?.postTokens === 'number' && Number.isFinite(meta.postTokens) ? meta.postTokens : null
}

/**
 * El contexto que ocupa un turno del asistente; 0 sin uso legible o con todo a 0 (los mensajes
 * sintéticos de error de Claude Code lo traen así).
 */
function tokensDelTurno(obj: LineaJsonl): number {
  const uso = (obj.message as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined
  if (!uso) return 0
  return num(uso.input_tokens) + num(uso.cache_creation_input_tokens) + num(uso.cache_read_input_tokens) + num(uso.output_tokens)
}

/** Lo que `medirContextoClaude` va recogiendo al recorrer el transcript de la última línea a la primera. */
interface EstadoClaude {
  ultimoEventoEn: number
  idxTurno: number
  tokensTurno: number
  turnoEn: number
  sesionId: string | undefined
  idxCompactacion: number
  tokensCompactacion: number
  compactacionEn: number
  /** Se busca aunque gane la compactación: su línea no lo dice y la ventana saldría inflada. */
  modelo: string | undefined
  /** Hubo algún turno del asistente: si ninguno trae uso legible, el formato cambió. */
  vioAsistente: boolean
}

/** Incorpora una línea (recorrida de fin a inicio) al estado: fecha, frontera de compactación o turno. */
function leerLineaClaude(est: EstadoClaude, obj: LineaJsonl, i: number): void {
  const instante = leerMarcaTemporal(obj.timestamp)
  if (instante && !est.ultimoEventoEn) est.ultimoEventoEn = instante

  if (est.idxCompactacion < 0 && obj.type === 'system' && obj.subtype === 'compact_boundary') {
    registrarFrontera(est, obj, i, instante)
    return
  }
  if (obj.type !== 'assistant' || obj.isSidechain === true) return
  est.vioAsistente = true
  registrarTurnoAsistente(est, obj, i, instante)
}

/** Registra una compactación; sin `postTokens` (CLI viejo) no hay nada que leer y manda el turno. */
function registrarFrontera(est: EstadoClaude, obj: LineaJsonl, i: number, instante: number): void {
  const tras = tokensTrasCompactar(obj)
  if (tras === null) return
  est.idxCompactacion = i
  est.tokensCompactacion = tras
  est.compactacionEn = instante
}

/** Registra el modelo y, si aún no hay turno, el primer turno del asistente con tokens. */
function registrarTurnoAsistente(est: EstadoClaude, obj: LineaJsonl, i: number, instante: number): void {
  const mensaje = obj.message as Record<string, unknown> | undefined
  const uso = mensaje?.usage as Record<string, unknown> | undefined
  if (!uso) return
  if (!est.modelo && typeof mensaje?.model === 'string') est.modelo = mensaje.model
  if (est.idxTurno >= 0) return // el turno ya está: se sigue solo por el modelo
  const usados = tokensDelTurno(obj)
  if (usados <= 0) return
  est.idxTurno = i
  est.tokensTurno = usados
  est.turnoEn = instante
  if (typeof obj.sessionId === 'string') est.sesionId = obj.sessionId
}

/**
 * Ventana de Claude Code a partir del modelo. Si lo observado ya la supera, la tabla
 * está desfasada (modelo nuevo, o ventana ampliada): se promociona al siguiente
 * escalón conocido en vez de pintar un porcentaje imposible.
 */
export function estimarVentanaClaude(modelo: string | undefined, tokensUsados: number): number {
  const base =
    (modelo && VENTANA_CLAUDE_POR_MODELO.find((m) => m.re.test(modelo))?.tokens) || VENTANA_CLAUDE_PREDETERMINADA
  if (tokensUsados <= base) return base
  const siguiente = ESCALONES_VENTANA_CLAUDE.find((t) => t >= tokensUsados)
  // Por encima del último escalón conocido, redondear hacia arriba al millón para que
  // el anillo siga significando algo (y no se quede clavado en el 100 %).
  return siguiente ?? Math.ceil(tokensUsados / 1_000_000) * 1_000_000
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/**
 * Último `token_count` con `info`. Aquí no se estima nada: `last_token_usage` es el
 * turno que se acaba de mandar (lo que ocupa la ventana AHORA) y `model_context_window`
 * es su tamaño. OJO con `total_token_usage`: es el ACUMULADO de toda la sesión
 * (decenas de millones en un chat largo) y no tiene nada que ver con el contexto.
 */
export async function medirContextoCodex(archivo: string, tamano: number): Promise<MedidaContexto | null> {
  const lineas = await leerLineasJsonl(archivo, tamano, BYTES_COLA, 'tail')
  let ultimoEventoEn = 0
  let encontrado: MedidaContexto | null = null
  // Un `token_count` con `info` es un turno medido; sin `info` solo trae límites de uso.
  let conInfo = false

  for (let i = lineas.length - 1; i >= 0; i--) {
    const obj = lineas[i]
    const instante = leerMarcaTemporal(obj.timestamp)
    if (instante && !ultimoEventoEn) ultimoEventoEn = instante
    if (encontrado) continue // ya está el turno; se sigue solo por si falta fechar el final

    const datos = obj.payload
    if (datos?.type !== 'token_count') continue
    const info = datos.info as Record<string, unknown> | null | undefined
    if (!info || typeof info !== 'object') continue
    conInfo = true
    const ultimo = info.last_token_usage as Record<string, unknown> | undefined
    if (!ultimo) continue
    const usados = num(ultimo.total_tokens) || num(ultimo.input_tokens) + num(ultimo.output_tokens)
    if (usados <= 0) continue
    encontrado = {
      tokensUsados: usados,
      tokensVentana: num(info.model_context_window),
      modelo: typeof info.model === 'string' ? info.model : undefined,
      sesionId: sesionCodexDesdeNombre(archivo),
      ultimoEventoEn: 0,
      turnoEn: instante
    }
  }
  if (conInfo && !encontrado) avisarContrato('codex', 'contexto', '`token_count` con `info` pero sin tokens legibles')
  // Aunque no haya ni un `token_count` se devuelve la medida: un rollout recién
  // abierto (un `/new`) no tiene turnos pero SÍ es el chat vivo, y hay que poder
  // fecharlo para que gane al anterior en vez de que el anterior siga mandando.
  return {
    tokensUsados: 0,
    tokensVentana: 0,
    sesionId: sesionCodexDesdeNombre(archivo),
    turnoEn: 0,
    ...encontrado,
    ultimoEventoEn
  }
}

/** sessionId de Codex desde el nombre `rollout-<ts>-<uuid>.jsonl`. */
function sesionCodexDesdeNombre(archivo: string): string {
  const base = path.basename(archivo, '.jsonl')
  return base.match(/rollout-.*?-([0-9a-fA-F-]{36})$/)?.[1] ?? base
}

// ---------------------------------------------------------------------------
// Utilidades de E/S
// ---------------------------------------------------------------------------

/**
 * ¿El nombre del fichero corresponde a esa conversación? Sirve para los dos formatos:
 * `<sessionId>.jsonl` en Claude Code y `rollout-<fecha>-<uuid>.jsonl` en Codex —donde,
 * comprobado, el uuid SOBREVIVE a los `codex resume` porque se sigue anexando al mismo
 * fichero—. Se compara por inclusión para no depender de ninguna de las dos formas.
 */
function nombreContieneSesion(archivo: string, sesionId: string): boolean {
  return sesionId.length > 0 && path.basename(archivo).includes(sesionId)
}

/** Epoch ms de una marca ISO del transcript; 0 si falta o no es válida. */
function leerMarcaTemporal(v: unknown): number {
  if (typeof v !== 'string') return 0
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/** Número o 0: los campos de `usage` faltan o vienen nulos según la versión del CLI. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function acotarPorcentajeContexto(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}
