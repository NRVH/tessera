// =============================================================================
// Parámetros de un lote de la consola SQL: qué pregunta el diálogo antes de ejecutar y
// qué binds lleva cada sentencia. La detección es la de `shared/sql/parametrosSql.ts` (la
// misma del main); aquí solo se reparte. Orden, etiqueta y pie salen del estilo de
// parámetros del dialecto. Puro: el diálogo (`DialogoParametros`) solo pinta los campos.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbBinds, DbValorBind } from '../../../../../shared/db-explorador-ipc.ts'
import { nunca } from '../../../../../shared/nunca.ts'
import { reglasDeMotor, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { ClaseSentencia } from '../../../../../shared/sql/clasificarSql.ts'
import { parametrosSql } from '../../../../../shared/sql/parametrosSql.ts'
import { cantidad } from './salidaConsola.ts'

/** Lo que hace falta de una sentencia del lote (es un subconjunto de `Sentencia`). */
export interface TramoSentencia {
  desde: number
  hastaContenido: number
  clase: ClaseSentencia
}

/** Un campo del diálogo: un parámetro del lote. */
export interface CampoParametro {
  /** La clave de `DbBinds` (`ID`, `Id` si iba citado, `1`). */
  clave: string
  /** Cómo está escrito la PRIMERA vez (`:id`, `$1`): la etiqueta del campo. */
  etiqueta: string
  /** En cuántas sentencias del lote aparece (el diálogo lo dice si son varias). */
  sentencias: number
}

export interface ParametrosLote {
  campos: CampoParametro[]
  /** Claves de cada sentencia del lote, en su orden. Vacío = esa sentencia no lleva binds. */
  porSentencia: string[][]
}

/** El valor de un campo mientras se edita. */
export interface ValorCampo {
  texto: string
  nulo: boolean
}

/**
 * Los parámetros de un lote: los campos que pide el diálogo (uno por clave) y qué
 * claves lleva cada sentencia. `fuente` es el texto del que salieron las sentencias
 * (sus offsets son de ahí).
 */
export function parametrosDeLote(
  fuente: string,
  sentencias: readonly TramoSentencia[],
  dialecto: DialectoSql
): ParametrosLote {
  const campos = new Map<string, CampoParametro>()
  const porSentencia: string[][] = []
  for (const s of sentencias) {
    if (s.clase === 'cliente') {
      porSentencia.push([])
      continue
    }
    const ps = parametrosSql(fuente, dialecto, s.desde, s.hastaContenido)
    const claves: string[] = []
    for (const p of ps) {
      claves.push(p.clave)
      const previo = campos.get(p.clave)
      if (previo) previo.sentencias++
      else campos.set(p.clave, { clave: p.clave, etiqueta: p.texto, sentencias: 1 })
    }
    porSentencia.push(claves)
  }
  const lista = Array.from(campos.values())
  if (clavesPorNumero(dialecto)) lista.sort((a, b) => Number(a.clave) - Number(b.clave))
  return { campos: lista, porSentencia }
}

/**
 * ¿Se ordenan las claves por su NÚMERO (`$1`, `$2`…) y no por su primera aparición?
 * Lo dice el estilo de parámetros del dialecto (`reglasDeMotor(d).estiloParametros`).
 */
function clavesPorNumero(dialecto: DialectoSql): boolean {
  const estilo = reglasDeMotor(dialecto).estiloParametros
  switch (estilo) {
    case 'dolarNumero':
      return true
    // 'sqliteMixto': por nombre en su orden de aparición y por número detrás; ese orden lo
    // da ya `parametrosSql` (ver `EstiloParametros`), así que aquí no se reordena.
    // 'ninguno' (SQL Server): no hay parámetros que ordenar.
    case 'dosPuntosNombre':
    case 'sqliteMixto':
    case 'ninguno':
      return false
    default:
      return nunca(estilo, 'clavesPorNumero')
  }
}

/**
 * Valores con los que abre el diálogo: los que ya trae el lote (`fijos`), si no lo
 * último usado en la consola (`recordados`), y si no vacío. Un `null` es la casilla
 * NULL marcada.
 */
export function valoresIniciales(
  campos: readonly CampoParametro[],
  recordados: ReadonlyMap<string, DbValorBind>,
  fijos?: Readonly<DbBinds>
): Record<string, ValorCampo> {
  const out: Record<string, ValorCampo> = {}
  for (const c of campos) {
    let v: DbValorBind | undefined
    if (fijos && Object.prototype.hasOwnProperty.call(fijos, c.clave)) v = fijos[c.clave]
    else if (recordados.has(c.clave)) v = recordados.get(c.clave)
    out[c.clave] = v === null ? { texto: '', nulo: true } : { texto: v ?? '', nulo: false }
  }
  return out
}

/** Lo que el diálogo devuelve, en la forma del contrato (la casilla NULL = `null`). */
export function valoresABinds(campos: readonly CampoParametro[], valores: Readonly<Record<string, ValorCampo>>): DbBinds {
  const out: DbBinds = {}
  for (const c of campos) {
    const v = valores[c.clave]
    if (!v) out[c.clave] = ''
    else out[c.clave] = v.nulo ? null : v.texto
  }
  return out
}

/** Las claves del lote que `binds` no trae (en el orden de los campos). */
export function clavesSinValor(p: ParametrosLote, binds: Readonly<DbBinds> | undefined): string[] {
  return p.campos
    .filter((c) => !binds || !Object.prototype.hasOwnProperty.call(binds, c.clave))
    .map((c) => c.clave)
}

/**
 * Los binds de CADA sentencia: solo sus claves, porque el servidor rechaza un bind que la
 * sentencia no usa. `undefined` para la que no tiene parámetros, que así no manda el campo.
 */
export function bindsPorSentencia(p: ParametrosLote, binds: Readonly<DbBinds>): Array<DbBinds | undefined> {
  return p.porSentencia.map((claves) => {
    if (claves.length === 0) return undefined
    const propios: DbBinds = {}
    for (const k of claves) {
      if (Object.prototype.hasOwnProperty.call(binds, k)) propios[k] = binds[k]
    }
    return propios
  })
}

/** Lo recordado tras usar `binds` (un mapa nuevo: lo usado pisa lo que había). */
export function recordarValores(
  recordados: ReadonlyMap<string, DbValorBind>,
  binds: Readonly<DbBinds>
): Map<string, DbValorBind> {
  const out = new Map(recordados)
  for (const k of Object.keys(binds)) out.set(k, binds[k])
  return out
}

/**
 * Cómo se escribe una clave con su prefijo: `:ID` en Oracle (citada, `:"Id"`, si no es
 * un identificador simple en mayúsculas), `$1` en PG.
 */
export function etiquetaDeClave(clave: string, dialecto: DialectoSql): string {
  const estilo = reglasDeMotor(dialecto).estiloParametros
  switch (estilo) {
    case 'dolarNumero':
      return `$${clave}`
    case 'dosPuntosNombre':
      return /^[A-Z][A-Z0-9_$#]*$|^[0-9]+$/.test(clave) ? `:${clave}` : `:"${clave.split('"').join('""')}"`
    case 'sqliteMixto':
      // Un número es `?N`; un nombre, `:nombre` (`:x`, `@x` y `$x` son el mismo valor).
      return /^[0-9]+$/.test(clave) ? `?${clave}` : `:${clave}`
    case 'ninguno':
      // SQL Server: sin parámetros del usuario (`@x` es una variable); no se llama nunca.
      return clave
    default:
      return nunca(estilo, 'etiquetaDeClave')
  }
}

/**
 * La línea de ayuda del pie de `DialogoParametros`: cómo se escriben y se distinguen
 * los parámetros en el estilo del dialecto.
 */
export function pieDialogoParametros(dialecto: DialectoSql): string {
  const estilo = reglasDeMotor(dialecto).estiloParametros
  switch (estilo) {
    case 'dolarNumero':
      return 'Por número: $1, $2…'
    case 'dosPuntosNombre':
      return 'Sin comillas, :id y :ID son el mismo'
    case 'sqliteMixto':
      return 'Por nombre (:id, @id y $id son el mismo) o por número: ?, ?1'
    case 'ninguno':
      // SQL Server: sin diálogo de parámetros (`@x` es una variable del lote); no debería llamarse,
      // pero si se llama, dice la verdad.
      return 'Sin parámetros: @x es una variable del lote (DECLARE)'
    default:
      return nunca(estilo, 'pieDialogoParametros')
  }
}

/** Largo máximo de cada valor en el resumen de una pestaña. */
const MAX_VALOR_RESUMEN = 40

/**
 * Los parámetros con que se ejecutó un resultado, en una línea para el tooltip de su
 * pestaña: `:ID = 5 · :NOMBRE = NULL`. Vacío si no llevaba.
 */
export function resumenBinds(binds: Readonly<DbBinds> | undefined, dialecto: DialectoSql): string {
  if (!binds) return ''
  const claves = Object.keys(binds)
  if (clavesPorNumero(dialecto)) claves.sort((a, b) => Number(a) - Number(b))
  return claves
    .map((k) => {
      const v = binds[k]
      const texto =
        v === null
          ? 'NULL'
          : v === ''
            ? "''"
            : v.length > MAX_VALOR_RESUMEN
              ? `${v.slice(0, MAX_VALOR_RESUMEN - 1)}…`
              : v
      return `${etiquetaDeClave(k, dialecto)} = ${texto}`
    })
    .join(' · ')
}

/** Qué hace el botón principal del diálogo. */
export type AccionParametros = 'ejecutar' | 'explicar'

/**
 * La frase del diálogo: para qué se piden los valores. «la sentencia» o «las 3
 * sentencias del lote»; para el plan, siempre una.
 */
export function textoDialogoParametros(sentenciasConParametros: number, accion: AccionParametros): string {
  const que =
    accion === 'explicar'
      ? 'Valores para explicar el plan de la sentencia'
      : sentenciasConParametros <= 1
        ? 'Valores para ejecutar la sentencia'
        : `Valores para ejecutar ${cantidad(sentenciasConParametros, 'sentencia', 'sentencias')} del lote`
  return `${que}. Se envían como texto y el servidor los convierte al tipo de su sitio.`
}

/** Cuántas sentencias del lote tienen algún parámetro. */
export function sentenciasConParametros(p: ParametrosLote): number {
  return p.porSentencia.filter((c) => c.length > 0).length
}
