// =============================================================================
// Fachada de «Ver DDL»: reexporta con su nombre de siempre el SQL de catálogo y los generadores
// puros de cada motor (`motores/ddlOracle.ts`, `ddlPostgres.ts`, `ddlSqlserver.ts`, también el
// repliegue de DBMS_METADATA, que es de Oracle). Aquí no queda código: lo de un motor vive en su
// archivo, donde `test:motores-sueltos` lo vigila por motor. Puro: sin electron ni drivers.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

export { literalCadena } from './ddlCatalogoComun.ts'
export * from './motores/ddlOracle.ts'
export * from './motores/ddlPostgres.ts'
export * from './motores/ddlSqlserver.ts'
