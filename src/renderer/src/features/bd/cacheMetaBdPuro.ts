// =============================================================================
// cacheMetaBdPuro — la lógica sin estado de la caché de catálogo del renderer: claves propias
// (mismo molde de tupla por NUL que `claveBd`), partes del detalle y su fusión, el índice de
// nombres desplegado, la llamada de documentos y claves, la instantánea para el árbol y qué
// claves toca cada evento de invalidación. Puro; lo usa `cacheMetaBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-cache-meta.md
// =============================================================================

import { partesAmbito, partesDetalle } from './arbolBd.ts'
import { CUENTA_ESCANEO, recorrerClaves } from './arbolClaves.ts'
import { nunca } from '../../../../shared/nunca.ts'
import type { CargaBd } from './arbolBd.ts'
import type { DbKvEscanear } from '../../../../shared/db-claves-ipc.ts'
import type {
  DbDetalle,
  DbErrorSql,
  DbEventoCatalogo,
  DbIndiceNombres,
  DbParteDetalle,
  DbRespuesta,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { ApiFamiliasBd, Entrada, ErrorGuardado, IndiceDesplegado, InstantaneaArbolBd, NombreIndexado } from './cacheMetaBdTipos.ts'

/** Separador de las claves: NUL, igual que `claveBd` (ningún motor lo admite). */
export const SEP = String.fromCharCode(0)
export const unir = (partes: readonly string[]): string => partes.join(SEP)

/** Cuánto se recuerda un error del índice de nombres o de los públicos. */
export const ERROR_NOMBRES_MS = 30_000

/** Orden canónico de las partes del detalle (para la clave de vuelo y comparar). */
const ORDEN_PARTES: readonly DbParteDetalle[] = ['columnas', 'indices', 'restricciones']

/** Tipos que pueden tener columnas: donde se busca `columnas(esquema, tabla)`. */
export const TIPOS_CON_COLUMNAS: readonly DbTipoObjeto[] = ['tabla', 'vista', 'vistaMaterializada', 'tablaForanea', 'tablaVirtual']

export function normalizarPartes(partes: readonly DbParteDetalle[]): DbParteDetalle[] {
  return ORDEN_PARTES.filter((p) => partes.indexOf(p) !== -1)
}

export function cubre(tiene: ReadonlySet<DbParteDetalle> | undefined, pide: readonly DbParteDetalle[]): boolean {
  if (!tiene) return pide.length === 0
  for (const p of pide) if (!tiene.has(p)) return false
  return true
}

/** ¿Tiene forma de `DbRespuesta`? Un handler que no existe o devuelve otra cosa no debe romper nada. */
export function esRespuesta(r: unknown): r is DbRespuesta<unknown> {
  return r !== null && typeof r === 'object' && typeof (r as { ok?: unknown }).ok === 'boolean'
}

/**
 * La entrada de detalle tras llegar `v` con las partes `pedidas`. Se fusiona solo con lo que
 * sigue siendo bueno: mezclar partes frescas con otras de antes de una invalidación daría un
 * detalle que nunca existió.
 */
export function fusionarDetalle(
  previa: Entrada | undefined,
  v: DbDetalle,
  pedidas: readonly DbParteDetalle[],
  obsoleta: boolean,
  tipo: DbTipoObjeto
): Entrada {
  const partesTotal = new Set<DbParteDetalle>(pedidas)
  const valor: DbDetalle = {}
  if (previa && !previa.obsoleta && !obsoleta) {
    Object.assign(valor, previa.valor as DbDetalle)
    if (previa.partes) for (const p of previa.partes) partesTotal.add(p)
  }
  if (v.columnas !== undefined) valor.columnas = v.columnas
  if (v.indices !== undefined) valor.indices = v.indices
  if (v.restricciones !== undefined) valor.restricciones = v.restricciones
  if (v.comentario !== undefined) valor.comentario = v.comentario
  return { valor, obsoleta, partes: partesTotal, tipo }
}

/** El índice de nombres desplegado a objetos, todos y por esquema. */
export function desplegarIndice(indice: DbIndiceNombres): IndiceDesplegado {
  const todos: NombreIndexado[] = []
  const porEsquema = new Map<string, NombreIndexado[]>()
  for (const [nombre, i, tipo] of indice.objetos) {
    const esq = indice.esquemas[i]
    if (esq === undefined) continue
    const o: NombreIndexado = { esquema: esq, nombre, tipo }
    todos.push(o)
    const lista = porEsquema.get(esq)
    if (lista) lista.push(o)
    else porEsquema.set(esq, [o])
  }
  return { todos, porEsquema }
}

type MapaInstantanea = 'esquemas' | 'bases' | 'conteos' | 'objetos' | 'docBases' | 'colecciones' | 'kvBases' | 'kvClaves'

/**
 * A qué mapa de la instantánea va cada entrada, por el primer elemento de su clave (`claveBd`).
 * Los esquemas de una BASE van al mismo mapa que los de la conexión, por la clave de su nodo.
 */
const MAPA_DE_TIPO: ReadonlyMap<string, MapaInstantanea> = new Map<string, MapaInstantanea>([
  ['docBases', 'docBases'],
  ['docBase', 'colecciones'],
  ['kvBases', 'kvBases'],
  ['kvBase', 'kvClaves'],
  ['conexion', 'esquemas'],
  ['base', 'esquemas'],
  ['bases', 'bases'],
  ['esquema', 'conteos'],
  ['carpeta', 'objetos']
])

/**
 * Lo cargado para el árbol, con la forma de `EntradaArbolBd`. El detalle solo entra si trae
 * todas las partes que pinta el árbol. Patrones y «Cargar más» van COPIADOS: la instantánea no
 * puede cambiar por debajo de quien la tiene (se compara por identidad).
 */
export function construirInstantanea(
  datos: ReadonlyMap<string, Entrada>,
  errores: ReadonlyMap<string, ErrorGuardado>,
  patronesKv: ReadonlyMap<string, string>,
  kvMas: ReadonlySet<string>
): InstantaneaArbolBd {
  const mapas: Record<MapaInstantanea, Map<string, unknown>> = {
    esquemas: new Map(),
    bases: new Map(),
    conteos: new Map(),
    objetos: new Map(),
    docBases: new Map(),
    colecciones: new Map(),
    kvBases: new Map(),
    kvClaves: new Map()
  }
  const detalles = new Map<string, DbDetalle>()
  for (const [clave, e] of datos) {
    const tipo = clave.slice(0, clave.indexOf(SEP))
    const destino = MAPA_DE_TIPO.get(tipo)
    if (destino !== undefined) mapas[destino].set(clave, e.valor)
    else if (tipo === 'objeto' && e.tipo !== undefined && cubre(e.partes, partesDetalle(e.tipo))) {
      detalles.set(clave, e.valor as DbDetalle)
    }
  }
  const erroresArbol = new Map<string, DbErrorSql>()
  for (const [clave, g] of errores) erroresArbol.set(clave, g.error)
  return {
    esquemas: mapas.esquemas,
    bases: mapas.bases,
    conteos: mapas.conteos,
    objetos: mapas.objetos,
    detalles,
    errores: erroresArbol,
    docBases: mapas.docBases,
    colecciones: mapas.colecciones,
    kvBases: mapas.kvBases,
    kvClaves: mapas.kvClaves,
    kvPatrones: new Map(patronesKv),
    kvCargandoMas: new Set(kvMas)
  } as InstantaneaArbolBd
}

/** Las cargas del árbol que van por los contratos de documentos y claves, no por el catálogo SQL. */
export type CargaFamilia = Extract<CargaBd, { tipo: 'docBases' | 'colecciones' | 'kvBases' | 'kvClaves' }>

/** La petición de una vuelta de SCAN (en el orden de campos del contrato). */
export function escaneoClaves(conexionId: string, base: number, patron: string, cursor: string): DbKvEscanear {
  return { conexionId, base, patron, cursor, cuenta: CUENTA_ESCANEO }
}

/**
 * La llamada de una carga de documentos o claves por su api; sin ella, un error con su motivo.
 * Las claves se recorren desde el principio con el patrón de la base (`patron`, leído al llamar).
 */
export function llamarFamilia(f: ApiFamiliasBd | null, carga: CargaFamilia, patron: () => string): Promise<DbRespuesta<unknown>> {
  if (!f) return Promise.resolve({ ok: false, error: { motivo: 'interno', mensaje: 'Esta ventana no tiene el explorador de este motor.' } })
  switch (carga.tipo) {
    case 'docBases':
      return f.docBases({ conexionId: carga.conexionId })
    case 'colecciones':
      return f.docColecciones({ conexionId: carga.conexionId, base: carga.base })
    case 'kvBases':
      return f.kvBases({ conexionId: carga.conexionId })
    case 'kvClaves': {
      const p = patron()
      return recorrerClaves((cursor) => f.kvEscanear(escaneoClaves(carga.conexionId, carga.base, p, cursor)), null, p)
    }
    default:
      return nunca(carga, 'cargarFamilia')
  }
}

/**
 * ¿Toca un evento con esquema a una clave de ese esquema? Con base, la posición del esquema es
 * un ÁMBITO `base␁esquema` y el evento no dice de qué base es: se invalida el esquema de ese
 * nombre en TODAS, y todo lo de una base con ese nombre (el main puede nombrar la base ahí).
 */
function afectaAlEsquema(ambito: string, esquema: string): boolean {
  const a = partesAmbito(ambito)
  return a.esquema === esquema || (a.base !== undefined && a.base === esquema)
}

/**
 * Qué claves toca cada evento: `esquemas` (se fijaron los visibles), las listas de esquemas y
 * de bases y el índice de nombres; con `esquema` (un DDL o Refrescar), lo de ese esquema, los
 * públicos solo si es PUBLIC, y la lista, los índices, las resoluciones y TODAS las claves
 * ajenas de la conexión; sin esquema o con `edicion`, todo lo de la conexión.
 */
export function afectaEvento(e: DbEventoCatalogo, clave: string): boolean {
  const p = clave.split(SEP)
  if (p[1] !== e.conexionId) return false
  const tipo = p[0]
  if (e.motivo === 'esquemas') return tipo === 'conexion' || tipo === 'nombres' || tipo === 'base' || tipo === 'bases'
  if (e.esquema === undefined || e.motivo === 'edicion') return true
  switch (tipo) {
    case 'esquema':
    case 'carpeta':
    case 'objeto':
      return afectaAlEsquema(p[2], e.esquema)
    case 'publicos':
      return e.esquema === 'PUBLIC'
    default:
      // conexion, nombres, resolver y fks (las de CUALQUIER esquema)
      return true
  }
}
