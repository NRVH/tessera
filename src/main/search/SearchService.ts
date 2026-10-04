// =============================================================================
// SearchService: coordina la búsqueda en archivos. El barrido corre en un worker_thread
// (`workers/searchWorker`) y aquí vive UNA sesión a la vez: su id es la guarda contra los lotes
// que el worker relevado ya había encolado, y los lotes y el fin se reenvían al renderer. La
// raíz no se guarda: se pide en cada arranque a `resolverEnProyecto` (la guarda anti-traversal
// de `FileService`), así no puede quedar desfasada al cambiar de pestaña. Los canales los
// traduce `search/ipc.ts`.
// =============================================================================

import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { BrowserWindow } from 'electron'
import {
  SEARCH_CHANNELS,
  type BusquedaAceptada,
  type CarpetasRequest,
  type CarpetasResult,
  type FinBusqueda,
  type IniciarBusqueda,
  type LoteResultados
} from '../../shared/search-ipc'
import { listarCarpetas } from './carpetas'
import type { MensajeWorkerBusqueda, PeticionBarrido } from './protocolo'

export interface SearchServiceOptions {
  getWindow: () => BrowserWindow | null
  /**
   * Resuelve una ruta RELATIVA POSIX del proyecto activo a su ruta host. Es
   * `FileService.resolveProyecto`, y se inyecta ENTERA (no solo la raíz) porque trae la guarda
   * anti-traversal: la carpeta del ámbito viene del renderer y `'../../..'` tiene que
   * estrellarse ahí, no aquí. Lanza si no hay proyecto activo o si la ruta se sale.
   */
  resolverEnProyecto: (relPosix: string) => string
  log?: (msg: string) => void
}

export class SearchService {
  private readonly getWindow: () => BrowserWindow | null
  private readonly resolverEnProyecto: (relPosix: string) => string
  readonly log: (msg: string) => void

  private worker: Worker | null = null
  /**
   * Id de la búsqueda VIVA. Todo lo que no lleve este id se descarta: entre el `terminate()` y
   * el final real del hilo siguen llegando los mensajes que ese worker ya había encolado. El
   * renderer vuelve a filtrar por su cuenta: la cola del worker y la del IPC son dos distintas.
   */
  private idActual = 0
  private siguienteId = 1

  constructor(opts: SearchServiceOptions) {
    this.getWindow = opts.getWindow
    this.resolverEnProyecto = opts.resolverEnProyecto
    this.log = opts.log ?? ((m) => console.log(`[search] ${m}`))
  }

  /**
   * Arranca una búsqueda y devuelve su id. Cancela la anterior SIEMPRE, incluso si esta no
   * llega a arrancar (una consulta vacía o sin proyecto): la búsqueda es incremental, cada tecla
   * lanza una, y mantener las anteriores sería pagar N barridos para tirar N-1.
   *
   * Lo que termina antes de arrancar viaja en la RESPUESTA, no por el canal DONE: este método
   * corre dentro del `handle`, así que un `send` saldría hacia el renderer antes que la respuesta
   * del invoke, y el renderer lo descartaría por no conocer aún el id con el que filtra, dejando
   * el modal en «Buscando…» para siempre.
   */
  iniciar(req: IniciarBusqueda): BusquedaAceptada {
    this.matarWorker()
    const id = this.siguienteId++
    this.idActual = id

    const query = req.query ?? ''
    if (query === '') {
      // No es un error: es "aún no hay nada que buscar". Se cierra el ciclo igual,
      // para que la UI no se quede esperando un fin que no llegaría.
      return {
        busquedaId: id,
        fin: { busquedaId: id, totalCoincidencias: 0, archivos: 0, truncado: false, cancelado: false }
      }
    }

    // La CARPETA del ámbito la resuelve `FileService.resolveProyecto`, que es quien
    // tiene la guarda anti-traversal. Si el ámbito es todo el proyecto, se resuelve
    // '' y sale la raíz: un solo camino para los dos casos.
    const subcarpeta =
      req.ambito?.tipo === 'carpeta' ? req.ambito.carpeta.replace(/^\/+|\/+$/g, '') : ''
    let raiz: string
    try {
      raiz = this.resolverEnProyecto('')
      // Se resuelve también la carpeta, aunque lo que viaje al worker sea la
      // relativa: es la validación (fuera del proyecto -> lanza aquí y el modal
      // enseña el motivo, en vez de barrer lo que no debe).
      if (subcarpeta !== '') this.resolverEnProyecto(subcarpeta)
    } catch (err) {
      return {
        busquedaId: id,
        fin: {
          busquedaId: id,
          totalCoincidencias: 0,
          archivos: 0,
          truncado: false,
          cancelado: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }

    const datos: PeticionBarrido = { raiz, subcarpeta, query, opts: req.opts }
    const worker = new Worker(path.join(__dirname, 'searchWorker.js'), { workerData: datos })
    this.worker = worker

    let total = 0
    let archivos = 0
    let truncado = false
    let cerrado = false
    const cerrar = (fin: Omit<FinBusqueda, 'busquedaId'>): void => {
      if (cerrado) return
      cerrado = true
      if (this.idActual === id) {
        this.worker = null
        this.enviarFin({ ...fin, busquedaId: id })
      }
    }

    worker.on('message', (msg: MensajeWorkerBusqueda) => {
      // Mensaje de un worker que ya no manda: llegó después de su relevo.
      if (this.idActual !== id) return
      if (msg.tipo === 'lote') {
        this.enviarLote({ busquedaId: id, coincidencias: msg.coincidencias })
        return
      }
      total = msg.total
      archivos = msg.archivos
      truncado = msg.truncado
      cerrar({ totalCoincidencias: total, archivos, truncado, cancelado: false, error: msg.error })
      void worker.terminate()
    })

    worker.on('error', (err) => {
      this.log(`worker falló: ${err.message}`)
      cerrar({
        totalCoincidencias: total,
        archivos,
        truncado,
        cancelado: false,
        error: 'La búsqueda falló: ' + err.message
      })
    })

    // Un `exit` sin `fin` previo solo puede ser un `terminate()`: el relevo ya
    // limpió el estado, así que este `cerrar` no hace nada (idActual ya cambió).
    worker.on('exit', () => {
      cerrar({ totalCoincidencias: total, archivos, truncado, cancelado: true })
    })

    return { busquedaId: id }
  }

  /**
   * El árbol de carpetas de cada proyecto abierto, para el selector de ámbito. Un proyecto que
   * falla (una unidad de red desconectada) devuelve su `error` y los demás salen enteros. Se leen
   * en serie: son recorridos de directorio contra el mismo disco, sin latencia que solapar.
   *
   * Es el único canal `search:*` que acepta rutas host del renderer, y no se valida contra una
   * lista de proyectos abiertos: el renderer ES el dueño de qué proyectos hay abiertos y ya
   * dispone de `workspace:setFilesRoot`, que acepta cualquier ruta absoluta y deja `files:*`
   * leyendo lo que cuelgue; los NOMBRES de las carpetas bajo una ruta son estrictamente menos
   * que eso, y un permiso aquí rompería la pestaña restaurada que aún no ancló su raíz. Lo que
   * sí se sostiene: de aquí no sale ninguna ruta host, solo relativas a cada proyecto.
   */
  async listar(req: CarpetasRequest): Promise<CarpetasResult> {
    const proyectos: CarpetasResult['proyectos'] = []
    for (const p of req.proyectos ?? []) {
      const base = { nombre: p.nombre, raiz: p.raiz }
      if (typeof p.raiz !== 'string' || !path.isAbsolute(p.raiz)) {
        proyectos.push({ ...base, carpetas: [], truncado: false, error: 'Ruta de proyecto inválida.' })
        continue
      }
      try {
        const { carpetas, truncado } = await listarCarpetas(path.resolve(p.raiz))
        proyectos.push({ ...base, carpetas, truncado })
      } catch (err) {
        proyectos.push({
          ...base,
          carpetas: [],
          truncado: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return { proyectos }
  }

  /** Cancela `busquedaId` si es la viva. Un id viejo se ignora en silencio. */
  cancelar(busquedaId: number): void {
    if (busquedaId !== this.idActual) return
    this.matarWorker()
    this.enviarFin({
      busquedaId,
      totalCoincidencias: 0,
      archivos: 0,
      truncado: false,
      cancelado: true
    })
    // Sube el id para que nada del worker muerto se cuele como resultado.
    this.idActual = this.siguienteId++
  }

  private matarWorker(): void {
    if (this.worker === null) return
    const w = this.worker
    this.worker = null
    void w.terminate()
  }

  /** Teardown (cierre de la app): no dejar un hilo barriendo el disco. */
  dispose(): void {
    this.matarWorker()
    this.idActual = this.siguienteId++
  }

  // --- Envío al renderer ----------------------------------------------------
  // Misma guarda `isDestroyed()` que FileService.emitChangeEvent y los dos
  // controllers de terminal: en el cierre la ventana muere antes que los hilos, y
  // un `send` sobre un webContents destruido tumba el proceso main.

  private enviarLote(lote: LoteResultados): void {
    this.enviar(SEARCH_CHANNELS.RESULTS, lote)
  }

  private enviarFin(fin: FinBusqueda): void {
    this.enviar(SEARCH_CHANNELS.DONE, fin)
  }

  private enviar(canal: string, payload: unknown): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(canal, payload)
    }
  }
}
