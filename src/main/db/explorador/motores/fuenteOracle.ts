// =============================================================================
// Oracle: «Ver fuente» de un objeto. PL/SQL sale de ALL_SOURCE (especificación y cuerpo), una
// vista de ALL_VIEWS y una vista materializada de ALL_MVIEWS; el mapeo arma las partes tituladas
// y los avisos (cuerpo ausente, código ofuscado). Puro; lo ensambla `catalogoOracle.ts`.
// =============================================================================

import type { DbFuente, DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { citar } from '../../../../shared/sql/identificadoresSql.ts'
import { AVISO_SIN_FUENTE, noDisponible, texto, textoOpcional } from './filasCatalogo.ts'
import { ora } from './sqlOracle.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/** Tipos de ALL_SOURCE (especificación, cuerpo) por tipo de objeto de Oracle. */
const TIPOS_FUENTE_ORACLE: Partial<Record<DbTipoObjeto, [string, string]>> = {
  paquete: ['PACKAGE', 'PACKAGE BODY'],
  tipoObjeto: ['TYPE', 'TYPE BODY'],
  tipoColeccion: ['TYPE', 'TYPE BODY'],
  // Un procedimiento y una función no pueden llamarse igual en el mismo esquema.
  rutina: ['PROCEDURE', 'FUNCTION'],
  disparador: ['TRIGGER', 'TRIGGER']
}

const AVISO_SIN_CUERPO =
  'No se ve el cuerpo: o el paquete no tiene, o ALL_SOURCE solo lo enseña a su dueño y a quien tenga privilegios de depuración.'
const AVISO_WRAPPED = 'Código ofuscado (wrapped): Oracle no guarda el fuente legible.'

function primeraLinea(t: string): string {
  const i = t.indexOf('\n')
  return i < 0 ? t : t.slice(0, i)
}

/** ALL_SOURCE, filas: `[type, line, text]`. Vista: `[text]` (LONG). Vista materializada: `[query]`. */
export function sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo {
  const tipos = TIPOS_FUENTE_ORACLE[ref.tipo]
  if (tipos) {
    return ora(
      [
        'SELECT type, line, text',
        '  FROM all_source',
        ' WHERE owner = :esq AND name = :obj AND type IN (:t1, :t2)',
        ' ORDER BY type, line'
      ],
      { esq: ref.esquema, obj: ref.nombre, t1: tipos[0], t2: tipos[1] }
    )
  }
  if (ref.tipo === 'vista') {
    return ora(['SELECT text FROM all_views WHERE owner = :esq AND view_name = :obj'], {
      esq: ref.esquema,
      obj: ref.nombre
    })
  }
  if (ref.tipo === 'vistaMaterializada') {
    return ora(['SELECT query FROM all_mviews WHERE owner = :esq AND mview_name = :obj'], {
      esq: ref.esquema,
      obj: ref.nombre
    })
  }
  return noDisponible(d.motor, `fuente de ${ref.tipo}`)
}

/** Las líneas de ALL_SOURCE agrupadas por `type`, y los tipos en el orden en que aparecen. */
function lineasPorTipo(filas: readonly FilaCatalogo[]): { orden: string[]; lineas: Map<string, string[]> } {
  const orden: string[] = []
  const lineas = new Map<string, string[]>()
  for (const f of filas) {
    const tipo = texto(f[0]).toUpperCase()
    let l = lineas.get(tipo)
    if (!l) {
      l = []
      lineas.set(tipo, l)
      orden.push(tipo)
    }
    l.push(texto(f[2]))
  }
  return { orden, lineas }
}

function tituloDeParte(tipo: string): DbFuente['partes'][number]['titulo'] {
  if (/ BODY$/.test(tipo)) return 'Cuerpo'
  return tipo === 'PACKAGE' || tipo === 'TYPE' ? 'Especificación' : 'Definición'
}

function mapearFuentePlsql(ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  const { orden, lineas } = lineasPorTipo(filas)
  const avisos: string[] = []
  const partes: DbFuente['partes'] = []
  for (const tipo of orden) {
    const cuerpo = (lineas.get(tipo) ?? []).join('').replace(/^\s+/, '')
    if (/\swrapped\b/i.test(primeraLinea(cuerpo)) && avisos.indexOf(AVISO_WRAPPED) < 0) avisos.push(AVISO_WRAPPED)
    partes.push({ titulo: tituloDeParte(tipo), texto: 'CREATE OR REPLACE ' + cuerpo })
  }
  if (partes.length === 0) avisos.push(AVISO_SIN_FUENTE)
  else if (ref.tipo === 'paquete' && !lineas.has('PACKAGE BODY')) avisos.push(AVISO_SIN_CUERPO)
  const fuente: DbFuente = { partes, origen: 'ALL_SOURCE' }
  if (avisos.length > 0) fuente.aviso = avisos.join(' ')
  return fuente
}

function mapearFuenteVista(ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  const cabecera = `${citar(ref.esquema)}.${citar(ref.nombre)}`
  const valor = filas.length > 0 ? textoOpcional(filas[0][0]) : undefined
  const origen = ref.tipo === 'vista' ? 'ALL_VIEWS' : 'ALL_MVIEWS'
  const prefijo =
    ref.tipo === 'vista' ? `CREATE OR REPLACE VIEW ${cabecera} AS\n` : `CREATE MATERIALIZED VIEW ${cabecera} AS\n`
  if (valor === undefined) return { partes: [], origen, aviso: AVISO_SIN_FUENTE }
  return { partes: [{ titulo: 'Definición', texto: prefijo + valor }], origen }
}

/** Filas de `sqlFuente` -> las partes del fuente con su origen y sus avisos. */
export function mapearFuente(_d: DialectoCatalogo, ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  return TIPOS_FUENTE_ORACLE[ref.tipo] ? mapearFuentePlsql(ref, filas) : mapearFuenteVista(ref, filas)
}
