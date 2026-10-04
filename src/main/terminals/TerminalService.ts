// =============================================================================
// Sesiones de terminal interactivas (pty) sobre el contenedor persistente del SandboxManager,
// ancladas al `workspacePath` neutro de un proyecto, o sobre el shell nativo del sistema.
// Una sesión es un `docker exec -it … bash -il` (o el shell nativo) conectado a un pseudo-TTY.
// Depende de `SandboxManager` (montajes) y del adaptador `adaptadores/pty.ts`.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
// Extensión explícita en los imports: los tests `.mts` importan este módulo con `node` a secas.
import type { IPty, IDisposable } from 'node-pty'
import path from 'node:path'
import type { Profile } from '../profiles/types.ts'
import type { SandboxManager } from '../sandbox/SandboxManager.ts'
import { dbLog } from '../db/dbLog.ts'
import { blindarEntradaPty } from './entradaPty.ts'
import { descartarSalida, programarVolcado, volcarAhora } from './bufferSalida.ts'
import { colaMuertesDelProceso } from './colaMuertes.ts'
import { lanzarPtyDocker, lanzarPtyNativo, resolverWorkspacePath } from './lanzamientoPty.ts'
import { matarArbolPosix, matarArbolWindows } from './adaptadores/pty.ts'
import { esWindows } from '../../shared/plataforma.ts'
import { conTope, esperar } from '../util/esperas.ts'
import type { CreateSessionOptions, SessionRecord, TerminalSession } from './tiposSesion.ts'

export type { CreateSessionOptions, TerminalSession } from './tiposSesion.ts'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/** ETX (Ctrl-C): aborta el comando en primer plano antes de pedir `exit`. */
const CTRL_C = String.fromCharCode(3)
/** Pausa entre el Ctrl-C y el `exit` para que readline procese el ^C. */
const CTRL_C_SETTLE_MS = 150
/** Margen para que el shell salga solo antes de forzar kill(). */
const GRACEFUL_EXIT_MS = 3000
/**
 * Tope para esperar a que un pty ya matado se recolecte: el seguro contra un `onExit` que no
 * llega nunca y cuelga el reinicio entero.
 */
const REAP_TIMEOUT_MS = 1500
/** `^C` que manda `detenerSesion` antes de recurrir al kill. */
const DETENER_INTENTOS = 3
/**
 * Espera de salida tras cada `^C` de la parada, después del asiento. Corta a propósito: el
 * siguiente `^C` debe caer dentro de la ventana de «pulsa otra vez para salir» del CLI.
 */
const DETENER_ESPERA_MS = 500

/** Nombre del contenedor del perfil: la convención `tessera-<id>` de SandboxManager. */
function containerNameFor(profile: Profile): string {
  return `tessera-${profile.id}`
}

/** Medidas de una parada, para el registro final de `detenerSesion`. */
interface EstadoParada {
  inicio: number
  elegante: boolean
  intentos: number
  recolectado: boolean
}

/** Sesiones de terminal (pty) de los perfiles: crea, recarga, detiene y cierra. */
export class TerminalService {
  private readonly sandbox: SandboxManager
  private readonly sessions = new Map<string, SessionRecord>()
  private counter = 0
  /** Turno de las MUERTES de pty (parar, cerrar, reiniciar, hibernar): de una en una, y del PROCESO. */
  private readonly muertes = colaMuertesDelProceso

  constructor(sandbox: SandboxManager) {
    this.sandbox = sandbox
  }

  /**
   * Abre un shell interactivo con cwd en el workspacePath neutro del proyecto, reutilizando el
   * contenedor del SandboxManager; en modo nativo, con cwd en la ruta real del proyecto.
   */
  async createSession(profile: Profile, opts: CreateSessionOptions): Promise<TerminalSession> {
    const containerName = containerNameFor(profile)
    // En modo nativo no hay contenedor: no se consulta el registro de montajes del sandbox.
    const host = opts.host === true
    const workspacePath = host
      ? path.resolve(opts.project)
      : await resolverWorkspacePath(this.sandbox, profile, opts.project)

    const id = `term-${profile.id}-${++this.counter}`
    const record: SessionRecord = {
      id,
      profileId: profile.id,
      project: opts.project,
      workspacePath,
      containerName,
      host,
      launch: opts.launch,
      extraEnv: opts.extraEnv,
      // `pty`, las suscripciones y `exit` los rellena spawnShell().
      pty: undefined as unknown as IPty,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      exitCode: null,
      reloading: false,
      closing: false,
      detenida: false,
      parada: null,
      listeners: new Set(),
      exitListeners: new Set(),
      outBuf: [],
      flushTimer: null,
      paused: false,
      dataSub: undefined as unknown as IDisposable,
      exitSub: undefined as unknown as IDisposable,
      exit: undefined as unknown as Promise<number>,
      resolveExit: () => {}
    }

    this.spawnShell(record)
    this.sessions.set(id, record)
    return record
  }

  /** stdin del usuario hacia el shell. */
  write(sessionId: string, data: string): void {
    const record = this.require(sessionId)
    // Con la sesión parada (o parándose) lo tecleado se tira: un Enter colado entre dos `^C`
    // enviaría el borrador que el primero acaba de descartar. El pane también bloquea la
    // entrada, pero la garantía tiene que vivir junto al pty.
    if (record.detenida) return
    record.pty.write(data)
  }

  /** Reflow del pty (columnas/filas). Se recuerda para restaurarlo tras un reload. */
  resize(sessionId: string, cols: number, rows: number): void {
    const record = this.require(sessionId)
    record.cols = cols
    record.rows = rows
    record.pty.resize(cols, rows)
  }

  /**
   * Contrapresión: pausa o reanuda la lectura del pty. Al pausar, el proceso de dentro se
   * bloquea al escribir y una salida masiva no inunda al renderer. Idempotente; un pty ya
   * muerto ignora la orden.
   */
  setPaused(sessionId: string, paused: boolean): void {
    const record = this.sessions.get(sessionId)
    if (!record || record.paused === paused) return
    record.paused = paused
    try {
      if (paused) record.pty.pause()
      else record.pty.resume()
    } catch {
      /* el pty ya no está vivo: nada que pausar/reanudar */
    }
  }

  /** Suscribe a la salida del shell; sobrevive a `reloadSession()`. Devuelve la baja. */
  onData(sessionId: string, cb: (data: string) => void): () => void {
    const record = this.require(sessionId)
    record.listeners.add(cb)
    return () => {
      record.listeners.delete(cb)
    }
  }

  /**
   * Suscribe al fin del shell, de primer nivel: sobrevive a `reloadSession()` y solo dispara
   * en salidas reales (`exit`, un crash), nunca en el kill de un reload ni en la parada de
   * `detenerSesion()`. Devuelve la baja.
   */
  onExit(sessionId: string, cb: (exitCode: number | null) => void): () => void {
    const record = this.require(sessionId)
    record.exitListeners.add(cb)
    return () => {
      record.exitListeners.delete(cb)
    }
  }

  /**
   * Levanta un shell nuevo en el mismo contenedor y cwd, recomputando el entorno, y conserva
   * el id y los suscriptores. Sirve para una sesión viva (mata el shell y lo relanza) y para
   * una muerta o parada (la resucita respawneando en el mismo record).
   */
  async reloadSession(
    sessionId: string,
    overrides?: { launch?: string; extraEnv?: Record<string, string> }
  ): Promise<TerminalSession> {
    const record = this.require(sessionId)

    // El reload aplica lo que solo puede fijarse al arrancar el proceso: el montaje de bases
    // de datos (sus secretos van en el entorno del pty) y el aviso al agente (en su línea).
    if (overrides?.launch !== undefined) record.launch = overrides.launch
    if (overrides?.extraEnv !== undefined) record.extraEnv = overrides.extraEnv

    // Una parada en curso se deja terminar: al acabar deja `exitCode` fijado y el bloque de
    // abajo se salta el cierre elegante, que teclearía `exit` en el agente.
    if (record.parada) await record.parada
    // Lo que se esperaba era un cierre: relanzar ahí dejaría un pty fuera del mapa.
    if (record.closing) throw new Error(`La sesión "${sessionId}" se cerró mientras esperaba para reiniciarse.`)

    if (record.exitCode === null) {
      record.reloading = true
      // El buffer se descarta ANTES del kill: el cierre elegante tarda hasta 3 s y en ese
      // tiempo la cola de antes del reinicio repintaría sobre la pantalla ya limpiada.
      descartarSalida(record)
      try {
        await this.muertes.enTurno(() => this.killCurrentShell(record))
      } finally {
        // El `finally` es obligatorio: con `reloading` colgado en `true` se descartaría en
        // silencio toda la salida del pty y la terminal quedaría en blanco sin ningún error.
        record.reloading = false
      }
    }

    // El buffer del pty viejo se descarta, no se vuelca: son los ecos del shell que acabamos
    // de matar y llegarían tras el reset del renderer, repintando su prompt sobre la pantalla
    // limpia. El camino de salida (`onExit`) sí vuelca. Se reinicia la pausa.
    descartarSalida(record)
    record.dataSub.dispose()
    record.exitSub.dispose()
    record.exitCode = null
    record.paused = false
    // Fin de la parada: el proceso nuevo vuelve a hablar y su salida real se anuncia.
    record.detenida = false

    this.spawnShell(record)
    return record
  }

  /** Termina el shell y saca la sesión de la lista. El contenedor sigue vivo. */
  async closeSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return

    // Una parada en curso se deja terminar antes de marcar el cierre: con `closing` puesto,
    // la parada se saltaría su kill de reserva creyendo que lo hace otro.
    if (record.parada) await record.parada

    record.closing = true
    await this.muertes.enTurno(() => this.killCurrentShell(record))
    record.dataSub.dispose()
    record.exitSub.dispose()
    descartarSalida(record)
    this.sessions.delete(sessionId)
  }

  /**
   * Cierra una sesión de agente NATIVO matando su árbol de procesos y sin teclear nada: ni
   * `^C` ni `exit`, que en la TUI del agente serían entrada del usuario. Es el cierre de la
   * hibernación por inactividad. La marca y la promesa de la parada se publican en síncrono,
   * así que un `closeSession` o un `reloadSession` simultáneos esperan y no teclean. Con el
   * proceso ya muerto no mata nada (su pid puede ser de otro). Sin sesión, no hace nada.
   */
  async cerrarConArbol(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    if (!record.host || !record.launch) {
      throw new Error(`La sesión "${sessionId}" no es de un agente nativo: no se cierra por su árbol.`)
    }
    if (record.parada || record.reloading || record.closing) {
      throw new Error(`La sesión "${sessionId}" está a mitad de una parada, de un reinicio o de un cierre.`)
    }
    record.closing = true
    record.detenida = true
    descartarSalida(record)
    let soltar: () => void = () => {}
    record.parada = new Promise<void>((resolve) => {
      soltar = resolve
    })
    const turno = this.muertes.coger()
    const estado = { inicio: Date.now(), arbol: false, recolectado: true }
    try {
      await turno.anterior
      estado.inicio = Date.now()
      // `killAllPtysNow` pudo llevársela mientras esperaba: ya no hay nada que matar.
      if (record.exitCode === null && this.sessions.get(sessionId) === record) {
        estado.arbol = true
        await this.matarArbol(record)
        estado.recolectado = await this.esperarSalida(record, REAP_TIMEOUT_MS)
      }
    } finally {
      try {
        this.darPorMuerto(record)
        if (this.sessions.get(sessionId) === record) this.sessions.delete(sessionId)
      } finally {
        // Pase lo que pase: un turno sin soltar atascaría todas las muertes que vengan detrás.
        record.parada = null
        soltar()
        turno.soltar()
      }
      dbLog(
        'hibernar',
        `session=${record.id} ${estado.arbol ? 'arbol' : 'ya-muerta'} ms=${Date.now() - estado.inicio}` +
          (estado.arbol ? ` recoleccion=${estado.recolectado ? 'ok' : 'vencida'}` : '')
      )
    }
  }

  /** Suelta las suscripciones del pty y deja el record con el proceso dado por terminado. */
  private darPorMuerto(record: SessionRecord): void {
    // `dispose` es idempotente (el `reloadSession`/`closeSession` de después lo repite), pero
    // sobre un pty ya destruido puede lanzar, y lo que sigue tiene que correr igual.
    for (const sub of [record.dataSub, record.exitSub]) {
      try {
        sub.dispose()
      } catch {
        /* el pty ya no existe */
      }
    }
    descartarSalida(record)
    if (record.exitCode === null) record.exitCode = -1
    record.resolveExit(-1) // sin efecto si el `onExit` ya la resolvió con el código real
  }

  /**
   * Para una sesión de agente NATIVO sin cerrarla: el proceso muere, el record se queda y un
   * `reloadSession()` posterior lo relanza en el mismo panel. Devuelve si el agente salió por
   * su cuenta (`elegante`) o hubo que matarlo. Lanza, sin tocar nada, con una sesión que no es
   * de agente nativo, está muerta, ya parada o a mitad de un reinicio o de un cierre.
   *
   * El gesto es solo `^C` repetido (nunca `exit`, que en la TUI del agente es un prompt) y las
   * paradas van de una en una aunque se pidan a la vez. Por qué, y el orden del kill de
   * reserva, en el ADR.
   */
  async detenerSesion(sessionId: string): Promise<{ elegante: boolean }> {
    const record = this.require(sessionId)
    this.validarDetenible(record, sessionId)

    // Antes del gesto: lo que el agente pinte al recibir los `^C` no llega al renderer.
    record.detenida = true
    descartarSalida(record)
    let soltar: () => void = () => {}
    record.parada = new Promise<void>((resolve) => {
      soltar = resolve
    })
    // El turno también se coge en síncrono: el orden de las paradas es el de las llamadas.
    const turno = this.muertes.coger()

    const estado: EstadoParada = { inicio: Date.now(), elegante: false, intentos: 0, recolectado: true }
    try {
      await turno.anterior
      estado.inicio = Date.now()
      await this.gestoDeParada(record, estado)
    } finally {
      this.cerrarParada(record, estado, soltar, turno.soltar)
    }
    return { elegante: estado.elegante }
  }

  /** Comprueba, antes de tocar nada, que la sesión se puede detener: un rechazo la deja intacta. */
  private validarDetenible(record: SessionRecord, sessionId: string): void {
    if (!record.host || !record.launch) {
      throw new Error(
        `La sesión "${sessionId}" no es de un agente nativo: sólo esas se pueden detener.`
      )
    }
    if (record.detenida || record.reloading || record.closing) {
      throw new Error(
        `La sesión "${sessionId}" ya está parada o a mitad de un reinicio o de un cierre.`
      )
    }
    if (record.exitCode !== null) {
      throw new Error(`La sesión "${sessionId}" ya no tiene un proceso vivo que detener.`)
    }
  }

  /** El gesto de la parada: hasta tres `^C` y, si el agente no sale, el kill de reserva. */
  private async gestoDeParada(record: SessionRecord, estado: EstadoParada): Promise<void> {
    const pty = record.pty
    // Con la lectura en pausa el agente puede quedarse bloqueado escribiendo y no atender el
    // `^C`; su salida se va a descartar igual, así que se deja fluir.
    if (record.paused) {
      record.paused = false
      try {
        pty.resume()
      } catch {
        /* el pty ya no está vivo: nada que reanudar */
      }
    }

    // Mientras esperaba su turno pudo salir por su cuenta (o caer con el cierre de la app):
    // no hay gesto que hacer, y escribir en un pty muerto solo daría un EPIPE.
    if (record.exitCode !== null) estado.elegante = !record.closing
    for (let i = 1; i <= DETENER_INTENTOS && record.exitCode === null; i++) {
      estado.intentos = i
      try {
        pty.write(CTRL_C)
      } catch {
        break // el pty ya no acepta escritura: al kill de reserva
      }
      if (await this.esperarSalida(record, CTRL_C_SETTLE_MS + DETENER_ESPERA_MS)) {
        estado.elegante = true
        break
      }
    }

    if (!estado.elegante) {
      // `closing` solo puede estar puesto aquí por `killAllPtysNow`, que ya mató el pty.
      if (record.exitCode === null && !record.closing) await this.matarDeReserva(record)
      estado.recolectado = await this.esperarSalida(record, REAP_TIMEOUT_MS)
    }
  }

  /** Cierra la parada aunque la recolección venza: suelta el pty, los turnos y deja el registro. */
  private cerrarParada(
    record: SessionRecord,
    estado: EstadoParada,
    soltar: () => void,
    soltarTurno: () => void
  ): void {
    try {
      this.darPorMuerto(record)
    } finally {
      // Pase lo que pase: un turno sin soltar atascaría todas las muertes que vengan detrás.
      record.parada = null
      soltar()
      soltarTurno()
    }
    // Al registro en disco: en la app empaquetada no hay consola y «cierre elegante» o
    // «cierre forzado» es lo que dice si el gesto sirve con los CLIs reales.
    dbLog(
      'detener',
      `session=${record.id} ${estado.elegante ? 'cierre elegante' : 'cierre forzado'} ` +
        `intentos=${estado.intentos} ms=${Date.now() - estado.inicio}` +
        (estado.elegante ? '' : ` recoleccion=${estado.recolectado ? 'ok' : 'vencida'}`)
    )
  }

  /** ¿Tiene la sesión un proceso vivo que no está parado? */
  estaViva(sessionId: string): boolean {
    const record = this.sessions.get(sessionId)
    return record !== undefined && record.exitCode === null && !record.detenida
  }

  /**
   * ¿Está la sesión a mitad de un reinicio o de un cierre, o parada por `detenerSesion()`?
   * Una parada también tiene `exitCode` fijado: quien clasifique debe preguntar esto antes
   * que `estaViva`.
   */
  estaOcupada(sessionId: string): boolean {
    const record = this.sessions.get(sessionId)
    return record !== undefined && (record.reloading || record.closing || record.detenida)
  }

  /** ¿Tiene la sesión la lectura del pty en pausa por contrapresión? */
  estaPausada(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.paused === true
  }

  /**
   * pid del proceso que lanzó el pty actual, o null si la sesión no existe o su proceso ya
   * terminó (el sistema reutiliza pids: uno viejo podría señalar a un proceso ajeno).
   */
  pidDe(sessionId: string): number | null {
    const record = this.sessions.get(sessionId)
    if (!record || record.exitCode !== null) return null
    return record.pty.pid
  }

  /**
   * Mata todos los ptys vivos al instante, sin cierre elegante. Solo lo usa el cierre para
   * actualizar: en Windows node-pty deja vivo un `OpenConsole.exe` cargado desde la carpeta de
   * instalación y el desinstalador falla si sigue abierto. Best-effort; devuelve cuántos mató.
   */
  killAllPtysNow(): number {
    let killed = 0
    for (const record of this.sessions.values()) {
      record.closing = true
      descartarSalida(record)
      try {
        record.dataSub.dispose()
      } catch {
        /* noop */
      }
      try {
        record.exitSub.dispose()
      } catch {
        /* noop */
      }
      try {
        record.pty.kill()
        killed++
      } catch {
        /* best-effort: seguimos con los demás */
      }
    }
    this.sessions.clear()
    return killed
  }

  /** Sesiones vivas, opcionalmente de un perfil. Excluye las muertas que se conservan para reabrir. */
  listSessions(profile?: Profile): TerminalSession[] {
    const live = [...this.sessions.values()].filter((s) => s.exitCode === null)
    return profile ? live.filter((s) => s.profileId === profile.id) : live
  }

  private require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error(`No existe una sesión de terminal con id "${sessionId}".`)
    return record
  }

  /** Lanza el pty y engancha al record el fan-out de datos y la captura del exitCode. */
  private spawnShell(record: SessionRecord): void {
    const pty = record.host ? lanzarPtyNativo(record) : lanzarPtyDocker(record)
    // Antes de que nadie escriba: en Windows, escribir en un pty recién muerto acababa en un
    // `write EAGAIN` no capturado. Ver `entradaPty.ts`.
    blindarEntradaPty(pty, record.id)

    record.pty = pty
    // Un pty nuevo nunca nace parado.
    record.detenida = false
    record.exit = new Promise<number>((resolve) => {
      record.resolveExit = resolve
    })

    record.dataSub = pty.onData((data) => {
      // El estertor del shell que estamos matando no se reenvía: los `^C` y el `exit` del
      // cierre elegante llegarían tras el reset del renderer y repintarían un prompt viejo.
      // Cae también lo que imprima un proceso que sobreviva al `^C`: el usuario pidió empezar
      // de cero. El agente comparte este camino y su pane escribe su propio rótulo al reiniciar.
      if (record.reloading) return
      // Tampoco la respuesta del agente a los `^C` de una parada.
      if (record.detenida) return
      record.outBuf.push(data)
      programarVolcado(record)
    })
    record.exitSub = pty.onExit(({ exitCode }) => {
      // Vuelca la cola ANTES de anunciar la salida (orden DATA -> EXIT), salvo en un reinicio
      // o una parada: su cola es el eco del cierre y el renderer ya limpió la pantalla.
      if (!record.reloading && !record.detenida) volcarAhora(record)
      record.exitCode = exitCode
      record.resolveExit(exitCode)
      // Se avisa solo de salidas que no provocamos nosotros. El record se conserva (`exited`)
      // para que reloadSession pueda resucitarlo en el mismo panel; el cierre definitivo
      // corre por closeSession/disposeAll.
      if (!record.reloading && !record.closing && !record.detenida) {
        for (const cb of record.exitListeners) cb(exitCode)
      }
    })
  }

  /**
   * Espera la salida del pty con tope. Ninguna espera es ilimitada: `record.exit` solo se
   * resuelve desde `onExit`, y si no llega, el reinicio se colgaría con `reloading` puesto y la
   * salida descartada. Peor caso con tope: un pty huérfano que el sistema acaba recogiendo.
   */
  private async esperarSalida(record: SessionRecord, ms: number): Promise<boolean> {
    return (await conTope(record.exit, ms)) === 'a-tiempo'
  }

  /**
   * Termina el shell actual y espera su onExit. Prioriza el cierre elegante (Ctrl-C y `exit`)
   * para que sea el propio shell quien salga con su exitCode real; `pty.kill()` es el último
   * recurso porque en Windows sin consola adjunta enmascara el exitCode. Idempotente.
   */
  private async killCurrentShell(record: SessionRecord): Promise<void> {
    if (record.exitCode !== null) {
      await this.esperarSalida(record, REAP_TIMEOUT_MS)
      return
    }

    try {
      // El `^C` debe procesarse ANTES de mandar `exit`: en el mismo tick readline descartaría
      // la línea `exit` y el shell no saldría.
      record.pty.write(CTRL_C)
      await esperar(CTRL_C_SETTLE_MS)
      record.pty.write('exit\n')
    } catch {
      // El pty ya no acepta escritura; caeremos al kill de abajo.
    }

    const exitedGracefully = await this.esperarSalida(record, GRACEFUL_EXIT_MS)

    if (!exitedGracefully && record.exitCode === null) {
      record.pty.kill()
      // `kill()` pide la muerte, no la garantiza: con tope, se sigue adelante si no se recolecta.
      await this.esperarSalida(record, REAP_TIMEOUT_MS)
    }
  }

  /**
   * Kill de reserva de `detenerSesion`. En Windows, primero el árbol (`taskkill /T /F`) y luego
   * el pty: al revés, los hijos de la PowerShell quedan huérfanos y fuera del árbol. Es un
   * método aparte porque `test-onexit-reload` lo neutraliza para fabricar una recolección
   * vencida.
   */
  private async matarDeReserva(record: SessionRecord): Promise<void> {
    const pty = record.pty
    if (esWindows()) await matarArbolWindows(pty.pid)
    // Si `taskkill` ya se lo llevó, el ConPTY está cerrado: un segundo cierre sería una
    // llamada nativa sobre un handle muerto.
    if (record.exitCode !== null) return
    try {
      pty.kill()
    } catch {
      /* ya muerto o sin handle: la recolección con tope de después decide */
    }
  }

  /**
   * Mata el árbol entero de la sesión y después el pty, en ese orden (ver `matarDeReserva`).
   * En macOS el árbol son los grupos y descendientes que decide `adaptadores/arbolProcesos`;
   * la rama de Windows es la misma llamada que la del kill de reserva.
   */
  private async matarArbol(record: SessionRecord): Promise<void> {
    const pty = record.pty
    if (esWindows()) await matarArbolWindows(pty.pid)
    else await matarArbolPosix(pty.pid)
    // Si `taskkill` ya se lo llevó, el ConPTY está cerrado: un segundo cierre sería una
    // llamada nativa sobre un handle muerto.
    if (record.exitCode !== null) return
    try {
      pty.kill()
    } catch {
      /* ya muerto o sin handle: la recolección con tope de después decide */
    }
  }
}
