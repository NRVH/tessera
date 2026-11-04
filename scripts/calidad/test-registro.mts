#!/usr/bin/env node
// =============================================================================
// Guardia de REGISTRO (npm run test:registro [-- rutas]): el español de `crearTextos(es, en)` trata de
// usted. Busca solo formas de tuteo que no se confunden con usted ni con la tercera persona («pulsa» o
// «elige» valen en «si pulsa» o «Tessera elige»), así que no sustituye a la lectura de cada texto.
// Depende de `comun.mts`; el criterio está en docs/decisiones/app/redaccion.md.
// =============================================================================
import ts from 'typescript'
import { archivosDelAmbito, cerrar, check, hr, informar, leer, leerArgumentos } from './comun.mts'
import type { Hallazgo } from './comun.mts'

const TUTEO =
  /(?<![\p{L}\p{N}_-])(tú|tu|tus|tuyo|tuya|tuyos|tuyas|tienes|puedes|quieres|necesitas|debes|sabes|usas|estás|abriste|cerraste|pusiste|elegiste|hiciste|cancelaste|asegúrate|inténtalo|actívalo|ciérralo|ábrelo|elimínala|elimínalo|revísalo|recuérdalo)(?![\p{L}\p{N}_-])/iu

/** El objeto español de una llamada: el primer argumento, o la `const` del archivo que nombra. */
function bloqueEspanol(sf: ts.SourceFile, llamada: ts.CallExpression): ts.Node | null {
  const arg = llamada.arguments[0]
  if (!arg || !ts.isIdentifier(arg)) return arg ?? null
  let hallado: ts.Node | null = null
  const buscar = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text && n.initializer) hallado = n.initializer
    ts.forEachChild(n, buscar)
  }
  buscar(sf)
  return hallado
}

/** Las formas de tuteo en los textos en español de un archivo. */
export function analizarRegistro(archivo: string, texto: string): Hallazgo[] {
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hallazgos: Hallazgo[] = []
  const mirar = (n: ts.Node): void => {
    const literal =
      ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.text : null
    const forma = literal === null ? null : TUTEO.exec(literal)
    if (forma) {
      hallazgos.push({
        archivo,
        linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        clase: 'tuteo',
        detalle: `«${forma[0]}» en «${(literal ?? '').slice(0, 70)}»`
      })
    }
    ts.forEachChild(n, mirar)
  }
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'crearTextos') {
      const es = bloqueEspanol(sf, n)
      if (es) mirar(es)
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return hallazgos
}

function autoprueba(): void {
  const casos: [string, string, number][] = [
    ['tuteo en un literal', "crearTextos({ a: 'Si tienes dudas' }, { a: 'x' })", 1],
    ['posesivo en una función', 'crearTextos({ a: (x: string) => `En tu equipo ${x}` }, { a: () => "x" })', 1],
    ['bloque por nombre', "const es = { a: 'Lo que puedes hacer' }; crearTextos(es, en)", 1],
    ['usted', "crearTextos({ a: 'Si tiene dudas, puede consultar su equipo' }, { a: 'x' })", 0],
    ['tercera persona', "crearTextos({ a: 'Tessera elige y pulsa' }, { a: 'x' })", 0],
    ['el inglés no se mira', "crearTextos({ a: 'x' }, { a: 'tu tienes' })", 0],
    ['fuera de crearTextos', "const a = 'instrucción: si tienes dudas'", 0],
    ['dentro de un identificador', "crearTextos({ a: 'sistema.tu-equipo tuEquipo' }, { a: 'x' })", 0]
  ]
  for (const [nombre, codigo, esperado] of casos) {
    const n = analizarRegistro('x.ts', codigo).length
    check(`autoprueba: ${nombre}`, n === esperado, `esperado ${esperado}, obtenido ${n}`)
  }
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
const archivos = archivosDelAmbito(/\.tsx?$/, op.rutas).filter((f) => f.startsWith('src/') && !/\/test-[^/]+$/.test(f))
const hallazgos = archivos.flatMap((a) => analizarRegistro(a, leer(a)))
hr(`Registro formal: ${archivos.length} archivo(s) revisado(s)`)
informar(hallazgos, op)
cerrar('registro', archivos.length, hallazgos, op)
