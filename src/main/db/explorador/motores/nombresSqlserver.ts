// =============================================================================
// Nombres de SQL Server en el SQL que escribe el main: cómo se cita un nombre con corchetes,
// cómo se escribe el prefijo de la base en un nombre de tres partes y cómo se compone el tipo de
// una columna desde `sys.columns`. Hoja compartida por el catálogo, la sesión y el DDL.
// Decisiones: docs/decisiones/bd/catalogo-motores-sqlserver.md
// =============================================================================

/** `[nombre]` con `]` doblado. */
export function corchetes(nombre: string): string {
  return '[' + nombre.split(']').join(']]') + ']'
}

/** `[base].` o '' (la de la sesión). */
export function prefijoBase(base: string | undefined): string {
  return base === undefined || base === '' ? '' : corchetes(base) + '.'
}

/**
 * La expresión T-SQL del tipo de una columna como se escribe en un DDL (`nvarchar(50)`,
 * `decimal(38,12)`), sobre `sys.columns` (alias `c`), `sys.types` (`t`) y el esquema del tipo
 * (`sys.schemas`, `ts`, con LEFT JOIN). Un tipo de usuario va con su esquema.
 */
export const SQL_TIPO_COLUMNA = sqlTipoExpresion('c', 't', 'ts')

/**
 * La expresión del tipo con los alias que se pidan: `medidas` es la fila con `max_length`,
 * `precision` y `scale` (una columna, o un tipo alias), `tipo` la de `sys.types` del tipo y
 * `esquemaTipo` la de su esquema (null si el tipo nunca es de usuario: la base de un alias).
 */
export function sqlTipoExpresion(medidas: string, tipo: string, esquemaTipo: string | null): string {
  const m = medidas
  const t = tipo
  return [
    'CASE',
    ...(esquemaTipo !== null ? [`  WHEN ${t}.is_user_defined = 1 THEN QUOTENAME(${esquemaTipo}.name) + '.' + QUOTENAME(${t}.name)`] : []),
    `  WHEN ${t}.name IN ('varchar', 'char', 'varbinary', 'binary')`,
    `    THEN ${t}.name + '(' + CASE WHEN ${m}.max_length = -1 THEN 'max' ELSE CAST(${m}.max_length AS varchar(10)) END + ')'`,
    `  WHEN ${t}.name IN ('nvarchar', 'nchar')`,
    `    THEN ${t}.name + '(' + CASE WHEN ${m}.max_length = -1 THEN 'max' ELSE CAST(${m}.max_length / 2 AS varchar(10)) END + ')'`,
    `  WHEN ${t}.name IN ('decimal', 'numeric')`,
    `    THEN ${t}.name + '(' + CAST(${m}.precision AS varchar(10)) + ',' + CAST(${m}.scale AS varchar(10)) + ')'`,
    `  WHEN ${t}.name IN ('datetime2', 'time', 'datetimeoffset') THEN ${t}.name + '(' + CAST(${m}.scale AS varchar(10)) + ')'`,
    `  WHEN ${t}.name = 'float' AND ${m}.precision <> 53 THEN 'float(' + CAST(${m}.precision AS varchar(10)) + ')'`,
    `  ELSE ${t}.name`,
    'END'
  ].join('\n')
}
