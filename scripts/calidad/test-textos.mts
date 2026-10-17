#!/usr/bin/env node
// =============================================================================
// Guardia de TEXTOS (npm run test:textos [-- rutas]): en el JSX del renderer no va texto escrito a
// mano, ni como hijo ni en `title`/`placeholder`/`aria-label`/`alt`, porque saldría solo en un idioma;
// va en el `textos*.ts` de su área con `crearTextos(es, en)`. Pasan lo técnico (con `.`, `-`, `_`,
// `/`…) y los nombres de `PERMITIDOS`. No ve `throw` ni diálogos del main: esos se revisan a mano.
// Depende de `comun.mts`; la regla está en docs/ESTANDAR_CODIGO.md («Idioma e identificadores»).
// =============================================================================
import ts from 'typescript'
import { archivosDelAmbito, cerrar, check, hr, informar, leer, leerArgumentos } from './comun.mts'
import type { Hallazgo } from './comun.mts'

/** Nombres propios y términos que se escriben igual en los dos idiomas. */
const PERMITIDOS = new Set([
  'Tessera', 'Codex', 'Claude Code', 'Codex · Claude Code', 'Docker', 'Git', 'Log', 'Diff', 'Editor',
  'JVM', 'bytecode', 'tdb', 'tdb ls', 'ms', 'NULL', 'WHERE', 'RO', '· db', 'mymaster',
  // Los conmutadores de buscar: mayúsculas y palabra completa, por su símbolo.
  'Aa', 'ab'
])

const ATRIBUTOS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'aria-description'])

/** Código: una sola pieza con un carácter de código (`AGENTS.md`, `--continue`) o una orden. */
const esCodigo = (t: string) => (!t.includes(' ') && /[._/\\=<>&;-]/.test(t)) || /^(npm|npx|git) /.test(t)

/** Texto que sale en un solo idioma: tiene letras, no es código y no es un nombre permitido. */
export function esTextoSuelto(texto: string): boolean {
  const t = texto.trim().replace(/\s+/g, ' ')
  return /\p{L}/u.test(t) && !esCodigo(t) && !PERMITIDOS.has(t)
}

/** El literal de un `{'…'}` o `{`…`}` sin sustituciones, o null. */
function literalDe(n: ts.Node | undefined): string | null {
  if (n && ts.isJsxExpression(n)) n = n.expression
  return n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null
}

/** Los textos sueltos de un `.tsx`. */
export function analizarTextos(archivo: string, texto: string): Hallazgo[] {
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hallazgos: Hallazgo[] = []
  const anotar = (n: ts.Node, t: string) =>
    hallazgos.push({ archivo, linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, clase: 'texto-suelto', detalle: `«${t.trim().slice(0, 60)}»` })
  const visitar = (n: ts.Node): void => {
    if (ts.isJsxText(n) && esTextoSuelto(n.text)) anotar(n, n.text)
    // Un `{'…'}` hijo de un elemento sale en pantalla igual que el texto escrito directamente.
    if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      const t = literalDe(n)
      if (t !== null && esTextoSuelto(t)) anotar(n, t)
    }
    if (ts.isJsxAttribute(n) && ATRIBUTOS.has(n.name.getText(sf))) {
      const t = literalDe(n.initializer)
      if (t !== null && esTextoSuelto(t)) anotar(n, t)
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return hallazgos
}

function autoprueba(): void {
  const casos: [string, string, number][] = [
    ['texto hijo en español', 'const a = <b>Guardar cambios</b>', 1],
    ['atributo en español', 'const a = <i aria-label="Barra de estado" />', 1],
    ['frase con punto', 'const a = <p>No hay conexiones. Crea una nueva.</p>', 1],
    ['frase con guion', 'const a = <i title="Abrir en solo-lectura" />', 1],
    ['literal entre llaves', "const a = <b title={'Guardar'}>{'Guardar'}</b>", 2],
    ['plantilla sin sustituciones', 'const a = <b>{`Guardar`}</b>', 1],
    ['nombre de archivo', 'const a = <code>AGENTS.md</code>', 0],
    ['texto desde crearTextos', 'const a = <b title={tx().guardar}>{tx().guardar}</b>', 0],
    ['nombre permitido', 'const a = <b>Tessera</b>', 0],
    ['término técnico', 'const a = <i placeholder="npm install -g mi-agente" />', 0],
    ['solo símbolos', 'const a = <b> · </b>', 0],
    ['atributo que no se lee', 'const a = <i className="barra de estado" />', 0]
  ]
  for (const [nombre, codigo, esperado] of casos) {
    const n = analizarTextos('x.tsx', codigo).length
    check(`autoprueba: ${nombre}`, n === esperado, `esperado ${esperado}, obtenido ${n}`)
  }
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
const archivos = archivosDelAmbito(/\.tsx$/, op.rutas).filter((f) => f.startsWith('src/renderer/'))
const hallazgos = archivos.flatMap((a) => analizarTextos(a, leer(a)))
hr(`Textos en dos idiomas: ${archivos.length} archivo(s) revisado(s)`)
informar(hallazgos, op)
cerrar('textos', archivos.length, hallazgos, op)
