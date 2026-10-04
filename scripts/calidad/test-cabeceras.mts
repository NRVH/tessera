#!/usr/bin/env node
// =============================================================================
// Guardia de CABECERAS de módulo (npm run test:cabeceras [-- rutas]).
// Todo archivo de código abre con una cabecera `// ====` de 3 a 8 líneas de contenido, y
// si cita `docs/decisiones/….md`, el ADR existe. Sale 1 con cualquier hallazgo
// (`--estricto` se acepta y no hace nada). Se prueba a sí misma con casos sintéticos.
// Depende de `comun.mts`; el estándar está en docs/ESTANDAR_CODIGO.md.
// =============================================================================
import { existsSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {
  DELIMITADOR,
  EXT_CODIGO,
  RAIZ,
  archivosDelAmbito,
  cerrar,
  check,
  hr,
  informar,
  leer,
  leerArgumentos
} from './comun.mts'
import type { Hallazgo } from './comun.mts'

const MIN = 3
const MAX = 8

const lineaDe = (texto: string, p: number) => texto.slice(0, p).split('\n').length

/** Las líneas `//` consecutivas que siguen al delimitador inicial, hasta el de cierre. */
function tramoDeCabecera(texto: string, rangos: ts.CommentRange[]) {
  const contenido: string[] = []
  let anterior = lineaDe(texto, rangos[0].pos)
  for (const r of rangos.slice(1)) {
    const linea = lineaDe(texto, r.pos)
    if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia || linea !== anterior + 1) break
    const t = texto.slice(r.pos, r.end)
    if (DELIMITADOR.test(t)) return { contenido, cerrada: true }
    contenido.push(t)
    anterior = linea
  }
  return { contenido, cerrada: false }
}

function adrsInexistentes(contenido: string[]): string[] {
  const citados = contenido.join('\n').match(/docs\/decisiones\/[\p{L}\p{N}_./-]+\.md/gu) ?? []
  return citados.filter((c) => !existsSync(path.join(RAIZ, c)))
}

/** Los hallazgos de cabecera de un archivo (vacío si cumple). */
export function analizarCabecera(archivo: string, texto: string): Hallazgo[] {
  const h = (clase: string, detalle: string, linea = 1): Hallazgo[] => [{ archivo, linea, clase, detalle }]
  const rangos = ts.getLeadingCommentRanges(texto, 0) ?? []
  const primero = rangos[0]
  if (!primero || !DELIMITADOR.test(texto.slice(primero.pos, primero.end))) {
    return h('sin-cabecera', 'el archivo no abre con una cabecera `// ====`')
  }
  const linea = lineaDe(texto, primero.pos)
  const { contenido, cerrada } = tramoDeCabecera(texto, rangos)
  if (!cerrada) return h('sin-cierre', 'la cabecera no se cierra con `// ====` en líneas seguidas', linea)
  if (contenido.length < MIN) return h('corta', `${contenido.length} línea(s); mínimo ${MIN}`, linea)
  if (contenido.length > MAX) return h('larga', `${contenido.length} líneas; máximo ${MAX}`, linea)
  return adrsInexistentes(contenido).flatMap((c) => h('adr-inexistente', `cita ${c}, que no existe`, linea))
}

function autoprueba(): void {
  const D = '// ' + '='.repeat(20)
  const cab = (n: number) => [D, ...Array.from({ length: n }, (_, i) => `// línea ${i}`), D].join('\n')
  const clases = (texto: string) => analizarCabecera('x.ts', texto).map((x) => x.clase).join(',')
  const casos: [string, string, string][] = [
    ['cabecera de 3 líneas tras un shebang', '#!/usr/bin/env node\n' + cab(3) + '\nexport {}', ''],
    ['cabecera de 8 líneas', cab(8) + '\n\nconst a = 1', ''],
    ['sin comentario inicial', "import x from 'y'\n" + cab(3), 'sin-cabecera'],
    ['empieza por JSDoc', '/** doc */\nexport const a = 1', 'sin-cabecera'],
    ['9 líneas', cab(9), 'larga'],
    ['2 líneas', cab(2), 'corta'],
    ['hueco antes del cierre', [D, '// a', '// b', '', '// c', D].join('\n'), 'sin-cierre'],
    ['ADR que no existe', [D, '// a', '// b', '// Decisiones: docs/decisiones/no/existe.md', D].join('\n'), 'adr-inexistente'],
    ['ADR que existe', [D, '// a', '// b', '// Decisiones: docs/decisiones/README.md', D].join('\n'), ''],
    ['ADR con tildes y eñe que no existe', [D, '// a', '// b', '// Decisiones: docs/decisiones/diseño/pestañas-únicas.md', D].join('\n'), 'adr-inexistente'],
    ['ADR que existe citado con punto final', [D, '// a', '// b', '// Ver docs/decisiones/calidad/react-hooks-dos-reglas.md.', D].join('\n'), '']
  ]
  for (const [nombre, texto, esperado] of casos) {
    const obtenido = clases(texto)
    check(`autoprueba: ${nombre}`, obtenido === esperado, `esperado «${esperado}», obtenido «${obtenido}»`)
  }
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
const archivos = archivosDelAmbito(EXT_CODIGO, op.rutas)
const hallazgos = archivos.flatMap((a) => analizarCabecera(a, leer(a)))
hr(`Cabeceras de módulo: ${archivos.length} archivo(s) revisado(s)`)
check('hay archivos en el ámbito', archivos.length > 0, `${archivos.length} archivo(s)`)
informar(hallazgos, op)
cerrar('cabeceras', archivos.length, hallazgos, op)
