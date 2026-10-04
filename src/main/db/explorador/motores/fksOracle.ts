// =============================================================================
// Oracle: las claves ajenas de un objeto en TRES consultas cortas (las restricciones propias, las
// FK que entran y las columnas de todas ellas) y su unión en relaciones. Puro salvo el lector del
// turno de catálogo. Lo ensambla `catalogoOracle.ts`, que reexporta lo público.
// Decisiones: docs/decisiones/bd/catalogo-motores-oracle.md
// =============================================================================

import type { DbFk, DbRelacionesFk } from '../../../../shared/db-explorador-ipc.ts'
import type { LectorCatalogo } from './catalogo.ts'
import { aNumero, clasificarFk, noDisponible, texto } from './filasCatalogo.ts'
import { ora } from './sqlOracle.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * Paso 1: las restricciones R, P y U DE la tabla. Filas: `[constraint_type, owner,
 * table_name, constraint_name, r_owner, r_constraint_name]`.
 */
export function sqlFks(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT constraint_type, owner, table_name, constraint_name, r_owner, r_constraint_name',
      '  FROM all_constraints',
      ' WHERE owner = :esq AND table_name = :obj',
      "   AND constraint_type IN ('R', 'P', 'U')"
    ],
    { esq: esquema, obj: objeto }
  )
}

/** Restricciones por consulta de columnas: un bind cada una más el del dueño, lejos del tope de 1000 de Oracle. */
export const RESTRICCIONES_POR_CONSULTA = 400

/** Claves (PK/UNIQUE) por consulta de entrantes: un bind cada una más el dueño. */
export const CLAVES_POR_CONSULTA = 500

/**
 * Paso 2: las FK que apuntan a esas claves de la tabla, troceado; ninguna consulta si no hay
 * claves. Con `/*+ RULE *\/` solo en la 11g. Filas: `[owner, table_name, constraint_name,
 * r_owner, r_constraint_name]`.
 */
export function sqlFksEntrantesOracle(d: DialectoCatalogo, esquema: string, claves: readonly string[]): ConsultaCatalogo[] {
  if (d.motor !== 'oracle') noDisponible(d.motor, 'sqlFksEntrantesOracle')
  const hint = d.versionMayor < 12 ? '/*+ RULE */ ' : ''
  const unicas = Array.from(new Set(claves))
  const consultas: ConsultaCatalogo[] = []
  for (let i = 0; i < unicas.length; i += CLAVES_POR_CONSULTA) {
    const binds: Record<string, string> = { esq: esquema }
    const marcas = unicas.slice(i, i + CLAVES_POR_CONSULTA).map((c, k) => {
      binds[`k${k}`] = c
      return `:k${k}`
    })
    consultas.push(
      ora(
        [
          `SELECT ${hint}owner, table_name, constraint_name, r_owner, r_constraint_name`,
          '  FROM all_constraints',
          " WHERE constraint_type = 'R'",
          `   AND r_owner = :esq AND r_constraint_name IN (${marcas.join(', ')})`
        ],
        binds
      )
    )
  }
  return consultas
}

/**
 * Paso 3: las columnas de esas restricciones, UNA CONSULTA POR DUEÑO y troceada, sin hint.
 * Filas: `[owner, constraint_name, table_name, column_name, position]`.
 */
export function sqlColumnasDeRestricciones(d: DialectoCatalogo, pares: ReadonlyArray<readonly [string, string]>): ConsultaCatalogo[] {
  if (d.motor !== 'oracle') noDisponible(d.motor, 'sqlColumnasDeRestricciones')
  const porDueno = new Map<string, Set<string>>()
  for (const [dueno, nombre] of pares) {
    const nombres = porDueno.get(dueno)
    if (nombres) nombres.add(nombre)
    else porDueno.set(dueno, new Set([nombre]))
  }
  const consultas: ConsultaCatalogo[] = []
  for (const [dueno, conjunto] of porDueno) {
    const nombres = Array.from(conjunto)
    for (let i = 0; i < nombres.length; i += RESTRICCIONES_POR_CONSULTA) {
      const binds: Record<string, string> = { o: dueno }
      const marcas = nombres.slice(i, i + RESTRICCIONES_POR_CONSULTA).map((nombre, k) => {
        binds[`c${k}`] = nombre
        return `:c${k}`
      })
      consultas.push(
        ora(
          [
            'SELECT owner, constraint_name, table_name, column_name, position',
            '  FROM all_cons_columns',
            ` WHERE owner = :o AND constraint_name IN (${marcas.join(', ')})`,
            ' ORDER BY owner, constraint_name, position'
          ],
          binds
        )
      )
    }
  }
  return consultas
}

/** Los pares (dueño, nombre) de las restricciones que hay que completar con columnas. */
export function paresDeFksOracle(filas: readonly FilaCatalogo[]): Array<[string, string]> {
  const pares: Array<[string, string]> = []
  for (const f of filas) {
    pares.push([texto(f[0]), texto(f[2])])
    pares.push([texto(f[3]), texto(f[4])])
  }
  return pares
}

/** Oracle: los nombres de las PK/UNIQUE de la tabla, de las filas del paso 1 (`sqlFks`). */
export function clavesReferenciablesOracle(propias: readonly FilaCatalogo[]): string[] {
  return propias.filter((f) => texto(f[0]) === 'P' || texto(f[0]) === 'U').map((f) => texto(f[3]))
}

/**
 * Las FK de los pasos 1 (las R de la tabla) y 2 (las que le entran), UNA vez cada una (la FK a
 * sí misma sale en los dos) y ordenadas por dueño, tabla y nombre.
 */
export function filasFksOracle(propias: readonly FilaCatalogo[], entrantes: readonly FilaCatalogo[]): FilaCatalogo[] {
  const unicas = new Map<string, FilaCatalogo>()
  for (const f of propias) {
    if (texto(f[0]) === 'R') unicas.set(`${texto(f[1])}\u0000${texto(f[3])}`, f.slice(1))
  }
  for (const f of entrantes) {
    const clave = `${texto(f[0])}\u0000${texto(f[2])}`
    if (!unicas.has(clave)) unicas.set(clave, f)
  }
  const orden = (f: FilaCatalogo): string => `${texto(f[0])}\u0000${texto(f[1])}\u0000${texto(f[2])}`
  return Array.from(unicas.values()).sort((a, b) => (orden(a) < orden(b) ? -1 : orden(a) > orden(b) ? 1 : 0))
}

/** Las columnas de las restricciones agrupadas por (dueño, nombre), con su tabla. */
function columnasPorRestriccion(columnas: readonly FilaCatalogo[]): Map<string, { tabla: string; columnas: Array<[number, string]> }> {
  const cols = new Map<string, { tabla: string; columnas: Array<[number, string]> }>()
  for (const c of columnas) {
    const clave = `${texto(c[0])}\u0000${texto(c[1])}`
    let e = cols.get(clave)
    if (!e) {
      e = { tabla: texto(c[2]), columnas: [] }
      cols.set(clave, e)
    }
    e.columnas.push([aNumero(c[4]) ?? e.columnas.length + 1, texto(c[3])])
  }
  return cols
}

/** Filas de `filasFksOracle` más las de `sqlColumnasDeRestricciones` -> relaciones. */
export function mapearFks(
  esquema: string,
  objeto: string,
  filas: readonly FilaCatalogo[],
  columnas: readonly FilaCatalogo[]
): DbRelacionesFk {
  const r: DbRelacionesFk = { salientes: [], entrantes: [] }
  const cols = columnasPorRestriccion(columnas)
  const ordenadas = (clave: string): string[] =>
    (cols.get(clave)?.columnas ?? []).slice().sort((a, b) => a[0] - b[0]).map((x) => x[1])
  for (const f of filas) {
    const dueno = texto(f[0])
    const nombre = texto(f[2])
    const rDueno = texto(f[3])
    const rNombre = texto(f[4])
    const rClave = `${rDueno}\u0000${rNombre}`
    const destino = cols.get(rClave)
    const fk: DbFk = {
      nombre,
      desde: { esquema: dueno, tabla: texto(f[1]), columnas: ordenadas(`${dueno}\u0000${nombre}`) },
      hacia: { esquema: rDueno, tabla: destino?.tabla ?? '', columnas: ordenadas(rClave) }
    }
    // Una FK hacia una tabla que el usuario NO ve (otro esquema sin permisos) no trae las
    // columnas del padre ni su nombre: sin las dos puntas no sirve para un JOIN, fuera.
    if (!destino || fk.desde.columnas.length === 0 || fk.desde.columnas.length !== fk.hacia.columnas.length) continue
    clasificarFk(fk, esquema, objeto, r)
  }
  return r
}

/**
 * Las FK de un objeto en los tres pasos, con el lector del turno de catálogo; cada consulta
 * pasa por `lector.construir`. Puro salvo el lector: el test le da uno falso.
 */
export async function leerFksOracle(lector: LectorCatalogo, esquema: string, objeto: string): Promise<DbRelacionesFk> {
  const d = lector.dialecto
  if (d.motor !== 'oracle') noDisponible(d.motor, 'leerFksOracle')
  const propias = await lector.consultar(lector.construir(() => sqlFks(d, esquema, objeto)))
  // Lo que se calcula de las filas va FUERA de `construir`: solo se clasifica lo que construye SQL.
  const claves = clavesReferenciablesOracle(propias)
  const entrantes: FilaCatalogo[] = []
  for (const c of lector.construir(() => sqlFksEntrantesOracle(d, esquema, claves))) {
    for (const f of await lector.consultar(c)) entrantes.push(f)
  }
  const filas = filasFksOracle(propias, entrantes)
  const columnas: FilaCatalogo[] = []
  if (filas.length > 0) {
    const pares = paresDeFksOracle(filas)
    for (const c of lector.construir(() => sqlColumnasDeRestricciones(d, pares))) {
      for (const f of await lector.consultar(c)) columnas.push(f)
    }
  }
  return mapearFks(esquema, objeto, filas, columnas)
}
