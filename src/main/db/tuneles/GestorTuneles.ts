// =============================================================================
// Los túneles SSH de las conexiones de base de datos: uno por conexión, compartido por `tdb` (vía el
// puente) y por el explorador. Abre `ssh -N -L 127.0.0.1:<libre>:<host>:<puerto>` por la conexión SSH
// elegida, espera a que el puerto local escuche y lo da como destino; si el ssh muere, la siguiente
// petición lo vuelve a abrir. Lo de SSH (línea, huellas, secreto) y lo del sistema llegan por `deps`.
// Decisiones: docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================
import type { DbTunelSsh } from '../../../shared/db-ipc.ts'

/** A dónde conecta el driver en lugar del servidor: el extremo local del túnel. */
export interface DestinoTunel {
  host: string
  port: number
}

/** Lo que el gestor necesita de la conexión de base de datos. */
export interface ConexionConTunel {
  id: string
  profileId: string
  alias: string
  /** El servidor y el puerto de la base, vistos desde el servidor SSH. */
  host: string
  port: number
  tunelSsh?: DbTunelSsh
}

/** La línea de ssh del túnel (la de `ControladorSsh.prepararTunelBd`). */
export interface LineaTunel {
  exe: string
  args: string[]
  env: NodeJS.ProcessEnv
  /** El túnel abrió (o no abrirá): la ficha del programa de contraseñas deja de valer. */
  alConectar: () => void
  vincular?: (matar: () => void) => void
}

/** Un ssh lanzado. */
export interface ProcesoTunel {
  /** Se llama una vez, cuando el proceso termina. */
  alSalir(cb: () => void): void
  /** Lo último que escribió en stderr. */
  errores(): string
  /** ¿Empezó ya la sesión? Solo pasa con el reenvío escuchando: es lo que distingue al ssh de otro proceso en el puerto. */
  enSesion(): boolean
  matar(): void
}

export interface DepsGestorTuneles {
  /** La línea de ssh; lanza con un mensaje para el usuario (huella sin confirmar, conexión borrada…). */
  preparar(profileId: string, conexionSshId: string, destino: { host: string; puerto: number }, puertoLocal: number): LineaTunel
  aliasSsh(conexionSshId: string): string | null
  lanzar(linea: LineaTunel): ProcesoTunel
  puertoLibre(): Promise<number>
  /** ¿Acepta conexiones `127.0.0.1:puerto`? Un intento corto. */
  escucha(puerto: number): Promise<boolean>
  esperar(ms: number): Promise<void>
  ahora(): number
  log(mensaje: string): void
}

/** Lo que tarda como mucho en abrir: el `ConnectTimeout` de ssh por salto y la autenticación. */
export const TOPE_APERTURA_MS = 25_000
const PAUSA_SONDEO_MS = 150

interface Tunel {
  /** Con qué se abrió: si la conexión cambia, es otro túnel. */
  clave: string
  apertura: Promise<DestinoTunel>
  proceso: ProcesoTunel | null
  cerrado: boolean
  /** Cambió una conexión SSH después de abrirlo: la siguiente petición abre otro. */
  viejo: boolean
}

/** La última línea de la salida de error de ssh que no es de su modo detallado (`-v`), para el mensaje. */
export function ultimaLinea(texto: string): string {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^debug\d?:/.test(l) && !/^OpenSSH/.test(l))
  return lineas[lineas.length - 1] ?? ''
}

export class GestorTuneles {
  private readonly d: DepsGestorTuneles
  private readonly tuneles = new Map<string, Tunel>()
  /**
   * Los sustituidos por otro (la conexión cambió) que siguen vivos: matarlos cortaría las sesiones que ya
   * van por ellos, también una transacción sin confirmar. Se cierran con la app (`cerrarTodos`).
   */
  private readonly retirados = new Set<Tunel>()

  constructor(deps: DepsGestorTuneles) {
    this.d = deps
  }

  /**
   * El destino local de una conexión con túnel, abriéndolo si hace falta; `null` si la conexión no lleva
   * túnel. Lanza con un mensaje para el usuario si no se puede abrir.
   */
  destino(con: ConexionConTunel): Promise<DestinoTunel> | null {
    const sshId = con.tunelSsh?.conexionId
    if (sshId === undefined) return null
    const clave = JSON.stringify([con.profileId, sshId, con.host, con.port])
    const previo = this.tuneles.get(con.id)
    if (previo && previo.clave === clave && !previo.cerrado && !previo.viejo) return previo.apertura
    if (previo) this.retirar(con.id, previo)
    const t: Tunel = { clave, apertura: Promise.resolve({ host: '', port: 0 }), proceso: null, cerrado: false, viejo: false }
    t.apertura = this.abrir(con, sshId, t)
    this.tuneles.set(con.id, t)
    // Un túnel que no abrió no se queda: la siguiente petición lo vuelve a intentar.
    t.apertura.catch(() => this.cerrarTunel(con.id, t))
    return t.apertura
  }

  /** Cierra el túnel de una conexión de base borrada. */
  cerrar(conexionId: string): void {
    const t = this.tuneles.get(conexionId)
    if (t) this.cerrarTunel(conexionId, t)
  }

  /**
   * Cambió una conexión SSH (puede ser el bastión de cualquiera): cada túnel sigue sirviendo a lo que ya
   * va por él y la siguiente petición abre otro con los datos nuevos.
   */
  marcarViejos(): void {
    for (const t of this.tuneles.values()) t.viejo = true
  }

  /** Cierra todos, también los retirados (la app se cierra). */
  cerrarTodos(): void {
    for (const [id, t] of [...this.tuneles]) this.cerrarTunel(id, t)
    for (const t of [...this.retirados]) this.cerrarTunel('', t)
  }

  /** Cuántos túneles hay abiertos o abriéndose, sin los retirados (pruebas y registro). */
  get abiertos(): number {
    return this.tuneles.size
  }

  /** Cuántos retirados siguen vivos (pruebas). */
  get vivosRetirados(): number {
    return this.retirados.size
  }

  private retirar(id: string, t: Tunel): void {
    if (this.tuneles.get(id) === t) this.tuneles.delete(id)
    if (!t.cerrado) this.retirados.add(t)
  }

  private cerrarTunel(id: string, t: Tunel): void {
    t.cerrado = true
    if (this.tuneles.get(id) === t) this.tuneles.delete(id)
    this.retirados.delete(t)
    t.proceso?.matar()
  }

  private async abrir(con: ConexionConTunel, sshId: string, t: Tunel): Promise<DestinoTunel> {
    const alias = this.d.aliasSsh(sshId)
    if (alias === null) throw new Error(`La conexión SSH del túnel de «${con.alias}» ya no existe: edita la conexión y elige otra.`)
    const puerto = await this.d.puertoLibre()
    const linea = this.d.preparar(con.profileId, sshId, { host: con.host, puerto: con.port }, puerto)
    if (t.cerrado) {
      linea.alConectar()
      throw new Error('El túnel se cerró mientras se abría.')
    }
    const proceso = this.d.lanzar(linea)
    t.proceso = proceso
    linea.vincular?.(() => proceso.matar())
    let salido = false
    proceso.alSalir(() => {
      salido = true
      if (!t.cerrado) this.d.log(`tunel de ${con.id} por ${sshId}: ssh salió`)
      this.cerrarTunel(con.id, t)
    })
    const fin = this.d.ahora() + TOPE_APERTURA_MS
    try {
      while (this.d.ahora() < fin) {
        if (salido || t.cerrado) {
          const causa = ultimaLinea(proceso.errores())
          throw new Error(`No se pudo abrir el túnel SSH por «${alias}»${causa ? `: ${causa}` : '.'}`)
        }
        // Las dos cosas: la sesión empezada dice que el puerto es del ssh (no de otro proceso que lo tomara
        // entre medias, al que se mandaría la contraseña de la base), y la sonda que ya acepta conexiones.
        if (proceso.enSesion() && (await this.d.escucha(puerto))) {
          this.d.log(`tunel de ${con.id} por ${sshId}: abierto en 127.0.0.1:${puerto}`)
          return { host: '127.0.0.1', port: puerto }
        }
        await this.d.esperar(PAUSA_SONDEO_MS)
      }
      throw new Error(`El túnel SSH por «${alias}» no se abrió en ${TOPE_APERTURA_MS / 1000} s.`)
    } finally {
      linea.alConectar()
    }
  }
}
