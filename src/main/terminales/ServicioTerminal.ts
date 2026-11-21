// =============================================================================
// Sesiones de terminal interactivas (pty) sobre el contenedor persistente del GestorSandbox,
// ancladas al `rutaWorkspace` neutro de un proyecto, o sobre el shell nativo del sistema.
// Una sesión es un `docker exec -it … bash -il` (o el shell nativo, o un ejecutable sin shell como
// ssh) conectado a un pseudo-TTY.
// Depende de `GestorSandbox` (montajes), del adaptador `adaptadores/pty.ts` y de `paradaSesion.ts`
// (la parada de un agente nativo y la espera con tope de la salida del pty).
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
// Extensión explícita en los imports: los tests `.mts` importan este módulo con `node` a secas.
import type { IPty, IDisposable } from 'node-pty'
import path from 'node:path'
import type { Perfil } from '../perfiles/types.ts'
import type { GestorSandbox } from '../sandbox/GestorSandbox.ts'
import { nombreContenedorPara } from '../sandbox/gestor/nombres.ts'
import { registroBd } from '../db/registroBd.ts'
import { blindarEntradaPty } from './entradaPty.ts'
import { descartarSalida, programarVolcado, volcarAhora } from './bufferSalida.ts'
import { colaMuertesDelProceso } from './colaMuertes.ts'
import { lanzarPtyDeSesion, resolverRutaWorkspace } from './lanzamientoPty.ts'
import { codigoDeSalidaTardio, liberarPty, matarArbolPosix, matarArbolWindows, matarPty, raizViva, rematarPty } from './adaptadores/pty.ts'
import { notaTaskkill } from './adaptadores/taskkill.ts'
import { esWindows } from '../../shared/plataforma.ts'
import { conTope, esperar } from '../util/esperas.ts'
import {
  CTRL_C,
  ESPERA_CTRL_C_MS,
  TOPE_RECOLECCION_MS,
  abrirParada,
  esperarSalida,
  gestoDeParada,
  registrarParada,
  validarDetenible,
  type EstadoParada
} from './paradaSesion.ts'
import type { OpcionesCrearSesion, RegistroSesion, SesionTerminal } from './tiposSesion.ts'

export type { OpcionesCrearSesion, SesionTerminal } from './tiposSesion.ts'

const COLS_DEFECTO = 80
const FILAS_DEFECTO = 24

/** Margen para que el shell salga solo antes de forzar kill(). */
const TOPE_SALIDA_ORDENADA_MS = 3000
/** Tope para recuperar el código que ConPTY no trajo en `onExit`; menor que TOPE_RECOLECCION_MS. */
const CODIGO_TARDIO_TOPE_MS = 1000

/** Tope de columnas y filas aceptado del renderer: más que cualquier pantalla real. */
const MAX_TAMANO = 2000

/** El tamaño pedido, si son enteros entre 1 y el tope; si no, null (viene por IPC). */
function tamanoValido(t: unknown): { cols: number; rows: number } | null {
  if (typeof t !== 'object' || t === null) return null
  const { cols, rows: filas } = t as { cols?: unknown; rows?: unknown }
  const vale = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_TAMANO
  return vale(cols) && vale(filas) ? { cols, rows: filas } : null
}

/** Sesiones de terminal (pty) de los perfiles: crea, recarga, detiene y cierra. */
export class ServicioTerminal {
  /** Solo las sesiones en contenedor (`host` falso) lo necesitan; las nativas y las SSH no. */
  private readonly sandbox: GestorSandbox | undefined
  private readonly sesiones = new Map<string, RegistroSesion>()
  private counter = 0
  /** Turno de las MUERTES de pty (parar, cerrar, reiniciar, hibernar): de una en una, y del PROCESO. */
  private readonly muertes = colaMuertesDelProceso
  /** La app se está cerrando: desde aquí no nace ni renace ningún pty, que ya nadie mataría. */
  private apagando = false

  constructor(sandbox?: GestorSandbox) {
    this.sandbox = sandbox
  }

  /**
   * Abre un shell interactivo con cwd en el rutaWorkspace neutro del proyecto, reutilizando el
   * contenedor del GestorSandbox; en modo nativo, con cwd en la ruta real del proyecto.
   */
  async crearSesion(perfil: Perfil, opts: OpcionesCrearSesion): Promise<SesionTerminal> {
    const nombreContenedor = nombreContenedorPara(perfil)
    // En modo nativo no hay contenedor: no se consulta el registro de montajes del sandbox.
    const host = opts.host === true
    let rutaWorkspace: string
    if (host) {
      rutaWorkspace = path.resolve(opts.proyecto)
    } else {
      if (!this.sandbox) throw new Error('Una sesión en contenedor necesita el GestorSandbox.')
      rutaWorkspace = await resolverRutaWorkspace(this.sandbox, perfil, opts.proyecto)
    }

    const id = `term-${perfil.id}-${++this.counter}`
    const registro: RegistroSesion = {
      id,
      perfilId: perfil.id,
      proyecto: opts.proyecto,
      rutaWorkspace,
      nombreContenedor,
      host,
      comandoLanzamiento: opts.comandoLanzamiento,
      extraEnv: opts.extraEnv,
      ejecutable: opts.ejecutable,
      // `pty`, las suscripciones y `exit` los rellena lanzarShell().
      pty: undefined as unknown as IPty,
      cols: tamanoValido(opts.tamano)?.cols ?? COLS_DEFECTO,
      rows: tamanoValido(opts.tamano)?.rows ?? FILAS_DEFECTO,
      codigoSalida: null,
      recargando: false,
      cerrando: false,
      detenida: false,
      parada: null,
      oyentesDatos: new Set(),
      oyentesSalida: new Set(),
      bufSalida: [],
      temporizadorVolcado: null,
      pausado: false,
      suscripcionDatos: undefined as unknown as IDisposable,
      suscripcionSalida: undefined as unknown as IDisposable,
      salidaPty: undefined as unknown as Promise<number>,
      resolverSalidaPty: () => {}
    }

    this.exigirSinApagar()
    this.lanzarShell(registro)
    this.sesiones.set(id, registro)
    return registro
  }

  /** Lanza si la app ya se está cerrando: un pty que naciera ahora quedaría vivo tras ella. */
  private exigirSinApagar(): void {
    if (this.apagando) throw new Error('La app se está cerrando: no se abren sesiones nuevas.')
  }

  /** stdin del usuario hacia el shell. */
  write(sesionId: string, datos: string): void {
    const registro = this.exigir(sesionId)
    // Con la sesión parada (o parándose) lo tecleado se tira: un Enter colado entre dos `^C`
    // enviaría el borrador que el primero acaba de descartar. El pane también bloquea la
    // entrada, pero la garantía tiene que vivir junto al pty.
    if (registro.detenida) return
    registro.pty.write(datos)
  }

  /** Reflow del pty (columnas/filas). Se recuerda para restaurarlo tras un reload. */
  resize(sesionId: string, cols: number, filas: number): void {
    const registro = this.exigir(sesionId)
    registro.cols = cols
    registro.rows = filas
    registro.pty.resize(cols, filas)
  }

  /**
   * Contrapresión: pausa o reanuda la lectura del pty. Al pausar, el proceso de dentro se
   * bloquea al escribir y una salida masiva no inunda al renderer. Idempotente; un pty ya
   * muerto ignora la orden.
   */
  fijarPausado(sesionId: string, pausado: boolean): void {
    const registro = this.sesiones.get(sesionId)
    if (!registro || registro.pausado === pausado) return
    registro.pausado = pausado
    try {
      if (pausado) registro.pty.pause()
      else registro.pty.resume()
    } catch {
      /* el pty ya no está vivo: nada que pausar/reanudar */
    }
  }

  /** Suscribe a la salida del shell; sobrevive a `recargarSesion()`. Devuelve la baja. */
  onData(sesionId: string, cb: (datos: string) => void): () => void {
    const registro = this.exigir(sesionId)
    registro.oyentesDatos.add(cb)
    return () => {
      registro.oyentesDatos.delete(cb)
    }
  }

  /**
   * Suscribe al fin del shell, de primer nivel: sobrevive a `recargarSesion()` y solo dispara
   * en salidas reales (`exit`, un crash), nunca en el kill de un reload ni en la parada de
   * `detenerSesion()`. Devuelve la baja.
   */
  onExit(sesionId: string, cb: (codigoSalida: number | null) => void): () => void {
    const registro = this.exigir(sesionId)
    registro.oyentesSalida.add(cb)
    return () => {
      registro.oyentesSalida.delete(cb)
    }
  }

  /**
   * Levanta un shell nuevo en el mismo contenedor y cwd, recomputando el entorno, y conserva
   * el id y los suscriptores. Sirve para una sesión viva (mata el shell y lo relanza) y para
   * una muerta o parada (la resucita respawneando en el mismo record).
   */
  async recargarSesion(
    sesionId: string,
    sustituciones?: { comandoLanzamiento?: string; extraEnv?: Record<string, string>; ejecutable?: OpcionesCrearSesion['ejecutable'] }
  ): Promise<SesionTerminal> {
    const registro = this.exigir(sesionId)

    // El reload aplica lo que solo puede fijarse al arrancar el proceso: el montaje de bases
    // de datos (sus secretos van en el entorno del pty) y el aviso al agente (en su línea).
    if (sustituciones?.comandoLanzamiento !== undefined) registro.comandoLanzamiento = sustituciones.comandoLanzamiento
    if (sustituciones?.extraEnv !== undefined) registro.extraEnv = sustituciones.extraEnv
    // Reconectar una sesión SSH aplica los datos vigentes de su conexión.
    if (sustituciones?.ejecutable !== undefined) registro.ejecutable = sustituciones.ejecutable

    // Una parada en curso se deja terminar: al acabar deja `codigoSalida` fijado y el bloque de
    // abajo se salta el cierre elegante, que teclearía `exit` en el agente.
    if (registro.parada) await registro.parada
    // Lo que se esperaba era un cierre: relanzar ahí dejaría un pty fuera del mapa.
    if (registro.cerrando) throw new Error(`La sesión "${sesionId}" se cerró mientras esperaba para reiniciarse.`)

    if (registro.codigoSalida === null) {
      registro.recargando = true
      // El buffer se descarta ANTES del kill: el cierre elegante tarda hasta 3 s y en ese
      // tiempo la cola de antes del reinicio repintaría sobre la pantalla ya limpiada.
      descartarSalida(registro)
      try {
        await this.muertes.enTurno(() => this.matarShellActual(registro))
      } finally {
        // El `finally` es obligatorio: con `recargando` colgado en `true` se descartaría en
        // silencio toda la salida del pty y la terminal quedaría en blanco sin ningún error.
        registro.recargando = false
      }
    }
    // El pty viejo deja de ser de la sesión: si su raíz sigue viva (recolección vencida, o una parada
    // que lo dio por muerto), se remata aquí para que no siga vivo fuera del mapa. Solo entonces entra
    // en la cola: reconectar una sesión que ya terminó no espera a las muertes de otras sesiones.
    const viejo = registro.pty
    if (raizViva(viejo)) {
      await this.muertes.enTurno(async () => {
        rematarPty(viejo)
      })
    }

    // El buffer del pty viejo se descarta, no se vuelca: son los ecos del shell que acabamos
    // de matar y llegarían tras el reset del renderer, repintando su prompt sobre la pantalla
    // limpia. El camino de salida (`onExit`) sí vuelca. Se reinicia la pausa.
    descartarSalida(registro)
    registro.suscripcionDatos.dispose()
    registro.suscripcionSalida.dispose()
    // Mientras se esperaba la muerte del viejo, el cierre de la app pudo llevarse la sesión: relanzar
    // ahí dejaría un pty fuera del mapa que nadie mataría.
    if (registro.cerrando || this.sesiones.get(sesionId) !== registro) {
      throw new Error(`La sesión "${sesionId}" se cerró mientras se reiniciaba.`)
    }
    this.exigirSinApagar()
    registro.codigoSalida = null
    registro.pausado = false
    // Fin de la parada: el proceso nuevo vuelve a hablar y su salida real se anuncia.
    registro.detenida = false

    this.lanzarShell(registro)
    return registro
  }

  /** Termina el shell y saca la sesión de la lista. El contenedor sigue vivo. */
  async cerrarSesion(sesionId: string): Promise<void> {
    const registro = this.sesiones.get(sesionId)
    if (!registro) return

    // Una parada en curso se deja terminar antes de marcar el cierre: con `closing` puesto,
    // la parada se saltaría su kill de reserva creyendo que lo hace otro.
    if (registro.parada) await registro.parada

    registro.cerrando = true
    await this.muertes.enTurno(async () => {
      try {
        await this.matarShellActual(registro)
      } finally {
        // Sale del mapa: si la recolección venció, no puede quedar vivo sin nadie que lo mate.
        rematarPty(registro.pty)
      }
    })
    registro.suscripcionDatos.dispose()
    registro.suscripcionSalida.dispose()
    descartarSalida(registro)
    this.sesiones.delete(sesionId)
  }

  /**
   * Cierra una sesión de agente NATIVO matando su árbol de procesos y sin teclear nada: ni
   * `^C` ni `exit`, que en la TUI del agente serían entrada del usuario. Es el cierre de la
   * hibernación por inactividad. La marca y la promesa de la parada se publican en síncrono,
   * así que un `cerrarSesion` o un `recargarSesion` simultáneos esperan y no teclean. Con el
   * proceso ya muerto no mata nada (su pid puede ser de otro). Sin sesión, no hace nada.
   */
  async cerrarConArbol(sesionId: string): Promise<void> {
    const registro = this.sesiones.get(sesionId)
    if (!registro) return
    if (!registro.host || !registro.comandoLanzamiento) {
      throw new Error(`La sesión "${sesionId}" no es de un agente nativo: no se cierra por su árbol.`)
    }
    if (registro.parada || registro.recargando || registro.cerrando) {
      throw new Error(`La sesión "${sesionId}" está a mitad de una parada, de un reinicio o de un cierre.`)
    }
    registro.cerrando = true
    registro.detenida = true
    descartarSalida(registro)
    const soltar = abrirParada(registro)
    const turno = this.muertes.coger()
    const estado = { inicio: Date.now(), arbol: false, recolectado: true }
    try {
      await turno.anterior
      estado.inicio = Date.now()
      // `matarTodosLosPtysYa` pudo llevársela mientras esperaba: ya no hay nada que matar.
      try {
        if (registro.codigoSalida === null && this.sesiones.get(sesionId) === registro) {
          estado.arbol = true
          await this.matarArbol(registro)
          estado.recolectado = await esperarSalida(registro, TOPE_RECOLECCION_MS)
        }
      } finally {
        // Sale del mapa: si su salida no llegó, se remata para que no siga vivo sin nadie que lo mate.
        rematarPty(registro.pty)
      }
    } finally {
      try {
        this.darPorMuerto(registro)
        if (this.sesiones.get(sesionId) === registro) this.sesiones.delete(sesionId)
      } finally {
        // Pase lo que pase: un turno sin soltar atascaría todas las muertes que vengan detrás.
        registro.parada = null
        soltar()
        turno.soltar()
      }
      registroBd(
        'hibernar',
        `session=${registro.id} ${estado.arbol ? 'arbol' : 'ya-muerta'} ms=${Date.now() - estado.inicio}` +
          (estado.arbol ? ` recoleccion=${estado.recolectado ? 'ok' : 'vencida'}` : '')
      )
    }
  }

  /** Suelta las suscripciones del pty y deja el record con el proceso dado por terminado. */
  private darPorMuerto(registro: RegistroSesion): void {
    // `dispose` es idempotente (el `recargarSesion`/`cerrarSesion` de después lo repite), pero
    // sobre un pty ya destruido puede lanzar, y lo que sigue tiene que correr igual.
    for (const sub of [registro.suscripcionDatos, registro.suscripcionSalida]) {
      try {
        sub.dispose()
      } catch {
        /* el pty ya no existe */
      }
    }
    descartarSalida(registro)
    if (registro.codigoSalida === null) registro.codigoSalida = -1
    registro.resolverSalidaPty(-1) // sin efecto si el `onExit` ya la resolvió con el código real
  }

  /**
   * Para una sesión de agente NATIVO sin cerrarla: el proceso muere, el record se queda y un
   * `recargarSesion()` posterior lo relanza en el mismo panel. Devuelve si el agente salió por
   * su cuenta (`elegante`) o hubo que matarlo. Lanza, sin tocar nada, con una sesión que no es
   * de agente nativo, está muerta, ya parada o a mitad de un reinicio o de un cierre.
   *
   * El gesto es solo `^C` repetido (nunca `exit`, que en la TUI del agente es un prompt) y las
   * paradas van de una en una aunque se pidan a la vez. Por qué, y el orden del kill de
   * reserva, en el ADR.
   */
  async detenerSesion(sesionId: string): Promise<{ elegante: boolean }> {
    const registro = this.exigir(sesionId)
    validarDetenible(registro, sesionId)

    // Antes del gesto: lo que el agente pinte al recibir los `^C` no llega al renderer.
    registro.detenida = true
    descartarSalida(registro)
    const soltar = abrirParada(registro)
    // El turno también se coge en síncrono: el orden de las paradas es el de las llamadas.
    const turno = this.muertes.coger()

    const estado: EstadoParada = { inicio: Date.now(), elegante: false, intentos: 0, recolectado: true }
    try {
      await turno.anterior
      estado.inicio = Date.now()
      // El kill de reserva por el método: `test-onexit-recarga` lo neutraliza en su instancia.
      await gestoDeParada(registro, estado, (r) => this.matarDeReserva(r))
    } finally {
      this.cerrarParada(registro, estado, soltar, turno.soltar)
    }
    return { elegante: estado.elegante }
  }

  /** Cierra la parada aunque la recolección venza: suelta el pty, los turnos y deja el registro. */
  private cerrarParada(
    registro: RegistroSesion,
    estado: EstadoParada,
    soltar: () => void,
    soltarTurno: () => void
  ): void {
    try {
      this.darPorMuerto(registro)
    } finally {
      // Pase lo que pase: un turno sin soltar atascaría todas las muertes que vengan detrás.
      registro.parada = null
      soltar()
      soltarTurno()
    }
    registrarParada(registro, estado)
  }

  /** ¿Tiene la sesión un proceso vivo que no está parado? */
  estaViva(sesionId: string): boolean {
    const registro = this.sesiones.get(sesionId)
    return registro !== undefined && registro.codigoSalida === null && !registro.detenida
  }

  /**
   * ¿Está la sesión a mitad de un reinicio o de un cierre, o parada por `detenerSesion()`?
   * Una parada también tiene `codigoSalida` fijado: quien clasifique debe preguntar esto antes
   * que `estaViva`.
   */
  estaOcupada(sesionId: string): boolean {
    const registro = this.sesiones.get(sesionId)
    return registro !== undefined && (registro.recargando || registro.cerrando || registro.detenida)
  }

  /** ¿Tiene la sesión la lectura del pty en pausa por contrapresión? */
  estaPausada(sesionId: string): boolean {
    return this.sesiones.get(sesionId)?.pausado === true
  }

  /**
   * pid del proceso que lanzó el pty actual, o null si la sesión no existe o su proceso ya
   * terminó (el sistema reutiliza pids: uno viejo podría señalar a un proceso ajeno).
   */
  pidDe(sesionId: string): number | null {
    const registro = this.sesiones.get(sesionId)
    if (!registro || registro.codigoSalida !== null) return null
    return registro.pty.pid
  }

  /**
   * Cierre de la app: mata el ÁRBOL de cada pty vivo y después los ptys que no hayan salido. Con
   * solo `pty.kill()`, en Windows cae la raíz (la PowerShell) y sus hijos (el agente, `cmd`,
   * `OpenConsole.exe`) siguen vivos sin padre y retienen la carpeta del proyecto. Desde aquí no
   * nace ninguna sesión. Con tope: lo que no muera a tiempo se deja al `pty.kill()` del final.
   * Devuelve cuántos ptys había vivos; `anotar` recibe lo que conviene dejar escrito (un `taskkill`
   * que falló o que no acabó, el tope).
   */
  async matarTodoConArbol(topeMs: number, anotar: (msg: string) => void = () => {}): Promise<number> {
    this.apagando = true
    const vivos = [...this.sesiones.values()].filter((r) => r.codigoSalida === null)
    for (const registro of vivos) {
      registro.cerrando = true
      descartarSalida(registro)
    }
    const pids = vivos.map((r) => r.pty.pid)
    // Un solo `taskkill` para todos: matar ptys en paralelo desde node-pty revienta el proceso.
    const arboles = esWindows()
      ? matarArbolWindows(pids).then((r) => {
          const nota = notaTaskkill(r)
          if (nota) anotar(nota)
        })
      : Promise.all(pids.map((pid) => matarArbolPosix(pid)))
    if ((await conTope(arboles, topeMs)) === 'tope') anotar(`los árboles no murieron en ${topeMs} ms`)
    await conTope(Promise.all(vivos.map((r) => esperarSalida(r, topeMs))), topeMs)
    this.matarTodosLosPtysYa()
    return vivos.length
  }

  /**
   * Lo mismo que `matarTodoConArbol` para UNAS sesiones, sin apagar el servicio: cerrar una ventana
   * mata el árbol de las suyas de una vez (sin teclear nada en el agente) y el resto sigue. Las
   * sesiones quedan en el mapa: quien llama las cierra después con `cerrarSesion`, que ya las
   * encuentra muertas. Devuelve cuántas había vivas.
   */
  async matarArbolesDe(ids: readonly string[], topeMs: number, anotar: (msg: string) => void = () => {}): Promise<number> {
    const vivos = ids
      .map((id) => this.sesiones.get(id))
      .filter((r): r is RegistroSesion => r !== undefined && r.codigoSalida === null && !r.cerrando && !r.parada)
    if (vivos.length === 0) return 0
    for (const registro of vivos) {
      registro.cerrando = true
      descartarSalida(registro)
    }
    const pids = vivos.map((r) => r.pty.pid)
    const arboles = esWindows()
      ? matarArbolWindows(pids).then((r) => {
          const nota = notaTaskkill(r)
          if (nota) anotar(nota)
        })
      : Promise.all(pids.map((pid) => matarArbolPosix(pid)))
    if ((await conTope(arboles, topeMs)) === 'tope') anotar(`los árboles no murieron en ${topeMs} ms`)
    await conTope(Promise.all(vivos.map((r) => esperarSalida(r, topeMs))), topeMs)
    return vivos.length
  }

  /**
   * Mata al instante, sin cierre elegante, todos los ptys y vacía el mapa. En Windows node-pty deja
   * vivo un `OpenConsole.exe` cargado desde la carpeta de instalación y el desinstalador falla si
   * sigue abierto. Best-effort; devuelve cuántos mató.
   */
  matarTodosLosPtysYa(): number {
    this.apagando = true
    let matados = 0
    for (const registro of this.sesiones.values()) {
      registro.cerrando = true
      descartarSalida(registro)
      try {
        registro.suscripcionDatos.dispose()
      } catch {
        /* noop */
      }
      try {
        registro.suscripcionSalida.dispose()
      } catch {
        /* noop */
      }
      try {
        // También a los que ya salieron: es lo que cierra su pseudoconsola, y con ella el
        // `OpenConsole.exe`, que no cuelga del árbol de la shell y `taskkill /T` no alcanza. Una sola
        // vez por pty: el que ya lo tuvo no lo repite.
        matarPty(registro.pty)
        matados++
      } catch {
        /* best-effort: seguimos con los demás */
      }
    }
    this.sesiones.clear()
    return matados
  }

  /** Sesiones vivas, opcionalmente de un perfil. Excluye las muertas que se conservan para reabrir. */
  listarSesiones(perfil?: Perfil): SesionTerminal[] {
    const vivas = [...this.sesiones.values()].filter((s) => s.codigoSalida === null)
    return perfil ? vivas.filter((s) => s.perfilId === perfil.id) : vivas
  }

  private exigir(sesionId: string): RegistroSesion {
    const registro = this.sesiones.get(sesionId)
    if (!registro) throw new Error(`No existe una sesión de terminal con id "${sesionId}".`)
    return registro
  }

  /** Lanza el pty y engancha al record el fan-out de datos y la captura del exitCode. */
  private lanzarShell(registro: RegistroSesion): void {
    const pty = lanzarPtyDeSesion(registro)
    // Antes de que nadie escriba: en Windows, escribir en un pty recién muerto acababa en un
    // `write EAGAIN` no capturado. Ver `entradaPty.ts`.
    blindarEntradaPty(pty, registro.id)

    registro.pty = pty
    // Un pty nuevo nunca nace parado.
    registro.detenida = false
    registro.salidaPty = new Promise<number>((resolver) => {
      registro.resolverSalidaPty = resolver
    })

    registro.suscripcionDatos = pty.onData((datos) => {
      // El estertor del shell que estamos matando no se reenvía: los `^C` y el `exit` del
      // cierre elegante llegarían tras el reset del renderer y repintarían un prompt viejo.
      // Cae también lo que imprima un proceso que sobreviva al `^C`: el usuario pidió empezar
      // de cero. El agente comparte este camino y su pane escribe su propio rótulo al reiniciar.
      if (registro.recargando) return
      // Tampoco la respuesta del agente a los `^C` de una parada.
      if (registro.detenida) return
      registro.bufSalida.push(datos)
      programarVolcado(registro)
    })
    registro.suscripcionSalida = pty.onExit(({ exitCode }) => {
      // Con el proceso fuera, el hilo lector de salida de Windows ya no tiene nada que leer. Es el
      // ÚNICO sitio que lo suelta: antes de la salida, un `kill()` que node-pty aún tiene en cola
      // (pty sin su primer byte) necesita ese hilo para llegar a ejecutarse. Toda salida recolectada
      // pasa por aquí; una que no se recolectó conserva su lector.
      liberarPty(pty)
      // ConPTY a veces avisa sin código (`onExit({})`): una pestaña SSH que no conecta perdería
      // el 255 y con él «No se pudo conectar». Se recupera antes de anunciar nada.
      if (typeof exitCode === 'number') this.alSalir(registro, pty, exitCode)
      else void codigoDeSalidaTardio(pty, CODIGO_TARDIO_TOPE_MS).then((codigo) => this.alSalir(registro, pty, codigo))
    })
  }

  /**
   * Fija la salida de `pty` y la anuncia. Sin código (ConPTY no lo dio ni tarde) el record queda
   * con -1, como `darPorMuerto`, y a quien escucha le llega ESE -1: el mismo valor que se ve en la
   * sesión. En Windows -1 es también como sale ssh de sus fallos, así que una pestaña SSH sin código
   * se clasifica igual por lo que escribió (`clasificarSalidaSsh`). Si entretanto se dio por muerto
   * o tiene otro pty, no se toca: el código sería de un proceso que ya no es el suyo.
   */
  private alSalir(registro: RegistroSesion, pty: IPty, codigo: number | null): void {
    if (registro.pty !== pty || registro.codigoSalida !== null) return
    // Vuelca la cola ANTES de anunciar la salida (orden DATA -> EXIT), salvo en un reinicio
    // o una parada: su cola es el eco del cierre y el renderer ya limpió la pantalla.
    if (!registro.recargando && !registro.detenida) volcarAhora(registro)
    registro.codigoSalida = codigo ?? -1
    registro.resolverSalidaPty(registro.codigoSalida)
    // Se avisa solo de salidas que no provocamos nosotros. El registro se conserva (con su
    // `codigoSalida`) para que recargarSesion pueda resucitarlo en el mismo panel; el cierre
    // definitivo corre por cerrarSesion.
    if (!registro.recargando && !registro.cerrando && !registro.detenida) {
      for (const cb of registro.oyentesSalida) cb(registro.codigoSalida)
    }
  }

  /**
   * Termina el shell actual y espera su onExit. Prioriza el cierre elegante (Ctrl-C y `exit`)
   * para que sea el propio shell quien salga con su exitCode real; `pty.kill()` es el último
   * recurso porque en Windows sin consola adjunta enmascara el exitCode. Idempotente.
   */
  private async matarShellActual(registro: RegistroSesion): Promise<void> {
    // Sin shell delante no hay a quién pedir `exit`: un `^C` o un `exit` irían al programa (en una
    // sesión SSH, al equipo remoto). Se mata el árbol sin teclear nada y se espera la recolección.
    if (registro.ejecutable && registro.codigoSalida === null) await this.matarArbol(registro)
    if (registro.codigoSalida !== null || registro.ejecutable) {
      await esperarSalida(registro, TOPE_RECOLECCION_MS)
      return
    }

    try {
      // El `^C` debe procesarse ANTES de mandar `exit`: en el mismo tick readline descartaría
      // la línea `exit` y el shell no saldría.
      registro.pty.write(CTRL_C)
      await esperar(ESPERA_CTRL_C_MS)
      registro.pty.write('exit\n')
    } catch {
      // El pty ya no acepta escritura; caeremos al kill de abajo.
    }

    const salioOrdenadamente = await esperarSalida(registro, TOPE_SALIDA_ORDENADA_MS)

    if (!salioOrdenadamente && registro.codigoSalida === null) {
      // El árbol y no solo la raíz: un agente no sale con `exit`, y en Windows `pty.kill()` mata la
      // PowerShell y deja vivo al agente que lanzó, sin padre.
      await this.matarArbol(registro)
      // `kill()` pide la muerte, no la garantiza: con tope, se sigue adelante si no se recolecta.
      await esperarSalida(registro, TOPE_RECOLECCION_MS)
    }
  }

  /**
   * Kill de reserva de `detenerSesion`. En Windows es `matarArbol`: primero el árbol
   * (`taskkill /T /F`), luego la espera con tope y solo entonces el pty; al revés, los hijos de la
   * PowerShell quedan huérfanos, y sin la espera `kill()` caería sobre un ConPTY ya cerrado. En
   * macOS sigue siendo solo `pty.kill()`. Es un método aparte porque `test-onexit-recarga` lo
   * neutraliza para fabricar una recolección vencida.
   */
  private async matarDeReserva(registro: RegistroSesion): Promise<void> {
    if (esWindows()) return this.matarArbol(registro)
    matarPty(registro.pty)
  }

  /**
   * Mata el árbol entero de la sesión y, solo si su salida no llega con tope, el pty; en Windows
   * es también el kill de reserva de `detenerSesion`. En macOS el árbol son los grupos y
   * descendientes que decide `adaptadores/arbolProcesos`. Quien llama espera después la
   * recolección: si la salida ya llegó aquí, esa espera no tarda.
   */
  private async matarArbol(registro: RegistroSesion): Promise<void> {
    const pty = registro.pty
    if (esWindows()) {
      const nota = notaTaskkill(await matarArbolWindows(pty.pid))
      if (nota) registroBd('pty', `session=${registro.id} ${nota}`)
    } else await matarArbolPosix(pty.pid)
    // `onExit` llega DESPUÉS, asíncrono: mirar `codigoSalida` ya casi siempre daría null. Si `taskkill`
    // se lo llevó, el ConPTY está cerrado y `kill()` sería una llamada nativa sobre un handle muerto.
    if (await esperarSalida(registro, TOPE_RECOLECCION_MS)) return
    matarPty(pty)
  }
}
