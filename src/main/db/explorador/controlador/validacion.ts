// =============================================================================
// Validación de las peticiones del explorador y ayudas puras: respuestas `ok`/`fallo`, textos acotados, filtro y orden,
// columnas exportables, `construir` (un fallo al construir SQL llega al usuario con su motivo) y el lector del catálogo.
// Las usan todos los módulos de esta carpeta.
// =============================================================================

import {
  DB_VALOR_MAX,
  type DbColumnaResultado,
  type DbErrorSql,
  type DbFormatoFilas,
  type DbIndiceNombres,
  type DbMotivoError,
  type DbParteDetalle,
  type DbResolverTx,
  type DbTipoLogico,
  type DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import {
  type DbFiltroGuiado,
  type DbOrdenColumna,
  validarFiltro,
  validarOrden
} from '../../../../shared/filtroGuiado.ts'

import type { ClaveCache } from '../CacheCatalogo.ts'
import { type ContextoCatalogo, ErrorGestor, type TopesLectura } from '../GestorSesiones.ts'
import { TOPE_RESPUESTA_EXPORTACION } from '../limites.ts'
import type { LectorDdl } from '../motores/catalogo.ts'
import { esObjeto, mensajeDe } from '../../../util/valores.ts'
import { esCelda } from '../edicionRejillaValidacion.ts'

export const TIPOS_OBJETO: readonly DbTipoObjeto[] = [
  'tabla',
  'vista',
  'vistaMaterializada',
  'tablaForanea',
  'rutina',
  'paquete',
  'secuencia',
  'sinonimo',
  'tipoObjeto',
  'tipoColeccion',
  'tipo',
  'disparador',
  // Las tablas virtuales de SQLite (fts5, rtree…), su carpeta en el árbol.
  'tablaVirtual'
]
export const PARTES_DETALLE: readonly DbParteDetalle[] = ['columnas', 'indices', 'restricciones']
export const FORMATOS: readonly DbFormatoFilas[] = ['tsv', 'csv', 'json', 'insert', 'markdown']
export const TIPOS_LOGICOS: readonly DbTipoLogico[] = [
  'texto',
  'numero',
  'fecha',
  'fechaHora',
  'booleano',
  'binario',
  'lob',
  'json',
  'otro'
]
/** Exportar lee los LOB ENTEROS (hasta `DB_VALOR_MAX`), no los 64 KiB de la rejilla. */
export const TOPES_EXPORTACION: TopesLectura = {
  topeCelda: DB_VALOR_MAX,
  topeBinario: DB_VALOR_MAX,
  topeRespuesta: TOPE_RESPUESTA_EXPORTACION
}
/** El valor completo: una celda, entera hasta `DB_VALOR_MAX` (texto en UTF-16, binario en bytes). */
export const TOPES_VALOR: TopesLectura = { topeCelda: DB_VALOR_MAX, topeBinario: DB_VALOR_MAX }

/** Tope de un identificador que llega del renderer (Oracle 128, PG 63: holgado). */
export const MAX_IDENT = 1024
/** Tope de un fragmento WHERE / ORDER BY. */
export const MAX_FRAGMENTO = 100_000
/** Plazos del diálogo de salida: un COMMIT puede tardar; un ROLLBACK lo hará el cierre. */
export const PLAZO_COMMIT_SALIDA_MS = 15_000
export const PLAZO_ROLLBACK_SALIDA_MS = 3_000

export function ok<T>(valor: T): { ok: true; valor: T } {
  return { ok: true, valor }
}

export function fallo(motivo: DbMotivoError, mensaje: string): { ok: false; error: DbErrorSql } {
  return { ok: false, error: { motivo, mensaje } }
}

export { esObjeto, mensajeDe }

/** Texto no vacío y acotado, o lanza un error de petición. */
export function exigir(v: unknown, nombre: string, max = MAX_IDENT): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    throw new ErrorGestor('interno', `Petición inválida: falta «${nombre}».`)
  }
  return v
}

export function opcional(v: unknown, nombre: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || v.length > max) throw new ErrorGestor('interno', `Petición inválida: «${nombre}».`)
  return v
}

/**
 * El filtro guiado y el orden de la cabecera de una petición de tabla,
 * VALIDADOS en la entrada (segunda barrera: el renderer ya lo hizo, pero lo que llega por IPC
 * no se cree). Un filtro inválido es un error de SU campo, como un WHERE roto: `motivo
 * 'servidor'` con `campo: 'filtro'` y la `condicion` culpable, para que la interfaz lo pinte
 * bajo esa condición. Un orden inválido no tiene campo que señalar (la cabecera no se
 * escribe): 'interno'. Ausentes (undefined / null), no se devuelven.
 */
export function filtroYOrden(filtro: unknown, orden: unknown): { filtro?: DbFiltroGuiado; orden?: DbOrdenColumna[] } {
  const r: { filtro?: DbFiltroGuiado; orden?: DbOrdenColumna[] } = {}
  if (filtro !== undefined && filtro !== null) {
    const p = validarFiltro(filtro)
    if (p !== null) throw new ErrorGestor('servidor', p.mensaje, { campo: 'filtro', ...(p.indice >= 0 ? { condicion: p.indice } : {}) })
    r.filtro = filtro as DbFiltroGuiado
  }
  if (orden !== undefined && orden !== null) {
    const p = validarOrden(orden)
    if (p !== null) throw new ErrorGestor('interno', p)
    r.orden = orden as DbOrdenColumna[]
  }
  return r
}

export { esCelda }

/** Columnas del origen `filas` de exportar, validadas; null si no tienen la forma. */
export function columnasExportables(v: unknown): DbColumnaResultado[] | null {
  if (!Array.isArray(v) || v.length > 10_000) return null
  const salida: DbColumnaResultado[] = []
  for (const c of v) {
    if (!esObjeto(c) || typeof c.nombre !== 'string' || c.nombre.length > MAX_IDENT) return null
    const tipoLogico = TIPOS_LOGICOS.indexOf(c.tipoLogico as DbTipoLogico) >= 0 ? (c.tipoLogico as DbTipoLogico) : 'otro'
    salida.push({ nombre: c.nombre, tipoLogico, tipoMotor: typeof c.tipoMotor === 'string' ? c.tipoMotor : '' })
  }
  return salida
}

export function resolverOpcional(v: unknown): DbResolverTx | undefined {
  if (v === undefined || v === null) return undefined
  if (v === 'commit' || v === 'rollback') return v
  throw new ErrorGestor('interno', 'Petición inválida: «resolver».')
}

/**
 * Construir SQL puede lanzar ("no existe en …" de un motor): se convierte en un error
 * seguro, con su mensaje. Genérica porque el catálogo del motor construye también listas
 * de consultas (las FKs troceadas de Oracle) y el bloque del DDL.
 */
export function construir<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    throw new ErrorGestor('interno', mensajeDe(e))
  }
}

/**
 * El lector que reciben las lecturas de VARIAS consultas del catálogo del motor
 * (`leerFks`, `leerDdl`) sobre el turno de `meta`: sus consultas pasan por `construir` y
 * sus fallos seguros son `ErrorGestor`. No reciben el `ContextoCatalogo`: el motor no tiene
 * por qué conocer el gestor ni su esquema, y no podría importar `ErrorGestor` sin ciclo.
 */
export function lectorDe(ctx: ContextoCatalogo): LectorDdl {
  return {
    dialecto: ctx.dialecto,
    consultar: (c) => ctx.consultar(c),
    construir,
    fallo: (mensaje) => new ErrorGestor('interno', mensaje),
    bloqueTexto: (sql, binds, salida, tope) => ctx.bloqueTexto(sql, binds, salida, tope)
  }
}

/**
 * Fusiona los índices de nombres por esquema en uno, en el orden de `esquemas` y con
 * el tope. Exportada para el test.
 */
export function fusionarIndices(
  esquemas: readonly string[],
  partes: readonly DbIndiceNombres[],
  porDefecto: string,
  tope: number,
  cortado = false
): DbIndiceNombres {
  const lista = esquemas.slice()
  const pos = new Map<string, number>()
  lista.forEach((e, i) => pos.set(e, i))
  const objetos: DbIndiceNombres['objetos'] = []
  let truncado = cortado
  for (const p of partes) {
    if (p.truncado) truncado = true
    for (const [nombre, i, tipo] of p.objetos) {
      const e = p.esquemas[i]
      if (e === undefined) continue
      let j = pos.get(e)
      if (j === undefined) {
        j = lista.length
        lista.push(e)
        pos.set(e, j)
      }
      if (objetos.length >= tope) {
        truncado = true
        break
      }
      objetos.push([nombre, j, tipo])
    }
  }
  const indice: DbIndiceNombres = { esquemas: lista, objetos, porDefecto }
  if (truncado) indice.truncado = true
  return indice
}

/**
 * Las opciones de `gestor.catalogo` con la BASE del nivel «Bases», si la
 * hay: el catálogo del motor la escribe en el nombre de tres partes (`DialectoCatalogo.base`).
 * Sin base, las opciones de siempre, sin el campo.
 */
export function conBase<T extends object>(op: T, base: string | undefined): T & { base?: string } {
  return base === undefined ? op : { ...op, base }
}

/** Lo mismo para una clave de la caché: la base la distingue (el mismo `dbo` en cada base). */
export function claveConBase(c: ClaveCache, base: string | undefined): ClaveCache {
  return base === undefined ? c : { ...c, base }
}
