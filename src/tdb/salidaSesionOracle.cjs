// =============================================================================
// DBMS_OUTPUT de la sesión Oracle: se activa al abrir SOLO en las consolas y se lee con
// GET_LINES y un bind de array tras las sentencias que el main marca con `salidaServidor`.
// Lo que pasa del tope se PURGA sin leerlo (DISABLE + ENABLE). Depende de `celdas.cjs`.
// Lo usa `sesionOracle.cjs`.
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')

/** Sin tope de buffer (NULL): el tope es de Tessera, al leer (`AcumuladorSalida`). */
const SQL_SALIDA_ACTIVA = 'BEGIN DBMS_OUTPUT.ENABLE(NULL); END;'
const SQL_GET_LINES = 'BEGIN DBMS_OUTPUT.GET_LINES(:lineas, :n); END;'
/** Vacía el buffer sin leerlo: DISABLE lo purga y ENABLE lo vuelve a abrir. */
const SQL_PURGAR_SALIDA = 'BEGIN DBMS_OUTPUT.DISABLE; DBMS_OUTPUT.ENABLE(NULL); END;'
/**
 * Líneas por viaje de GET_LINES. En thick el bind de array reserva
 * `maxArraySize × maxSize` (32767 bytes por línea): con 100 son ~3 MB por llamada y
 * una salida normal (unas decenas de líneas) cabe en un viaje.
 */
const LINEAS_POR_VIAJE = 100

/**
 * Lee (y vacía) lo que la sentencia dejó en DBMS_OUTPUT, hasta agotarlo o llegar al tope (cada
 * viaje por una VPN cuesta más que el aviso de «el resto se descartó»). Solo en sesiones con la
 * salida activada al abrir. Nunca lanza: la salida es un extra y no puede tapar el resultado ni
 * el error de la sentencia.
 */
async function leerSalida(s) {
  if (!s.salidaActiva) return undefined
  const oracledb = s.oracledb
  const acc = new celdas.AcumuladorSalida()
  try {
    for (;;) {
      const r = await s.conexion.execute(SQL_GET_LINES, {
        lineas: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767, maxArraySize: LINEAS_POR_VIAJE },
        n: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: LINEAS_POR_VIAJE }
      })
      const lineas = (r.outBinds && r.outBinds.lineas) || []
      const n = Math.min(Number(r.outBinds && r.outBinds.n) || 0, lineas.length)
      // PUT_LINE('') llega como NULL: es una línea vacía, no una ausencia.
      for (let i = 0; i < n; i++) acc.agregar(lineas[i] === null || lineas[i] === undefined ? '' : lineas[i], false)
      if (n < LINEAS_POR_VIAJE) break
      if (acc.lleno) {
        await s.conexion.execute(SQL_PURGAR_SALIDA)
        acc.marcarPurgada()
        break
      }
    }
  } catch {
    // Sin permiso sobre DBMS_OUTPUT o sesión rota: sin salida; el resultado manda.
  }
  const lineas = acc.lineas()
  return lineas.length > 0 ? lineas : undefined
}

/** Activa DBMS_OUTPUT en la sesión; `false` si está vetado (la consola funciona igual, sin salida). */
async function activarSalida(s) {
  try {
    await s.conexion.execute(SQL_SALIDA_ACTIVA)
    return true
  } catch {
    return false
  }
}

module.exports = { leerSalida, activarSalida }
