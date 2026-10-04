// =============================================================================
// Puente local: `tdb` le pregunta a Tessera, en cada invocación, qué bases tiene montadas y con qué
// credenciales, así montar y desmontar aplica al momento. Un token por sesión ve solo lo montado en su
// proyecto (o, el de un solo uso, su conexión); cada secreto viaja con la huella de su destino. Pipe en
// Windows, socket en una carpeta 0700 en POSIX. Sin `electron`: el registro se inyecta.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================
import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
// Extensión explícita: `test-db-bridge.mts` importa este módulo con `node` a secas.
import { nombreAleatorio, planPuntoEscucha } from './puntoEscucha.ts'
import { huellaDestino, type DestinoBd } from './huellaDestino.ts'

/** Versión del protocolo. `tdb` la manda y el puente la exige. */
const PROTOCOLO = 1

/** Dónde escucha el puente, y qué carpeta hay que barrer al cerrar (vacía en Windows). */
interface PuntoEscucha {
  /** Lo que se pasa a `server.listen()` y viaja en `TESSERA_DB_PIPE`. */
  nombre: string
  /** Carpeta privada a borrar en `stop()`. Vacía cuando no hay nada que borrar. */
  carpeta: string
}

/**
 * El punto de escucha: un named pipe en Windows y, en POSIX, un socket dentro de una carpeta 0700
 * del temporal (con `/tmp` de respaldo por el tope de `sun_path`). Si la carpeta no se puede crear
 * no lanza: falla `listen` y se cae al contrato antiguo. Ver docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md.
 */
function puntoDeEscucha(log: (msg: string) => void): PuntoEscucha {
  // El orden de las candidatas es la preferencia: el temporal del usuario primero
  // (privado por usuario en macOS), `/tmp` como respaldo. Ver `puntoEscucha.ts`.
  const plan = planPuntoEscucha(nombreAleatorio(), [tmpdir(), '/tmp'])
  // El aviso va ANTES de tocar nada: si `listen` va a fallar, el porqué tiene que
  // estar ya escrito en el registro de bases cuando llegue su `EINVAL`.
  if (plan.aviso !== null) log(plan.aviso)
  if (plan.carpeta !== '') {
    try {
      mkdirSync(plan.carpeta, { recursive: true, mode: 0o700 })
    } catch {
      /* que falle `listen` y se caiga al contrato antiguo; no es fatal */
    }
  }
  return { nombre: plan.nombre, carpeta: plan.carpeta }
}

/**
 * Tope de una petición. Son cuatro campos; 4 KiB sobran de largo, y poner un tope
 * evita que un cliente roto (o malicioso) haga crecer un buffer sin fin.
 */
const MAX_PETICION = 4096

/** Un cliente que no completa su petición en este tiempo se descarta. */
const TIMEOUT_SOCKET_MS = 5000

/** Vida de un token de un solo uso (el del botón "Probar" del panel). */
const TOKEN_EFIMERO_MS = 60_000

/** Clave de un proyecto dentro del mapa de ámbitos. Debe casar con `editorTargetKey` del renderer. */
function claveProyecto(profileId: string, projectHostPath: string): string {
  return `${profileId}|${projectHostPath}`
}

/**
 * Lo que el puente sabe de una sesión viva. El ámbito NO está aquí: es del PROYECTO
 * (`ambitos`) y se resuelve en cada invocación. Nada de lo que traiga la petición
 * del cliente puede ampliarlo: la concesión solo guarda de quién es el token.
 */
interface Concesion {
  profileId: string
  projectHostPath: string
  /**
   * ¿Es la sesión del agente de datos (el espacio de datos del perfil)? INFORMATIVO:
   * se devuelve en `resolve` para la redacción de los mensajes de `tdb` y no cambia
   * el ámbito. Siempre false en un token de un solo uso.
   */
  espacioDatos: boolean
  /** Solo para tokens de un solo uso: id autorizado y momento de caducidad. */
  unaVez?: { connectionId: string; caducaEn: number }
}

/** Lo que el main sabe de una sesión al acuñar su token, además de su proyecto. */
export interface InfoConcesion {
  /** Ver `Concesion.espacioDatos`. Ausente = false (un proyecto). */
  espacioDatos?: boolean
}

/** Lo que el puente necesita de una conexión: id, perfil y destino (para su huella). */
export interface ConexionDelPuente extends DestinoBd {
  id: string
  profileId: string
}

/** Lo que el puente recibe: las conexiones y secretos del registro, el reloj y el log. */
export interface DbBridgeDeps {
  /** TODAS las conexiones de un perfil. */
  conexionesDelPerfil: (profileId: string) => ConexionDelPuente[]
  /** Secreto descifrado de una conexión, o null si no hay o es ilegible. */
  secretoDe: (id: string) => string | null
  /** Ahora, inyectable para poder probar la caducidad sin esperar un minuto. */
  ahora?: () => number
  /**
   * Registro. Se INYECTA en vez de importar `dbLog` para que este módulo no arrastre
   * `electron`: así su test corre con `node` a secas, como el resto de los del repo.
   */
  log?: (msg: string) => void
}

/** Lo que el puente responde a un `resolve`. */
export interface RespuestaResolve {
  ok: true
  v: number
  /** Ids de las conexiones montadas AHORA MISMO en esa sesión. */
  scope: string[]
  /** Secretos de esas conexiones. Solo de esas. */
  secretos: Record<string, string>
  /**
   * La huella del destino de cada secreto (`huellaDestino`), con las mismas claves que
   * `secretos`: `tdb` no usa un secreto contra una entrada del registro con otra huella (ver
   * el ADR). No es un secreto.
   */
  huellas: Record<string, string>
  /**
   * SIEMPRE false. Significaba "ámbito sin acotar" (la antigua consola de datos) y ya
   * no lo concede nadie. Se sigue enviando, explícito, porque `tdb.cjs` hace
   * `scopeDefinido = !r.consola`: con el campo ausente también saldría `true`, pero
   * un contrato que funciona por accidente es el primero que rompe el cambio
   * siguiente.
   */
  consola: false
  /**
   * ¿Es la sesión del agente de datos? INFORMATIVO: `tdb` elige con esto la
   * redacción de sus mensajes («el agente de datos» / «este proyecto») y manda sobre
   * `TESSERA_DB_ESPACIO`, que es su respaldo. No cambia `scope` ni `secretos`.
   */
  espacioDatos: boolean
}

/** Puente local que sirve a `tdb` el ámbito y los secretos de una sesión en cada invocación. */
export class DbBridge {
  private readonly deps: DbBridgeDeps
  private servidor: Server | null = null
  private nombre = ''
  /**
   * Carpeta privada del socket en POSIX, para poder borrarla en `stop()`. Vacía en
   * Windows, donde el pipe es un objeto del kernel y no hay archivo que barrer.
   */
  private carpetaSocket = ''
  /**
   * Último punto de escucha, para que `reanudar()` vuelva al MISMO: es el nombre que
   * ya llevan en su entorno los ptys vivos. `stop()` lo olvida; `pausar()` no.
   */
  private puntoPrevio: PuntoEscucha | null = null
  /**
   * Cierre en curso de la última pausa. `reanudar()` lo espera antes de volver a
   * escuchar en el mismo nombre: mientras quede una conexión abierta del servidor
   * viejo, el pipe de Windows sigue existiendo y el `listen` nuevo fallaría.
   */
  private cierre: Promise<void> = Promise.resolve()
  /** token -> concesión. En memoria: si el proceso muere, no queda nada que revocar. */
  private readonly concesiones = new Map<string, Concesion>()
  /** sessionId -> token, para poder revocar por sesión al cerrarla. */
  private readonly porSesion = new Map<string, string>()
  /**
   * Ámbito por PROYECTO, no por sesión. Es lo que hace que un cambio de casillas
   * llegue de una sola vez al pane del agente Y a las terminales de abajo de ese
   * proyecto, sin que nadie tenga que ir buscando qué sesiones tocar.
   */
  private readonly ambitos = new Map<string, string[]>()

  private readonly log: (msg: string) => void

  constructor(deps: DbBridgeDeps) {
    this.deps = deps
    this.log = deps.log ?? (() => {})
  }

  /** ¿Está el puente escuchando? Decide qué contrato se inyecta en el pty. */
  get listo(): boolean {
    return this.servidor !== null
  }

  /** Nombre del pipe, para pasarlo por el entorno. Vacío si no está levantado. */
  get pipe(): string {
    return this.nombre
  }

  /**
   * Levanta el pipe. Nombre ALEATORIO de 64 bits por instancia: dos Tesseras a la
   * vez (la instalada y una de desarrollo) no chocan, y cada terminal lleva en su
   * entorno el nombre de la suya.
   *
   * Si falla, no es fatal: `listo` se queda en false y el entorno del pty cae al
   * contrato antiguo (secretos en variables). Peor, pero funcionando.
   */
  start(): void {
    if (this.servidor) return
    void this.escuchar(puntoDeEscucha(this.log), null)
  }

  /**
   * Escucha en `punto`. Resuelve cuando el servidor ya escucha o cuando se dio por
   * perdido (nunca rechaza: un puente que no levanta no es fatal, ver `start`).
   *
   * `respaldo` es lo que se intenta si el `listen` falla ANTES de llegar a escuchar
   * —solo lo pasa `reanudar()`, que prueba primero el punto viejo—. Un error que
   * llegue DESPUÉS de escuchar no lo dispara: ese servidor ya funcionó, y cambiarle el
   * nombre por debajo a los ptys vivos sería peor que dejarlo como está.
   */
  private escuchar(punto: PuntoEscucha, respaldo: (() => Promise<void>) | null): Promise<void> {
    this.carpetaSocket = punto.carpeta
    this.puntoPrevio = punto
    const { nombre } = punto
    return new Promise<void>((resolve) => {
      let escuchando = false
      try {
        const servidor = createServer((socket) => this.atender(socket))
        servidor.on('error', (err) => {
          this.log(`ERROR del servidor: ${String(err)}`)
          // Se cierra y se barre, no basta con olvidarlo: quedarían el descriptor del listener (si el
          // error llegó tras un `listen` correcto) y la carpeta 0700 del socket (solo en POSIX), y un
          // segundo `start()` pisaría `carpetaSocket` dejando la primera imposible de barrer. El caso
          // que lo dispara es el `EINVAL` por `sun_path` demasiado largo que avisa `puntoEscucha.ts`.
          try {
            servidor.close()
          } catch {
            /* si ya estaba cerrado, no hay nada que soltar */
          }
          // Solo si sigue siendo EL servidor: el error tardío de uno que ya se pausó
          // no puede tumbar al que lo sustituyó, ni barrerle la carpeta.
          if (this.servidor === servidor) {
            this.servidor = null
            this.nombre = ''
            this.limpiarCarpetaSocket()
          }
          if (!escuchando && respaldo) {
            escuchando = true // un único respaldo por intento, aunque llegue otro 'error'
            void respaldo().then(resolve)
            return
          }
          resolve()
        })
        servidor.listen(nombre, () => {
          escuchando = true
          // Una pausa entre el `listen` y este aviso ya lo dio por cerrado: no se
          // resucita a sus espaldas.
          if (this.servidor !== servidor) {
            resolve()
            return
          }
          this.nombre = nombre
          this.log('escuchando (montaje en caliente disponible)')
          resolve()
        })
        // `listen` es asíncrono, pero el nombre ya se puede publicar: el primer `tdb`
        // llega segundos después, cuando el usuario teclea.
        this.servidor = servidor
        this.nombre = nombre
      } catch (err) {
        this.log(`no se pudo levantar: ${String(err)} (se usarán variables de entorno)`)
        this.servidor = null
        this.nombre = ''
        resolve()
      }
    })
  }

  /**
   * Cierra el punto de escucha SIN olvidar nada: el nombre, los tokens y los ámbitos
   * se quedan para `reanudar()`. Es lo que usa el cierre de la app, que se puede
   * abortar (ver el ADR). Resuelve cuando el servidor terminó de cerrarse, o sea
   * cuando ya no queda ninguna conexión suya abierta; como mucho `TIMEOUT_SOCKET_MS`,
   * que es lo que vive un cliente que no termina su petición.
   *
   * La carpeta del socket SÍ se barre ya: si la app sale justo después —el caso
   * normal—, no hay otro momento para hacerlo.
   */
  pausar(): Promise<void> {
    const servidor = this.servidor
    this.servidor = null
    this.nombre = ''
    let cierre: Promise<void> = Promise.resolve()
    if (servidor) {
      cierre = new Promise<void>((resolve) => {
        try {
          // El callback llega también con error (servidor que no llegó a escuchar):
          // en los dos casos ya no hay nada suyo abierto.
          servidor.close(() => resolve())
        } catch {
          resolve()
        }
      })
    }
    this.limpiarCarpetaSocket()
    this.cierre = cierre
    return cierre
  }

  /**
   * Vuelve a escuchar tras una `pausar()`, en el MISMO punto si se puede (ver el
   * ADR: es lo que mantiene vivos los ptys que ya llevan ese nombre y su token).
   * Si no se puede, en uno nuevo. Idempotente: con el servidor ya levantado no hace
   * nada. Nunca rechaza.
   */
  async reanudar(): Promise<void> {
    if (this.servidor) return
    await this.cierre
    // Otro `reanudar()` (o un `start()`) pudo ganar mientras se esperaba el cierre.
    if (this.servidor) return
    const previo = this.puntoPrevio
    const nuevo = (): Promise<void> => this.escuchar(puntoDeEscucha(this.log), null)
    if (!previo) {
      await nuevo()
      return
    }
    if (previo.carpeta !== '' && !this.recrearCarpeta(previo.carpeta)) {
      await nuevo()
      return
    }
    await this.escuchar(previo, async () => {
      this.log('no se pudo volver a escuchar en el mismo punto: se usa uno nuevo (las terminales abiertas tendrán que recargarse)')
      await nuevo()
    })
    if (this.nombre === previo.nombre) this.log('reanudado en el mismo punto: las sesiones abiertas siguen valiendo')
  }

  /**
   * Recrea la carpeta privada del socket para reanudar en el mismo punto. SIN
   * `recursive` a propósito: así `mkdir` falla con `EEXIST` si la carpeta ya existe, y
   * eso es justo lo que hay que detectar. El nombre dejó de ser secreto en cuanto se
   * creó (en el respaldo de `/tmp` cualquiera lista el directorio), así que entre la
   * pausa y la reanudación otro usuario pudo crear esa carpeta a su nombre; escuchar
   * dentro le daría a él el socket y, con él, los tokens de quien conectara. Con
   * `mkdir` exclusivo la carpeta es nuestra y nace en 0700, o no se usa.
   */
  private recrearCarpeta(carpeta: string): boolean {
    try {
      mkdirSync(carpeta, { mode: 0o700 })
      return true
    } catch (err) {
      const codigo = (err as NodeJS.ErrnoException).code ?? String(err)
      this.log(`no se pudo recrear la carpeta del socket (${codigo}): se escucha en un punto nuevo`)
      return false
    }
  }

  /**
   * Apagado DEFINITIVO: cierra el punto de escucha y olvida todas las concesiones y el
   * nombre, así que un `reanudar()` posterior empezaría de cero. El cierre de la app
   * usa `pausar()`, que se puede deshacer.
   */
  stop(): void {
    this.concesiones.clear()
    this.porSesion.clear()
    this.puntoPrevio = null
    try {
      this.servidor?.close()
    } catch {
      /* cerrar es best-effort: el proceso se va igualmente */
    }
    this.servidor = null
    this.nombre = ''
    // En POSIX el socket es un archivo y sobrevive al proceso: sin barrer su carpeta, cada arranque
    // dejaría un directorio huérfano. En Windows el pipe es del kernel y no hay nada que hacer.
    this.limpiarCarpetaSocket()
  }

  /**
   * Borra la carpeta privada del socket, si la hubo. Best-effort y silencioso: si el
   * temporal ya no está (lo barrió el sistema) o no se puede borrar, el proceso se va
   * igualmente y lo que queda es un directorio vacío de 0 bytes.
   */
  private limpiarCarpetaSocket(): void {
    const carpeta = this.carpetaSocket
    this.carpetaSocket = ''
    if (!carpeta) return
    try {
      rmSync(carpeta, { recursive: true, force: true })
    } catch {
      /* el temporal es del sistema; que quede una carpeta vacía no rompe nada */
    }
  }

  // --- Concesiones -----------------------------------------------------------

  /**
   * Acuña un token para una sesión que aún NO existe.
   *
   * El orden importa y no es negociable: el entorno del pty se construye ANTES de
   * `createSession`, así que en ese momento no hay `sessionId` al que atarlo. Se
   * acuña primero y se ata después con `bind`.
   *
   * El token ve lo montado en su proyecto, y nada más: no hay parámetro para "ver
   * todas" (ver el ADR). Vale igual para el espacio de datos del perfil, cuya
   * marca (`info.espacioDatos`) solo cambia la redacción de los mensajes de `tdb`.
   */
  mint(profileId: string, projectHostPath: string, info: InfoConcesion = {}): string {
    const token = randomBytes(24).toString('hex')
    this.concesiones.set(token, {
      profileId,
      projectHostPath,
      // Estricto: solo un `true` de verdad marca el espacio. Cualquier otro valor
      // que llegara por un llamador descuidado cuenta como proyecto, que es lo de
      // siempre.
      espacioDatos: info.espacioDatos === true
    })
    return token
  }

  /** Ata un token ya acuñado a su sesión, para poder revocarlo al cerrarla. */
  bind(token: string, sessionId: string): void {
    if (!this.concesiones.has(token)) return
    // Una sesión que se reata (reload) suelta su token anterior: si no, cada recarga
    // dejaría un token vivo y sin dueño, que es exactamente un oráculo de credenciales.
    const previo = this.porSesion.get(sessionId)
    if (previo && previo !== token) this.concesiones.delete(previo)
    this.porSesion.set(sessionId, token)
  }

  /**
   * Token de UN SOLO USO para una conexión concreta. Lo usa el botón "Probar" del
   * panel, que corre `tdb` desde el main y no tiene pty ni sesión.
   *
   * Existe para no romper una propiedad que este subsistema ya tenía y conviene
   * conservar: el panel y el agente ejercitan EXACTAMENTE el mismo camino, así que
   * un fallo se reproduce igual desde los dos lados. Si "Probar" siguiera pasando el
   * secreto por variables, dejaría de probar lo que de verdad usa el agente.
   */
  mintUnaVez(connectionId: string, profileId: string): string {
    const token = randomBytes(24).toString('hex')
    const ahora = this.deps.ahora ? this.deps.ahora() : Date.now()
    this.concesiones.set(token, {
      profileId,
      projectHostPath: '',
      // El botón "Probar" no es la sesión de nadie: ni proyecto ni espacio. False es
      // lo neutro, y sus mensajes no hablan de montajes.
      espacioDatos: false,
      unaVez: { connectionId, caducaEn: ahora + TOKEN_EFIMERO_MS }
    })
    return token
  }

  /**
   * Revoca lo que tuviera esa sesión. Hay que llamarlo desde TODOS los caminos por
   * los que muere un pty —cierre normal, hibernación del perfil, recuperación de un
   * crash del renderer, cierre para actualizar—: olvidar uno deja vivo un token que
   * sigue sirviendo credenciales a un proceso que ya nadie mira.
   */
  revoke(sessionId: string): void {
    const token = this.porSesion.get(sessionId)
    if (!token) return
    this.concesiones.delete(token)
    this.porSesion.delete(sessionId)
  }

  /**
   * Perfil al que pertenece un token. Lo necesita el puente de DOCKER: ejecuta el
   * `tdb` real en Windows y tiene que decirle con qué perfil corre, porque de ahí
   * salen el filtrado y los mensajes.
   */
  perfilDeToken(token: string): string | null {
    return this.buscarConcesion(token)?.profileId ?? null
  }

  /** Cuántas concesiones vivas hay (para el registro y para los tests). */
  get concesionesVivas(): number {
    return this.concesiones.size
  }

  // --- Ámbito ----------------------------------------------------------------

  /**
   * Fija las bases montadas de un PROYECTO. Es lo que aplica en caliente: la
   * siguiente invocación de `tdb` —en cualquier terminal de ese proyecto— ya lo ve.
   */
  setScope(profileId: string, projectHostPath: string, ids: readonly string[]): void {
    this.ambitos.set(claveProyecto(profileId, projectHostPath), [...ids])
  }

  /** Ámbito vigente de un proyecto. */
  getScope(profileId: string, projectHostPath: string): string[] {
    return this.ambitos.get(claveProyecto(profileId, projectHostPath)) ?? []
  }

  // --- Servidor --------------------------------------------------------------

  private atender(socket: Socket): void {
    socket.setTimeout(TIMEOUT_SOCKET_MS)
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => socket.destroy())

    let buffer = ''
    socket.on('data', (trozo) => {
      buffer += trozo.toString('utf-8')
      if (buffer.length > MAX_PETICION) {
        socket.destroy()
        return
      }
      const corte = buffer.indexOf('\n')
      if (corte < 0) return
      const linea = buffer.slice(0, corte)
      buffer = ''
      let respuesta: unknown
      try {
        respuesta = this.resolver(JSON.parse(linea))
      } catch {
        respuesta = { ok: false, error: 'peticion invalida' }
      }
      socket.end(JSON.stringify(respuesta) + '\n')
    })
  }

  /** Resuelve una petición ya parseada. Separado para poder probarlo sin sockets. */
  resolver(peticion: unknown): { ok: boolean; error?: string } | RespuestaResolve {
    const p = peticion as { v?: number; token?: string; op?: string }
    if (p?.v !== PROTOCOLO) return { ok: false, error: 'version de protocolo distinta' }
    if (p?.op !== 'resolve') return { ok: false, error: 'operacion desconocida' }

    const concesion = this.buscarConcesion(String(p.token ?? ''))
    // Mismo mensaje para "token inexistente", "token caducado" y "token gastado": un
    // error distinto por caso le diría a quien esté probando tokens cuál va por buen
    // camino.
    if (!concesion) return { ok: false, error: 'no autorizado' }

    const delPerfil = this.deps.conexionesDelPerfil(concesion.profileId)

    // Token de un solo uso: autoriza UNA conexión y se consume aquí mismo.
    if (concesion.unaVez) {
      const id = concesion.unaVez.connectionId
      this.gastar(String(p.token))
      const con = delPerfil.find((c) => c.id === id)
      if (!con) return { ok: false, error: 'no autorizado' }
      return this.armar([con], concesion.espacioDatos)
    }

    // ÁMBITO VIGENTE, no el que hubiera al arrancar la sesión. Aquí es donde el
    // montaje pasa a aplicar en caliente. Es el ÚNICO camino de un token de sesión,
    // también el del espacio de datos: ya no hay rama que sirva el perfil entero. La
    // marca del espacio NO entra en este cálculo: solo viaja en la respuesta.
    const permitidos = new Set(this.getScope(concesion.profileId, concesion.projectHostPath))
    return this.armar(
      delPerfil.filter((c) => permitidos.has(c.id)),
      concesion.espacioDatos
    )
  }

  private armar(conexiones: ConexionDelPuente[], espacioDatos: boolean): RespuestaResolve {
    const secretos: Record<string, string> = {}
    const huellas: Record<string, string> = {}
    for (const c of conexiones) {
      const secreto = this.deps.secretoDe(c.id)
      if (secreto !== null) {
        secretos[c.id] = secreto
        // Del MISMO objeto que el ámbito (la memoria del main), no del disco: es la
        // conexión para la que se sirve el secreto.
        huellas[c.id] = huellaDestino(c)
      }
    }
    return {
      ok: true,
      v: PROTOCOLO,
      scope: conexiones.map((c) => c.id),
      secretos,
      huellas,
      consola: false,
      espacioDatos
    }
  }

  /**
   * Busca la concesión de un token en tiempo CONSTANTE respecto al valor. Comparar
   * con `===` (o con un `Map.get` a secas) filtra por tiempo cuántos caracteres
   * acertó quien lo prueba; `timingSafeEqual` no.
   */
  private buscarConcesion(token: string): Concesion | null {
    if (!token) return null
    const buscado = Buffer.from(token, 'utf-8')
    const ahora = this.deps.ahora ? this.deps.ahora() : Date.now()
    let encontrada: Concesion | null = null
    for (const [candidato, concesion] of this.concesiones) {
      const bufer = Buffer.from(candidato, 'utf-8')
      if (bufer.length !== buscado.length) continue
      if (!timingSafeEqual(bufer, buscado)) continue
      if (concesion.unaVez && concesion.unaVez.caducaEn < ahora) {
        this.concesiones.delete(candidato)
        return null
      }
      encontrada = concesion
    }
    return encontrada
  }

  private gastar(token: string): void {
    this.concesiones.delete(token)
  }
}
