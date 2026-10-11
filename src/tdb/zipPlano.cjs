// =============================================================================
// Escribe APLANADO un ZIP del catálogo de drivers ya descomprimido con `fflate`, conservando sus
// enlaces simbólicos: el Instant Client de Linux trae `libclntsh.so -> libclntsh.so.19.1`, y
// `fflate` da el destino del enlace como si fuera el contenido del archivo. Qué entradas son
// enlaces se lee del directorio central del ZIP. Gemelo de `src/main/db/zipConEnlaces.ts`.
// Decisiones: docs/decisiones/bd/drivers-catalogo-y-matriz-oracle.md
// =============================================================================
'use strict'

const path = require('node:path')
const { mkdirSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')

const FIRMA_FIN = 0x06054b50
const FIRMA_CENTRAL = 0x02014b50
const SISTEMA_UNIX = 3
const TIPO_ARCHIVO = 0o170000
const TIPO_ENLACE = 0o120000

/**
 * Los nombres de las entradas que son enlaces simbólicos (hechas en Unix y con el tipo de enlace en
 * sus atributos externos). Un ZIP que no se sabe leer da ninguno: se escribirían como archivos y el
 * centinela, si es un enlace, ya no valdría.
 */
function enlacesDelZip(zip) {
  const enlaces = new Set()
  const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let fin = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN) {
      fin = i
      break
    }
  }
  if (fin < 0) return enlaces
  const total = vista.getUint16(fin + 10, true)
  let p = vista.getUint32(fin + 16, true)
  for (let n = 0; n < total && p + 46 <= zip.length; n++) {
    if (vista.getUint32(p, true) !== FIRMA_CENTRAL) break
    const hechoEn = vista.getUint16(p + 4, true) >> 8
    const largoNombre = vista.getUint16(p + 28, true)
    const largoExtra = vista.getUint16(p + 30, true)
    const largoComentario = vista.getUint16(p + 32, true)
    const atributos = vista.getUint32(p + 38, true)
    if (hechoEn === SISTEMA_UNIX && ((atributos >>> 16) & TIPO_ARCHIVO) === TIPO_ENLACE) {
      enlaces.add(Buffer.from(zip.subarray(p + 46, p + 46 + largoNombre)).toString('utf8'))
    }
    p += 46 + largoNombre + largoExtra + largoComentario
  }
  return enlaces
}

/**
 * Destino válido de un enlace del paquete: un nombre de la MISMA carpeta (el ZIP se aplana), sin
 * barras ni `..`. Uno que saliera de ella apuntaría a cualquier sitio del disco.
 */
function destinoDeEnlace(datos) {
  const destino = Buffer.from(datos).toString('utf8')
  // eslint-disable-next-line no-control-regex
  if (destino === '' || destino === '.' || destino === '..' || /[/\\\u0000-\u001f]/.test(destino)) return null
  return destino
}

/**
 * Escribe las entradas en `destino` con su nombre base (corta un `../` de un ZIP manipulado),
 * sin las firmas de `META-INF/`. Los enlaces se crean como enlaces solo si `conEnlaces`; uno con
 * un destino que sale de la carpeta no se escribe. Devuelve cuántas entradas escribió.
 */
function escribirPlano(destino, archivos, enlaces, conEnlaces) {
  mkdirSync(destino, { recursive: true })
  let escritos = 0
  for (const [nombre, datos] of Object.entries(archivos)) {
    if (nombre.endsWith('/') || datos.length === 0 || nombre.includes('META-INF/')) continue
    const base = path.basename(nombre)
    if (!base || base === '.' || base === '..') continue
    const ruta = path.join(destino, base)
    if (conEnlaces && enlaces.has(nombre)) {
      const apunta = destinoDeEnlace(datos)
      if (apunta === null) continue
      rmSync(ruta, { force: true })
      symlinkSync(apunta, ruta)
    } else {
      writeFileSync(ruta, datos)
    }
    escritos++
  }
  return escritos
}

module.exports = { enlacesDelZip, destinoDeEnlace, escribirPlano }
