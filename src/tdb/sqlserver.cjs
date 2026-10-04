// =============================================================================
// Adaptador SQL Server de `tdb`: la interfaz de los demás adaptadores (abrir, consultar, banner,
// tablas, columnas, foraneas, indices, sesiones) más `guardiaSoloLectura` (pura, antes de
// conectar) y `bases`. Conectar es de `sqlserverComun.cjs`; la guardia, de `guardiaSqlserver.cjs`;
// las peticiones, de `peticionSqlserver.cjs`; el catálogo, de `catalogoSqlserver.cjs`.
// El solo lectura lo impone Tessera con tres capas, no el servidor.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-solo-lectura.md
// =============================================================================

'use strict'

const comun = require('./sqlserverComun.cjs')
const guardia = require('./guardiaSqlserver.cjs')
const peticion = require('./peticionSqlserver.cjs')
const catalogo = require('./catalogoSqlserver.cjs')

const { guardiaSoloLectura, mensajeGuardia, envolverSoloLectura, dividirLotes } = guardia
const { ejecutar, errorTdb, revertirSiAbierta, TOPE_PETICION_MS } = peticion

/** El nombre de la aplicación que ve el servidor (`program_name`): quién y con qué conexión. */
function nombreApp(ctx, con) {
  const quien = ctx && ctx.usuarioWindows ? ctx.usuarioWindows : 'tessera'
  // TDS lo corta en 128 caracteres; mejor cortarlo aquí que dejar que falle el login.
  return `Tessera/tdb ${quien}@${con.alias}`.slice(0, 128)
}

/**
 * Conecta y manda `sqlInicioSesion('cli')` (`SET LOCK_TIMEOUT`: un agente no se queda colgado
 * detrás de una transacción sin confirmar; vence con el 1222). Cada petición lleva además un
 * tope de 60 s, el mismo `statement_timeout` que `postgres.cjs`. Devuelve la sesión de `tdb`:
 * `{ conexion, modo, driverId, cerrar }` con `conexion` = `{ tds, con, soloLectura }`.
 */
async function abrir(con, secreto, ctx) {
  let config
  try {
    config = comun.opcionesConexion(con, secreto, {
      cas: comun.certificadosDeConfianza(),
      appName: nombreApp(ctx, con),
      requestTimeoutMs: TOPE_PETICION_MS
    })
  } catch (e) {
    throw errorTdb(e, con)
  }
  let tds
  try {
    tds = await comun.conectar(config)
  } catch (e) {
    throw errorTdb(e, con)
  }
  // Un 'error' sin oyente tumba el proceso (el socket que se cae con la sesión ociosa); el
  // de la petición en curso lo dice su callback.
  tds.on('error', () => {})
  const c = { tds, con, soloLectura: con.readonly !== false, resueltos: new Map() }
  const inicio = comun.sqlInicioSesion('cli')
  if (inicio) {
    const r = await ejecutar(tds, inicio, { lote: true })
    if (r.error) {
      await comun.cerrar(tds)
      throw errorTdb(r.error, con)
    }
  }
  return {
    conexion: c,
    // `tdb test` lo pinta entre paréntesis, como el 'nativo'/'thick' de los otros motores.
    modo: comun.esAutenticacion(con.autenticacion) && comun.pideDominio(con.autenticacion) ? 'nativo, cuenta de dominio (NTLM)' : 'nativo',
    driverId: null,
    cerrar: async () => {
      await comun.cerrar(tds)
    }
  }
}

/** Los lotes de `sql`: con la guardia en solo lectura, sin ella en escritura. Lanza si no se pueden ejecutar. */
function lotesDe(c, sql) {
  const div = c.soloLectura ? guardiaSoloLectura(sql) : dividirLotes(sql)
  if (!div.ok) throw new Error(c.soloLectura ? mensajeGuardia(c.con.alias, div) : div.motivo)
  if (div.lotes.length === 0) throw new Error('No hay ninguna sentencia que ejecutar.')
  return div.lotes
}

/** El aviso de que se alcanzó el tope de filas: la petición se CANCELÓ ahí y lo que venía detrás no se ejecutó. */
function avisoDeTope(limite, k, i, total) {
  return (
    `Se alcanzó el tope de ${limite} filas en el conjunto ${k}: tdb canceló ahí la ejecución, así que lo que venía ` +
    `detrás en el lote${i < total - 1 ? ' y los lotes siguientes' : ''} NO se ejecutó. Usa --limit N o TOP.`
  )
}

/** Los avisos de después de ejecutar todos los lotes. */
function avisosFinales(c, lotes, conjuntos, resumen) {
  const avisos = []
  if (lotes.length > 1) avisos.push(`Se ejecutaron ${lotes.length} lotes (separados por GO).`)
  if (conjuntos.length > 1) avisos.push(`El texto devolvió ${conjuntos.length} conjuntos de resultados; están todos en «conjuntos».`)
  if (conjuntos.length === 0) {
    // En solo lectura no se dice «cambió»: un `SELECT @x = …` también cuenta filas.
    avisos.push(resumen.huboAfectadas && !c.soloLectura ? `El texto no devuelve filas; cambió ${resumen.afectadas} fila(s).` : 'El texto no devuelve filas.')
  }
  return avisos
}

/**
 * Ejecuta `sql` (uno o varios lotes separados por GO, cada uno en su petición y en orden) y
 * devuelve `{ columnas, filas, avisos?, conjuntos?, salida? }`: arriba, las columnas y las filas
 * del ÚLTIMO conjunto; en `conjuntos`, todos; en `salida`, PRINT y RAISERROR de nivel ≤ 10.
 * El tope de filas CANCELA la petición (no envuelve en `TOP`: rompería los CTE, el ORDER BY y los lotes).
 */
async function consultar(c, sql, limite) {
  const lotes = lotesDe(c, sql)
  const conjuntos = []
  const salida = []
  const avisos = []
  const resumen = { afectadas: 0, huboAfectadas: false }
  for (let i = 0; i < lotes.length; i++) {
    const lote = lotes[i]
    const texto = c.soloLectura ? envolverSoloLectura(lote.texto) : lote.texto
    const r = await ejecutar(c.tds, texto, { lote: true, limite })
    for (const x of r.conjuntos) conjuntos.push(x)
    for (const x of r.salida) salida.push(x)
    for (const x of r.afectadas) {
      resumen.afectadas += x
      resumen.huboAfectadas = true
    }
    if (r.error) {
      // En solo lectura, lo que quedara abierto se revierte ya (el envoltorio no llegó a su
      // ROLLBACK); en escritura, lo que el texto dejó abierto también: se dice en el error.
      const revertida = await revertirSiAbierta(c.tds)
      throw errorDeLote(r, c, i, lotes, revertida)
    }
    if (c.soloLectura) await revertirSiAbierta(c.tds)
    if (r.cancelado) {
      avisos.push(avisoDeTope(limite, conjuntos.length, i, lotes.length))
      break
    }
  }
  if (!c.soloLectura && (await revertirSiAbierta(c.tds))) {
    avisos.push('El texto dejó una transacción abierta (BEGIN TRAN sin COMMIT) y se revirtió: tdb abre y cierra la conexión en cada comando.')
  }
  avisos.push(...avisosFinales(c, lotes, conjuntos, resumen))
  return resultadoDe(conjuntos, salida, avisos)
}

/** El resultado de `consultar`: las columnas y las filas del último conjunto, y `conjuntos`, `salida` y `avisos` si los hay. */
function resultadoDe(conjuntos, salida, avisos) {
  const ultimo = conjuntos[conjuntos.length - 1]
  return {
    columnas: ultimo ? ultimo.columnas : [],
    filas: ultimo ? ultimo.filas : [],
    ...(conjuntos.length > 1
      ? { conjuntos: conjuntos.map((x) => ({ columnas: x.columnas, filas: x.filas, ...(x.recortado ? { recortado: true } : {}) })) }
      : {}),
    ...(salida.length > 0 ? { salida } : {}),
    ...(avisos.length > 0 ? { avisos } : {})
  }
}

/**
 * El error de un lote, con lo que pasó con el resto: SQL Server sigue con el lote tras muchos
 * errores, así que se dice cuántas sentencias corrieron DESPUÉS y, en una conexión de escritura,
 * qué quedó confirmado.
 */
function errorDeLote(r, c, i, lotes, revertida) {
  const base = errorTdb(r.error, c.con, lotes[i].linea - 1)
  const notas = []
  if (lotes.length > 1) {
    notas.push(`Falló el lote ${i + 1} de ${lotes.length}${i < lotes.length - 1 ? '; los siguientes no se ejecutaron' : ''}.`)
  }
  if (c.soloLectura) {
    notas.push('Nada quedó escrito: la conexión es de solo lectura.')
  } else {
    if (i > 0) notas.push(`Los ${i} lote(s) anteriores ya se ejecutaron y lo que escribieron quedó confirmado.`)
    if (r.trasError > 0) {
      notas.push(`SQL Server siguió con el lote tras el error: después terminaron ${r.trasError} sentencia(s) más, y lo que escribieron quedó confirmado.`)
    }
    if (revertida) notas.push('Quedaba una transacción abierta y se revirtió.')
  }
  const err = new Error(base.message + (notas.length > 0 ? `\n    ${notas.join('\n    ')}` : ''))
  if (base.codigo) err.codigo = base.codigo
  return err
}

module.exports = {
  abrir,
  consultar,
  banner: catalogo.banner,
  tablas: catalogo.tablas,
  columnas: catalogo.columnas,
  foraneas: catalogo.foraneas,
  indices: catalogo.indices,
  sesiones: catalogo.sesiones,
  bases: catalogo.bases,
  guardiaSoloLectura,
  mensajeGuardia,
  // Para `test-sqlserver-tdb` (puras).
  INICIOS_LECTURA: guardia.INICIOS_LECTURA,
  PROHIBIDAS: guardia.PROHIBIDAS,
  SET_PERMITIDOS: guardia.SET_PERMITIDOS,
  TOPE_PETICION_MS,
  tokenizar: guardia.tokenizar,
  dividirLotes,
  envolverSoloLectura,
  valorTdb: peticion.valorTdb,
  nombresUnicos: peticion.nombresUnicos,
  partesNombre: catalogo.partesNombre,
  tipoEscrito: catalogo.tipoEscrito,
  sinParentesis: catalogo.sinParentesis,
  textoDeError: peticion.textoDeError,
  nombreApp,
  // Para `test-sqlserver-tdb` contra el servidor: la capa 3 (el envoltorio) sin las otras dos.
  ejecutar,
  revertirSiAbierta
}
