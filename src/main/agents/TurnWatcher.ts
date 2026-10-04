// =============================================================================
// Vigilante de turnos: avisa cuando el transcript de una sesión dice que el agente empezó o terminó
// de trabajar.
// Lee solo el fichero que acaba de cambiar (`fs.watch` da el nombre), tras comprobar una vez por
// fichero que es del proyecto de la sesión y no de un subagente.
// Rebote corto (250 ms) porque apaga el dot del perfil; `UsageWatcher` espera 2,5 s y no se fundió
// con él.
// Depende de `marcasTurno`, `formatoTranscript` y `util/jsonlCola`; lo usa la terminal del agente.
// Decisiones: docs/decisiones/agentes/turnos-marcas-del-transcript.md
// =============================================================================

import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
// Extensión explícita en toda la cadena: estos módulos los alcanzan los tests `.mts`,
// que corren con `node` a secas (type-stripping) y no resuelven imports de VALOR sin ella.
import { leerLineasJsonl, type LineaJsonl } from '../util/jsonlCola.ts'
import { metaDeCabecera } from '../transcripts/formatoTranscript.ts'
import { leerCabezaParseada } from '../transcripts/cabezaJsonl.ts'
import { ultimaMarca, type AgenteTranscript, type MarcaTurno } from '../transcripts/marcasTurno.ts'
import { cambiosSegundoPlano, type CambioSegundoPlano } from '../transcripts/tareasSegundoPlano.ts'
import { basenameSuelto } from '../conversations/slugProyecto.ts'

/** Silencio tras la última escritura antes de mirar el fichero. Ver cabecera. */
const QUIET_TURNO_MS = 250

/** Cola que se lee buscando la marca. La marca va al final; 64 KiB cubre de sobra un
 *  `last_agent_message` largo, y es la cuarta parte de lo que lee el anillo. */
const COLA_TURNO_BYTES = 64 * 1024

/** Cabeza que se lee para saber de qué proyecto es el transcript. */
const CABEZA_TURNO_BYTES = 32 * 1024

/** Bytes leídos como mucho de la cabeza: una primera línea con una imagen pegada (megas de
 *  base64) se compacta, y el `cwd` que va en ella no se pierde. Ver `cabezaJsonl.ts`. */
const CABEZA_TURNO_LECTURA_MAX = 32 * 1024 * 1024

/** Trozo de lectura: menor que el presupuesto, o `leerCabezaJsonl` pararía tras el primero. */
const CABEZA_TURNO_TROZO = 8 * 1024

/** Tope de la caché de metadatos: no se invalida (no cambian), así que necesita techo. */
const MAX_METAS = 2000

/** Lo que hay que saber de una sesión para poder atribuirle un cambio de fichero. */
export interface SesionVigilada {
  /** Carpeta de credenciales del agente (la misma `<base>` del uso y el contexto). */
  base: string
  agente: AgenteTranscript
  /** Basename SUELTO del proyecto: el mismo filtro que usan el historial y el anillo. */
  proyecto: string
}

interface EntradaVigilante {
  /** Sesiones que miran esta carpeta. Un solo `fs.watch` para todas. */
  sesiones: Map<string, SesionVigilada>
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  /** Ficheros tocados desde el último aviso (se vacía al disparar). */
  tocados: Set<string>
}

/** Carpeta que se vigila por agente. La misma criba que hace `UsageWatcher`. */
function raizDe(base: string, agente: AgenteTranscript): string {
  return path.join(base, agente === 'codex' ? 'sessions' : 'projects')
}

/** Clave de la carpeta vigilada: dos sesiones de la misma cuenta la comparten. */
function claveRaiz(base: string, agente: AgenteTranscript): string {
  return `${agente}::${base}`
}

export class TurnWatcher {
  private readonly entradas = new Map<string, EntradaVigilante>()
  /** Ruta -> (proyecto, subagente). No se invalida: no cambian. */
  private readonly metas = new Map<string, { proyecto: string | null; subagente: boolean }>()
  private readonly onMarca: (sessionId: string, marca: MarcaTurno) => void
  private readonly log: (msg: string) => void
  /** Lo que el transcript dice de las tareas en segundo plano (solo Claude Code). */
  private readonly alSegundoPlano: ((sessionId: string, cambios: CambioSegundoPlano[]) => void) | null

  constructor(
    onMarca: (sessionId: string, marca: MarcaTurno) => void,
    log: (msg: string) => void = (m) => console.log(`[turnos] ${m}`),
    alSegundoPlano: ((sessionId: string, cambios: CambioSegundoPlano[]) => void) | null = null
  ) {
    this.onMarca = onMarca
    this.log = log
    this.alSegundoPlano = alSegundoPlano
  }

  /** Empieza a vigilar el transcript de esta sesión. Idempotente. */
  watch(sessionId: string, sesion: SesionVigilada): void {
    const clave = claveRaiz(sesion.base, sesion.agente)
    const existente = this.entradas.get(clave)
    if (existente) {
      existente.sesiones.set(sessionId, sesion)
      // REINTENTO. Si el `fs.watch` de la primera sesión falló —la carpeta aún no
      // existía (cuenta recién estrenada), o el SO se quedó sin watchers—, la entrada
      // quedó viva pero SIN vigilante, y cada sesión posterior se enganchaba a ella y
      // heredaba el fallo: la detección por transcript se caía al silencio de 10 s para
      // el resto de la vida del proceso, sin más síntoma que la latencia. Para entonces
      // la carpeta ya suele existir, así que se vuelve a intentar.
      if (!existente.watcher) this.montar(existente, sesion)
      return
    }
    const entrada: EntradaVigilante = {
      sesiones: new Map([[sessionId, sesion]]),
      watcher: null,
      timer: null,
      tocados: new Set()
    }
    this.entradas.set(clave, entrada)
    this.montar(entrada, sesion)
  }

  /** Monta el `fs.watch` de una entrada. Deja `watcher` en null si no se pudo. */
  private montar(entrada: EntradaVigilante, sesion: SesionVigilada): void {
    const raiz = raizDe(sesion.base, sesion.agente)
    try {
      entrada.watcher = watch(raiz, { recursive: true, persistent: false }, (_evento, filename) => {
        if (!filename) return
        const rel = filename.toString()
        if (!rel.endsWith('.jsonl')) return
        entrada.tocados.add(path.join(raiz, rel))
        if (entrada.timer) clearTimeout(entrada.timer)
        entrada.timer = setTimeout(() => {
          entrada.timer = null
          const tocados = [...entrada.tocados]
          entrada.tocados.clear()
          void this.revisar(entrada, tocados)
        }, QUIET_TURNO_MS)
      })
      // Un vigilante que se cae (la carpeta desaparece) deja de contar como vigilante: la
      // siguiente sesión que se enganche lo vuelve a montar, y `vigila()` ya dice que no.
      const montado = entrada.watcher
      montado.on('error', (e) => {
        this.log(`el vigilante de ${raiz} se cayó: ${e instanceof Error ? e.message : String(e)}`)
        montado.close()
        if (entrada.watcher === montado) entrada.watcher = null
      })
    } catch (e) {
      // Carpeta sin estrenar o límite de watchers del SO. No es fatal: el rastreador
      // conserva su red de seguridad (silencio absoluto) y el BEL sigue cerrando turnos.
      this.log(`no se pudo vigilar ${raiz}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** Deja de vigilar esta sesión; con la última de su carpeta, cierra el `fs.watch`. */
  unwatch(sessionId: string): void {
    for (const [clave, entrada] of this.entradas) {
      if (!entrada.sesiones.delete(sessionId)) continue
      if (entrada.sesiones.size > 0) return
      if (entrada.timer) clearTimeout(entrada.timer)
      entrada.watcher?.close()
      this.entradas.delete(clave)
      return
    }
  }

  /**
   * ¿Se está vigilando DE VERDAD el transcript de esta sesión? Falso si nunca se pidió o si
   * el `fs.watch` de su carpeta no se pudo montar o se cayó: quien pregunta no puede tomar
   * el silencio del vigilante por «no ha pasado nada».
   */
  vigila(sessionId: string): boolean {
    for (const entrada of this.entradas.values()) {
      if (entrada.sesiones.has(sessionId)) return entrada.watcher !== null
    }
    return false
  }

  disposeAll(): void {
    for (const entrada of this.entradas.values()) {
      if (entrada.timer) clearTimeout(entrada.timer)
      entrada.watcher?.close()
    }
    this.entradas.clear()
    this.metas.clear()
  }

  /**
   * Mira los ficheros tocados y reparte la marca a las sesiones a las que les toca.
   * Si dos sesiones del mismo perfil comparten cuenta pero no proyecto, cada una recibe
   * solo lo suyo: por eso el filtro por proyecto está aquí y no en el `fs.watch`.
   */
  private async revisar(entrada: EntradaVigilante, ficheros: string[]): Promise<void> {
    // El agente es el MISMO para todas las sesiones de una entrada (va en su clave), así
    // que la cabecera y la cola del fichero se leen UNA vez y se reparten. Hacerlo dentro
    // del bucle de sesiones multiplicaba por el número de proyectos abiertos del perfil
    // una lectura de 32 KiB en el hilo main —y encima cada 250 ms, y encima justo en los
    // ficheros cuya cabecera aún no se puede resolver, que son los que no se cachean—.
    for (const file of ficheros) {
      const primera = entrada.sesiones.values().next().value
      if (!primera) return
      const agente = primera.agente
      try {
        const meta = await this.metaDe(file, agente)
        if (meta.subagente) continue // su fin no es el fin del turno del padre
        if (meta.proyecto === null) continue
        // Solo se lee la cola si alguna sesión mira ese proyecto.
        let interesa = false
        for (const sesion of entrada.sesiones.values()) {
          if (sesion.proyecto === meta.proyecto) {
            interesa = true
            break
          }
        }
        if (!interesa) continue
        const lineas = await leerLineasJsonl(file, 0, COLA_TURNO_BYTES, 'tail')
        this.repartir(entrada, meta.proyecto, agente, lineas)
      } catch {
        // Fichero borrado o a medio escribir entre el aviso y la lectura: se ignora.
      }
    }
  }

  /**
   * Entrega a las sesiones del proyecto lo que dice la cola de su transcript. Las tareas en
   * segundo plano van antes que la marca y aunque no haya ninguna: se lanzan y avisan de su
   * fin con el turno ya cerrado.
   */
  private repartir(entrada: EntradaVigilante, proyecto: string, agente: AgenteTranscript, lineas: LineaJsonl[]): void {
    const cambios = agente === 'claude-code' && this.alSegundoPlano ? cambiosSegundoPlano(lineas) : []
    const marca = ultimaMarca(agente, lineas)
    if (!marca && cambios.length === 0) return
    for (const [sessionId, sesion] of entrada.sesiones) {
      if (sesion.proyecto !== proyecto) continue
      if (cambios.length > 0) this.alSegundoPlano?.(sessionId, cambios)
      if (marca) this.onMarca(sessionId, marca)
    }
  }

  private async metaDe(
    file: string,
    agente: AgenteTranscript
  ): Promise<{ proyecto: string | null; subagente: boolean }> {
    const hit = this.metas.get(file)
    if (hit) return hit
    const lineas = await leerCabezaParseada(file, {
      presupuesto: CABEZA_TURNO_BYTES,
      lecturaMax: CABEZA_TURNO_LECTURA_MAX,
      trozo: CABEZA_TURNO_TROZO
    })
    const meta = metaDeCabecera(agente, lineas)
    const resuelto = {
      proyecto: meta.cwd === null ? null : basenameSuelto(meta.cwd),
      subagente: meta.subagente
    }
    // Solo se cachea lo que se pudo atribuir: un transcript recién creado puede no
    // tener todavía su cabecera, y cachear ese "no sé" lo dejaría fuera para siempre.
    if (resuelto.proyecto !== null) {
      if (this.metas.size >= MAX_METAS) this.metas.clear()
      this.metas.set(file, resuelto)
    }
    return resuelto
  }
}
