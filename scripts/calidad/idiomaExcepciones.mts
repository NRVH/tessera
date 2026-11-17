// =============================================================================
// Excepciones de idioma limitadas a una declaración y a su contenedor en un archivo exacto.
// Valida las categorías y rechaza filas duplicadas, ámbitos inválidos y excepciones sin uso.
// Los datos se comparten entre el recuento y la medición del índice sin consultar fuentes externas.
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import ts from 'typescript'

export const RUTA_EXCEPCIONES = 'scripts/calidad/excepciones-idioma.tsv'
const MOTIVOS = ['api-ajena', 'formato-ajeno', 'clave-guardada', 'cruza-proceso', 'nombre-propio'] as const
export interface ExcepcionIdioma {
  archivo: string
  contenedor: string
  nombre: string
  motivo: typeof MOTIVOS[number]
  linea: number
}

export class ErrorExcepciones extends Error {}

function rutaExacta(archivo: string): boolean {
  return Boolean(archivo) && !/[\\:*?\s]/.test(archivo) && !archivo.startsWith('/') &&
    archivo.split('/').every((parte) => parte !== '' && parte !== '.' && parte !== '..')
}

export function leerExcepciones(texto: string): Map<string, ExcepcionIdioma[]> {
  const excepciones = new Map<string, ExcepcionIdioma[]>()
  const vistas = new Set<string>()
  let cabecera = false
  for (const [indice, linea] of texto.split(/\r?\n/).entries()) {
    if (!linea.trim() || linea.startsWith('#')) continue
    const columnas = linea.split('\t')
    if (!cabecera) {
      if (linea !== 'archivo\tcontenedor\tnombre\tmotivo') throw new ErrorExcepciones(`excepciones: línea ${indice + 1}: cabecera inválida`)
      cabecera = true
      continue
    }
    const [archivo, contenedor, nombre, motivo] = columnas
    const clave = columnas.slice(0, 3).join('\t')
    if (columnas.length !== 4 || !rutaExacta(archivo) || !/^(?:[A-Za-z_$#][\w$]*|data-[a-z\d-]+)$/.test(nombre ?? '') ||
      !MOTIVOS.includes(motivo as ExcepcionIdioma['motivo']) || vistas.has(clave)) {
      throw new ErrorExcepciones(`excepciones: línea ${indice + 1}: fila inválida o repetida`)
    }
    vistas.add(clave)
    const fila = { archivo, contenedor, nombre, motivo: motivo as ExcepcionIdioma['motivo'], linea: indice + 1 }
    excepciones.set(archivo, [...(excepciones.get(archivo) ?? []), fila])
  }
  if (!cabecera) throw new ErrorExcepciones('excepciones: línea 1: falta la cabecera')
  return excepciones
}

/** El contenedor con nombre más cercano; las funciones flecha toman el nombre de su variable. */
export function contenedorDe(nodo: ts.Node): string {
  for (let padre = nodo.parent; padre; padre = padre.parent) {
    if (ts.isClassLike(padre) || ts.isInterfaceDeclaration(padre) || ts.isTypeAliasDeclaration(padre) || ts.isFunctionLike(padre)) {
      if (padre.name) return padre.name.getText().replace(/^['"]|['"]$/g, '')
      if (ts.isVariableDeclaration(padre.parent)) return padre.parent.name.getText()
    }
  }
  return ''
}

export function esLocal(nodo: ts.Node): boolean {
  if (ts.isParameter(nodo)) return true
  if (!ts.isVariableDeclaration(nodo)) return false
  for (let padre: ts.Node | undefined = nodo.parent; padre; padre = padre.parent) if (ts.isFunctionLike(padre)) return true
  return false
}

export function comprobarUso(filas: ExcepcionIdioma[], usadas: Set<ExcepcionIdioma>): void {
  for (const fila of filas) if (!usadas.has(fila)) {
    throw new ErrorExcepciones(`excepciones: línea ${fila.linea}: excepción sin uso: ${fila.archivo}::${fila.contenedor}::${fila.nombre}`)
  }
}
