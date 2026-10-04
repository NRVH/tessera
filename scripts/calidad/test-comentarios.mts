#!/usr/bin/env node
// =============================================================================
// Guardia de BLOQUES DE COMENTARIO largos (npm run test:comentarios [-- …]).
// Fuera de la cabecera y del JSDoc, ningún bloque pasa de 10 líneas: un bloque es una
// racha de `//` en líneas propias y seguidas, o un `/* */` (también JSX y CSS). JSDoc es
// solo el `/** */` pegado a una declaración; si no documenta nada, cuenta como bloque.
// Sale 1 con cualquier hallazgo. Se autoprueba.
// =============================================================================
import {
  DELIMITADOR,
  EXT_CODIGO_Y_CSS,
  archivosDelAmbito,
  cerrar,
  check,
  extraerComentarios,
  hr,
  informar,
  leer,
  leerArgumentos
} from './comun.mts'
import type { Comentario, Hallazgo } from './comun.mts'

const MAX = 10

interface Bloque {
  inicio: number
  fin: number
}

/** Cuántos comentarios ocupa la cabecera `// ====` si el archivo abre con ella. */
function comentariosDeCabecera(texto: string, cs: Comentario[]): number {
  const primero = cs[0]
  if (!primero || primero.tipo !== 'linea' || !DELIMITADOR.test(primero.texto)) return 0
  const antes = texto.split('\n').slice(0, primero.inicio - 1)
  if (!antes.every((l) => l.trim() === '' || l.startsWith('#!'))) return 0
  let i = 1
  while (i < cs.length && cs[i].tipo === 'linea' && cs[i].inicio === cs[i - 1].fin + 1) {
    i++
    if (DELIMITADOR.test(cs[i - 1].texto)) break
  }
  return i
}

const encadena = (a: Comentario, b: Comentario) =>
  a.tipo === 'linea' && b.tipo === 'linea' && a.propioRenglon && b.propioRenglon && b.inicio === a.fin + 1

/** Agrupa las rachas de `//` seguidas; el JSDoc no cuenta. */
function agrupar(cs: Comentario[]): Bloque[] {
  const bloques: Bloque[] = []
  let previo: Comentario | null = null
  for (const c of cs) {
    if (c.tipo === 'jsdoc') {
      previo = null
      continue
    }
    const ultimo = bloques[bloques.length - 1]
    if (previo && ultimo && encadena(previo, c)) ultimo.fin = c.fin
    else bloques.push({ inicio: c.inicio, fin: c.fin })
    previo = c
  }
  return bloques
}

/** Los bloques de más de MAX líneas de un archivo. */
export function analizarComentarios(archivo: string, texto: string): Hallazgo[] {
  const cs = extraerComentarios(archivo, texto)
  const resto = cs.slice(comentariosDeCabecera(texto, cs))
  return agrupar(resto)
    .map((b) => ({ ...b, lineas: b.fin - b.inicio + 1 }))
    .filter((b) => b.lineas > MAX)
    .map((b) => ({ archivo, linea: b.inicio, clase: 'bloque-largo', detalle: `${b.lineas} líneas (máximo ${MAX})` }))
}

function autoprueba(): void {
  const D = '// ' + '='.repeat(20)
  const lineas = (n: number, p = '// x') => Array.from({ length: n }, () => p).join('\n')
  const cab = [D, lineas(3), D].join('\n')
  const casos: [string, string, string, string][] = [
    ['10 líneas de //', 'a.ts', lineas(10) + '\nexport {}', ''],
    ['11 líneas de //', 'a.ts', lineas(11) + '\nexport {}', 'bloque-largo'],
    ['/* */ de 11 líneas', 'a.ts', '/*\n' + lineas(9, ' x') + '\n*/\nexport {}', 'bloque-largo'],
    ['JSDoc de 20 líneas', 'a.ts', '/**\n' + lineas(18, ' * x') + '\n */\nexport const a = 1', ''],
    ['/** */ de 11 líneas delante de una sentencia', 'a.ts', '/**\n' + lineas(9, ' * x') + '\n */\nf()', 'bloque-largo'],
    ['/** */ de 11 líneas al final del archivo', 'a.ts', 'export {}\n/**\n' + lineas(9, ' * x') + '\n */\n', 'bloque-largo'],
    ['/** */ de 11 líneas dentro de una función', 'a.ts', 'function f() {\n/**\n' + lineas(9, ' * x') + '\n */\nreturn 1\n}', 'bloque-largo'],
    ['/** */ largo y otro JSDoc delante de la función', 'a.ts', '/**\n' + lineas(9, ' * x') + '\n */\n/** doc */\nexport function f() {}', 'bloque-largo'],
    ['JSDoc largo, directiva // y la función', 'a.ts', '/**\n' + lineas(9, ' * x') + '\n */\n// eslint-disable-next-line\nexport function f() {}', ''],
    ['JSDoc largo de un método', 'a.ts', 'class A {\n  /**\n' + lineas(9, '   * x') + '\n   */\n  m() {}\n}', ''],
    ['JSDoc largo de una propiedad de interfaz', 'a.ts', 'interface I {\n  /**\n' + lineas(9, '   * x') + '\n   */\n  p: string\n}', ''],
    ['JSDoc largo de un tipo', 'a.ts', '/**\n' + lineas(9, ' * x') + '\n */\ntype T = string', ''],
    ['JSDoc largo de un export CommonJS', 'a.cjs', '/**\n' + lineas(9, ' * x') + '\n */\nmodule.exports.f = function () {}', ''],
    ['/** */ largo en JSX', 'a.tsx', 'export const A = () => <div>{/**\n' + lineas(9, 'x') + '\n*/}</div>', 'bloque-largo'],
    ['/** */ largo en CSS', 'a.css', '/**\n' + lineas(9, ' * x') + '\n */\n.a {}', 'bloque-largo'],
    ['cabecera y código', 'a.ts', cab + '\n\nexport {}', ''],
    ['cabecera y 11 // pegadas', 'a.ts', cab + '\n' + lineas(11) + '\nexport {}', 'bloque-largo'],
    ['11 comentarios al final de línea', 'a.ts', lineas(11, 'f() // x'), ''],
    ['CSS de 11 líneas', 'a.css', '/*\n' + lineas(9, ' x') + '\n*/\n.a {}', 'bloque-largo'],
    ['JSX de 11 líneas', 'a.tsx', 'export const A = () => <div>{/*\n' + lineas(9, 'x') + '\n*/}</div>', 'bloque-largo']
  ]
  for (const [nombre, archivo, texto, esperado] of casos) {
    const obtenido = [...new Set(analizarComentarios(archivo, texto).map((h) => h.clase))].join(',')
    check(`autoprueba: ${nombre}`, obtenido === esperado, `esperado «${esperado}», obtenido «${obtenido}»`)
  }
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
const archivos = archivosDelAmbito(EXT_CODIGO_Y_CSS, op.rutas)
const hallazgos = archivos.flatMap((a) => analizarComentarios(a, leer(a)))
hr(`Bloques de comentario de más de ${MAX} líneas: ${archivos.length} archivo(s)`)
check('hay archivos en el ámbito', archivos.length > 0, `${archivos.length} archivo(s)`)
informar(hallazgos, op)
cerrar('comentarios', archivos.length, hallazgos, op)
