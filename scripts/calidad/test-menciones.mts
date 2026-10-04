#!/usr/bin/env node
// =============================================================================
// Guardia de MENCIONES en COMENTARIOS (npm run test:menciones [-- …]): nombres de productos o
// datos que no deben acabar en el código. Mira solo comentarios (también `{/* */}` de JSX, CSS y
// CSS en literales de `estilos*.ts` y `estilos/*.ts`), nunca cadenas visibles. Los patrones no
// se versionan: llegan con `--privados <archivo>`, TESSERA_PATRONES_PRIVADOS o, si no, del local
// `.patrones-privados.txt` de la raíz. Sin patrones sale 0 y el VEREDICTO lo dice.
// Sale 1 con cualquier hallazgo. Se autoprueba.
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  EXT_CODIGO_Y_CSS,
  RAIZ,
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

/** Lo que se busca y lo que se tapa antes de buscar (nombres de paquete, de proveedor…). */
export interface Patrones {
  prohibidos: RegExp[]
  permitidos: RegExp[]
}

/** Tapa lo permitido con espacios (conserva posiciones y saltos de línea). */
function taparPermitidos(texto: string, permitidos: readonly RegExp[]): string {
  return permitidos.reduce((t, re) => t.replace(re, (m) => ' '.repeat(m.length)), texto)
}

function buscar(c: Comentario, texto: string, re: RegExp, archivo: string): Hallazgo[] {
  const fuera: Hallazgo[] = []
  for (const m of texto.matchAll(re)) {
    const linea = c.inicio + (texto.slice(0, m.index).match(/\n/g)?.length ?? 0)
    fuera.push({ archivo, linea, clase: 'mención', detalle: `patrón privado: «${m[0]}»` })
  }
  return fuera
}

/** Las menciones en los comentarios de un archivo. */
export function analizarMenciones(archivo: string, texto: string, patrones: Patrones): Hallazgo[] {
  const fuera: Hallazgo[] = []
  for (const c of extraerComentarios(archivo, texto)) {
    const limpio = taparPermitidos(c.texto, patrones.permitidos)
    for (const re of patrones.prohibidos) fuera.push(...buscar(c, limpio, re, archivo))
  }
  return fuera
}

/**
 * Una regex por línea; `#` comenta y las vacías no cuentan. `!` delante la marca como
 * permitida (se tapa antes de buscar) y `(?i)` delante la hace insensible a mayúsculas.
 */
export function parsearPatrones(contenido: string): Patrones {
  const patrones: Patrones = { prohibidos: [], permitidos: [] }
  for (const cruda of contenido.split(/\r?\n/)) {
    let l = cruda.trim()
    if (!l || l.startsWith('#')) continue
    const permitido = l.startsWith('!')
    if (permitido) l = l.slice(1)
    const sinCaja = l.startsWith('(?i)')
    if (sinCaja) l = l.slice(4)
    const re = new RegExp(l, sinCaja ? 'gi' : 'g')
    ;(permitido ? patrones.permitidos : patrones.prohibidos).push(re)
  }
  return patrones
}

/** El archivo de patrones que se carga solo si no llega ni `--privados` ni la variable. */
export const PATRONES_LOCALES = path.join(RAIZ, '.patrones-privados.txt')

/** El archivo a leer: el explícito (`--privados` o la variable), si no el local si existe, si no ninguno. */
export function rutaDePatrones(explicita: string | null, existe: (ruta: string) => boolean = existsSync): string | null {
  if (explicita) return explicita
  return existe(PATRONES_LOCALES) ? PATRONES_LOCALES : null
}

/** Lo que se añade al VEREDICTO cuando no se ha buscado nada: un TODO PASS así no certifica. */
export function avisoSinPatrones(patrones: Patrones): string | undefined {
  return patrones.prohibidos.length === 0 ? 'SIN PATRONES: NO SE HA BUSCADO NINGUNA MENCIÓN' : undefined
}

function cargarPatrones(ruta: string | null): Patrones {
  if (!ruta) return { prohibidos: [], permitidos: [] }
  const ok = existsSync(ruta)
  check('patrones privados cargados', ok, ok ? ruta : `no existe ${ruta}`)
  return ok ? parsearPatrones(readFileSync(ruta, 'utf8')) : { prohibidos: [], permitidos: [] }
}

function autopruebaDelArchivo(): void {
  const vacio: Patrones = { prohibidos: [], permitidos: [] }
  check('autoprueba: sin patrones, el VEREDICTO lo avisa',
    avisoSinPatrones(vacio) === 'SIN PATRONES: NO SE HA BUSCADO NINGUNA MENCIÓN', String(avisoSinPatrones(vacio)))
  check('autoprueba: con patrones, sin aviso',
    avisoSinPatrones(parsearPatrones('secreto')) === undefined, String(avisoSinPatrones(parsearPatrones('secreto'))))
  check('autoprueba: la ruta explícita manda sobre el archivo local',
    rutaDePatrones('otro.txt', () => true) === 'otro.txt', String(rutaDePatrones('otro.txt', () => true)))
  check('autoprueba: sin ruta explícita, se carga el archivo local si existe',
    rutaDePatrones(null, () => true) === PATRONES_LOCALES, String(rutaDePatrones(null, () => true)))
  check('autoprueba: sin ruta ni archivo local, ningún archivo',
    rutaDePatrones(null, () => false) === null, String(rutaDePatrones(null, () => false)))
}

function autoprueba(): void {
  const patrones = parsearPatrones(
    ['# comentario', '(?i)\\bZorbaEdit\\b', 'secreto', '!zorbaedit-iconos', ''].join('\n')
  )
  check('autoprueba: el archivo da 2 prohibidos y 1 permitido',
    patrones.prohibidos.length === 2 && patrones.permitidos.length === 1,
    `${patrones.prohibidos.length}/${patrones.permitidos.length}`)
  const casos: [string, string, string, string][] = [
    ['comentario de línea', 'a.ts', '// igual que ZorbaEdit\nconst a = 1', 'mención'],
    ['sin distinguir mayúsculas', 'a.ts', '// igual que zorbaedit\nconst a = 1', 'mención'],
    ['cadena visible', 'a.ts', "const a = 'ZorbaEdit'", ''],
    ['literal de plantilla', 'a.ts', 'const a = `// ZorbaEdit`', ''],
    ['nombre de paquete permitido', 'a.ts', '// iconos de zorbaedit-iconos\nexport {}', ''],
    ['comentario JSX', 'a.tsx', 'export const A = () => <div>{/* como ZorbaEdit */}</div>', 'mención'],
    ['texto JSX', 'a.tsx', 'export const A = () => <p>// ZorbaEdit</p>', ''],
    ['CSS', 'a.css', '/* como ZorbaEdit */\n.a { color: red }', 'mención'],
    ['CSS en estilos*.ts', 'estilosX.ts', 'export const c = `/* como ZorbaEdit */ .a{}`', 'mención'],
    ['CSS en estilos/*.ts', 'git/estilos/log.ts', 'export const c = `/* como ZorbaEdit */ .a{}`', 'mención'],
    ['CSS en otro .ts', 'otro.ts', 'export const c = `/* como ZorbaEdit */ .a{}`', ''],
    ['patrón con caja', 'a.ts', '// un secreto\nexport {}', 'mención'],
    ['patrón con caja, otra caja', 'a.ts', '// un SECRETO\nexport {}', '']
  ]
  for (const [nombre, archivo, texto, esperado] of casos) {
    const obtenido = [...new Set(analizarMenciones(archivo, texto, patrones).map((h) => h.clase))].join(',')
    check(`autoprueba: ${nombre}`, obtenido === esperado, `esperado «${esperado}», obtenido «${obtenido}»`)
  }
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
autopruebaDelArchivo()
const patrones = cargarPatrones(rutaDePatrones(op.privados))
const archivos = archivosDelAmbito(EXT_CODIGO_Y_CSS, op.rutas)
const hallazgos = archivos.flatMap((a) => analizarMenciones(a, leer(a), patrones))
hr(`Menciones en comentarios: ${archivos.length} archivo(s), ${patrones.prohibidos.length} patrón(es)`)
if (patrones.prohibidos.length === 0) {
  console.log(
    '  Sin patrones: pásalos con --privados <archivo>, TESSERA_PATRONES_PRIVADOS o en ' +
      path.relative(RAIZ, PATRONES_LOCALES).replace(/\\/g, '/') + '.'
  )
}
check('hay archivos en el ámbito', archivos.length > 0, `${archivos.length} archivo(s)`)
informar(hallazgos, op)
cerrar('menciones', archivos.length, hallazgos, op, avisoSinPatrones(patrones))
