// =============================================================================
// El catálogo de MySQL y MariaDB para `tdb` (`test`, `schema`, `describe`, `sessions`): consultas a
// `information_schema` con `?` (sustituidos por `mysqlComun`), nombres de una o dos partes
// (`base.tabla`, con `acentos graves` o "comillas"); sin base fija, las tablas de todas las bases que
// el usuario ve. Pieza de `mysql.cjs`, que reexporta todo.
// Decisiones: docs/decisiones/bd/adaptador-mysql-solo-lectura.md
// =============================================================================

'use strict'

const comun = require('./mysqlComun.cjs')

/** Las bases del propio servidor (la misma lista que el descriptor). */
const SISTEMA = "('information_schema', 'mysql', 'performance_schema', 'sys')"

/** Las filas de una consulta INTERNA con `?`, como objetos por el nombre de cada columna. */
function filasDe(s, sql, valores) {
  const texto = comun.sustituirMarcadores(sql, valores || [])
  return new Promise((resolve, reject) => {
    s.c.query({ sql: texto, rowsAsArray: true }, (err, filas, campos) => {
      if (err) return reject(err)
      const nombres = (campos || []).map((f) => String(f.name))
      resolve(
        (filas || []).map((f) => {
          const o = {}
          for (let i = 0; i < nombres.length; i++) {
            const v = f[i]
            o[nombres[i]] = v === null || v === undefined ? null : Buffer.isBuffer(v) ? '0x' + v.toString('hex').toUpperCase() : String(v)
          }
          return o
        })
      )
    })
  })
}

/**
 * Las partes de un nombre (`tabla`, `base.tabla`, con `acentos` o "comillas" y su delimitador doblado
 * dentro). null si no se entiende o tiene más de dos partes.
 */
function partesNombre(texto) {
  const s = String(texto).trim()
  const partes = []
  let actual = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '`' || ch === '"') {
      let j = i + 1
      let v = ''
      for (;;) {
        if (j >= s.length) return null
        if (s[j] === ch) {
          if (s[j + 1] === ch) {
            v += ch
            j += 2
            continue
          }
          break
        }
        v += s[j++]
      }
      actual += v
      i = j + 1
      continue
    }
    if (ch === '.') {
      partes.push(actual.trim())
      actual = ''
      i++
      continue
    }
    actual += ch
    i++
  }
  partes.push(actual.trim())
  if (partes.length > 2 || partes.some((p) => p === '')) return null
  return partes
}

/** La base y la tabla de un nombre de `describe`: con una parte, la base de la sesión. */
function baseYTabla(tabla) {
  const p = partesNombre(tabla)
  if (!p) throw new Error(`No se entiende el nombre «${tabla}»: usa tabla o base.tabla (con \`acentos graves\` si lleva puntos).`)
  return p.length === 2 ? { base: p[0], tabla: p[1] } : { base: null, tabla: p[0] }
}

/** La condición de la base: la nombrada, o la de la sesión (`DATABASE()`). */
function condicionBase(columna, base) {
  return base === null ? { sql: `${columna} = DATABASE()`, valores: [] } : { sql: `${columna} = ?`, valores: [base] }
}

async function banner(s) {
  const [f] = await filasDe(s, 'SELECT VERSION() AS v, @@version_comment AS c')
  return f ? `${f.v}${f.c ? ` (${f.c})` : ''}` : '(desconocido)'
}

/**
 * Las tablas y vistas de la base de la sesión; sin base, las de TODAS las bases que no son del
 * sistema, con su nombre de dos partes (`base.tabla`).
 */
async function tablas(s) {
  const [b] = await filasDe(s, 'SELECT DATABASE() AS b')
  const sinBase = !b || b.b === null
  return filasDe(
    s,
    [
      `SELECT ${sinBase ? "CONCAT(t.TABLE_SCHEMA, '.', t.TABLE_NAME)" : 't.TABLE_NAME'} AS TABLE_NAME,`,
      '       (SELECT COUNT(*) FROM information_schema.COLUMNS c',
      '         WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS COLUMNAS,',
      "       NULLIF(t.TABLE_COMMENT, '') AS COMENTARIO",
      '  FROM information_schema.TABLES t',
      ` WHERE ${sinBase ? `t.TABLE_SCHEMA NOT IN ${SISTEMA}` : 't.TABLE_SCHEMA = DATABASE()'}`,
      ' ORDER BY 1'
    ].join('\n')
  )
}

/** Las columnas de una tabla (`tabla` o `base.tabla`), con el tipo tal como se escribió. */
async function columnas(s, tabla) {
  const n = baseYTabla(tabla)
  const b = condicionBase('c.TABLE_SCHEMA', n.base)
  return filasDe(
    s,
    [
      'SELECT c.COLUMN_NAME, c.COLUMN_TYPE AS DATA_TYPE,',
      "       CASE c.IS_NULLABLE WHEN 'YES' THEN 'Y' ELSE 'N' END AS NULLABLE,",
      "       CASE WHEN c.EXTRA LIKE '%auto_increment%' THEN 'AUTO_INCREMENT' ELSE c.COLUMN_DEFAULT END AS DATA_DEFAULT,",
      "       NULLIF(c.COLUMN_COMMENT, '') AS COMENTARIO,",
      "       CASE c.COLUMN_KEY WHEN 'PRI' THEN 'Y' ELSE 'N' END AS ES_PK",
      '  FROM information_schema.COLUMNS c',
      ` WHERE ${b.sql} AND c.TABLE_NAME = ?`,
      ' ORDER BY c.ORDINAL_POSITION'
    ].join('\n'),
    [...b.valores, n.tabla]
  )
}

/** Las claves foráneas de la base de la sesión, o las de una tabla (las que salen de ella). */
async function foraneas(s, tabla) {
  const n = tabla ? baseYTabla(tabla) : { base: null, tabla: null }
  const b = condicionBase('k.TABLE_SCHEMA', n.base)
  const deTabla = n.tabla !== null
  return filasDe(
    s,
    [
      'SELECT k.TABLE_NAME AS ORIGEN, k.COLUMN_NAME AS COL_ORIGEN,',
      "       CONCAT(k.REFERENCED_TABLE_SCHEMA, '.', k.REFERENCED_TABLE_NAME) AS DESTINO,",
      '       k.REFERENCED_COLUMN_NAME AS COL_DESTINO, k.CONSTRAINT_NAME AS RESTRICCION',
      '  FROM information_schema.KEY_COLUMN_USAGE k',
      ` WHERE ${b.sql} AND k.REFERENCED_TABLE_NAME IS NOT NULL${deTabla ? ' AND k.TABLE_NAME = ?' : ''}`,
      ' ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION'
    ].join('\n'),
    [...b.valores, ...(deTabla ? [n.tabla] : [])]
  )
}

/** Los índices de una tabla: nombre, columnas en orden, si es único, si es la PK y si es de prefijo. */
async function indices(s, tabla) {
  const n = baseYTabla(tabla)
  const b = condicionBase('TABLE_SCHEMA', n.base)
  return filasDe(
    s,
    [
      'SELECT INDEX_NAME AS INDICE,',
      "       GROUP_CONCAT(COALESCE(COLUMN_NAME, '(expresión)') ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS COLUMNAS,",
      "       CASE WHEN MIN(NON_UNIQUE) = 0 THEN 'sí' ELSE 'no' END AS UNICO,",
      "       CASE WHEN INDEX_NAME = 'PRIMARY' THEN 'PK' ELSE MIN(INDEX_TYPE) END AS ORIGEN,",
      "       CASE WHEN MAX(SUB_PART) IS NULL THEN '' ELSE 'prefijo' END AS PARCIAL",
      '  FROM information_schema.STATISTICS',
      ` WHERE ${b.sql} AND TABLE_NAME = ?`,
      ' GROUP BY INDEX_NAME ORDER BY 1'
    ].join('\n'),
    [...b.valores, n.tabla]
  )
}

/** Las sesiones del mismo usuario en el servidor. */
async function sesiones(s) {
  return filasDe(
    s,
    [
      'SELECT ID AS SID, USER AS USERNAME, COALESCE(DB, \'\') AS MODULE, COMMAND AS STATUS, TIME AS DESDE',
      '  FROM information_schema.PROCESSLIST',
      " WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)",
      ' ORDER BY ID'
    ].join('\n')
  )
}

module.exports = { banner, tablas, columnas, foraneas, indices, sesiones, partesNombre, baseYTabla }
