// =============================================================================
// SQL de la pestaña de tabla (rejilla) del explorador: compositor puro del `SELECT` paginado
// y del `COUNT(*)` a partir del objeto del catálogo y de los campos WHERE/ORDER BY del usuario
// (o del filtro guiado). Solo el main compone SQL; sin electron, fs ni `process`.
// Piezas: tipos (`sqlRejillaTipos`), cláusulas (`sqlRejillaClausulas`) y errores (`sqlRejillaErrores`).
// Decisiones: docs/decisiones/bd/rejilla-sql-fragmentos.md, docs/decisiones/bd/rejilla-paginado.md
// =============================================================================

import { descriptorSql, etiquetasSqlDonde, type DescriptorSql, type FormaPaginado } from '../../../shared/motores/index.ts'
import { nunca } from '../../../shared/nunca.ts'
import { marcadorPosicional, type DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { COLUMNA_ROWID } from '../../../shared/sql/dmlRejilla.ts'
import { citar } from '../../../shared/sql/identificadoresSql.ts'
import type { ValorFiltroSql } from './filtroSql.ts'
import { soloMotoresCon } from './motores/filasCatalogo.ts'
import { motorExplorador } from './motores/index.ts'
import {
  bindsDelFiltro,
  clausulasDe,
  componerBase,
  desplazar,
  validarFragmento,
  type Clausulas
} from './sqlRejillaClausulas.ts'
import {
  campoDeError,
  campoDeErrorEnLinea,
  campoDeErrorEnPuntosDeCodigo
} from './sqlRejillaErrores.ts'
import {
  PREFIJO_COLUMNA_CLAVE,
  detalleDeErrorRejilla,
  esErrorRejilla,
  fallo,
  type BindsRejilla,
  type CampoRejilla,
  type ClaveKeyset,
  type ConsultaRejilla,
  type ErrorRejilla,
  type ObjetoRejilla,
  type PeticionConsultaTabla,
  type PeticionConteo,
  type ResultadoRejilla,
  type UbicacionErrorRejilla,
  type ValidacionFragmento,
  type ValorClave
} from './sqlRejillaTipos.ts'

export type { FormaPaginado }
export { COLUMNA_ROWID, PREFIJO_COLUMNA_CLAVE, campoDeError, campoDeErrorEnLinea, campoDeErrorEnPuntosDeCodigo }
export { detalleDeErrorRejilla, esErrorRejilla, validarFragmento }
export type {
  BindsRejilla,
  CampoRejilla,
  ClaveKeyset,
  ConsultaRejilla,
  ErrorRejilla,
  ObjetoRejilla,
  PeticionConsultaTabla,
  PeticionConteo,
  ResultadoRejilla,
  UbicacionErrorRejilla,
  ValidacionFragmento,
  ValorClave
}

// --- Objeto y ROWID -------------------------------------------------------------------

/** Nombre de enlace que Oracle acepta sin comillas y ya en mayúsculas. */
const DBLINK_SIN_COMILLAS = /^[A-Z][A-Z0-9_$#]*(\.[A-Z][A-Z0-9_$#]*)*(@[A-Z][A-Z0-9_$#]*)?$/

/** ¿Se lee por su ROWID una fila sin PK de este motor? Un `switch` que cierra con `nunca`. */
function leeRowid(d: DescriptorSql): boolean {
  const sinPk = d.sesion.identidadSinPk
  switch (sinPk) {
    case 'rowid':
      return true
    case 'unicaNoNula':
      return false
    default:
      return nunca(sinPk, 'leeRowid')
  }
}

/** Por qué no se lee por ROWID: nombra los motores del registro que SÍ, no uno escrito a mano. */
function mensajeSinRowid(): string {
  const donde = etiquetasSqlDonde(leeRowid)
  return donde === '' ? 'Ningún motor lee las filas por su ROWID.' : `ROWID solo existe en ${donde}.`
}

/** El nombre de tres partes, solo en un motor con nivel «Bases»; el error si el objeto no puede llevar base. */
function conBase(d: DialectoSql, objeto: ObjetoRejilla, esquema: string, fuente: string): string | ErrorRejilla {
  const nivel = descriptorSql(d).catalogo.nivelBases
  switch (nivel) {
    case 'ninguno':
      return fallo(`${descriptorSql(d).etiqueta} no tiene bases dentro de una conexión: el objeto no puede llevar base.`, null, null)
    case 'sinBaseFija':
      if (!esquema) return fallo('Falta el esquema del objeto.', null, null)
      return citar(objeto.base as string) + '.' + fuente
    default:
      return nunca(nivel, 'fuenteDe')
  }
}

/** `"E"."O"` (o `"E"."O"@LINK`), o el error si el objeto no es consultable. */
function fuenteDe(d: DialectoSql, objeto: ObjetoRejilla): string | ErrorRejilla {
  const { esquema, nombre, dblink } = objeto
  const catalogo = descriptorSql(d).catalogo
  if (dblink && !catalogo.tieneDblinks) {
    return fallo(soloMotoresCon('enlaces de base de datos (@dblink)', (x) => x.catalogo.tieneDblinks), null, null)
  }
  // Un sinónimo remoto creado sin esquema resuelve con `TABLE_OWNER` nulo: el nombre va sin calificar.
  if (!nombre || (!esquema && !dblink)) {
    return fallo('Falta el esquema o el nombre del objeto.', null, null)
  }
  const publico = catalogo.pseudoEsquemaPublico
  if (publico !== null && esquema === publico) {
    return fallo(`${publico} no es un esquema: hay que resolver el sinónimo antes de consultarlo.`, null, null)
  }
  let fuente = esquema ? citar(esquema) + '.' + citar(nombre) : citar(nombre)
  if (dblink) fuente += '@' + (DBLINK_SIN_COMILLAS.test(dblink) ? dblink : citar(dblink))
  return objeto.base ? conBase(d, objeto, esquema, fuente) : fuente
}

/**
 * El `*` de una cabecera que lleva columnas detrás (la del ROWID, las de la clave): calificado
 * por el objeto entero, salvo en SQLite, cuya gramática no admite `esquema.tabla.*`.
 */
function estrellaDe(forma: FormaPaginado, fuente: string): string {
  switch (forma) {
    case 'keyset':
      return '*'
    case 'cursor':
    case 'rownum':
    case 'limitOffset':
    case 'offsetFetch':
      return `${fuente}.*`
    default:
      return nunca(forma, 'estrellaDe')
  }
}

// --- Consulta de la pestaña ---------------------------------------------------------

const MENSAJE_BINDS_NO_CASAN = 'Los parámetros del filtro de este motor no casan con su forma de paginado.'

function enteroNoNegativo(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

/** Alias del número de fila del ROWNUM de respaldo: citado y con el prefijo de Tessera, para no chocar con una columna. */
export const COLUMNA_RN = '__TESSERA_RN'

/** Prefijo y sufijo del ROWNUM anidado. El interior va en sus propias líneas. */
const ROWNUM_PREFIJO = `SELECT * FROM (SELECT q__.*, ROWNUM ${citar(COLUMNA_RN)} FROM (\n`
const ROWNUM_SUFIJO = `\n) q__ WHERE ROWNUM <= :hasta) WHERE ${citar(COLUMNA_RN)} > :desde`

/** La cabecera `SELECT … FROM …` (con la columna del ROWID si se pide) o el error del ROWID. */
function cabeceraDe(
  p: PeticionConsultaTabla,
  motor: DescriptorSql,
  fuente: string
): { cabecera: string; columnaRowid: string | null } | ErrorRejilla {
  const sinRowid = !leeRowid(motor)
  if (p.rowid === true && (sinRowid || p.objeto.dblink)) {
    return fallo(
      sinRowid ? mensajeSinRowid() : 'Un objeto remoto (@dblink) no se lee con su ROWID.',
      null,
      null
    )
  }
  // Solo con `rowid` (un motor sin ROWID lanza al pedírsela); el alias solo lo pasa SQLite.
  const sesion = motorExplorador(p.dialecto).sesion
  const columnaRowid =
    p.rowid !== true ? null : p.aliasRowid === undefined ? sesion.sqlColumnaRowid() : sesion.sqlColumnaRowid(p.aliasRowid)
  const cabecera =
    columnaRowid !== null
      ? `SELECT ${estrellaDe(p.forma, fuente)}, ${columnaRowid} AS ${citar(COLUMNA_ROWID)} FROM ${fuente}`
      : 'SELECT * FROM ' + fuente
  return { cabecera, columnaRowid }
}

/**
 * SQL de una página de la pestaña de tabla. Nunca lanza con un dialecto conocido: un
 * fragmento inválido vuelve como `ErrorRejilla` con su `campo` y su posición.
 */
export function construirConsultaTabla(p: PeticionConsultaTabla): ResultadoRejilla {
  const d = p.dialecto
  const motor = descriptorSql(d)
  if (motor.sesion.paginado.admitidas.indexOf(p.forma) < 0) {
    return fallo(`La forma de paginado «${p.forma}» no vale para ${d}.`, null, null)
  }
  const fuente = fuenteDe(d, p.objeto)
  if (typeof fuente !== 'string') return fuente
  const c = clausulasDe(d, p, true)
  if ('error' in c) return c
  const cab = cabeceraDe(p, motor, fuente)
  if ('error' in cab) return cab

  // Un `switch` que cierra con `nunca`: una forma nueva no compila aquí hasta tener su rama.
  const forma = p.forma
  switch (forma) {
    case 'cursor': {
      // Sin filtro, `[]` como siempre; con él, sus valores (en Oracle, el objeto por nombre).
      const base = componerBase(cab.cabecera, c, [])
      return { sql: base.sql, binds: bindsDelFiltro(c), rangos: base.rangos, columnasExtraAlFinal: 0 }
    }
    case 'rownum':
    case 'limitOffset':
    case 'offsetFetch':
      return consultaPaginada(forma, p, cab.cabecera, c)
    case 'keyset':
      // Con ORDER BY del usuario, o sin clave (una vista, una virtual): LIMIT/OFFSET.
      if (c.orderBy !== null || !p.clave) {
        if (motor.sesion.paginado.admitidas.indexOf('limitOffset') < 0) {
          return fallo('Sin clave ni ORDER BY, esta tabla no se puede paginar.', null, null)
        }
        return consultaPaginada('limitOffset', p, cab.cabecera, c)
      }
      return consultaPorClave(p, p.clave, fuente, c, cab.columnaRowid)
    default:
      return nunca(forma, 'construirConsultaTabla')
  }
}

/** Las expresiones de la clave del keyset (el alias del rowid o las columnas de la PK citadas), o el error. */
function expresionesDeClave(clave: ClaveKeyset): string[] | ErrorRejilla {
  switch (clave.tipo) {
    case 'rowid':
      if (!/^(rowid|_rowid_|oid)$/i.test(clave.alias)) return fallo('Alias de rowid no válido.', null, null)
      return [clave.alias]
    case 'pk':
      if (clave.columnas.length === 0 || clave.columnas.some((x) => x === '')) {
        return fallo('La clave del paginado no tiene columnas.', null, null)
      }
      return clave.columnas.map((x) => citar(x))
    default:
      return nunca(clave, 'consultaPorClave')
  }
}

/** `[AND|WHERE] clave > marcadores`: la condición que deja lo ya leído detrás. `k` son los binds que hay delante. */
function condicionKeyset(d: DialectoSql, expresiones: string[], n: number, k: number, hayWhere: boolean): string {
  const marcas = Array.from({ length: n }, (_, i) => marcadorPosicional(d, k + i + 1))
  const lado = expresiones.length === 1 ? expresiones[0] : `(${expresiones.join(', ')})`
  const valores = marcas.length === 1 ? marcas[0] : `(${marcas.join(', ')})`
  return `${hayWhere ? '\n  AND ' : '\nWHERE '}${lado} > ${valores}`
}

/**
 * 'keyset': la página DETRÁS de la última clave leída, sin OFFSET. La clave va DOS veces: en
 * el ORDER BY y el WHERE (su expresión) y como columnas ocultas al final, que el trabajador
 * quita y devuelve aparte. La del ROWID de edición, si la hay, va delante de ellas.
 */
function consultaPorClave(
  p: PeticionConsultaTabla,
  clave: ClaveKeyset,
  fuente: string,
  c: Clausulas,
  columnaRowid: string | null
): ResultadoRejilla {
  const n = p.n
  if (!enteroNoNegativo(n) || n < 1) {
    return fallo('Paginado inválido: `n` debe ser un entero ≥ 1.', null, null)
  }
  if (c.nombrados !== null) return fallo(MENSAJE_BINDS_NO_CASAN, null, null)
  // Sin calificar: hay UNA tabla en el FROM y SQLite no admite todas las formas calificadas.
  const expresiones = expresionesDeClave(clave)
  if ('error' in expresiones) return expresiones
  const despues = p.despues ?? null
  if (despues !== null && despues.length !== expresiones.length) {
    return fallo('La clave de la última fila no cuadra con la del paginado.', null, null)
  }
  const ocultas = expresiones.map((e, i) => `${e} AS ${citar(PREFIJO_COLUMNA_CLAVE + (i + 1))}`).join(', ')
  const rowid = columnaRowid !== null ? `, ${columnaRowid} AS ${citar(COLUMNA_ROWID)}` : ''
  const cabecera = `SELECT ${estrellaDe(p.forma, fuente)}${rowid}, ${ocultas} FROM ${fuente}`
  const base = componerBase(cabecera, c, [])
  let sql = base.sql
  // Los del filtro delante; la clave de la última fila y `n`, detrás.
  const binds: Array<number | ValorClave | ValorFiltroSql> = c.valores.slice()
  if (despues !== null) {
    sql += condicionKeyset(p.dialecto, expresiones, despues.length, binds.length, c.where !== null)
    binds.push(...despues)
  }
  sql += `\nORDER BY ${expresiones.join(', ')}\nLIMIT ${marcadorPosicional(p.dialecto, binds.length + 1)}`
  binds.push(n)
  return { sql, binds, rangos: base.rangos, columnasExtraAlFinal: 0, columnasClave: expresiones.length }
}

/** ROWNUM anidado (Oracle, respaldo del cursor): sin ORDER BY del usuario lleva `sinOrdenEstable`. */
function paginaRownum(cabecera: string, c: Clausulas, n: number, desde: number): ResultadoRejilla {
  const base = componerBase(cabecera, c, [])
  const salida: ConsultaRejilla = {
    sql: ROWNUM_PREFIJO + base.sql + ROWNUM_SUFIJO,
    // Sin filtro, `{ hasta, desde }` como siempre (el `...{}` no añade nada).
    binds: { ...(c.nombrados ?? {}), hasta: desde + n, desde },
    rangos: desplazar(base.rangos, ROWNUM_PREFIJO.length),
    columnasExtraAlFinal: 1
  }
  if (c.orderBy === null) salida.sinOrdenEstable = true
  return salida
}

/** LIMIT/OFFSET: sin ORDER BY del usuario, por la PK si la hay. Los marcadores son los del dialecto. */
function paginaLimitOffset(p: PeticionConsultaTabla, cabecera: string, c: Clausulas, n: number, desde: number): ResultadoRejilla {
  const k = c.valores.length
  const pk = c.orderBy === null ? (p.pkColumnas ?? []).filter((x) => x !== '') : []
  const base = componerBase(cabecera, c, pk)
  const salida: ConsultaRejilla = {
    sql: `${base.sql}\nLIMIT ${marcadorPosicional(p.dialecto, k + 1)} OFFSET ${marcadorPosicional(p.dialecto, k + 2)}`,
    binds: [...c.valores, n, desde],
    rangos: base.rangos,
    columnasExtraAlFinal: 0
  }
  if (c.orderBy === null && pk.length === 0) salida.sinOrdenEstable = true
  return salida
}

/** OFFSET/FETCH: el orden va siempre (OFFSET sin ORDER BY es un error): el del usuario, la PK o `(SELECT NULL)`. */
function paginaOffsetFetch(p: PeticionConsultaTabla, cabecera: string, c: Clausulas, n: number, desde: number): ResultadoRejilla {
  const k = c.valores.length
  const pk = c.orderBy === null ? (p.pkColumnas ?? []).filter((x) => x !== '') : []
  const base = componerBase(cabecera, c, pk)
  const sinOrden = c.orderBy === null && pk.length === 0
  const salida: ConsultaRejilla = {
    sql:
      `${base.sql}${sinOrden ? '\nORDER BY (SELECT NULL)' : ''}` +
      `\nOFFSET ${marcadorPosicional(p.dialecto, k + 1)} ROWS FETCH NEXT ${marcadorPosicional(p.dialecto, k + 2)} ROWS ONLY`,
    binds: [...c.valores, desde, n],
    rangos: base.rangos,
    columnasExtraAlFinal: 0
  }
  if (sinOrden) salida.sinOrdenEstable = true
  return salida
}

/** Las formas que re-ejecutan por páginas: ROWNUM anidado, LIMIT/OFFSET u OFFSET/FETCH. */
function consultaPaginada(
  forma: 'rownum' | 'limitOffset' | 'offsetFetch',
  p: PeticionConsultaTabla,
  cabecera: string,
  c: Clausulas
): ResultadoRejilla {
  const n = p.n
  const desde = p.desde ?? 0
  if (!enteroNoNegativo(n) || n < 1 || !enteroNoNegativo(desde) || !Number.isSafeInteger(desde + n)) {
    return fallo('Paginado inválido: `n` debe ser un entero ≥ 1 y `desde` un entero ≥ 0.', null, null)
  }
  // ROWNUM enlaza por nombre; las otras dos, por posición.
  if (forma === 'rownum' ? c.valores.length > 0 : c.nombrados !== null) return fallo(MENSAJE_BINDS_NO_CASAN, null, null)
  switch (forma) {
    case 'rownum':
      return paginaRownum(cabecera, c, n, desde)
    case 'limitOffset':
      return paginaLimitOffset(p, cabecera, c, n, desde)
    case 'offsetFetch':
      return paginaOffsetFetch(p, cabecera, c, n, desde)
    default:
      return nunca(forma, 'consultaPaginada')
  }
}

/**
 * `SELECT COUNT(*)` de «Contar», con el mismo WHERE que la rejilla (el libre o el filtro
 * guiado, con sus parámetros). El orden, si llega, se ignora.
 */
export function construirConteo(p: PeticionConteo): ResultadoRejilla {
  const fuente = fuenteDe(p.dialecto, p.objeto)
  if (typeof fuente !== 'string') return fuente
  const c = clausulasDe(p.dialecto, p, false)
  if ('error' in c) return c
  const base = componerBase('SELECT COUNT(*) FROM ' + fuente, c, [])
  return { sql: base.sql, binds: bindsDelFiltro(c), rangos: base.rangos, columnasExtraAlFinal: 0 }
}
