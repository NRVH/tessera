// =============================================================================
// Cláusulas de la pestaña de tabla: valida los fragmentos WHERE y ORDER BY del usuario con el
// léxico compartido, compila el filtro guiado y el orden de la cabecera, y compone
// `SELECT … WHERE (…) ORDER BY …` con el rango de cada fragmento dentro del SQL final.
// Puro; lo usa `sqlRejilla.ts`, que reexporta `validarFragmento`.
// Decisiones: docs/decisiones/bd/rejilla-sql-fragmentos.md
// =============================================================================

import type { DbFiltroGuiado, DbOrdenColumna } from '../../../shared/filtroGuiado.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { citar } from '../../../shared/sql/identificadoresSql.ts'
import { tokenizar, type Token } from '../../../shared/sql/lexicoSql.ts'
import { compilarFiltro, compilarOrden, esErrorFiltro, type ValorFiltroSql } from './filtroSql.ts'
import type { BindEntradaLob } from './protocoloTrabajador.ts'
import {
  esErrorRejilla,
  fallo,
  type BindsRejilla,
  type CampoRejilla,
  type ConsultaRejilla,
  type ErrorRejilla,
  type ValidacionFragmento
} from './sqlRejillaTipos.ts'

const ETIQUETA: Record<CampoRejilla, string> = { where: 'WHERE', orderBy: 'ORDER BY' }

function mensajeSinCerrar(t: Token, etiqueta: string): string {
  switch (t.tipo) {
    case 'comentario':
      return `Comentario sin cerrar en ${etiqueta}.`
    case 'identCitado':
      return `Identificador entre comillas sin cerrar en ${etiqueta}.`
    case 'cadena':
      return t.valor.charAt(0) === '$'
        ? `Cadena con ${t.valor.slice(0, t.valor.indexOf('$', 1) + 1) || '$…$'} sin cerrar en ${etiqueta}.`
        : `Cadena sin cerrar en ${etiqueta}.`
    default:
      return `Texto sin cerrar en ${etiqueta}.`
  }
}

/**
 * Valida un fragmento con el léxico compartido. Devuelve `{ vacio }` si se puede
 * insertar (vacío = solo blancos y comentarios) o el error con su posición.
 */
export function validarFragmento(texto: string, campo: CampoRejilla, d: DialectoSql): ValidacionFragmento {
  const etiqueta = ETIQUETA[campo]
  const abiertos: number[] = []
  let significativos = 0
  for (const t of tokenizar(texto, d)) {
    if (t.sinCerrar) return fallo(mensajeSinCerrar(t, etiqueta), campo, t.desde)
    switch (t.tipo) {
      case 'comentario':
        continue
      case 'puntoYComa':
        return fallo(`${etiqueta} no admite «;»: aquí va una sola expresión.`, campo, t.desde)
      case 'parenA':
        abiertos.push(t.desde)
        break
      case 'parenC':
        if (abiertos.length === 0) {
          return fallo(`Sobra un «)» en ${etiqueta}: no tiene su «(».`, campo, t.desde)
        }
        abiertos.pop()
        break
      case 'bind':
        return fallo(
          `${etiqueta} no admite variables de enlace (${t.valor}): escribe el valor.`,
          campo,
          t.desde
        )
      case 'lineaCliente':
        return fallo(`${etiqueta} no admite comandos de psql.`, campo, t.desde)
      case 'palabra':
        if (campo === 'orderBy' && abiertos.length === 0 && t.valor === 'FOR') {
          return fallo(
            'ORDER BY no admite FOR UPDATE ni FOR SHARE: la rejilla solo lee.',
            campo,
            t.desde
          )
        }
        break
      default:
        break
    }
    significativos++
  }
  if (abiertos.length > 0) {
    return fallo(`Falta cerrar un «(» en ${etiqueta}.`, campo, abiertos[abiertos.length - 1])
  }
  return { vacio: significativos === 0 }
}

/** Valida y devuelve el fragmento a insertar (`null` si está vacío). */
function fragmento(
  texto: string | null | undefined,
  campo: CampoRejilla,
  d: DialectoSql
): string | null | ErrorRejilla {
  if (texto == null || texto === '') return null
  const v = validarFragmento(texto, campo, d)
  if (esErrorRejilla(v)) return v
  return v.vacio ? null : texto
}

/**
 * Lo que va detrás del FROM, ya validado y compilado: el WHERE (el texto del usuario o el
 * filtro guiado) y el ORDER BY (el texto del usuario o el orden de la cabecera), con los
 * parámetros del filtro.
 */
export interface Clausulas {
  where: string | null
  /** El WHERE es el filtro guiado: rangos de cada condición, RELATIVOS a `where`. null = texto del usuario. */
  condiciones: Array<[number, number]> | null
  orderBy: string | null
  /** Parámetros del filtro, posicionales: van DELANTE de los del paginado. */
  valores: ValorFiltroSql[]
  /** Oracle: los del filtro por nombre (`{ f1: … }`); null en los posicionales. */
  nombrados: Record<string, string | number | BindEntradaLob> | null
}

/** Los campos de una petición que `clausulasDe` mira. */
interface EntradaClausulas {
  where?: string | null
  orderBy?: string | null
  filtro?: DbFiltroGuiado | null
  orden?: readonly DbOrdenColumna[] | null
}

/** ¿Trae texto que no sea solo blancos? (la exclusión mira lo que se escribió, no si es válido). */
function conTexto(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim() !== ''
}

/** Compila el filtro guiado sobre `c`; el error si no vale o si viene con el WHERE libre. */
function aplicarFiltro(d: DialectoSql, p: EntradaClausulas, c: Clausulas): ErrorRejilla | null {
  if (p.filtro == null) return null
  const f = compilarFiltro(d, p.filtro)
  if (f !== null && esErrorFiltro(f)) {
    const e = fallo(f.mensaje, 'filtro', null)
    if (f.indice >= 0) e.condicion = f.indice
    return e
  }
  if (f === null) return null
  if (conTexto(p.where)) return fallo('El filtro guiado y el WHERE libre no van juntos: se aplica uno u otro.', null, null)
  c.where = f.sql
  c.condiciones = f.rangos
  c.valores = f.valores
  c.nombrados = f.nombrados
  return null
}

/** Compila el orden de la cabecera sobre `c`; el error si no vale o si viene con el ORDER BY libre. */
function aplicarOrden(p: EntradaClausulas, c: Clausulas): ErrorRejilla | null {
  if (p.orden == null) return null
  const o = compilarOrden(p.orden)
  if (o !== null && typeof o !== 'string') return fallo(o.mensaje, null, null)
  if (o === null) return null
  if (conTexto(p.orderBy)) return fallo('El orden de la cabecera y el ORDER BY libre no van juntos: se aplica uno u otro.', null, null)
  c.orderBy = o
  return null
}

/**
 * Valida los fragmentos del usuario, compila el filtro y el orden y comprueba que no vengan a
 * la vez con su texto libre. `conOrden` false (el recuento): sin ORDER BY.
 */
export function clausulasDe(d: DialectoSql, p: EntradaClausulas, conOrden: boolean): Clausulas | ErrorRejilla {
  const where = fragmento(p.where, 'where', d)
  if (where !== null && typeof where !== 'string') return where
  const orderBy = conOrden ? fragmento(p.orderBy, 'orderBy', d) : null
  if (orderBy !== null && typeof orderBy !== 'string') return orderBy
  const c: Clausulas = { where, condiciones: null, orderBy, valores: [], nombrados: null }
  const errorFiltro = aplicarFiltro(d, p, c)
  if (errorFiltro !== null) return errorFiltro
  if (conOrden) {
    const errorOrden = aplicarOrden(p, c)
    if (errorOrden !== null) return errorOrden
  }
  return c
}

/** Los binds de una consulta SIN paginar (cursor, recuento): los del filtro, o `[]`. */
export function bindsDelFiltro(c: Clausulas): BindsRejilla {
  return c.nombrados ?? c.valores.slice()
}

/** El SQL compuesto y el rango de cada fragmento del usuario dentro de él. */
export interface Base {
  sql: string
  rangos: ConsultaRejilla['rangos']
}

/** `SELECT … FROM … [WHERE (…)] [ORDER BY …]`, con los rangos de cada fragmento. */
export function componerBase(cabecera: string, c: Clausulas, ordenImplicito: readonly string[]): Base {
  let sql = cabecera
  const rangos: ConsultaRejilla['rangos'] = {}
  if (c.where !== null) {
    sql += '\nWHERE (\n'
    const ini = sql.length
    sql += c.where
    if (c.condiciones) rangos.filtro = c.condiciones.map(([a, b]): [number, number] => [a + ini, b + ini])
    else rangos.where = [ini, sql.length]
    sql += '\n)'
  }
  if (c.orderBy !== null) {
    sql += '\nORDER BY '
    const ini = sql.length
    sql += c.orderBy
    // También el orden compilado de la cabecera: con rango, un error del servidor al ordenar
    // vuelve como `campo: 'orderBy'` y los datos se quedan en vez de sustituirse por un aviso.
    rangos.orderBy = [ini, sql.length]
  } else if (ordenImplicito.length > 0) {
    // Con una flecha: `.map(citar)` pasaría el índice como el dialecto opcional de `citar`.
    sql += '\nORDER BY ' + ordenImplicito.map((x) => citar(x)).join(', ')
  }
  return { sql, rangos }
}

/** Mueve `delta` posiciones todos los rangos (el SQL se envuelve en un prefijo). */
export function desplazar(rangos: ConsultaRejilla['rangos'], delta: number): ConsultaRejilla['rangos'] {
  const r: ConsultaRejilla['rangos'] = {}
  if (rangos.where) r.where = [rangos.where[0] + delta, rangos.where[1] + delta]
  if (rangos.orderBy) r.orderBy = [rangos.orderBy[0] + delta, rangos.orderBy[1] + delta]
  if (rangos.filtro) r.filtro = rangos.filtro.map(([a, b]): [number, number] => [a + delta, b + delta])
  return r
}
