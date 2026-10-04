// =============================================================================
// El catálogo de SQL Server para `tdb` (`describe`, `schema`, `ls`, `sessions`): nombres de una,
// dos o tres partes entre [corchetes] o "comillas", las consultas a `sys.*` sin STRING_AGG ni
// funciones que no tenga SQL Server 2012 (FOR XML PATH), y las bases a las que llega el usuario.
// Pieza de `sqlserver.cjs`, que reexporta todo. Con tres partes las consultas van a `[base].sys.*`.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-solo-lectura.md
// =============================================================================

'use strict'

const comun = require('./sqlserverComun.cjs')
const { ejecutar, errorTdb } = require('./peticionSqlserver.cjs')

/** Las filas de una consulta INTERNA (con parámetros), como objetos. Lanza el error de `tdb`. */
async function filasDe(c, sql, parametros) {
  const r = await ejecutar(c.tds, sql, { parametros: parametros || [] })
  if (r.error) throw errorTdb(r.error, c.con)
  const conjunto = r.conjuntos[r.conjuntos.length - 1]
  return conjunto ? conjunto.filas : []
}

/** `[nombre]` con los `]` doblados: un nombre de base que no se puede pasar como parámetro. */
function corchetes(nombre) {
  return `[${String(nombre).replace(/]/g, ']]')}]`
}

/** Lee lo que hay entre corchetes o comillas que se abren en `i`: `{ valor, fin }`, o null si no se cierran. */
function leerCitadoSimple(s, i) {
  const cierre = s[i] === '[' ? ']' : '"'
  let j = i + 1
  let v = ''
  while (j < s.length) {
    if (s[j] === cierre) {
      if (s[j + 1] === cierre) {
        v += cierre
        j += 2
        continue
      }
      return { valor: v, fin: j + 1 }
    }
    v += s[j++]
  }
  return null
}

/**
 * Las partes de un nombre de objeto (`base.esquema.tabla`, con [corchetes]]] o "comillas""), sin
 * sus comillas; una parte vacía (`base..tabla`) es ''. null si el nombre no se entiende.
 */
function partesNombre(texto) {
  const s = String(texto).trim()
  const partes = []
  let actual = ''
  let i = 0
  let citada = false
  while (i < s.length) {
    const ch = s[i]
    if (ch === '[' || ch === '"') {
      const q = leerCitadoSimple(s, i)
      if (!q) return null
      actual += q.valor
      citada = true
      i = q.fin
      continue
    }
    if (ch === '.') {
      partes.push(citada ? actual : actual.trim())
      actual = ''
      citada = false
      i++
      continue
    }
    actual += ch
    i++
  }
  partes.push(citada ? actual : actual.trim())
  if (partes.length === 0 || partes.length > 3 || partes[partes.length - 1] === '') return null
  return partes
}

/**
 * Resuelve un nombre de tabla o vista: `{ bd, id, esquema, nombre }` (`bd` es el prefijo
 * `[base].` o ''), o null si no existe. Un nombre de una parte se busca en el esquema por
 * defecto del usuario, después en `dbo`, y si solo existe en otro esquema, ahí; si está en
 * varios, se pide cuál. Lanza si el nombre no se entiende.
 */
async function resolverObjeto(c, texto) {
  if (c.resueltos.has(texto)) return c.resueltos.get(texto)
  const partes = partesNombre(texto)
  if (!partes) {
    throw new Error(`No se entiende el nombre "${texto}": escribe tabla, esquema.tabla o base.esquema.tabla (con [corchetes] si hace falta).`)
  }
  const nombre = partes[partes.length - 1]
  const esquema = partes.length >= 2 && partes[partes.length - 2] !== '' ? partes[partes.length - 2] : null
  const base = partes.length === 3 && partes[0] !== '' ? partes[0] : null
  const bd = base ? `${corchetes(base)}.` : ''
  const filas = await filasDe(
    c,
    `SELECT TOP (3) o.object_id AS ID, s.name AS ESQUEMA, o.name AS NOMBRE,
            CASE WHEN s.name = SCHEMA_NAME() THEN 0 WHEN s.name = N'dbo' THEN 1 ELSE 2 END AS RANGO
       FROM ${bd}sys.all_objects AS o
       JOIN ${bd}sys.schemas AS s ON s.schema_id = o.schema_id
      WHERE o.name = @nombre
        AND (@esquema IS NULL OR s.name = @esquema)
        AND o.type IN ('U', 'V', 'S', 'IT', 'TF', 'IF', 'ET')
      ORDER BY RANGO, s.name`,
    [
      { nombre: 'nombre', valor: nombre },
      { nombre: 'esquema', valor: esquema }
    ]
  )
  let r = null
  if (filas.length > 0) {
    const [a, b] = filas
    if (esquema === null && a.RANGO === 2 && b) {
      throw new Error(
        `"${nombre}" está en varios esquemas (${filas.map((f) => `${f.ESQUEMA}.${f.NOMBRE}`).join(', ')}): di cuál con esquema.${nombre}.`
      )
    }
    r = { bd, id: a.ID, esquema: a.ESQUEMA, nombre: a.NOMBRE }
  }
  c.resueltos.set(texto, r)
  return r
}

/** El tipo como se escribe (`nvarchar(50)`, `decimal(10,2)`, `varchar(max)`, `datetime2(7)`). */
function tipoEscrito(f) {
  const t = String(f.TIPO)
  const largo = Number(f.LARGO)
  switch (t) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return `${t}(${largo === -1 ? 'max' : largo})`
    case 'nchar':
    case 'nvarchar':
      return `${t}(${largo === -1 ? 'max' : largo / 2})`
    case 'decimal':
    case 'numeric':
      return `${t}(${f.PRECISION},${f.ESCALA})`
    case 'datetime2':
    case 'time':
    case 'datetimeoffset':
      return `${t}(${f.ESCALA})`
    default:
      return t
  }
}

/** Quita los paréntesis de fuera que SQL Server pone a los valores por defecto: `((0))` → `0`. */
function sinParentesis(texto) {
  let s = String(texto)
  for (;;) {
    if (!(s.startsWith('(') && s.endsWith(')'))) return s
    // Solo si el de fuera se cierra en el último carácter.
    let prof = 0
    let cierra = -1
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') prof++
      else if (s[i] === ')') {
        prof--
        if (prof === 0) {
          cierra = i
          break
        }
      }
    }
    if (cierra !== s.length - 1) return s
    s = s.slice(1, -1)
  }
}

async function banner(c) {
  const [f] = await filasDe(
    c,
    `SELECT @@VERSION AS V,
            CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS VERSION,
            CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS EDICION,
            DB_NAME() AS BASE,
            SUSER_SNAME() AS USUARIO`
  )
  if (!f) return 'SQL Server (desconocido)'
  const t = comun.tlsDe(c.con)
  const mayor = Number(String(f.VERSION || '').split('.')[0])
  const partes = [String(f.V || '').split('\n')[0].trim(), f.EDICION, `base ${f.BASE}${c.con.database ? '' : ' (la de por defecto del usuario: la conexión no fija base)'}`, `como ${f.USUARIO}`]
  partes.push(t.cifrar ? (t.confiarCertificado ? 'cifrada, certificado sin verificar' : 'cifrada') : 'sin cifrar')
  partes.push(c.soloLectura ? 'solo lectura (la impone Tessera)' : 'lectura y escritura')
  if (Number.isFinite(mayor) && mayor < 11) partes.push('versión anterior a SQL Server 2012: Tessera no la admite')
  return partes.filter(Boolean).join(' · ')
}

/** Tablas y vistas de la base ACTUAL, como `esquema.nombre`. */
async function tablas(c) {
  return filasDe(
    c,
    `SELECT s.name + N'.' + o.name AS TABLE_NAME,
            (SELECT COUNT(*) FROM sys.columns AS x WHERE x.object_id = o.object_id) AS COLUMNAS,
            CASE WHEN o.type = 'V' THEN N'vista' ELSE N'' END
              + CASE WHEN ep.value IS NULL THEN N''
                     WHEN o.type = 'V' THEN N' · ' + CAST(ep.value AS nvarchar(4000))
                     ELSE CAST(ep.value AS nvarchar(4000)) END AS COMENTARIO
       FROM sys.objects AS o
       JOIN sys.schemas AS s ON s.schema_id = o.schema_id
       LEFT JOIN sys.extended_properties AS ep
              ON ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = N'MS_Description'
      WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
      ORDER BY s.name, o.name`
  )
}

/** Columnas de una tabla o vista con la forma de los otros adaptadores ([] si no existe). */
async function columnas(c, tabla) {
  const obj = await resolverObjeto(c, tabla)
  if (!obj) return []
  const bd = obj.bd
  const filas = await filasDe(
    c,
    `SELECT col.name AS COLUMN_NAME,
            t.name AS TIPO, col.max_length AS LARGO, col.precision AS PRECISION, col.scale AS ESCALA,
            CASE WHEN col.is_nullable = 1 THEN 'Y' ELSE 'N' END AS NULLABLE,
            dc.definition AS DATA_DEFAULT,
            CAST(ep.value AS nvarchar(4000)) AS DESCRIPCION,
            CASE WHEN col.is_identity = 1 THEN N'IDENTITY(' + CAST(ic.seed_value AS nvarchar(40)) + N',' + CAST(ic.increment_value AS nvarchar(40)) + N')' END AS IDENTIDAD,
            cc.definition AS CALCULADA,
            CASE WHEN EXISTS (SELECT 1 FROM ${bd}sys.indexes AS i
                                JOIN ${bd}sys.index_columns AS ixc ON ixc.object_id = i.object_id AND ixc.index_id = i.index_id
                               WHERE i.object_id = col.object_id AND i.is_primary_key = 1 AND ixc.column_id = col.column_id)
                 THEN 'Y' ELSE 'N' END AS ES_PK
       FROM ${bd}sys.all_columns AS col
       JOIN ${bd}sys.types AS t ON t.user_type_id = col.user_type_id
       LEFT JOIN ${bd}sys.default_constraints AS dc ON dc.object_id = col.default_object_id
       LEFT JOIN ${bd}sys.identity_columns AS ic ON ic.object_id = col.object_id AND ic.column_id = col.column_id
       LEFT JOIN ${bd}sys.computed_columns AS cc ON cc.object_id = col.object_id AND cc.column_id = col.column_id
       LEFT JOIN ${bd}sys.extended_properties AS ep
              ON ep.class = 1 AND ep.major_id = col.object_id AND ep.minor_id = col.column_id AND ep.name = N'MS_Description'
      WHERE col.object_id = @id
      ORDER BY col.column_id`,
    [{ nombre: 'id', tipo: 'int', valor: obj.id }]
  )
  return filas.map((f) => ({
    COLUMN_NAME: f.COLUMN_NAME,
    // Ya escrito entero: `tipoLegible` de `tdb.cjs` lo pinta tal cual (sin DATA_PRECISION).
    DATA_TYPE: tipoEscrito(f),
    NULLABLE: f.NULLABLE,
    DATA_DEFAULT: f.DATA_DEFAULT === null ? null : sinParentesis(f.DATA_DEFAULT),
    COMENTARIO: [f.IDENTIDAD, f.CALCULADA !== null ? `calculada: ${sinParentesis(f.CALCULADA)}` : null, f.DESCRIPCION].filter(Boolean).join(' · '),
    ES_PK: f.ES_PK
  }))
}

/** Claves foráneas: de una tabla (`tabla`), o de toda la base actual (`tabla` null). */
async function foraneas(c, tabla) {
  let bd = ''
  let id = null
  if (tabla !== null && tabla !== undefined) {
    const obj = await resolverObjeto(c, tabla)
    if (!obj) return []
    bd = obj.bd
    id = obj.id
  }
  return filasDe(
    c,
    `SELECT so.name + N'.' + po.name AS ORIGEN,
            pc.name AS COL_ORIGEN,
            sr.name + N'.' + ro.name AS DESTINO,
            rc.name AS COL_DESTINO,
            fk.name AS RESTRICCION,
            fk.delete_referential_action_desc AS AL_BORRAR
       FROM ${bd}sys.foreign_keys AS fk
       JOIN ${bd}sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
       JOIN ${bd}sys.objects AS po ON po.object_id = fk.parent_object_id
       JOIN ${bd}sys.schemas AS so ON so.schema_id = po.schema_id
       JOIN ${bd}sys.columns AS pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN ${bd}sys.objects AS ro ON ro.object_id = fk.referenced_object_id
       JOIN ${bd}sys.schemas AS sr ON sr.schema_id = ro.schema_id
       JOIN ${bd}sys.columns AS rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      WHERE (@id IS NULL OR fk.parent_object_id = @id)
      ORDER BY so.name, po.name, fk.name, fkc.constraint_column_id`,
    [{ nombre: 'id', tipo: 'int', valor: id }]
  )
}

/** Índices de una tabla, con sus columnas en orden (sin las INCLUDE). */
async function indices(c, tabla) {
  const obj = await resolverObjeto(c, tabla)
  if (!obj) return []
  const bd = obj.bd
  return filasDe(
    c,
    `SELECT i.name AS INDICE,
            STUFF((SELECT N', ' + col.name + CASE WHEN ixc.is_descending_key = 1 THEN N' DESC' ELSE N'' END
                     FROM ${bd}sys.index_columns AS ixc
                     JOIN ${bd}sys.all_columns AS col ON col.object_id = ixc.object_id AND col.column_id = ixc.column_id
                    WHERE ixc.object_id = i.object_id AND ixc.index_id = i.index_id AND ixc.is_included_column = 0
                    ORDER BY ixc.key_ordinal
                      FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') AS COLUMNAS,
            CASE WHEN i.is_unique = 1 THEN N'sí' ELSE N'' END AS UNICO,
            CASE WHEN i.is_primary_key = 1 THEN N'PRIMARY KEY' WHEN i.is_unique_constraint = 1 THEN N'UNIQUE' ELSE N'CREATE INDEX' END
              + CASE WHEN i.type = 1 THEN N' (CLUSTERED)' WHEN i.type IN (5, 6) THEN N' (COLUMNSTORE)' ELSE N'' END AS ORIGEN,
            CASE WHEN i.has_filter = 1 THEN N'sí' ELSE N'' END AS PARCIAL
       FROM ${bd}sys.indexes AS i
      WHERE i.object_id = @id AND i.type > 0
      ORDER BY i.name`,
    [{ nombre: 'id', tipo: 'int', valor: obj.id }]
  )
}

/**
 * Las bases a las que llega el usuario (`HAS_DBACCESS`), sin las del sistema, y cuál es la
 * actual: para `tdb schema` de una conexión SIN base fija.
 */
async function bases(c) {
  const filas = await filasDe(
    c,
    `SELECT d.name AS BASE,
            d.state_desc AS ESTADO,
            CASE WHEN d.name = DB_NAME() THEN N'◄ actual' ELSE N'' END AS ACTUAL
       FROM sys.databases AS d
      WHERE d.database_id > 4 AND HAS_DBACCESS(d.name) = 1
      ORDER BY d.name`
  )
  const [actual] = await filasDe(c, 'SELECT DB_NAME() AS BASE')
  return { actual: actual ? actual.BASE : null, bases: filas }
}

/**
 * Las sesiones del usuario. Sin VIEW SERVER STATE el servidor solo enseña la PROPIA, y así lo
 * dice `tdb sessions` (es lo mismo que ve el explorador).
 */
async function sesiones(c) {
  return filasDe(
    c,
    `SELECT s.session_id AS SID,
            s.login_name AS USERNAME,
            s.program_name AS MODULE,
            DB_NAME(s.database_id) AS BASE,
            s.status AS STATUS,
            CONVERT(varchar(19), s.login_time, 120) AS DESDE
       FROM sys.dm_exec_sessions AS s
      WHERE s.is_user_process = 1 AND s.login_name = SUSER_SNAME()
      ORDER BY s.login_time, s.session_id`
  )
}

module.exports = { partesNombre, tipoEscrito, sinParentesis, banner, tablas, columnas, foraneas, indices, bases, sesiones }
