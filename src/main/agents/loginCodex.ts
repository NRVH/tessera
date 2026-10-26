// =============================================================================
// Login por navegador de Codex en los contenedores de cuenta: el navegador vuelve a
// `localhost:1455` del equipo y este puente lleva esa conexión al Codex del contenedor, sin
// publicar puertos. Se abre al arrancar una cuenta sin credencial o al ver en la salida que Codex
// empezó uno (sesión caducada). Codex fija el 1455: un solo login a la vez.
// Decisiones: docs/decisiones/sandbox/contenedor-por-cuenta.md
// =============================================================================

import net from 'node:net'
import { statSync } from 'node:fs'
import { txAgentes } from './textos.ts'
import { avisoParaUsuario } from '../../shared/dockerErrors.ts'

/** El puerto al que vuelve el navegador tras iniciar sesión en Codex: Codex no deja cambiarlo. */
export const PUERTO_LOGIN_CODEX = 1455

/** Tras aparecer la credencial, el puente sigue un rato: el navegador aún pide la página de «listo». */
const GRACIA_TRAS_LOGIN_MS = 15_000

/** Un login de Codex pendiente: de qué contenedor es y qué archivo dice que terminó. */
export interface DatosLogin {
  /** Nombre del contenedor de la cuenta en Docker. */
  contenedor: string
  profileId: string
  /** Nombres que ve el usuario, para decirle cuál está pendiente. */
  cuenta: string
  perfil: string
  /** Ruta del host de la credencial (`auth.json`): cuando aparece o se reescribe, el login terminó. */
  credencial: string
  /**
   * Con la red del anfitrión, Docker puede reenviar ya el 1455 de ese Codex al equipo. El puente se
   * abre igual (si la función está apagada en Docker, es la única vuelta), pero sin aviso si el puerto ya está tomado.
   */
  redHost: boolean
}

export interface DepsPuente {
  /** Une una conexión del equipo con el 1455 del contenedor. */
  conectar: (contenedor: string, socket: net.Socket) => void
  /** El 1455 del equipo no se pudo tomar (otro programa o el sistema): el navegador no podrá volver. */
  avisarPuertoOcupado: (datos: DatosLogin) => void
  /** Cuándo se escribió por última vez un archivo, o null si no existe. */
  marcaDe?: (ruta: string) => number | null
  intervaloMs?: number
  graciaMs?: number
  /** Un login abandonado con la pestaña abierta no retiene el puerto para siempre. */
  topeMs?: number
  /** Otro puerto en las pruebas, para no chocar con un login real. */
  puerto?: number
}

/** Reserva del login: se ata a la sesión cuando existe, o se suelta si la apertura falla. */
export interface ReservaLogin {
  asignar: (sessionId: string) => void
  soltar: () => void
}

/** Lo más que un login queda pendiente: lo que tarda en caducar el enlace de Codex, con margen. */
const TOPE_LOGIN_MS = 15 * 60_000

interface Pendiente {
  datos: DatosLogin
  sessionId: string | null
  ticket: number
  /** La credencial al reservar: una vieja (sesión caducada) no cuenta como login terminado. */
  marcaInicial: number | null
  hasta: number
}

function marcaDelArchivo(ruta: string): number | null {
  try {
    return statSync(ruta).mtimeMs
  } catch {
    return null
  }
}

/**
 * El enlace de autorización de Codex que vuelve al 1455 (`redirect_uri` codificado) o su aviso de
 * «servidor de login en …:1455», ya sin espacios. No basta con «localhost:1455»: un agente lo puede
 * citar en una conversación.
 */
const RE_VUELTA_LOGIN = /redirect_uri=https?%3a%2f%2f(?:127\.0\.0\.1|localhost)%3a1455|loginserveronhttps?:\/\/(?:127\.0\.0\.1|localhost):1455/i
// CSI, OSC y los caracteres de marco con que una interfaz de terminal parte una línea larga.
// eslint-disable-next-line no-control-regex
const RE_RUIDO = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\s─-▟]/g
const VENTANA_DETECTOR = 4096

/**
 * Detector, por sesión, de que Codex empezó un inicio de sesión por navegador: lo empiece la línea
 * de arranque o el propio Codex con una sesión caducada. Mira la salida sin colores, espacios ni
 * marcos, para encontrar la URL aunque la terminal la parta en varias líneas.
 */
export function crearDetectorLoginCodex(): (datos: string) => boolean {
  let ventana = ''
  return (datos) => {
    ventana = (ventana + datos.replace(RE_RUIDO, '')).slice(-VENTANA_DETECTOR)
    if (!RE_VUELTA_LOGIN.test(ventana)) return false
    ventana = ''
    return true
  }
}

/** El único login de Codex en curso en contenedores y el puente de su vuelta. */
export class PuenteLoginCodex {
  private readonly deps: DepsPuente
  private pendiente: Pendiente | null = null
  /** A dónde lleva el puente: el pendiente, o el que acaba de terminar durante su gracia. */
  private destino: string | null = null
  private servidor: net.Server | null = null
  private vigilante: NodeJS.Timeout | null = null
  private gracia: NodeJS.Timeout | null = null
  private tickets = 0

  constructor(deps: DepsPuente) {
    this.deps = deps
  }

  /**
   * Toma el login para una cuenta sin credencial. Lanza si otra sesión tiene uno pendiente; la
   * misma sesión (recargar) lo conserva.
   */
  reservar(datos: DatosLogin, sessionId?: string): ReservaLogin {
    this.revisar()
    const p = this.pendiente
    if (p) {
      this.rechazarSiEsDeOtra(p, datos, sessionId)
      // La misma sesión recarga o enseña un enlace nuevo: el plazo cuenta desde ahora.
      p.hasta = Date.now() + (this.deps.topeMs ?? TOPE_LOGIN_MS)
    }
    const ticket = p ? p.ticket : ++this.tickets
    if (!p) {
      const marcaInicial = (this.deps.marcaDe ?? marcaDelArchivo)(datos.credencial)
      this.pendiente = { datos, sessionId: sessionId ?? null, ticket, marcaInicial, hasta: Date.now() + (this.deps.topeMs ?? TOPE_LOGIN_MS) }
      this.vigilante = setInterval(() => this.revisar(), this.deps.intervaloMs ?? 1000)
      this.vigilante.unref?.()
    }
    this.abrirPuente(datos)
    return {
      asignar: (id) => {
        if (this.pendiente?.ticket !== ticket) return
        this.pendiente.sessionId = id
        // Lo que tardó en prepararse el contenedor (bajar la imagen) no cuenta para el plazo del login.
        this.pendiente.hasta = Date.now() + (this.deps.topeMs ?? TOPE_LOGIN_MS)
      },
      soltar: () => {
        if (this.pendiente?.ticket === ticket) this.liberar(false)
      }
    }
  }

  /** Lanza si el login pendiente es de otra sesión; la misma (recargar) lo conserva. */
  private rechazarSiEsDeOtra(p: Pendiente, datos: DatosLogin, sessionId: string | undefined): void {
    // La apertura reserva antes de que exista la sesión, y su salida puede llegar antes de atarla.
    if (p.sessionId === null && sessionId !== undefined && p.datos.contenedor === datos.contenedor) p.sessionId = sessionId
    if (sessionId !== undefined && p.sessionId === sessionId) return
    const t = txAgentes().loginCodex
    // La misma cuenta en otra pestaña comparte contenedor: los dos logins se pelearían por su 1455.
    if (p.datos.contenedor === datos.contenedor) throw new Error(avisoParaUsuario(t.mismaCuentaTitulo(p.datos.cuenta), t.mismaCuenta))
    throw new Error(avisoParaUsuario(t.enCursoTitulo, t.enCurso(p.datos.cuenta, p.datos.perfil)))
  }

  /** La sesión se cerró: su login, si lo tenía, deja de estar pendiente. */
  soltarSesion(sessionId: string): void {
    if (this.pendiente?.sessionId === sessionId) this.liberar(false)
  }

  /** El login pendiente ahora, o null. */
  enCurso(): DatosLogin | null {
    this.revisar()
    return this.pendiente?.datos ?? null
  }

  /** ¿El puente escucha ahora? */
  escuchando(): boolean {
    return this.servidor !== null
  }

  cerrar(): void {
    this.liberar(false)
  }

  /** Si la credencial apareció o se reescribió, el login terminó: se suelta con su gracia. Pasado el tope, sin ella. */
  private revisar(): void {
    const p = this.pendiente
    if (!p) return
    const marca = (this.deps.marcaDe ?? marcaDelArchivo)(p.datos.credencial)
    if (marca !== null && marca !== p.marcaInicial) this.liberar(true)
    else if (Date.now() > p.hasta) this.liberar(false)
  }

  private liberar(conGracia: boolean): void {
    if (this.vigilante) clearInterval(this.vigilante)
    this.vigilante = null
    this.pendiente = null
    if (this.gracia) clearTimeout(this.gracia)
    this.gracia = null
    if (conGracia && this.servidor) {
      this.gracia = setTimeout(() => this.cerrarPuente(), this.deps.graciaMs ?? GRACIA_TRAS_LOGIN_MS)
      this.gracia.unref?.()
    } else {
      this.cerrarPuente()
    }
  }

  private abrirPuente(datos: DatosLogin): void {
    if (this.gracia) clearTimeout(this.gracia)
    this.gracia = null
    this.destino = datos.contenedor
    if (this.servidor) return
    // Se decide al llegar cada conexión: la gracia de un login y la reserva del siguiente cambian el destino.
    const srv = net.createServer((socket) => {
      if (this.destino === null) socket.destroy()
      else this.deps.conectar(this.destino, socket)
    })
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (this.servidor === srv) this.servidor = null
      // Con la red del anfitrión activa en Docker, quien tiene el 1455 es el propio reenvío de Docker
      // hacia ese Codex: la vuelta llega igual. Cualquier otro fallo (ocupado, o reservado por el
      // sistema, que en Windows da EACCES) deja el login sin vuelta y se dice.
      if (datos.redHost && err.code === 'EADDRINUSE') return
      this.deps.avisarPuertoOcupado(datos)
    })
    // Solo el loopback: desde la red no se llega al Codex de nadie.
    srv.listen(this.deps.puerto ?? PUERTO_LOGIN_CODEX, '127.0.0.1')
    // No retiene la salida de la app con un login a medias.
    srv.unref()
    this.servidor = srv
  }

  private cerrarPuente(): void {
    this.destino = null
    this.servidor?.close()
    this.servidor = null
  }
}
