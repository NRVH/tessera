// =============================================================================
// filtrarAjustes: el buscador del panel de Configuración. Módulo PURO (sin React ni
// DOM) probado con `node` a secas. Ignora acentos, casa por palabras sueltas y en
// cualquier orden, y oculta el grupo que se queda sin filas. Busca por etiqueta,
// palabras clave y título del grupo, NO por los textos de ayuda: son frases largas y
// media lista casaría con cualquier palabra común. El último tercio añade el nivel de
// CATEGORÍA del riel sin tocar lo anterior: la búsqueda sigue siendo plana y global.
// =============================================================================

/** Una fila buscable: su id, lo que se lee y los sinónimos con los que se busca. */
export interface AjusteBuscable {
  id: string
  etiqueta: string
  /** Sinónimos y palabras con las que alguien buscaría este ajuste. */
  claves?: readonly string[]
}

/** Un grupo con sus filas, tal y como se pinta.
 *
 *  Todo `readonly` para que el catálogo del panel pueda declararse `as const`:
 *  así los títulos de grupo son un tipo literal y `grupo('Aparencia')` deja de
 *  compilar en vez de esconder la sección entera en tiempo de ejecución. */
export interface GrupoBuscable {
  titulo: string
  ajustes: readonly AjusteBuscable[]
}

/**
 * Quita acentos y pasa a minúsculas.
 *
 * NFD parte cada letra acentuada en letra + diacrítico, y el rango U+0300-036F
 * borra los diacríticos sueltos. Así "Tamaño" y "tamano" casan igual, que es lo
 * que escribe cualquiera con prisa.
 */
export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Ids de los ajustes que sobreviven a la consulta.
 *
 * Consulta vacía => TODOS (devolver ninguno dejaría el panel en blanco al borrar
 * el texto, que es justo cuando se quiere ver todo otra vez).
 *
 * Con varias palabras se exigen TODAS, en cualquier orden: escribir más
 * palabras tiene que acotar, no ampliar. Cada palabra casa por SUBCADENA, así
 * que "tam" ya encuentra "tamaño" mientras se teclea.
 */
export function filtrarAjustes(grupos: readonly GrupoBuscable[], consulta: string): Set<string> {
  const palabras = normalizarTexto(consulta).split(/\s+/).filter((p) => p !== '')
  const visibles = new Set<string>()
  for (const grupo of grupos) {
    // El TÍTULO DEL GRUPO cuenta como texto de sus filas: buscar "terminal"
    // tiene que enseñar la fuente y el tamaño de la terminal, aunque esas filas
    // se llamen solo "Fuente" y "Tamaño".
    const textoGrupo = normalizarTexto(grupo.titulo)
    for (const ajuste of grupo.ajustes) {
      if (palabras.length === 0) {
        visibles.add(ajuste.id)
        continue
      }
      const heno = [textoGrupo, normalizarTexto(ajuste.etiqueta)]
        .concat((ajuste.claves ?? []).map(normalizarTexto))
        .join(' ')
      if (palabras.every((p) => heno.includes(p))) visibles.add(ajuste.id)
    }
  }
  return visibles
}

/** ¿Queda alguna fila visible de este grupo? Si no, el grupo se oculta entero. */
export function grupoVisible(grupo: GrupoBuscable, visibles: ReadonlySet<string>): boolean {
  return grupo.ajustes.some((a) => visibles.has(a.id))
}

/** ¿La búsqueda no encontró NADA? Para poder decirlo en vez de dejar el panel vacío. */
export function sinResultados(
  grupos: readonly GrupoBuscable[],
  visibles: ReadonlySet<string>
): boolean {
  return grupos.every((g) => !grupoVisible(g, visibles))
}

// ---------------------------------------------------------------------------
// CATEGORÍAS: el nivel que añade el modal con riel.
//
// Un ajuste que casa la búsqueda puede estar en una categoría que no se ve: "letra"
// tiene que encontrar a la vez el tamaño de la interfaz y el de la terminal, y
// filtrar solo dentro de la categoría abierta escondería la mitad. Por eso
// `filtrarAjustes` recibe una lista PLANA de grupos (la de `gruposDe`) y aquí solo se
// añade lo que el riel necesita: cuántas coincidencias tiene cada categoría.
// ---------------------------------------------------------------------------

/** Una categoría del riel: un nombre y los grupos que se pintan dentro. */
export interface CategoriaBuscable {
  /** Estable y en minúscula: es la clave de selección del riel, no lo que se lee. */
  id: string
  titulo: string
  grupos: readonly GrupoBuscable[]
}

/**
 * Todos los grupos de todas las categorías, en el orden del catálogo.
 *
 * Es la entrada de `filtrarAjustes`: aplanar aquí es lo que hace que la búsqueda
 * sea global sin que el filtro tenga que saber nada de categorías.
 *
 * EL TÍTULO SALE COMPUESTO ("Apariencia Tamaño y escala") A PROPÓSITO. El título
 * de grupo es, para `filtrarAjustes`, solo PAJAR: nunca se pinta desde aquí (el
 * modal renderiza el catálogo, no esto). Componerlo con el de la categoría hace
 * que buscar "apariencia" encuentre sus filas aunque ningún grupo suyo se llame
 * así, sin tener que repetir la palabra en las `claves` de cada ajuste — que es
 * justo el tipo de duplicado que se acaba olvidando al añadir el siguiente.
 */
export function gruposDe(categorias: readonly CategoriaBuscable[]): readonly GrupoBuscable[] {
  return categorias.flatMap((c) =>
    c.grupos.map((g) => ({ titulo: `${c.titulo} ${g.titulo}`, ajustes: g.ajustes }))
  )
}

/** ¿Esta categoría tiene algo que enseñar con el filtro puesto? */
export function categoriaVisible(
  categoria: CategoriaBuscable,
  visibles: ReadonlySet<string>
): boolean {
  return categoria.grupos.some((g) => grupoVisible(g, visibles))
}

/**
 * Cuántos ajustes visibles tiene cada categoría, por id. Es el contador del riel.
 *
 * Se devuelve la entrada SIEMPRE, también con cero: quien pinta el riel necesita
 * distinguir "cero coincidencias" (categoría apagada) de "categoría que no está
 * en el catálogo" (un id mal escrito), y un `Map` sin la clave confundiría las dos.
 */
export function contarPorCategoria(
  categorias: readonly CategoriaBuscable[],
  visibles: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const out = new Map<string, number>()
  for (const c of categorias) {
    let n = 0
    for (const g of c.grupos) for (const a of g.ajustes) if (visibles.has(a.id)) n++
    out.set(c.id, n)
  }
  return out
}
