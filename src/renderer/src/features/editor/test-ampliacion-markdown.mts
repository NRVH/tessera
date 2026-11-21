#!/usr/bin/env node
// =============================================================================
// Prueba de las reglas puras de ampliación en Markdown
// (npm run test:ampliacion-markdown).
// Fija el tamaño pintado mínimo (64 × 64 px) y cuándo un clic directo sobre una
// imagen o diagrama debe abrir el visor ampliado.
// =============================================================================

import {
  MIN_LADO_IMAGEN_AMPLIABLE_PX,
  clicDebeAmpliar,
  imagenEsAmpliable,
  type OpcionesClicAmpliacion
} from './ampliacionMarkdown.ts'

function hr(titulo: string): void {
  console.log('\n' + '='.repeat(64) + '\n' + titulo)
}

let total = 0
let correctas = 0

function check(nombre: string, obtenido: boolean, esperado: boolean): void {
  total++
  const coincide = obtenido === esperado
  if (coincide) correctas++
  console.log(`[${coincide ? 'PASS' : 'FAIL'}] ${nombre}: ${obtenido} (esperado: ${esperado})`)
}

function comprobarMedida(nombre: string, ancho: number, alto: number, esperado: boolean): void {
  check(`${nombre} (${ancho}×${alto})`, imagenEsAmpliable(ancho, alto), esperado)
}

function comprobarClic(nombre: string, opciones: OpcionesClicAmpliacion, esperado: boolean): void {
  check(nombre, clicDebeAmpliar(opciones), esperado)
}

hr('Umbral mínimo para ofrecer «Ampliar» en imágenes de Markdown')
comprobarMedida('insignia pequeña de 20×20', 20, 20, false)
comprobarMedida('icono de 16×16', 16, 16, false)
comprobarMedida('banner ancho pero bajo de 200×20', 200, 20, false)
comprobarMedida('imagen estrecha pero alta de 20×200', 20, 200, false)
comprobarMedida('un píxel bajo el umbral en ancho', MIN_LADO_IMAGEN_AMPLIABLE_PX - 1, MIN_LADO_IMAGEN_AMPLIABLE_PX, false)
comprobarMedida('un píxel bajo el umbral en alto', MIN_LADO_IMAGEN_AMPLIABLE_PX, MIN_LADO_IMAGEN_AMPLIABLE_PX - 1, false)
comprobarMedida('justo en el umbral', MIN_LADO_IMAGEN_AMPLIABLE_PX, MIN_LADO_IMAGEN_AMPLIABLE_PX, true)
comprobarMedida('imagen grande de 200×200', 200, 200, true)
comprobarMedida('imagen sin medidas pintadas', 0, 0, false)
comprobarMedida('medidas no finitas o negativas', Number.NaN, 200, false)
comprobarMedida('medidas negativas', -100, 200, false)

const IMAGEN_GRANDE: OpcionesClicAmpliacion['elemento'] = { tipo: 'imagen', lista: true, ancho: 200, alto: 200 }
const DIAGRAMA_LISTO: OpcionesClicAmpliacion['elemento'] = { tipo: 'diagrama', dibujado: true, conError: false }

hr('Clic directo sobre imagen o diagrama en Markdown')
comprobarClic(
  'clic principal sin modificadores sobre imagen grande amplía',
  { elemento: IMAGEN_GRANDE, boton: 0, conModificadores: false, enEnlace: false, conSeleccion: false },
  true
)
comprobarClic(
  'clic principal sin modificadores sobre diagrama dibujado amplía',
  { elemento: DIAGRAMA_LISTO, boton: 0, conModificadores: false, enEnlace: false, conSeleccion: false },
  true
)
comprobarClic(
  'imagen dentro de un enlace no amplía',
  { elemento: IMAGEN_GRANDE, boton: 0, conModificadores: false, enEnlace: true, conSeleccion: false },
  false
)
comprobarClic(
  'clic con modificadores no amplía',
  { elemento: IMAGEN_GRANDE, boton: 0, conModificadores: true, enEnlace: false, conSeleccion: false },
  false
)
comprobarClic(
  'clic con botón secundario no amplía',
  { elemento: DIAGRAMA_LISTO, boton: 2, conModificadores: false, enEnlace: false, conSeleccion: false },
  false
)
comprobarClic(
  'clic con botón central no amplía',
  { elemento: IMAGEN_GRANDE, boton: 1, conModificadores: false, enEnlace: false, conSeleccion: false },
  false
)
comprobarClic(
  'selección de texto no vacía dentro del diagrama no amplía',
  { elemento: DIAGRAMA_LISTO, boton: 0, conModificadores: false, enEnlace: false, conSeleccion: true },
  false
)
comprobarClic(
  'imagen pequeña que no ofrece ampliar no amplía',
  {
    elemento: { tipo: 'imagen', lista: true, ancho: 20, alto: 20 },
    boton: 0,
    conModificadores: false,
    enEnlace: false,
    conSeleccion: false
  },
  false
)
comprobarClic(
  'imagen aún no cargada no amplía',
  {
    elemento: { tipo: 'imagen', lista: false, ancho: 200, alto: 200 },
    boton: 0,
    conModificadores: false,
    enEnlace: false,
    conSeleccion: false
  },
  false
)
comprobarClic(
  'diagrama con error no amplía',
  {
    elemento: { tipo: 'diagrama', dibujado: true, conError: true },
    boton: 0,
    conModificadores: false,
    enEnlace: false,
    conSeleccion: false
  },
  false
)
comprobarClic(
  'diagrama sin dibujar no amplía',
  {
    elemento: { tipo: 'diagrama', dibujado: false, conError: false },
    boton: 0,
    conModificadores: false,
    enEnlace: false,
    conSeleccion: false
  },
  false
)

hr(`VEREDICTO: ${correctas}/${total} PASS`)
process.exit(correctas === total ? 0 : 1)
