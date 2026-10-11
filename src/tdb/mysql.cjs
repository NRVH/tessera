// =============================================================================
// Adaptador MySQL y MariaDB de `tdb`: abre mysql2 (JavaScript puro, empaquetado), impone el solo
// lectura en el servidor (la sesión y cada consulta en una transacción READ ONLY) y consulta con
// tope de filas. Conectar y las celdas son de `mysqlComun.cjs`; el catálogo, de `catalogoMysql.cjs`.
// Lo cargan `tdb.cjs` por `MOTORES.mysql` (`motores.cjs`).
// Decisiones: docs/decisiones/bd/adaptador-mysql-solo-lectura.md
// =============================================================================

'use strict'

const comun = require('./mysqlComun.cjs')
const catalogo = require('./catalogoMysql.cjs')

/** Tope de espera por sentencia (ms), el mismo `statement_timeout` que `postgres.cjs`. */
const TOPE_SENTENCIA_MS = 60_000

/** El nombre de la aplicación que ve el servidor: quién y con qué conexión. */
function nombreApp(ctx, con) {
  const quien = ctx && ctx.usuarioWindows ? ctx.usuarioWindows : 'tessera'
  return `Tessera/tdb ${quien}@${con.alias}`
}

/**
 * Lo que la guardia por prefijo de `tdb.cjs` no ve y en MySQL ESCRIBE aunque la transacción sea de
 * solo lectura: un comentario ejecutable (`/*!…*\/`, el servidor ejecuta lo de dentro y el prefijo
 * lo quita como comentario) y `INTO OUTFILE`/`INTO DUMPFILE` (un archivo en el servidor). Se mira el
 * texto ENTERO, también dentro de las cadenas: un falso positivo cuesta reescribir la consulta.
 * Devuelve el motivo del rechazo, o null.
 */
function rechazoSoloLectura(sql) {
  if (/\/\*[mM]?!/.test(sql)) return 'lleva un comentario ejecutable (/*! … */), que el servidor ejecuta y no se puede comprobar.'
  // La palabra sola, no `INTO OUTFILE`: entre las dos puede ir un comentario (`INTO/**/OUTFILE`).
  if (/\b(outfile|dumpfile)\b/i.test(sql)) return 'INTO OUTFILE y INTO DUMPFILE escriben un archivo en el servidor.'
  return null
}

/**
 * Conecta y prepara la sesión (`prepararSesion`: modo SQL, versión mínima y, en solo lectura, la
 * sesión entera en READ ONLY). Devuelve la sesión de `tdb`: `{ conexion, modo, driverId, cerrar }`
 * con `conexion` = `{ c, con, soloLectura }`.
 */
async function abrir(con, secreto, ctx) {
  let c
  try {
    c = await comun.conectar(comun.opcionesConexion(con, secreto, { appName: nombreApp(ctx, con) }))
  } catch (e) {
    throw comun.errorAlConectar(e, con)
  }
  // Un 'error' sin oyente tumba el proceso (el socket que se cae con la sesión ociosa).
  c.on('error', () => {})
  const soloLectura = con.readonly !== false
  try {
    const info = await comun.prepararSesion(c, soloLectura)
    // El tope del servidor: en segundos en MariaDB (`max_statement_time`), en ms en MySQL (solo SELECT).
    const tope = comun.esMariaDb(info.version) ? `max_statement_time = ${TOPE_SENTENCIA_MS / 1000}` : `max_execution_time = ${TOPE_SENTENCIA_MS}`
    await comun.interna(c, `SET SESSION ${tope}`)
  } catch (e) {
    await comun.cerrar(c)
    throw e
  }
  return {
    conexion: { c, con, soloLectura },
    modo: 'nativo',
    driverId: null,
    cerrar: async () => {
      await comun.cerrar(c)
    }
  }
}

/** Nombres de columna únicos (`a`, `a_2`…): las filas van como objetos y dos iguales se pisarían. */
function nombresUnicos(nombres) {
  const vistos = new Map()
  return nombres.map((n) => {
    const k = vistos.get(n) || 0
    vistos.set(n, k + 1)
    return k === 0 ? n : `${n}_${k + 1}`
  })
}

/** Una fila (array, ya en texto) como objeto con las columnas de su conjunto. */
function filaObjeto(fila, campos, nombres) {
  const o = {}
  for (let i = 0; i < nombres.length; i++) {
    const r = comun.celdas.celdaMysql(fila[i], campos[i], { catalogo: true, topeCelda: 0, topeBinario: 0 })
    o[nombres[i]] = r.valor
  }
  return o
}

/**
 * Corre `sql` y junta sus conjuntos (un CALL devuelve varios) con un tope de filas por conjunto.
 * En solo lectura, al pasar el tope se CORTA la conexión (no hay nada que perder); con escritura
 * se leen y descartan las que sobran, para que la sentencia termine entera.
 */
function correr(c, sql, limite, soloLectura) {
  return new Promise((resolve, reject) => {
    const conjuntos = []
    const afectadas = []
    let cortada = false
    const q = c.query({ sql, rowsAsArray: true, timeout: TOPE_SENTENCIA_MS })
    q.on('fields', (campos) => {
      // Una sentencia sin filas (un OK) también emite 'fields', sin campos.
      if (!campos) return
      conjuntos.push({ campos, nombres: nombresUnicos(campos.map((f) => String(f.name))), filas: [], recortado: false })
    })
    q.on('result', (fila) => {
      const actual = conjuntos[conjuntos.length - 1]
      if (!Array.isArray(fila) || !actual) {
        if (fila && typeof fila.affectedRows === 'number') afectadas.push(fila.affectedRows)
        return
      }
      if (actual.filas.length >= limite) {
        actual.recortado = true
        if (soloLectura && !cortada) {
          cortada = true
          c.destroy()
          resolve({ conjuntos, afectadas, cortada })
        }
        return
      }
      actual.filas.push(filaObjeto(fila, actual.campos, actual.nombres))
    })
    q.on('error', (err) => {
      if (!cortada) reject(err)
    })
    q.on('end', () => {
      if (!cortada) resolve({ conjuntos, afectadas, cortada })
    })
  })
}

/** El error de `tdb` de un fallo del servidor: su número y su mensaje. */
function errorTdb(err) {
  const n = err && typeof err.errno === 'number' ? ` (${err.errno})` : ''
  const e = new Error(`${(err && (err.sqlMessage || err.message)) || err}${n}`)
  if (err && err.errno) e.codigo = String(err.errno)
  return e
}

/**
 * Ejecuta UNA sentencia y devuelve `{ columnas, filas, avisos?, conjuntos? }`: arriba, el ÚLTIMO
 * conjunto con filas; en `conjuntos`, todos. En solo lectura va dentro de `START TRANSACTION READ
 * ONLY … ROLLBACK` sobre una sesión ya READ ONLY.
 */
async function consultar(s, sql, limite) {
  const { c, soloLectura } = s
  if (soloLectura) {
    const motivo = rechazoSoloLectura(sql)
    if (motivo) throw new Error(`"${s.con.alias}" es de SOLO LECTURA y esa sentencia ${motivo}`)
    await comun.interna(c, 'START TRANSACTION READ ONLY')
  }
  let r
  try {
    r = await correr(c, sql.replace(/;\s*$/, ''), limite, soloLectura)
  } catch (err) {
    if (soloLectura) await comun.interna(c, 'ROLLBACK').catch(() => {})
    throw errorTdb(err)
  }
  if (soloLectura && !r.cortada) await comun.interna(c, 'ROLLBACK')
  return resultadoDe(r, limite, soloLectura)
}

/** El resultado de `consultar` a partir de lo que devolvió `correr`. */
function resultadoDe(r, limite, soloLectura) {
  const avisos = []
  const conFilas = r.conjuntos
  const ultimo = conFilas[conFilas.length - 1]
  if (r.cortada) avisos.push(`Se alcanzó el tope de ${limite} filas: tdb cortó ahí la lectura. Usa --limit N o LIMIT.`)
  if (conFilas.length === 0) {
    const n = r.afectadas.reduce((a, b) => a + b, 0)
    avisos.push(r.afectadas.length > 0 && !soloLectura ? `La sentencia no devuelve filas; cambió ${n} fila(s).` : 'La sentencia no devuelve filas.')
  }
  if (conFilas.length > 1) avisos.push(`La sentencia devolvió ${conFilas.length} conjuntos de resultados; están todos en «conjuntos».`)
  return {
    columnas: ultimo ? ultimo.nombres : [],
    filas: ultimo ? ultimo.filas : [],
    ...(conFilas.length > 1
      ? { conjuntos: conFilas.map((x) => ({ columnas: x.nombres, filas: x.filas, ...(x.recortado ? { recortado: true } : {}) })) }
      : {}),
    ...(avisos.length > 0 ? { avisos } : {})
  }
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
  // Sin `bases`: en MySQL la base es el esquema, y sin base fija `tablas` ya las da con su nombre
  // de dos partes (`base.tabla`), que es también lo que acepta `describe`.
  // Para `test-mysql-tdb`.
  rechazoSoloLectura,
  nombresUnicos,
  nombreApp,
  TOPE_SENTENCIA_MS
}
