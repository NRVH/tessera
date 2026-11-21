// =============================================================================
// Composición de la insignia de la franja, reducción de los píxeles y contenedor ICO.
// El canal rojo de la máscara cubre el disco y el verde cubre la flecha sobre el disco.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { contrasteColor, type ColorRgb } from '../../shared/contrasteColor.ts'

export const TAMANO_BASE_FRANJA = 512
export const TAMANOS_ICONO_FRANJA = [16, 24, 32, 48, 64, 128, 256] as const

const FLECHA_CLARA: ColorRgb = [255, 255, 255]
const FLECHA_OSCURA: ColorRgb = [34, 36, 43]

export function validarColorDeFranja(color: unknown): string | null {
  return typeof color === 'string' && color.length === 7 && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null
}

export function componerIconoFranja(base: Buffer, insignia: Buffer, color: ColorRgb): Buffer {
  const flecha = contrasteColor(color, FLECHA_CLARA) > contrasteColor(color, FLECHA_OSCURA) ? FLECHA_CLARA : FLECHA_OSCURA
  const icono = Buffer.from(base)

  for (let indice = 0; indice < base.length; indice += 4) {
    const disco = insignia[indice] / 255
    if (disco === 0) continue
    const trazo = insignia[indice + 1] / 255
    const fondo = (base[indice + 3] / 255) * (1 - disco)
    const alfa = disco + fondo
    for (let canal = 0; canal < 3; canal++) {
      const pigmento = color[canal] * (1 - trazo) + flecha[canal] * trazo
      icono[indice + canal] = Math.round((pigmento * disco + base[indice + canal] * fondo) / alfa)
    }
    icono[indice + 3] = Math.round(alfa * 255)
  }
  return icono
}

export function rgbaDesdeBgraPremultiplicado(bgra: Buffer): Buffer {
  const rgba = Buffer.alloc(bgra.length)
  for (let indice = 0; indice < bgra.length; indice += 4) {
    const alfa = bgra[indice + 3]
    if (alfa === 0) continue
    rgba[indice] = Math.round((bgra[indice + 2] * 255) / alfa)
    rgba[indice + 1] = Math.round((bgra[indice + 1] * 255) / alfa)
    rgba[indice + 2] = Math.round((bgra[indice] * 255) / alfa)
    rgba[indice + 3] = alfa
  }
  return rgba
}

export function bgraPremultiplicadoDesdeRgba(rgba: Buffer): Buffer {
  const bgra = Buffer.allocUnsafe(rgba.length)
  for (let indice = 0; indice < rgba.length; indice += 4) {
    const alfa = rgba[indice + 3] / 255
    bgra[indice] = Math.round(rgba[indice + 2] * alfa)
    bgra[indice + 1] = Math.round(rgba[indice + 1] * alfa)
    bgra[indice + 2] = Math.round(rgba[indice] * alfa)
    bgra[indice + 3] = rgba[indice + 3]
  }
  return bgra
}

function reducirPixel(origen: Buffer, tamano: number, destino: Buffer, lado: number, x: number, y: number): void {
  // Se mide el solapamiento en unidades enteras para cubrir también los tamaños que no dividen al original.
  const izquierda = x * tamano
  const derecha = izquierda + tamano
  const arriba = y * tamano
  const abajo = arriba + tamano
  let rojo = 0
  let verde = 0
  let azul = 0
  let alfa = 0
  for (let fila = Math.floor(arriba / lado); fila * lado < abajo; fila++) {
    const alto = Math.min(abajo, (fila + 1) * lado) - Math.max(arriba, fila * lado)
    for (let columna = Math.floor(izquierda / lado); columna * lado < derecha; columna++) {
      const ancho = Math.min(derecha, (columna + 1) * lado) - Math.max(izquierda, columna * lado)
      const indice = (fila * tamano + columna) * 4
      const peso = ancho * alto * origen[indice + 3]
      rojo += origen[indice] * peso
      verde += origen[indice + 1] * peso
      azul += origen[indice + 2] * peso
      alfa += peso
    }
  }
  if (alfa === 0) return
  const indice = (y * lado + x) * 4
  destino[indice] = Math.round(rojo / alfa)
  destino[indice + 1] = Math.round(verde / alfa)
  destino[indice + 2] = Math.round(azul / alfa)
  destino[indice + 3] = Math.round(alfa / (tamano * tamano))
}

export function reducirIconoPorArea(origen: Buffer, tamano: number, lado: number): Buffer {
  const destino = Buffer.alloc(lado * lado * 4)
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) reducirPixel(origen, tamano, destino, lado, x, y)
  }
  return destino
}

export function empaquetarIco(entradas: readonly { tamano: number; png: Buffer }[]): Buffer {
  const cabecera = Buffer.alloc(6 + 16 * entradas.length)
  cabecera.writeUInt16LE(1, 2)
  cabecera.writeUInt16LE(entradas.length, 4)
  let posicion = cabecera.length
  for (const [indice, { tamano, png }] of entradas.entries()) {
    const entrada = 6 + 16 * indice
    cabecera[entrada] = cabecera[entrada + 1] = tamano === 256 ? 0 : tamano
    cabecera.writeUInt16LE(1, entrada + 4)
    cabecera.writeUInt16LE(32, entrada + 6)
    cabecera.writeUInt32LE(png.length, entrada + 8)
    cabecera.writeUInt32LE(posicion, entrada + 12)
    posicion += png.length
  }
  return Buffer.concat([cabecera, ...entradas.map(({ png }) => png)])
}
