// =============================================================================
// El protocolo SFTP versión 3 (draft-ietf-secsh-filexfer-02), lo justo para el explorador: los tipos de
// paquete, el troceado de lo que llega por la salida de ssh, y cómo se escriben y leen los campos y los
// atributos. Puro: sin procesos ni disco. Lo usa `ClienteSftp.ts`.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================

export const TIPO = {
  INIT: 1,
  VERSION: 2,
  OPEN: 3,
  CLOSE: 4,
  READ: 5,
  WRITE: 6,
  LSTAT: 7,
  FSTAT: 8,
  SETSTAT: 9,
  FSETSTAT: 10,
  OPENDIR: 11,
  READDIR: 12,
  REMOVE: 13,
  MKDIR: 14,
  RMDIR: 15,
  REALPATH: 16,
  STAT: 17,
  RENAME: 18,
  EXTENDED: 200,
  STATUS: 101,
  HANDLE: 102,
  DATA: 103,
  NAME: 104,
  ATTRS: 105,
  EXTENDED_REPLY: 201
} as const

/** Códigos de SSH_FXP_STATUS. */
export const ESTADO = { OK: 0, EOF: 1, NO_EXISTE: 2, SIN_PERMISO: 3, FALLO: 4, MENSAJE_MALO: 5, SIN_CONEXION: 6, CONEXION_PERDIDA: 7, NO_ADMITIDO: 8 } as const

/** Banderas de SSH_FXP_OPEN. */
export const ABRIR = { LEER: 0x1, ESCRIBIR: 0x2, CREAR: 0x8, TRUNCAR: 0x10, EXCLUSIVO: 0x20 } as const

const ATTR_TAMANO = 0x1
const ATTR_UIDGID = 0x2
const ATTR_PERMISOS = 0x4
const ATTR_TIEMPOS = 0x8
const ATTR_EXTENDIDOS = 0x80000000

/** Los bits de tipo de `st_mode`. */
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

/** Un paquete más largo que esto no es de un servidor sano (OpenSSH limita a 256 KiB). */
export const MAX_PAQUETE = 4 * 1024 * 1024

export interface Atributos {
  tamano: number | null
  permisos: number | null
  /** Segundos desde 1970. */
  mtime: number | null
}

/** Lo que dice el `st_mode` de unos atributos. */
export function tipoDeModo(permisos: number | null): 'carpeta' | 'archivo' | 'enlace' | 'otro' {
  if (permisos === null) return 'otro'
  const t = permisos & S_IFMT
  if (t === S_IFDIR) return 'carpeta'
  if (t === S_IFREG) return 'archivo'
  return t === S_IFLNK ? 'enlace' : 'otro'
}

/** `rwxr-xr-x` de unos permisos (con s/t de setuid, setgid y sticky). */
export function textoPermisos(permisos: number | null): string | null {
  if (permisos === null) return null
  const tri = (bits: number, especial: boolean, letra: string): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${especial ? (bits & 1 ? letra : letra.toUpperCase()) : bits & 1 ? 'x' : '-'}`
  return tri((permisos >> 6) & 7, (permisos & 0o4000) !== 0, 's') + tri((permisos >> 3) & 7, (permisos & 0o2000) !== 0, 's') + tri(permisos & 7, (permisos & 0o1000) !== 0, 't')
}

/** Escribe los campos de un paquete. */
export class Escritor {
  private readonly trozos: Buffer[] = []

  u8(n: number): this {
    this.trozos.push(Buffer.from([n & 0xff]))
    return this
  }

  u32(n: number): this {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n >>> 0)
    this.trozos.push(b)
    return this
  }

  u64(n: number): this {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(n))
    this.trozos.push(b)
    return this
  }

  cadena(s: string | Buffer): this {
    const b = typeof s === 'string' ? Buffer.from(s, 'utf-8') : s
    this.u32(b.length)
    this.trozos.push(b)
    return this
  }

  /** Atributos: solo los permisos si se dan (al crear o al copiar los de un archivo que se reemplaza). */
  atributos(permisos?: number): this {
    if (permisos === undefined) return this.u32(0)
    return this.u32(ATTR_PERMISOS).u32(permisos & 0o7777)
  }

  /** El paquete entero: longitud, tipo y cuerpo. */
  paquete(tipo: number): Buffer {
    const cuerpo = Buffer.concat(this.trozos)
    const cabecera = Buffer.alloc(5)
    cabecera.writeUInt32BE(cuerpo.length + 1)
    cabecera.writeUInt8(tipo, 4)
    return Buffer.concat([cabecera, cuerpo])
  }
}

/** Un paquete que no tiene la forma que dice su tipo. */
export class PaqueteMalo extends Error {}

/** Lee los campos de un paquete. */
export class Lector {
  private pos = 0
  private readonly b: Buffer

  constructor(b: Buffer) {
    this.b = b
  }

  private exigir(n: number): void {
    if (this.pos + n > this.b.length) throw new PaqueteMalo('paquete SFTP corto')
  }

  u8(): number {
    this.exigir(1)
    return this.b.readUInt8(this.pos++)
  }

  u32(): number {
    this.exigir(4)
    const n = this.b.readUInt32BE(this.pos)
    this.pos += 4
    return n
  }

  u64(): number {
    this.exigir(8)
    const n = this.b.readBigUInt64BE(this.pos)
    this.pos += 8
    return Number(n)
  }

  bytes(): Buffer {
    const n = this.u32()
    this.exigir(n)
    const r = this.b.subarray(this.pos, this.pos + n)
    this.pos += n
    return r
  }

  cadena(): string {
    return this.bytes().toString('utf-8')
  }

  atributos(): Atributos {
    const banderas = this.u32()
    const a: Atributos = { tamano: null, permisos: null, mtime: null }
    if (banderas & ATTR_TAMANO) a.tamano = this.u64()
    if (banderas & ATTR_UIDGID) {
      this.u32()
      this.u32()
    }
    if (banderas & ATTR_PERMISOS) a.permisos = this.u32()
    if (banderas & ATTR_TIEMPOS) {
      this.u32()
      a.mtime = this.u32()
    }
    if (banderas & ATTR_EXTENDIDOS) {
      const n = this.u32()
      for (let i = 0; i < n; i++) {
        this.bytes()
        this.bytes()
      }
    }
    return a
  }

  get quedan(): number {
    return this.b.length - this.pos
  }
}

/**
 * Trocea lo que llega de ssh en paquetes enteros (`[tipo, cuerpo]`). Guarda lo que sobra para el siguiente
 * trozo. Un paquete que dice medir más de `MAX_PAQUETE` es un error: el otro lado no habla SFTP.
 */
export class Troceador {
  private resto: Buffer = Buffer.alloc(0)

  meter(trozo: Buffer): Array<{ tipo: number; cuerpo: Buffer }> {
    this.resto = this.resto.length === 0 ? trozo : Buffer.concat([this.resto, trozo])
    const paquetes: Array<{ tipo: number; cuerpo: Buffer }> = []
    while (this.resto.length >= 4) {
      const n = this.resto.readUInt32BE(0)
      if (n < 1 || n > MAX_PAQUETE) throw new PaqueteMalo(`paquete SFTP de ${n} bytes`)
      if (this.resto.length < 4 + n) break
      paquetes.push({ tipo: this.resto.readUInt8(4), cuerpo: this.resto.subarray(5, 4 + n) })
      this.resto = this.resto.subarray(4 + n)
    }
    return paquetes
  }
}
