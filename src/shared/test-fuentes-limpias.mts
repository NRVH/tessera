#!/usr/bin/env node
// =============================================================================
// Guardia de CARACTERES INVISIBLES en el fuente (npm run test:fuentes-limpias): no
// prueba una función, recorre `src/` con `fs` (sin `node_modules` ni `out`). Un byte
// NUL crudo vuelve el archivo binario para git y grep; un U+00A0 pegado en un literal
// parece un espacio y no lo es. El carácter se ESCRIBE como escape, no se pega.
// Se permiten tabulador, salto de línea y retorno de carro; fallan los controles C0 y
// DEL, los C1, y U+00A0, U+200B, U+2060 y U+FEFF (este rompe un `import` a media línea).
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Los tres de estructura. Todo lo demás sobra en un fuente. */
const PERMITIDOS = new Set([0x09, 0x0a, 0x0d])

/**
 * Invisibles fuera del rango de control que hacen exactamente el mismo daño: se
 * leen como un espacio (o como nada) y nadie que toque la línea sabe que están.
 * U+00A0 espacio duro · U+200B ancho cero · U+2060 juntapalabras · U+FEFF BOM.
 */
const INVISIBLES = new Set([0x00a0, 0x200b, 0x2060, 0xfeff])

/** Extensiones que se revisan: el código y la configuración que se edita a mano. */
const EXTENSIONES = new Set(['.ts', '.tsx', '.mts', '.css', '.html', '.json', '.yml', '.md'])

/** Carpetas que no son fuente nuestro. */
const SALTAR = new Set(['node_modules', 'out', 'dist', '.git', 'build'])

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Nombre humano de los que se ven a menudo; el resto sale por su código. */
const NOMBRES: Record<number, string> = {
  0x00: 'NUL crudo (U+0000)',
  0x00a0: 'ESPACIO DURO (U+00A0)',
  0x200b: 'ESPACIO DE ANCHO CERO (U+200B)',
  0x2060: 'JUNTAPALABRAS (U+2060)',
  0xfeff: 'BOM / espacio de ancho cero sin salto (U+FEFF)'
}

interface Hallazgo {
  archivo: string
  linea: number
  codigo: number
  contexto: string
}

function recorrer(dir: string, fuera: string[]): void {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      if (SALTAR.has(d.name)) continue
      recorrer(path.join(dir, d.name), fuera)
      continue
    }
    if (!d.isFile()) continue
    if (!EXTENSIONES.has(path.extname(d.name))) continue
    fuera.push(path.join(dir, d.name))
  }
}

function revisar(archivo: string): Hallazgo[] {
  const texto = readFileSync(archivo, 'utf8')
  const hallazgos: Hallazgo[] = []
  let linea = 1
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    if (c === 0x0a) {
      linea++
      continue
    }
    const malo =
      (c < 0x20 && !PERMITIDOS.has(c)) ||
      c === 0x7f ||
      (c >= 0x80 && c <= 0x9f) ||
      INVISIBLES.has(c)
    if (!malo) continue
    hallazgos.push({
      archivo: path.relative(raiz, archivo).replace(/\\/g, '/'),
      linea,
      codigo: c,
      contexto: texto.slice(Math.max(0, i - 30), i + 20).replace(/[\r\n]/g, '·')
    })
  }
  return hallazgos
}

const archivos: string[] = []
for (const sub of ['src', 'scripts', 'docs']) {
  const abs = path.join(raiz, sub)
  try {
    if (statSync(abs).isDirectory()) recorrer(abs, archivos)
  } catch {
    // La carpeta puede no existir en un checkout parcial: no es un fallo.
  }
}

const todos: Hallazgo[] = []
for (const a of archivos) todos.push(...revisar(a))

console.log('\n' + '='.repeat(78))
console.log('Caracteres invisibles en el fuente')
console.log('='.repeat(78))
console.log(`  archivos revisados: ${archivos.length}`)

if (todos.length > 0) {
  for (const h of todos) {
    const nombre =
      NOMBRES[h.codigo] ?? `control U+${h.codigo.toString(16).padStart(4, '0').toUpperCase()}`
    console.log(`\nFAIL  ${h.archivo}:${h.linea} — ${nombre}`)
    console.log(`      -> …${h.contexto}…`)
    console.log('      -> escríbelo como escape, no lo pegues como carácter.')
  }
}

console.log('')
if (todos.length > 0) {
  console.log(`RESULTADO: ${todos.length} carácter(es) invisible(s) en el fuente`)
  process.exit(1)
}
console.log(`RESULTADO: ${archivos.length} archivos limpios`)
