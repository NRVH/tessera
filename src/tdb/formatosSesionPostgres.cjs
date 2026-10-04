// =============================================================================
// Formatos que Tessera fija en la sesión PostgreSQL (fechas, intervalos, bytea, flotantes y
// `standard_conforming_strings`) y la segunda barrera por ParameterStatus: si el servidor
// informa de que uno se apartó, se vuelven a fijar antes de la siguiente sentencia.
// Sin dependencias; lo usa `sesionPostgres.cjs`.
// Decisiones: docs/decisiones/bd/trabajador-postgres-sesion.md
// =============================================================================
'use strict'

/** Formatos que Tessera fija (el main rechaza cambiarlos). Un solo viaje. */
const SQL_FORMATOS =
  "SELECT set_config('DateStyle', 'ISO, YMD', false), set_config('IntervalStyle', 'postgres', false), " +
  "set_config('bytea_output', 'hex', false), set_config('extra_float_digits', '3', false), " +
  "set_config('standard_conforming_strings', 'on', false)"
/** Columnas de `SQL_FORMATOS`: lo que `SQL_ABRIR` lee va detrás. */
const N_FORMATOS = 5
const SQL_ABRIR = `${SQL_FORMATOS}, current_schema(), current_user, current_setting('server_version')`

/**
 * Lo que el servidor informa por ParameterStatus de los formatos fijados, con el valor que
 * Tessera les da (en minúsculas: el nombre llega como el del GUC, 'DateStyle'). `bytea_output` y
 * `extra_float_digits` no se informan: esos siguen a cargo del rechazo del main y de `refijarFormatos`.
 */
const FORMATOS_INFORMADOS = new Map([
  ['standard_conforming_strings', 'on'],
  ['datestyle', 'ISO, YMD'],
  ['intervalstyle', 'postgres']
])

/**
 * Apunta en `apartados` (un Set por sesión) lo que diga un ParameterStatus: un formato fijado que
 * se aparta de lo de Tessera entra, y sale cuando vuelve (al refijarlo, o porque un ROLLBACK
 * deshizo el `set_config` hecho dentro de la transacción).
 */
function anotarParametro(apartados, nombre, valor) {
  const n = String(nombre || '').toLowerCase()
  const esperado = FORMATOS_INFORMADOS.get(n)
  if (esperado === undefined) return
  if (String(valor) === esperado) apartados.delete(n)
  else apartados.add(n)
}

/**
 * Escucha los ParameterStatus de la conexión de `pg`, que reemite cada mensaje del protocolo por
 * su nombre; sin ella (otra versión) solo queda el rechazo del main.
 */
function vigilarFormatos(s) {
  const conexionPg = s.cliente.connection
  if (conexionPg && typeof conexionPg.on === 'function') {
    conexionPg.on('parameterStatus', (m) => {
      if (m) anotarParametro(s.apartados, m.parameterName, m.parameterValue)
    })
  }
}

module.exports = { SQL_FORMATOS, N_FORMATOS, SQL_ABRIR, vigilarFormatos }
