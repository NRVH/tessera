// =============================================================================
// Los nombres en inglés propio que declara un archivo de código: variables, parámetros, funciones, clases,
// tipos y miembros. No mira propiedades de objetos literales, desestructuración ni importaciones: su nombre
// lo fija el tipo o el módulo de origen, que ya se revisa donde se declara.
// Depende de `idiomaGlosario.mts` (vocabulario) e `idiomaExenciones.mts` (lo que no elige quien escribe).
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import ts from 'typescript'
import { crearContexto, esMiembro, exento, herenciaExterna } from './idiomaExenciones.mts'
import type { Contexto } from './idiomaExenciones.mts'
import { evaluarNombre } from './idiomaGlosario.mts'
import type { Glosario } from './idiomaGlosario.mts'
import { ErrorExcepciones, comprobarUso, contenedorDe, esLocal } from './idiomaExcepciones.mts'
import type { ExcepcionIdioma } from './idiomaExcepciones.mts'

/** El vocabulario y las claves guardadas con que se mide un archivo. */
export interface DatosIdioma {
  glosario: Glosario
  claves: Set<string>
  excepciones?: Map<string, ExcepcionIdioma[]>
}

export interface NombreIngles {
  nombre: string
  archivo: string
  linea: number
  /** Qué se declara: `VariableDeclaration`, `Parameter`, `InterfaceDeclaration`… */
  clase: string
  palabras: string[]
  sinTraduccion: string[]
  propuesta: string | null
}

const NOMBRE_DE_CODIGO = /^[A-Za-z_$#][\w$]*$/

/**
 * El nombre que se evalúa, o null si no es un identificador. Una cadena que no lo es (`'agent-accounts.json'`,
 * `'Content-Type'`) es una clave de un archivo o de un protocolo; solo `data-…` es un atributo propio.
 */
function textoDelNombre(nombre: ts.Node): string | null {
  if (ts.isIdentifier(nombre) || ts.isPrivateIdentifier(nombre)) return nombre.text
  if (!ts.isStringLiteral(nombre)) return null
  if (nombre.text.startsWith('data-')) return nombre.text.slice(5)
  return NOMBRE_DE_CODIGO.test(nombre.text) ? nombre.text : null
}

function esDeclaracion(nodo: ts.Node): nodo is ts.NamedDeclaration {
  return ts.isVariableDeclaration(nodo) || ts.isParameter(nodo) || ts.isFunctionDeclaration(nodo) || ts.isFunctionExpression(nodo) ||
    ts.isClassDeclaration(nodo) || ts.isClassExpression(nodo) || ts.isInterfaceDeclaration(nodo) || ts.isTypeAliasDeclaration(nodo) ||
    ts.isEnumDeclaration(nodo) || ts.isEnumMember(nodo) || ts.isModuleDeclaration(nodo) || ts.isTypeParameterDeclaration(nodo) ||
    esMiembro(nodo)
}

/** Una variable que se inicializa con el nombre de una plataforma habla del sistema operativo. */
function guardaPlataforma(nodo: ts.Node): boolean {
  return ts.isVariableDeclaration(nodo) && Boolean(nodo.initializer) && /['"`](?:windows|win32)['"`]/i.test(nodo.initializer!.getText())
}

/** Si la declaración es un miembro de una clase que hereda de una API ajena, o de un objeto literal, no se mira. */
function miembroAjeno(ctx: Contexto, nodo: ts.Node): boolean {
  if (!esMiembro(nodo)) return false
  return ts.isObjectLiteralExpression(nodo.parent) || herenciaExterna(ctx, nodo.parent)
}

function hallazgoDe(ctx: Contexto, fuente: ts.SourceFile, glosario: Glosario, nodo: ts.Node): NombreIngles | null {
  if (!esDeclaracion(nodo) || !nodo.name) return null
  const nombre = textoDelNombre(nodo.name)
  if (!nombre || (ts.isParameter(nodo) && nombre === 'this')) return null
  if (miembroAjeno(ctx, nodo) || exento(ctx, nodo, nombre)) return null
  const admitePrefijo = ts.isParameter(nodo) || ts.isVariableDeclaration(nodo) || esMiembro(nodo)
  const evaluacion = evaluarNombre(glosario, nombre, { admitePrefijo, plataforma: guardaPlataforma(nodo) })
  if (!evaluacion) return null
  const linea = fuente.getLineAndCharacterOfPosition(nodo.name.getStart(fuente)).line + 1
  const escrito = ts.isStringLiteral(nodo.name) ? nodo.name.text : nombre
  // Un atributo `data-…` se evalúa sin su prefijo, que la propuesta conserva.
  const prefijo = ts.isStringLiteral(nodo.name) && nodo.name.text.startsWith('data-') ? 'data-' : ''
  const propuesta = evaluacion.propuesta === null ? null : prefijo + evaluacion.propuesta
  return { nombre: escrito, archivo: ctx.archivo, linea, clase: ts.SyntaxKind[nodo.kind], ...evaluacion, propuesta }
}

/** Los nombres en inglés propio que declara el archivo, en el orden en que aparecen. */
export function extraerNombres(archivo: string, texto: string, datos: DatosIdioma, validar = true): NombreIngles[] {
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
  const ctx = crearContexto(archivo, fuente, datos.claves)
  const hallazgos: NombreIngles[] = []
  const filas = datos.excepciones?.get(archivo) ?? []
  const usadas = new Set<ExcepcionIdioma>()
  const visitar = (nodo: ts.Node): void => {
    const escrito = esDeclaracion(nodo) && nodo.name ? ts.isStringLiteral(nodo.name) ? nodo.name.text : textoDelNombre(nodo.name) : null
    const fila = escrito ? filas.find((fila) => fila.nombre === escrito && fila.contenedor === contenedorDe(nodo)) : undefined
    if (fila) {
      if (validar && esLocal(nodo) && fila.motivo !== 'cruza-proceso' && fila.motivo !== 'clave-guardada') {
        throw new ErrorExcepciones(`excepciones: línea ${fila.linea}: categoría no permitida para variable local o parámetro: ${fila.nombre}`)
      }
      usadas.add(fila)
    }
    const hallazgo = hallazgoDe(ctx, fuente, datos.glosario, nodo)
    if (hallazgo && !fila) hallazgos.push(hallazgo)
    ts.forEachChild(nodo, visitar)
  }
  visitar(fuente)
  if (validar) comprobarUso(filas, usadas)
  return hallazgos
}
