// =============================================================================
// Un cliente SFTP sobre la entrada y la salida de un `ssh -s sftp` del sistema: peticiones con su id, las
// respuestas casadas por id (pueden ir varias en vuelo) y las operaciones del explorador (listar, mirar,
// crear, borrar, renombrar, abrir, leer, escribir). No sabe de procesos: le dan los dos flujos, y quien lo
// crea le dice cuándo se cortaron (`cortar`). Los fallos del servidor salen como `ErrorSftp` en español.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================
import type { Readable, Writable } from 'node:stream'
import { ABRIR, ESTADO, Escritor, Lector, TIPO, Troceador, type Atributos } from './protocoloSftp.ts'

/** Un fallo del servidor (`SSH_FXP_STATUS`) o de la sesión, con un texto para el usuario. */
export class ErrorSftp extends Error {
  readonly codigo: number

  constructor(codigo: number, mensaje: string) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** El texto de un estado del servidor sobre `ruta` (su propio mensaje solo si no hay uno nuestro). */
function textoDeEstado(codigo: number, delServidor: string, ruta: string | undefined): string {
  const sobre = ruta !== undefined ? ` «${ruta}»` : ''
  if (codigo === ESTADO.NO_EXISTE) return `No existe${sobre}.`
  if (codigo === ESTADO.SIN_PERMISO) return `El servidor no da permiso sobre${sobre || ' eso'}.`
  if (codigo === ESTADO.NO_ADMITIDO) return 'El servidor no admite esta operación.'
  if (codigo === ESTADO.SIN_CONEXION || codigo === ESTADO.CONEXION_PERDIDA) return 'Se perdió la conexión con el servidor.'
  const detalle = delServidor.trim() && delServidor.trim().toLowerCase() !== 'failure' ? `: ${delServidor.trim()}` : ''
  return `El servidor no pudo hacerlo${sobre}${detalle}.`
}

/** Una entrada de una carpeta: su nombre y sus atributos (`lstat`: un enlace es un enlace). */
export interface EntradaRemota {
  nombre: string
  atributos: Atributos
}

interface Pendiente {
  resolver: (r: { tipo: number; lector: Lector }) => void
  rechazar: (e: Error) => void
}

/** Tope de espera de una petición: un servidor colgado no deja colgado al explorador. */
const TOPE_PETICION_MS = 60_000

export class ClienteSftp {
  private readonly entrada: Writable
  private readonly troceador = new Troceador()
  private readonly pendientes = new Map<number, Pendiente>()
  private siguienteId = 1
  private corte: ErrorSftp | null = null
  private alVersion: ((r: { version: number; extensiones: Set<string> }) => void) | null = null
  /** Extensiones que anunció el servidor (`posix-rename@openssh.com`…). */
  extensiones = new Set<string>()

  constructor(entrada: Writable, salida: Readable) {
    this.entrada = entrada
    salida.on('data', (trozo: Buffer) => this.recibir(trozo))
    entrada.on('error', () => this.cortar('Se perdió la conexión con el servidor.'))
  }

  /** La sesión se acabó (ssh salió o se cerró): todo lo pendiente falla con este texto. */
  cortar(texto: string): void {
    if (this.corte) return
    this.corte = new ErrorSftp(ESTADO.CONEXION_PERDIDA, texto)
    for (const p of this.pendientes.values()) p.rechazar(this.corte)
    this.pendientes.clear()
  }

  get cortada(): boolean {
    return this.corte !== null
  }

  /** El saludo: INIT 3 -> VERSION. Resuelve con las extensiones del servidor. */
  iniciar(topeMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tope = setTimeout(() => reject(new ErrorSftp(ESTADO.SIN_CONEXION, 'El servidor no contestó al abrir SFTP.')), topeMs)
      this.alVersion = (r) => {
        clearTimeout(tope)
        this.extensiones = r.extensiones
        resolve()
      }
      this.escribir(new Escritor().u32(3).paquete(TIPO.INIT))
    })
  }

  private escribir(paquete: Buffer): void {
    if (this.corte) throw this.corte
    this.entrada.write(paquete)
  }

  private recibir(trozo: Buffer): void {
    let paquetes
    try {
      paquetes = this.troceador.meter(trozo)
    } catch {
      this.cortar('El servidor no habla SFTP.')
      return
    }
    for (const { tipo, cuerpo } of paquetes) {
      const lector = new Lector(cuerpo)
      if (tipo === TIPO.VERSION) {
        this.alVersionRecibida(lector)
        continue
      }
      let id: number
      try {
        id = lector.u32()
      } catch {
        continue
      }
      const p = this.pendientes.get(id)
      if (!p) continue
      this.pendientes.delete(id)
      p.resolver({ tipo, lector })
    }
  }

  private alVersionRecibida(lector: Lector): void {
    const version = lector.u32()
    const extensiones = new Set<string>()
    try {
      while (lector.quedan > 0) {
        extensiones.add(lector.cadena())
        lector.bytes()
      }
    } catch {
      // Una extensión mal formada no impide usar la sesión.
    }
    this.alVersion?.({ version, extensiones })
    this.alVersion = null
  }

  /** Manda una petición y espera su respuesta (cualquier tipo). */
  private peticion(tipo: number, rellenar: (e: Escritor) => Escritor): Promise<{ tipo: number; lector: Lector }> {
    if (this.corte) return Promise.reject(this.corte)
    const id = this.siguienteId
    this.siguienteId = (this.siguienteId + 1) >>> 0 || 1
    return new Promise((resolve, reject) => {
      const tope = setTimeout(() => {
        this.pendientes.delete(id)
        reject(new ErrorSftp(ESTADO.SIN_CONEXION, 'El servidor no contestó a tiempo.'))
      }, TOPE_PETICION_MS)
      this.pendientes.set(id, {
        resolver: (r) => {
          clearTimeout(tope)
          resolve(r)
        },
        rechazar: (e) => {
          clearTimeout(tope)
          reject(e)
        }
      })
      try {
        this.escribir(rellenar(new Escritor().u32(id)).paquete(tipo))
      } catch (e) {
        this.pendientes.delete(id)
        clearTimeout(tope)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** Una respuesta del tipo esperado, o el `ErrorSftp` de su STATUS. `ruta` solo sirve para el texto. */
  private async esperar(tipo: number, rellenar: (e: Escritor) => Escritor, esperado: number, ruta?: string): Promise<Lector | null> {
    const r = await this.peticion(tipo, rellenar)
    if (r.tipo === esperado && esperado !== TIPO.STATUS) return r.lector
    if (r.tipo !== TIPO.STATUS) throw new ErrorSftp(ESTADO.MENSAJE_MALO, 'El servidor contestó algo inesperado.')
    const codigo = r.lector.u32()
    if (codigo === ESTADO.OK || (codigo === ESTADO.EOF && esperado !== TIPO.STATUS)) return null
    let mensaje = ''
    try {
      mensaje = r.lector.cadena()
    } catch {
      // Sin mensaje.
    }
    throw new ErrorSftp(codigo, textoDeEstado(codigo, mensaje, ruta))
  }

  /** Una operación que solo contesta STATUS OK. */
  private async simple(tipo: number, rellenar: (e: Escritor) => Escritor, ruta: string): Promise<void> {
    await this.esperar(tipo, rellenar, TIPO.STATUS, ruta)
  }

  /** La ruta canónica (absoluta, sin `..`). */
  async realpath(ruta: string): Promise<string> {
    const l = await this.esperar(TIPO.REALPATH, (e) => e.cadena(ruta), TIPO.NAME, ruta)
    if (!l || l.u32() < 1) throw new ErrorSftp(ESTADO.FALLO, `No existe «${ruta}».`)
    return l.cadena()
  }

  async stat(ruta: string): Promise<Atributos> {
    const l = await this.esperar(TIPO.STAT, (e) => e.cadena(ruta), TIPO.ATTRS, ruta)
    if (!l) throw new ErrorSftp(ESTADO.FALLO, `No existe «${ruta}».`)
    return l.atributos()
  }

  async lstat(ruta: string): Promise<Atributos> {
    const l = await this.esperar(TIPO.LSTAT, (e) => e.cadena(ruta), TIPO.ATTRS, ruta)
    if (!l) throw new ErrorSftp(ESTADO.FALLO, `No existe «${ruta}».`)
    return l.atributos()
  }

  /** Los atributos, o null si no existe (para saber si algo se pisaría). */
  async lstatSiExiste(ruta: string): Promise<Atributos | null> {
    try {
      return await this.lstat(ruta)
    } catch (e) {
      if (e instanceof ErrorSftp && e.codigo === ESTADO.NO_EXISTE) return null
      throw e
    }
  }

  /** El contenido de una carpeta, sin `.` ni `..`. */
  async listar(ruta: string): Promise<EntradaRemota[]> {
    const lh = await this.esperar(TIPO.OPENDIR, (e) => e.cadena(ruta), TIPO.HANDLE, ruta)
    if (!lh) throw new ErrorSftp(ESTADO.FALLO, `No se pudo abrir «${ruta}».`)
    const handle = lh.bytes()
    const entradas: EntradaRemota[] = []
    try {
      for (;;) {
        const l = await this.esperar(TIPO.READDIR, (e) => e.cadena(handle), TIPO.NAME, ruta)
        if (!l) break
        const n = l.u32()
        for (let i = 0; i < n; i++) {
          const nombre = l.cadena()
          l.bytes()
          const atributos = l.atributos()
          if (nombre !== '.' && nombre !== '..') entradas.push({ nombre, atributos })
        }
      }
    } finally {
      await this.cerrar(handle).catch(() => {})
    }
    return entradas
  }

  mkdir(ruta: string): Promise<void> {
    return this.simple(TIPO.MKDIR, (e) => e.cadena(ruta).atributos(), ruta)
  }

  rmdir(ruta: string): Promise<void> {
    return this.simple(TIPO.RMDIR, (e) => e.cadena(ruta), ruta)
  }

  remove(ruta: string): Promise<void> {
    return this.simple(TIPO.REMOVE, (e) => e.cadena(ruta), ruta)
  }

  /** RENAME de v3: falla si el destino existe (no pisa). */
  rename(desde: string, a: string): Promise<void> {
    return this.simple(TIPO.RENAME, (e) => e.cadena(desde).cadena(a), desde)
  }

  /** `posix-rename@openssh.com`: reemplaza el destino de una vez. Solo si el servidor lo anunció. */
  renameReemplazando(desde: string, a: string): Promise<void> {
    return this.simple(TIPO.EXTENDED, (e) => e.cadena('posix-rename@openssh.com').cadena(desde).cadena(a), desde)
  }

  setPermisos(ruta: string, permisos: number): Promise<void> {
    return this.simple(TIPO.SETSTAT, (e) => e.cadena(ruta).atributos(permisos), ruta)
  }

  /** Abre un archivo para leer, o para escribir creándolo en exclusiva (nunca pisa: se escribe a un temporal). */
  async abrir(ruta: string, modo: 'leer' | 'crear', permisos?: number): Promise<Buffer> {
    const banderas = modo === 'leer' ? ABRIR.LEER : ABRIR.ESCRIBIR | ABRIR.CREAR | ABRIR.EXCLUSIVO
    const l = await this.esperar(TIPO.OPEN, (e) => e.cadena(ruta).u32(banderas).atributos(permisos), TIPO.HANDLE, ruta)
    if (!l) throw new ErrorSftp(ESTADO.FALLO, `No se pudo abrir «${ruta}».`)
    return l.bytes()
  }

  async cerrar(handle: Buffer): Promise<void> {
    await this.esperar(TIPO.CLOSE, (e) => e.cadena(handle), TIPO.STATUS)
  }

  /** Lee hasta `largo` bytes desde `desde`; null al final del archivo. Puede devolver menos. */
  async leer(handle: Buffer, desde: number, largo: number): Promise<Buffer | null> {
    const l = await this.esperar(TIPO.READ, (e) => e.cadena(handle).u64(desde).u32(largo), TIPO.DATA)
    return l ? Buffer.from(l.bytes()) : null
  }

  async escribirEn(handle: Buffer, desde: number, datos: Buffer): Promise<void> {
    await this.esperar(TIPO.WRITE, (e) => e.cadena(handle).u64(desde).cadena(datos), TIPO.STATUS)
  }
}
