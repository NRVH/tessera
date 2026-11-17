// =============================================================================
// Codificación binaria del agente SSH con límites y consumo completo de cada mensaje.
// Valida peticiones y construye respuestas para rechazar datos malformados y operaciones no admitidas.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
export const TOPE_MENSAJE = 256 * 1024

export function entero(valor: number): Buffer {
  const salida = Buffer.alloc(4)
  salida.writeUInt32BE(valor)
  return salida
}

export function cadena(valor: string | Buffer): Buffer {
  const bytes = typeof valor === 'string' ? Buffer.from(valor) : valor
  return Buffer.concat([entero(bytes.length), bytes])
}

export function multiprecision(bytes: Buffer): Buffer {
  let inicio = 0
  while (inicio < bytes.length && bytes[inicio] === 0) inicio++
  const valor = bytes.subarray(inicio)
  return cadena(valor.length && valor[0] & 128 ? Buffer.concat([Buffer.from([0]), valor]) : valor)
}

export class Lector {
  private posicion = 0
  private readonly datos: Buffer
  constructor(datos: Buffer) {
    this.datos = datos
    if (datos.length > TOPE_MENSAJE) throw new Error('Mensaje SSH demasiado grande')
  }
  bytes(cantidad: number): Buffer {
    if (cantidad < 0 || this.posicion + cantidad > this.datos.length) throw new Error('Mensaje SSH truncado')
    const valor = this.datos.subarray(this.posicion, this.posicion + cantidad)
    this.posicion += cantidad
    return valor
  }
  entero(): number { return this.bytes(4).readUInt32BE() }
  cadena(): Buffer { return this.bytes(this.entero()) }
  texto(): string { return this.cadena().toString('utf8') }
  restantes(): number { return this.datos.length - this.posicion }
  terminar(): void {
    if (this.posicion !== this.datos.length) throw new Error('Mensaje SSH con datos sobrantes')
  }
}

export type PeticionAgente = { tipo: 'listar' } | { tipo: 'firmar'; publica: Buffer; datos: Buffer; banderas: number } | { tipo: 'fallo' }

export function decodificar(datos: Buffer): PeticionAgente {
  const lector = new Lector(datos)
  const tipo = lector.bytes(1)[0]
  if (tipo === 11) { lector.terminar(); return { tipo: 'listar' } }
  if (tipo !== 13) return { tipo: 'fallo' }
  const peticion = { tipo: 'firmar' as const, publica: lector.cadena(), datos: lector.cadena(), banderas: lector.entero() }
  lector.terminar()
  return peticion
}

export function identidades(claves: readonly { publica: Buffer; nombre: string }[]): Buffer {
  return Buffer.concat([Buffer.from([12]), entero(claves.length), ...claves.flatMap((c) => [cadena(c.publica), cadena(c.nombre)])])
}

export function respuestaFirma(firma: Buffer): Buffer {
  return Buffer.concat([Buffer.from([14]), cadena(firma)])
}

/** Una pública no puede ocultar bytes adicionales de otro archivo en el material del contenedor. */
export function comprobarPublica(publica: Buffer): Buffer {
  const lector = new Lector(publica)
  const tipo = lector.texto()
  if (tipo === 'ssh-ed25519') {
    if (lector.cadena().length !== 32) throw new Error('Pública Ed25519 incorrecta')
  } else if (tipo === 'ssh-rsa') {
    if (!lector.cadena().length || !lector.cadena().length) throw new Error('Pública RSA incorrecta')
  } else if (tipo.startsWith('ecdsa-sha2-')) {
    const curva = lector.texto()
    const longitudes: Record<string, number> = { nistp256: 65, nistp384: 97, nistp521: 133 }
    const punto = lector.cadena()
    if (tipo !== `ecdsa-sha2-${curva}` || punto.length !== longitudes[curva] || punto[0] !== 4) throw new Error('Pública ECDSA incorrecta')
  } else throw new Error('Tipo de pública no admitido')
  lector.terminar()
  return publica
}
