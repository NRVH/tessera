#!/usr/bin/env node
// =============================================================================
// Prueba de las capas, el contraste y las representaciones del icono de franja.
// El PNG de reserva fija el dibujo y el suavizado de los bordes.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { contrasteColor } from '../../shared/contrasteColor.ts'
import {
  bgraPremultiplicadoDesdeRgba,
  componerIconoFranja,
  empaquetarIco,
  reducirIconoPorArea,
  rgbaDesdeBgraPremultiplicado,
  TAMANO_BASE_FRANJA,
  TAMANOS_ICONO_FRANJA,
  validarColorDeFranja
} from './iconoFranjaPuro.ts'

interface ImagenPng {
  width: number
  height: number
  data: Buffer
}

// El códec PNG del generador permite probar los recursos y el ICO sin cargar Electron.
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read: (datos: Buffer) => ImagenPng; write: (imagen: ImagenPng) => Buffer } }
}

function leerRecurso(nombre: string): Buffer {
  const ruta = new URL(`../../../build/${nombre}.png`, import.meta.url)
  const imagen = PNG.sync.read(readFileSync(ruta))
  equal(imagen.width, 512)
  equal(imagen.height, 512)
  return imagen.data
}

const base = leerRecurso('tessera-franja-base')
const mascara = leerRecurso('tessera-franja-insignia')
const verde = componerIconoFranja(base, mascara, [0x5f, 0xd0, 0x8d])

test('el verde de reserva coincide a 512 px con una unidad de tolerancia por canal', () => {
  const original = leerRecurso('tessera-franja')
  let diferencia = 0
  for (let indice = 0; indice < original.length; indice++) {
    diferencia = Math.max(diferencia, Math.abs(verde[indice] - original[indice]))
  }
  ok(diferencia <= 1, `Diferencia máxima por canal: ${diferencia}`)
})

test('la flecha elige el mayor contraste y el disco conserva el color solicitado', () => {
  equal(contrasteColor([255, 255, 255], [0, 0, 0]), 21)
  equal(contrasteColor([34, 36, 43], [34, 36, 43]), 1)
  const claro = componerIconoFranja(base, mascara, [245, 245, 245])
  const oscuro = componerIconoFranja(base, mascara, [16, 16, 16])
  const flecha = (383 * 512 + 383) * 4
  const disco = (430 * 512 + 400) * 4
  deepEqual([...claro.subarray(flecha, flecha + 4)], [34, 36, 43, 255])
  deepEqual([...oscuro.subarray(flecha, flecha + 4)], [255, 255, 255, 255])
  deepEqual([...claro.subarray(disco, disco + 4)], [245, 245, 245, 255])
  deepEqual([...oscuro.subarray(disco, disco + 4)], [16, 16, 16, 255])
})

test('solo se acepta un hexadecimal RGB completo para nombrar el ICO', () => {
  equal(validarColorDeFranja('#5Fd08D'), '#5fd08d')
  for (const invalido of [undefined, null, 123456, '#abc', '5fd08d', '#5fd08d\n', '#5fd08dff', '#/../aa']) {
    equal(validarColorDeFranja(invalido), null)
  }
})

test('la conversión intercambia rojo y azul y premultiplica por el alfa', () => {
  const rgba = Buffer.from([240, 80, 20, 128, 5, 4, 3, 0])
  const bgra = bgraPremultiplicadoDesdeRgba(rgba)
  deepEqual([...bgra], [10, 40, 120, 128, 0, 0, 0, 0])
  deepEqual([...rgbaDesdeBgraPremultiplicado(bgra)], [239, 80, 20, 128, 0, 0, 0, 0])
})

test('la reducción pondera por área y alfa aunque el factor no sea entero', () => {
  const origen = Buffer.from([0, 0, 255, 0, 255, 0, 0, 255, 0, 255, 0, 0])
  const cuadricula = Buffer.concat([Buffer.alloc(12), origen, Buffer.alloc(12)])
  const destino = reducirIconoPorArea(cuadricula, 3, 2)
  deepEqual([...destino], Array.from({ length: 4 }, () => [255, 0, 0, 28]).flat())
})

test('el ICO tiene siete entradas PNG consecutivas con sus tamaños', () => {
  const tamanos = [16, 24, 32, 48, 64, 128, 256]
  const entradas = TAMANOS_ICONO_FRANJA.map((tamano) => ({
    tamano,
    png: PNG.sync.write({ width: tamano, height: tamano, data: reducirIconoPorArea(verde, TAMANO_BASE_FRANJA, tamano) })
  }))
  const ico = empaquetarIco(entradas)
  equal(ico.readUInt16LE(0), 0)
  equal(ico.readUInt16LE(2), 1)
  equal(ico.readUInt16LE(4), tamanos.length)
  let inicio = 6 + 16 * tamanos.length
  for (const [indice, tamano] of tamanos.entries()) {
    const entrada = 6 + 16 * indice
    equal(ico[entrada] || 256, tamano)
    equal(ico[entrada + 1] || 256, tamano)
    equal(ico.readUInt16LE(entrada + 4), 1)
    equal(ico.readUInt16LE(entrada + 6), 32)
    equal(ico.readUInt32LE(entrada + 12), inicio)
    const fin = inicio + ico.readUInt32LE(entrada + 8)
    const png = PNG.sync.read(ico.subarray(inicio, fin))
    equal(png.width, tamano)
    equal(png.height, tamano)
    inicio = fin
  }
  equal(inicio, ico.length)
})
