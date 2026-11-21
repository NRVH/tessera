// =============================================================================
// Icono nativo de la franja y caché de sus iconos de relanzamiento en Windows.
// El nombre de cada archivo sale del color validado, de modo que varios perfiles pueden compartirlo.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { escribirSinSeguirEnlacesSync } from '../util/escrituraAtomica'
import {
  bgraPremultiplicadoDesdeRgba,
  componerIconoFranja,
  empaquetarIco,
  reducirIconoPorArea,
  rgbaDesdeBgraPremultiplicado,
  TAMANO_BASE_FRANJA,
  TAMANOS_ICONO_FRANJA,
  validarColorDeFranja
} from './iconoFranjaPuro'

export function rutaRecursoIcono(nombre: string): string {
  return app.isPackaged ? join(process.resourcesPath, nombre) : join(app.getAppPath(), 'build', nombre)
}

function leerCapa(nombre: string): Buffer {
  const imagen = nativeImage.createFromPath(rutaRecursoIcono(nombre))
  const { width: ancho, height: alto } = imagen.getSize()
  if (ancho !== TAMANO_BASE_FRANJA || alto !== TAMANO_BASE_FRANJA) {
    throw new Error(`Recurso de franja ausente o de tamaño incorrecto: ${nombre}`)
  }
  const mapa = imagen.toBitmap()
  if (mapa.length !== ancho * alto * 4) throw new Error(`Píxeles de franja ilegibles: ${nombre}`)
  return rgbaDesdeBgraPremultiplicado(mapa)
}

let capas: { base: Buffer; insignia: Buffer } | undefined

function componerIconoDeColor(hexadecimal: string): Buffer {
  capas ??= {
    base: leerCapa('tessera-franja-base.png'),
    insignia: leerCapa('tessera-franja-insignia.png')
  }
  const rojo = parseInt(hexadecimal.slice(0, 2), 16)
  const verde = parseInt(hexadecimal.slice(2, 4), 16)
  const azul = parseInt(hexadecimal.slice(4, 6), 16)
  return componerIconoFranja(capas.base, capas.insignia, [rojo, verde, azul])
}

function prepararIconoWindows(hexadecimal: string): string {
  const ruta = join(app.getPath('userData'), 'iconos-franja', `${hexadecimal}.ico`)
  if (existsSync(ruta)) return ruta
  const icono = componerIconoDeColor(hexadecimal)
  const entradas = TAMANOS_ICONO_FRANJA.map((tamano) => {
    const mapa = bgraPremultiplicadoDesdeRgba(reducirIconoPorArea(icono, TAMANO_BASE_FRANJA, tamano))
    const png = nativeImage.createFromBitmap(mapa, { width: tamano, height: tamano }).toPNG()
    if (png.length === 0) throw new Error(`No se pudo codificar el icono de franja de ${tamano} px`)
    return { tamano, png }
  })
  escribirSinSeguirEnlacesSync(ruta, empaquetarIco(entradas))
  return ruta
}

function prepararIconoLinux(hexadecimal: string): NativeImage {
  // X11 publica la representación de escala 1 como icono de ventana.
  const mapa = bgraPremultiplicadoDesdeRgba(componerIconoDeColor(hexadecimal))
  return nativeImage.createFromBitmap(mapa, { width: TAMANO_BASE_FRANJA, height: TAMANO_BASE_FRANJA })
}

export function crearIconoFranja(color: unknown, enWindows: boolean): { imagen: NativeImage; ruta: string | null } {
  const validado = validarColorDeFranja(color)
  if (validado === null) throw new Error('Falta un color de perfil con formato #rrggbb')
  const hexadecimal = validado.slice(1)
  const ruta = enWindows ? prepararIconoWindows(hexadecimal) : null
  // En Windows, Electron elige el tamaño nativo entre las entradas del ICO cargado desde disco.
  const imagen = ruta ? nativeImage.createFromPath(ruta) : prepararIconoLinux(hexadecimal)
  if (imagen.isEmpty()) throw new Error('No se pudo cargar el icono de franja')
  return { imagen, ruta }
}
