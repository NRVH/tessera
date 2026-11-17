// =============================================================================
// Apoyo de la autoprueba de la guardia de claves persistidas: el programa del repo con un archivo servido
// en memoria, la mutación de una propiedad o de un `Omit` sobre el texto real y los hallazgos del repo
// entero con la lista versionada. Sin escribir en disco.
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { check, RAIZ } from './comun.mts'
import { calcularFilas, leerLista, compararConLista } from './clavesPersistidas.mts'
import { sobrantesEnSpreads } from './spreadsPersistidos.mts'
import type { Hallazgo } from './clavesPersistidas.mts'

export const archivoRaices = path.join(RAIZ, 'src', 'main', 'raicesPersistidas.ts')
export function caso(nombre: string, comprobar: () => void): void {
  try { comprobar(); check(nombre, true, 'coincide con lo esperado') }
  catch (error) { check(nombre, false, String(error)); console.error(error) }
}
export function programaEnMemoria(texto: string, completo = false, archivo = archivoRaices, desplazar?: string): ts.Program {
  const configuracion = ts.getParsedCommandLineOfConfigFile(path.join(RAIZ, 'tsconfig.node.json'), { composite: false, noEmit: true }, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')) }
  })!
  const anfitrion = ts.createCompilerHost(configuracion.options, true)
  const original = anfitrion.getSourceFile.bind(anfitrion)
  anfitrion.getSourceFile = (f, lenguaje, error, nuevo) => path.resolve(f) === path.resolve(archivo)
    ? ts.createSourceFile(f, texto, lenguaje, true)
    : desplazar && path.resolve(f) === path.join(RAIZ, desplazar)
      ? ts.createSourceFile(f, '\n\n' + readFileSync(f, 'utf8'), lenguaje, true)
      : original(f, lenguaje, error, nuevo)
  return ts.createProgram(completo ? [...configuracion.fileNames, archivoRaices] : [archivoRaices], configuracion.options, anfitrion)
}
/** Los spreads sobrantes de un programa sintético servido como `raicesPersistidas.ts`. */
export function sobrantesSinteticos(texto: string): Hallazgo[] {
  const programa = programaEnMemoria(texto)
  return sobrantesEnSpreads(ts, programa, calcularFilas(ts, programa).enCierre, () => true)
}

export function nodosQue<T extends ts.Node>(raiz: ts.Node, elegir: (n: ts.Node) => n is T): T[] {
  const nodos: T[] = []
  function visitar(n: ts.Node): void {
    if (elegir(n)) nodos.push(n)
    ts.forEachChild(n, visitar)
  }
  visitar(raiz)
  return nodos
}
export function unico<T>(nodos: T[], detalle: string): T {
  assert.equal(nodos.length, 1, `No se puede aplicar la mutación: ${detalle}; se esperaba un nodo y hay ${nodos.length}. Revise el caso para que siga protegiendo la clave.`)
  return nodos[0]
}
export function textoMutado(archivo: string, declaracion: string, propiedad: string, nuevo: string): string {
  const texto = readFileSync(path.join(RAIZ, archivo), 'utf8')
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
  const nodo = unico(fuente.statements.filter((n) => (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.text === declaracion), `${archivo}: ${declaracion}`)
  let inicio: number, fin: number, reemplazo: string
  if (nuevo === 'omitir') {
    const omitir = unico(nodosQue(nodo, (n): n is ts.TypeReferenceNode | ts.ExpressionWithTypeArguments => ts.isTypeReferenceNode(n) || ts.isExpressionWithTypeArguments(n)).filter((n) => {
      const nombre = ts.isTypeReferenceNode(n) ? n.typeName : n.expression
      return ts.isIdentifier(nombre) && nombre.text === 'Omit'
    }), `${declaracion}: Omit`)
    const argumento = omitir.typeArguments?.[1]
    assert(argumento, `No se puede aplicar la mutación: falta la lista de Omit en ${declaracion}. Revise el caso.`)
    inicio = argumento.getStart(fuente); fin = inicio; reemplazo = `'${propiedad}' | `
  } else {
    const miembro = unico(nodosQue(nodo, ts.isPropertySignature).filter((n) => n.name.getText(fuente) === propiedad), `${declaracion}.${propiedad}`)
    inicio = miembro.name.getStart(fuente); fin = miembro.name.end; reemplazo = nuevo
  }
  return '\n\n' + texto.slice(0, inicio) + reemplazo + texto.slice(fin)
}
export function expansionReal(programa: ts.Program, archivo: string, funcion: string): ts.SpreadAssignment {
  const fuente = programa.getSourceFile(path.join(RAIZ, archivo))!
  assert(fuente, `No se puede localizar el spread: falta ${archivo}. Revise el caso.`)
  return unico(nodosQue(fuente, ts.isSpreadAssignment).filter((n) => ts.isCallExpression(n.expression) &&
    ts.isIdentifier(n.expression.expression) && n.expression.expression.text === funcion), `${archivo}: spread de ${funcion}`)
}
export function hallazgosDelRepo(programa: ts.Program): Hallazgo[] {
  const cierre = calcularFilas(ts, programa)
  const lista = leerLista(readFileSync(path.join(RAIZ, 'scripts', 'calidad', 'claves-persistidas.tsv'), 'utf8'))
  return [...cierre.hallazgos, ...compararConLista(cierre.filas, lista, () => false), ...sobrantesEnSpreads(ts, programa, cierre.enCierre, (f) => {
    const relativa = path.relative(path.join(RAIZ, 'src'), f)
    return !relativa.startsWith('..') && ['main', 'shared', 'preload'].includes(relativa.split(path.sep)[0])
  })]
}
