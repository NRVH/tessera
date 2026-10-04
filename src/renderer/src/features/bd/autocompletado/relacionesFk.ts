// =============================================================================
// Sugerencias por clave ajena: tras `JOIN ` las tablas relacionadas con las de la
// izquierda, con su ON y un alias libre; tras `ON ` las condiciones entre la tabla
// del JOIN y las previas. Todo citado por motor y en la caja en que se escribió.
// Puro: depende de `candidatosSql`, `fuenteCatalogo` y `shared/`.
// Decisiones: docs/decisiones/bd/ui-autocompletado-fks-y-estrella.md
// =============================================================================

import type { DbFk } from '../../../../../shared/db-explorador-ipc.ts'
import { dialectoDeMotor, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { citarSiHaceFalta, nombreCalificado } from '../../../../../shared/sql/identificadoresSql.ts'
import { RESERVADAS } from '../../../../../shared/sql/palabrasSql.ts'
import { coincidencia, NIVEL_SUGERENCIA, ORDEN_TIPO, type Candidato } from './candidatosSql.ts'
import type { InfoCondicion, InfoJoin } from './contextoSql.ts'
import { ajenaAlCatalogo, esquemaDeRef, esquemasLocales, type FuenteCatalogo } from './fuenteCatalogo.ts'
import type { RefTabla } from './referenciasSql.ts'

/** Palabras que no pueden ser un alias sin comillas (además de las reservadas del motor). */
const NO_SIRVEN_DE_ALIAS = new Set(['AS', 'ON', 'IN', 'IS', 'OR', 'BY', 'TO', 'DO', 'IF', 'AT', 'OF', 'NO', 'GO'])

/**
 * Un alias libre para `tabla`: sus iniciales en minúsculas (`order_items` -> `oi`,
 * `CLIENTES` -> `c`), con un número detrás si ya se usa en la sentencia (alias o nombre
 * de tabla) o no se puede escribir sin comillas. `usados` va plegado como el motor.
 */
export function aliasLibre(tabla: string, usados: readonly string[], d: DialectoSql): string {
  const partes = tabla.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0 && /^[A-Za-z]/.test(p))
  let base = partes.map((p) => p[0].toLowerCase()).join('')
  if (base === '') base = 't'
  const ocupado = (a: string): boolean => {
    const may = a.toUpperCase()
    if (NO_SIRVEN_DE_ALIAS.has(may) || RESERVADAS[dialectoDeMotor(d)].has(may)) return true
    return usados.some((u) => u.toUpperCase() === may)
  }
  if (!ocupado(base)) return base
  for (let n = 1; ; n++) if (!ocupado(base + n)) return base + n
}

/** Cómo se nombra una tabla de la sentencia al calificar una columna. */
export function expuestoDe(r: RefTabla, d: DialectoSql): string {
  if (r.expuesto !== undefined) return r.expuesto
  return citarSiHaceFalta(r.alias !== null ? r.alias : r.nombre, d)
}

/** `a.x = b.y [AND a.x2 = b.y2]` en la caja pedida. */
function condicionFk(
  nueva: string,
  colsNueva: readonly string[],
  previa: string,
  colsPrevia: readonly string[],
  d: DialectoSql,
  caja: 'mayus' | 'minus'
): string {
  const y = caja === 'minus' ? ' and ' : ' AND '
  const partes: string[] = []
  for (let i = 0; i < colsNueva.length && i < colsPrevia.length; i++) {
    partes.push(`${nueva}.${citarSiHaceFalta(colsNueva[i], d)} = ${previa}.${citarSiHaceFalta(colsPrevia[i], d)}`)
  }
  return partes.join(y)
}

function mismoObjeto(fuente: FuenteCatalogo, a: { esquema: string; nombre: string }, esquema: string, tabla: string): boolean {
  const x = fuente.destino ? fuente.destino(a.esquema, a.nombre) : a
  return x.esquema === esquema && x.nombre === tabla
}

/** Tras `JOIN `: las tablas relacionadas por FK con las de la izquierda, con su ON. */
export function anadirJoins(
  acc: Candidato[],
  p: string,
  join: InfoJoin,
  esquemaEscrito: string | null,
  fuente: FuenteCatalogo,
  d: DialectoSql
): void {
  if (!fuente.fks) return
  const locales = esquemasLocales(fuente, d)
  const on = join.caja === 'minus' ? 'on' : 'ON'
  const vistos = new Set<string>()
  let orden = 0
  const emitir = (esq: string, tabla: string, cols: readonly string[], previa: RefTabla, colsPrevia: readonly string[], fk: DbFk): void => {
    if (esquemaEscrito !== null && esq !== esquemaEscrito) return
    const minus = tabla.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0) return
    const alias = aliasLibre(tabla, join.usados, d)
    const nombre = nombreCalificado(esquemaEscrito !== null || locales.indexOf(esq) >= 0 ? null : esq, tabla, d)
    const texto = `${nombre} ${alias} ${on} ${condicionFk(alias, cols, expuestoDe(previa, d), colsPrevia, d, join.caja)}`
    if (vistos.has(texto)) return
    vistos.add(texto)
    acc.push({
      nivel: NIVEL_SUGERENCIA.relacion,
      sub: c,
      tipoOrd: ORDEN_TIPO.join,
      clave: orden++,
      minus: texto.toLowerCase(),
      extra: esq,
      etiqueta: texto,
      parentesis: fk.nombre,
      tipo: 'join',
      calificarCon: null,
      literal: true
    })
  }
  for (const previa of join.previas) {
    if (ajenaAlCatalogo(previa)) continue
    const e = esquemaDeRef(previa, fuente, d)
    const rel = e === null ? null : fuente.fks(e, previa.nombre)
    if (!rel) continue
    // Sale de la previa hacia otra: la otra aporta las columnas REFERENCIADAS.
    for (const fk of rel.salientes) emitir(fk.hacia.esquema, fk.hacia.tabla, fk.hacia.columnas, previa, fk.desde.columnas, fk)
    // Entra en la previa desde otra: la otra aporta las columnas de la FK.
    for (const fk of rel.entrantes) emitir(fk.desde.esquema, fk.desde.tabla, fk.desde.columnas, previa, fk.hacia.columnas, fk)
  }
}

/** Tras `ON ` (o `AND` dentro del ON): las condiciones de FK entre la tabla del JOIN y las de su izquierda. */
export function anadirCondiciones(acc: Candidato[], p: string, cond: InfoCondicion, fuente: FuenteCatalogo, d: DialectoSql): void {
  if (!fuente.fks || ajenaAlCatalogo(cond.nueva)) return
  const e = esquemaDeRef(cond.nueva, fuente, d)
  const rel = e === null ? null : fuente.fks(e, cond.nueva.nombre)
  if (!rel) return
  const nueva = expuestoDe(cond.nueva, d)
  const vistos = new Set<string>()
  let orden = 0
  const emitir = (texto: string, fk: DbFk): void => {
    const minus = texto.toLowerCase()
    const c = coincidencia(minus, p)
    if (c < 0 || vistos.has(texto)) return
    vistos.add(texto)
    acc.push({
      nivel: NIVEL_SUGERENCIA.relacion,
      sub: c,
      tipoOrd: ORDEN_TIPO.condicion,
      clave: orden++,
      minus,
      extra: '',
      etiqueta: texto,
      parentesis: fk.nombre,
      tipo: 'condicion',
      calificarCon: null,
      literal: true
    })
  }
  for (const previa of cond.previas) {
    if (ajenaAlCatalogo(previa)) continue
    const ep = esquemaDeRef(previa, fuente, d)
    if (ep === null) continue
    const real = { esquema: ep, nombre: previa.nombre }
    const nombrePrevia = expuestoDe(previa, d)
    for (const fk of rel.salientes) {
      if (mismoObjeto(fuente, real, fk.hacia.esquema, fk.hacia.tabla)) {
        emitir(condicionFk(nueva, fk.desde.columnas, nombrePrevia, fk.hacia.columnas, d, cond.caja), fk)
      }
    }
    for (const fk of rel.entrantes) {
      if (mismoObjeto(fuente, real, fk.desde.esquema, fk.desde.tabla)) {
        emitir(condicionFk(nueva, fk.hacia.columnas, nombrePrevia, fk.desde.columnas, d, cond.caja), fk)
      }
    }
  }
}
