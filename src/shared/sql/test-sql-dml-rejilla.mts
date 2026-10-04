#!/usr/bin/env node
// =============================================================================
// Prueba del DML de «Enviar» y de la confirmación de producción (node src/shared/sql/test-sql-dml-rejilla.mts).
// Fija UPDATE/INSERT/DELETE por PK y por ROWID con binds de cada motor y la vista con literales, los errores, que la
// ejecución no lleve ni un literal del usuario, `requiereConfirmacionProduccion` con sus negativas, `columnas`, la
// concurrencia optimista (`originales`), los nombres que SQL*Plus rompe y de qué cuelga cada decisión del motor.
// =============================================================================

import { COLUMNA_ROWID, ErrorDml, sentenciaDeCambio, vistaPreviaDml, vistaTerminada } from './dmlRejilla.ts'
import { bloqueEjecutarOracle } from '../escrituraSql/oracle.ts'
import { MOTORES } from '../motores/index.ts'
import { REGLAS } from './dialectosSql.ts'
import { requiereConfirmacionProduccion } from './produccionSql.ts'
import { dividirSentencias } from './divisorSql.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ErrorDml ? e.message : `OTRO: ${String(e)}`
  }
}

const OBJ = { esquema: 'HR', nombre: 'EMP' }
const PK = { tipo: 'pk' as const, columnas: ['ID'] }

function main(): void {
  hr('(1) Por PK')
  const up = sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'actualizar', clave: ['7'], valores: { NOMBRE: 'Ana', ALTA: '2024-01-02 03:04:05' } }, { ALTA: 'fechaHora', NOMBRE: 'texto' })
  check('Oracle UPDATE con binds :n y nombres citados', up.sql === 'UPDATE "HR"."EMP" SET "NOMBRE" = :1, "ALTA" = :2 WHERE "ID" = :3', up.sql)
  check('los binds en su orden (la clave al final)', j(up.binds) === j(['Ana', '2024-01-02 03:04:05', '7']), j(up.binds))
  check(
    'la vista con literales (fecha con TO_DATE)',
    up.vista === `UPDATE "HR"."EMP" SET "NOMBRE" = 'Ana', "ALTA" = TO_DATE('2024-01-02 03:04:05', 'YYYY-MM-DD HH24:MI:SS') WHERE "ID" = '7'`,
    up.vista
  )
  const upPg = sentenciaDeCambio('postgres', { esquema: 'public', nombre: 'emp' }, { tipo: 'pk', columnas: ['id', 'Tipo'] }, { tipo: 'actualizar', clave: ['1', 'a'], valores: { nota: null } })
  check('PG: $n, PK compuesta y NULL', upPg.sql === 'UPDATE "public"."emp" SET "nota" = $1 WHERE "id" = $2 AND "Tipo" = $3' && j(upPg.binds) === j([null, '1', 'a']), `${upPg.sql} ${j(upPg.binds)}`)
  check('la vista de un NULL es NULL', upPg.vista.includes('"nota" = NULL'), upPg.vista)
  const ins = sentenciaDeCambio('postgres', { esquema: 'public', nombre: 'emp' }, PK, { tipo: 'insertar', valores: { id: '9', nombre: "O'Brien" } })
  check('INSERT con su lista de columnas', ins.sql === 'INSERT INTO "public"."emp" ("id", "nombre") VALUES ($1, $2)' && j(ins.binds) === j(['9', "O'Brien"]), ins.sql)
  check("la vista duplica la comilla", ins.vista.endsWith(`VALUES ('9', 'O''Brien')`), ins.vista)
  const del = sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'borrar', clave: ['7'] })
  check('DELETE por PK', del.sql === 'DELETE FROM "HR"."EMP" WHERE "ID" = :1' && j(del.binds) === j(['7']), del.sql)
  const numVista = sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'actualizar', clave: ['7'], valores: { SUELDO: '1234.5' } }, { SUELDO: 'numero' }).vista
  check('un número va sin comillas en la vista', numVista.includes('"SUELDO" = 1234.5'), numVista)
  const boolClave = sentenciaDeCambio('postgres', OBJ, { tipo: 'pk', columnas: ['ACTIVO'] }, { tipo: 'borrar', clave: [true] })
  check('una clave booleana va como texto', j(boolClave.binds) === j(['true']), j(boolClave.binds))

  hr('(2) ROWID')
  const rid = sentenciaDeCambio('oracle', OBJ, { tipo: 'rowid', columna: '__TESSERA_ROWID' }, { tipo: 'actualizar', clave: ['AAAR3sAAEAAAACXAAA'], valores: { NOMBRE: 'x' } })
  check('WHERE ROWID = :n', rid.sql === 'UPDATE "HR"."EMP" SET "NOMBRE" = :1 WHERE ROWID = :2' && rid.binds[1] === 'AAAR3sAAEAAAACXAAA', rid.sql)
  check('NEGATIVO: ROWID en PG lanza', lanza(() => sentenciaDeCambio('postgres', OBJ, { tipo: 'rowid', columna: 'x' }, { tipo: 'borrar', clave: ['a'] })) !== null, 'lanza')
  // SQLite declara 'rowid', y el mensaje (sacado del registro, para
  // esto) lo nombra sin que nadie lo toque.
  check(
    'el mensaje sale del registro: «ROWID solo existe en Oracle y SQLite.»',
    lanza(() => sentenciaDeCambio('postgres', OBJ, { tipo: 'rowid', columna: 'x' }, { tipo: 'borrar', clave: ['a'] })) === 'ROWID solo existe en Oracle y SQLite.',
    String(lanza(() => sentenciaDeCambio('postgres', OBJ, { tipo: 'rowid', columna: 'x' }, { tipo: 'borrar', clave: ['a'] })))
  )

  hr('(3) Errores')
  check("identidad 'ninguna' lanza con su motivo", lanza(() => sentenciaDeCambio('postgres', OBJ, { tipo: 'ninguna', motivo: 'Sin clave primaria.' }, { tipo: 'borrar', clave: [] })) === 'Sin clave primaria.', 'ok')
  check('clave con NULL lanza', (lanza(() => sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'borrar', clave: [null] })) ?? '').includes('NULL'), 'ok')
  check('clave que no cuadra lanza', lanza(() => sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'borrar', clave: ['1', '2'] })) !== null, 'ok')
  check('UPDATE sin celdas lanza', lanza(() => sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'actualizar', clave: ['1'], valores: {} })) !== null, 'ok')
  check('INSERT vacío en Oracle lanza', lanza(() => sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'insertar', valores: {} })) !== null, 'ok')
  const def = sentenciaDeCambio('postgres', { esquema: 'public', nombre: 't' }, PK, { tipo: 'insertar', valores: {} })
  check('INSERT vacío en PG: DEFAULT VALUES', def.sql === 'INSERT INTO "public"."t" DEFAULT VALUES' && def.binds.length === 0, def.sql)

  hr('(4) Lo del usuario nunca entra en el SQL que se ejecuta')
  const malo = "x'; DROP TABLE emp; --"
  const iny = sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'actualizar', clave: ["1' OR '1'='1"], valores: { NOMBRE: malo } })
  check('ni el valor ni la clave aparecen en el SQL ejecutado', !iny.sql.includes('DROP') && !iny.sql.includes("OR '1'"), iny.sql)
  check('van en los binds tal cual', j(iny.binds) === j([malo, "1' OR '1'='1"]), j(iny.binds))
  const colRara = sentenciaDeCambio('postgres', OBJ, PK, { tipo: 'actualizar', clave: ['1'], valores: { 'a"b': 'v' } })
  check('un nombre de columna con comillas se cita duplicándolas', colRara.sql.includes('"a""b" = $1'), colRara.sql)
  const vista = vistaPreviaDml('postgres', OBJ, PK, [
    { tipo: 'insertar', valores: { ID: '1' } },
    { tipo: 'borrar', clave: ['2'] }
  ])
  check('la vista previa: una sentencia por línea con `;`', vista.split('\n').length === 2 && vista.split('\n').every((l) => l.endsWith(';')), vista)
  // En Oracle el salto de un valor sale como CHR(10) (el literal que acepta SQL*Plus, ver
  // `formatosFilas.ts`), así que la vista sigue siendo una sentencia por línea.
  const vistaSalto = vistaPreviaDml('oracle', OBJ, PK, [
    { tipo: 'actualizar', clave: ['1'], valores: { NOTA: 'uno\ndos;' } },
    { tipo: 'borrar', clave: ['2'] }
  ])
  check(
    'Oracle: un valor con saltos no parte la vista previa (CHR(10) fuera del literal)',
    vistaSalto.split('\n').length === 2 && vistaSalto.startsWith(`UPDATE "HR"."EMP" SET "NOTA" = 'uno' || CHR(10) || 'dos;' WHERE`),
    vistaSalto
  )

  hr('(5) Confirmación de producción')
  const pide = (sql: string, d: 'oracle' | 'postgres'): boolean => requiereConfirmacionProduccion(dividirSentencias(sql, d)[0])
  const si: Array<[string, 'oracle' | 'postgres']> = [
    ['update t set a = 1', 'oracle'],
    ['insert into t values (1)', 'postgres'],
    ['delete from t', 'oracle'],
    ['create table x (a int)', 'postgres'],
    ['begin null; end;', 'oracle'],
    ['call p()', 'postgres'],
    ['commit', 'oracle'],
    ['end', 'postgres'],
    ['select * from t for update', 'oracle'],
    ['lock table t in exclusive mode', 'oracle'],
    ['grant select on t to u', 'oracle']
  ]
  for (const [sql, d] of si) check(`pide: ${sql} (${d})`, pide(sql, d), 'sí')
  const no: Array<[string, 'oracle' | 'postgres']> = [
    ['select * from t', 'oracle'],
    ['with c as (select 1) select * from c', 'postgres'],
    ['rollback', 'oracle'],
    ['savepoint a', 'postgres'],
    ['begin', 'postgres'],
    ["alter session set current_schema = hr", 'oracle'],
    ['set search_path to x', 'postgres']
  ]
  for (const [sql, d] of no) check(`NEGATIVO no pide: ${sql} (${d})`, !pide(sql, d), 'no')

  hr('(6) A qué columna va cada bind (lo usa el main para el CLOB y las claves binarias)')
  check('UPDATE: las del SET y después las de la clave, en el orden de los binds', j(up.columnas) === j(['NOMBRE', 'ALTA', 'ID']) && up.columnas.length === up.binds.length, j(up.columnas))
  check('PK compuesta de PG', j(upPg.columnas) === j(['nota', 'id', 'Tipo']), j(upPg.columnas))
  check('INSERT: las de la lista', j(ins.columnas) === j(['id', 'nombre']), j(ins.columnas))
  check('DELETE: solo la clave', j(del.columnas) === j(['ID']), j(del.columnas))
  check('ROWID: null (no es una columna)', j(rid.columnas) === j(['NOMBRE', null]), j(rid.columnas))
  check('NEGATIVO: INSERT DEFAULT VALUES no tiene ninguna', def.columnas.length === 0 && def.binds.length === 0, j(def.columnas))

  hr('(7) Concurrencia optimista: los valores leídos van al WHERE (`originales`)')
  const RID = { tipo: 'rowid' as const, columna: COLUMNA_ROWID }
  const occ = sentenciaDeCambio(
    'oracle',
    OBJ,
    RID,
    {
      tipo: 'actualizar',
      clave: ['AAAR3sAAEAAAACXAAA'],
      valores: { NOMBRE: 'Luis' },
      originales: { NOMBRE: 'Ana', SUELDO: '0.5', NOTA: null, ALTA: '2024-01-02 00:00:00', min: 'x' }
    },
    { SUELDO: 'numero', ALTA: 'fechaHora' }
  )
  check(
    'Oracle: `"COL" = :n` tras la identidad, binds numerados después del SET y del ROWID, NULL como IS NULL sin bind',
    occ.sql ===
      'UPDATE "HR"."EMP" SET "NOMBRE" = :1 WHERE ROWID = :2 AND "NOMBRE" = :3 AND "SUELDO" = :4 AND "NOTA" IS NULL AND "ALTA" = :5 AND "min" = :6',
    occ.sql
  )
  check(
    'los binds de los originales, en su orden y como TEXTO (fecha y número incluidos)',
    j(occ.binds) === j(['Luis', 'AAAR3sAAEAAAACXAAA', 'Ana', '0.5', '2024-01-02 00:00:00', 'x']),
    j(occ.binds)
  )
  check(
    '`columnas` sigue paralelo a los binds: la de cada original es la columna con la que se compara',
    j(occ.columnas) === j(['NOMBRE', null, 'NOMBRE', 'SUELDO', 'ALTA', 'min']) && occ.columnas.length === occ.binds.length,
    j(occ.columnas)
  )
  check(
    'la vista previa enseña el WHERE COMPLETO con sus literales (número sin comillas, fecha con TO_DATE)',
    occ.vista ===
      `UPDATE "HR"."EMP" SET "NOMBRE" = 'Luis' WHERE ROWID = 'AAAR3sAAEAAAACXAAA' AND "NOMBRE" = 'Ana' AND "SUELDO" = 0.5 AND "NOTA" IS NULL AND "ALTA" = TO_DATE('2024-01-02 00:00:00', 'YYYY-MM-DD HH24:MI:SS') AND "min" = 'x'`,
    occ.vista
  )
  check(
    'NEGATIVO: nada de DECODE (compara el TO_CHAR de la columna: medido, un NUMBER 0.5 no casa consigo mismo)',
    !occ.sql.includes('DECODE') && !occ.sql.includes('DISTINCT'),
    occ.sql
  )
  const occDel = sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { ID: '7' } })
  check(
    'DELETE por ROWID con originales',
    occDel.sql === 'DELETE FROM "HR"."EMP" WHERE ROWID = :1 AND "ID" = :2' && j(occDel.binds) === j(['AAAR3sAAEAAAACXAAA', '7']) && j(occDel.columnas) === j([null, 'ID']),
    `${occDel.sql} ${j(occDel.binds)}`
  )
  const vacioOra = sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { V: '' } })
  check(
    "Oracle: un original '' va como IS NULL (allí '' ES NULL y `= ''` no casa nunca)",
    vacioOra.sql === 'DELETE FROM "HR"."EMP" WHERE ROWID = :1 AND "V" IS NULL' && vacioOra.binds.length === 1,
    `${vacioOra.sql} ${j(vacioOra.binds)}`
  )
  const occPg = sentenciaDeCambio(
    'postgres',
    { esquema: 'public', nombre: 'emp' },
    { tipo: 'pk', columnas: ['id', 'Tipo'] },
    { tipo: 'actualizar', clave: ['1', 'a'], valores: { nota: 'n' }, originales: { 'a"b': 'q"x', nota: null, vacia: '' } }
  )
  check(
    'PG: $n tras el SET y la PK compuesta, columna con comillas en el nombre citada, NULL como IS NULL',
    occPg.sql === 'UPDATE "public"."emp" SET "nota" = $1 WHERE "id" = $2 AND "Tipo" = $3 AND "a""b" = $4 AND "nota" IS NULL AND "vacia" = $5',
    occPg.sql
  )
  check(
    "NEGATIVO PG: '' NO es NULL en PostgreSQL, así que se compara como valor",
    j(occPg.binds) === j(['n', '1', 'a', 'q"x', '']) && j(occPg.columnas) === j(['nota', 'id', 'Tipo', 'a"b', 'vacia']),
    `${j(occPg.binds)} ${j(occPg.columnas)}`
  )
  check(
    'PG: la vista con el nombre citado y el valor con su comilla',
    occPg.vista.endsWith(`WHERE "id" = '1' AND "Tipo" = 'a' AND "a""b" = 'q"x' AND "nota" IS NULL AND "vacia" = ''`),
    occPg.vista
  )
  const conRowid = sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { [COLUMNA_ROWID]: 'AAAR3sAAEAAAACXAAA', ID: '7' } })
  check(
    'la columna oculta del ROWID en los originales se salta (no existe en la tabla: ORA-00904)',
    conRowid.sql === 'DELETE FROM "HR"."EMP" WHERE ROWID = :1 AND "ID" = :2' && !conRowid.sql.includes(COLUMNA_ROWID),
    conRowid.sql
  )
  const occIny = sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { NOMBRE: "x' OR '1'='1" } })
  check('un original malicioso va en su bind, nunca en el SQL que se ejecuta', !occIny.sql.includes("OR '1'") && occIny.binds[1] === "x' OR '1'='1", occIny.sql)
  const booleano = sentenciaDeCambio('postgres', OBJ, PK, { tipo: 'borrar', clave: ['1'], originales: { ACTIVO: true as unknown as string } })
  check('un original booleano (por IPC) se escribe como la clave', j(booleano.binds) === j(['1', 'true']), j(booleano.binds))
  check(
    'NEGATIVO: un original que no es texto ni NULL lanza, no se adivina su formato',
    (lanza(() => sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { N: 5 as unknown as string } })) ?? '').includes('«N»'),
    String(lanza(() => sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { N: 5 as unknown as string } })))
  )
  const sinOrig = sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'actualizar', clave: ['AAAR3sAAEAAAACXAAA'], valores: { NOMBRE: 'x' }, originales: {} })
  check('NEGATIVO: `originales` vacío = la sentencia de siempre', sinOrig.sql === rid.sql && j(sinOrig.binds) === j(rid.binds), sinOrig.sql)
  const previa = vistaPreviaDml('oracle', OBJ, RID, [
    { tipo: 'borrar', clave: ['AAAR3sAAEAAAACXAAA'], originales: { ID: '7', NOTA: null } }
  ], { ID: 'numero' })
  check(
    '`vistaPreviaDml` también lleva las comprobaciones de concurrencia',
    previa === `DELETE FROM "HR"."EMP" WHERE ROWID = 'AAAR3sAAEAAAACXAAA' AND "ID" = 7 AND "NOTA" IS NULL;`,
    previa
  )
  // Oracle no compara un CLOB con `=` (ORA-00932, medido en la 11.2 y
  // la 21c), así que un VARCHAR2 de más de 1000 caracteres en el WHERE de la vista no
  // puede ir en TO_CLOB como en el SET: la vista previa fallaba al correrla a mano.
  const largo = 'L'.repeat(1500)
  const occLargo = sentenciaDeCambio('oracle', OBJ, RID, {
    tipo: 'actualizar',
    clave: ['AAAR3sAAEAAAACXAAA'],
    valores: { NOTA: largo },
    originales: { NOTA: largo }
  })
  const [setLargo, whereLargo] = occLargo.vista.split(' WHERE ')
  check(
    'Oracle: un original de más de 1000 caracteres va en el WHERE SIN TO_CLOB (y el mismo valor en el SET, con él)',
    setLargo.includes('TO_CLOB(') && !whereLargo.includes('TO_CLOB') && whereLargo.includes(`"NOTA" = '${'L'.repeat(1000)}' || '${'L'.repeat(500)}'`),
    `SET ${setLargo.slice(0, 40)}… WHERE ${whereLargo.slice(0, 60)}…`
  )
  const pkLarga = sentenciaDeCambio('oracle', OBJ, { tipo: 'pk', columnas: ['COD'] }, { tipo: 'borrar', clave: [largo] })
  check('Oracle: la CLAVE larga en el WHERE, tampoco en TO_CLOB', !pkLarga.vista.includes('TO_CLOB') && j(pkLarga.binds) === j([largo]), pkLarga.vista.slice(0, 60))

  hr('(8) Nombres que SQL*Plus rompe: la vista previa en un bloque')
  // MEDIDO con el SQL*Plus de la 11.2 y de la 21c:
  // la vista previa copiada, con un nombre con un salto (una línea que acaba en `;`, una `/`
  // o un `.` solos, una línea en blanco) daba ORA-01740 y SP2-0042 y no borraba la fila; con
  // un `&` en el nombre, SQL*Plus pedía un valor y el UPDATE fallaba con ORA-00904. En bloque
  // con EXECUTE IMMEDIATE, las cuatro sentencias aplicadas. Lo que se EJECUTA no cambia.
  const LF = String.fromCharCode(10)
  const CR = String.fromCharCode(13)
  const OBJ_S = { esquema: 'HR', nombre: 'E' + LF + 'MP' }
  const upS = sentenciaDeCambio('oracle', OBJ_S, PK, { tipo: 'actualizar', clave: ['7'], valores: { ['X' + CR + 'Y']: 'Ana' } })
  const planaS = 'UPDATE "HR"."E' + LF + 'MP" SET "X' + CR + 'Y" = \'Ana\' WHERE "ID" = \'7\''
  check(
    'Oracle, un salto en el nombre de la TABLA o de una COLUMNA: la vista es el bloque de esa sentencia (`bloqueEjecutarOracle`), terminado en `/`',
    upS.vista === bloqueEjecutarOracle(planaS) && upS.terminador === '\n/' && vistaTerminada(upS) === bloqueEjecutarOracle(planaS) + '\n/',
    j(upS.vista.slice(0, 60))
  )
  check(
    'lo que se EJECUTA no cambia: el mismo SQL con binds, con los nombres crudos (el driver no pasa por SQL*Plus)',
    upS.sql === 'UPDATE "HR"."E' + LF + 'MP" SET "X' + CR + 'Y" = :1 WHERE "ID" = :2' && j(upS.binds) === j(['Ana', '7']) && j(upS.columnas) === j(['X' + CR + 'Y', 'ID']),
    j(upS.sql)
  )
  const occS = sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'borrar', clave: ['7'], originales: { ['N;' + LF + '/']: null } })
  check('también un nombre que solo sale en los ORIGINALES (su `IS NULL`, sin bind)', occS.terminador === '\n/' && occS.vista.startsWith('BEGIN\n'), j(occS.vista.slice(0, 40)))
  const amp = sentenciaDeCambio('oracle', { esquema: 'HR', nombre: 'I+D&T' }, PK, { tipo: 'insertar', valores: { ID: '1' } })
  check(
    'un `&` en un nombre también (la vista previa no tiene dónde poner un SET DEFINE OFF): bloque',
    amp.terminador === '\n/' && amp.vista === bloqueEjecutarOracle('INSERT INTO "HR"."I+D&T" ("ID") VALUES (\'1\')'),
    j(amp.vista)
  )
  const pgS = sentenciaDeCambio('postgres', OBJ_S, PK, { tipo: 'actualizar', clave: ['7'], valores: { ['X' + CR + 'Y']: 'Ana' } })
  check('NEGATIVO PG: la sentencia de siempre, con `;` (psql lee las comillas)', pgS.terminador === ';' && pgS.vista.startsWith('UPDATE "HR"."E' + LF + 'MP"'), j(pgS.vista))
  const tabS = sentenciaDeCambio('oracle', { esquema: 'HR', nombre: 'E\tMP' }, PK, { tipo: 'borrar', clave: ['7'] })
  check('NEGATIVO: un TABULADOR en un nombre no es un salto (medido): la sentencia de siempre', tabS.terminador === ';' && tabS.vista === 'DELETE FROM "HR"."E\tMP" WHERE "ID" = \'7\'', j(tabS.vista))
  const normal = sentenciaDeCambio('oracle', OBJ, PK, { tipo: 'borrar', clave: ['7'] })
  check('NEGATIVO: los nombres de siempre, la sentencia de siempre con `;`', normal.terminador === ';' && vistaTerminada(normal) === 'DELETE FROM "HR"."EMP" WHERE "ID" = \'7\';', vistaTerminada(normal))
  const previaS = vistaPreviaDml('oracle', OBJ_S, PK, [
    { tipo: 'borrar', clave: ['1'] },
    { tipo: 'actualizar', clave: ['2'], valores: { V: 'x;' + LF + '/' } }
  ])
  const trozos = dividirSentencias(previaS, 'oracle')
  check(
    'la vista previa junta cada sentencia con su terminador, y el divisor de la consola la parte en las mismas (dos bloques)',
    trozos.length === 2 && trozos.every((t) => t.terminador === 'barra') && previaS.endsWith('END;\n/'),
    trozos.map((t) => t.terminador).join(',')
  )

  hr('(9) Por motor, sin banderas ajenas ni nombres a mano')
  // Se cambian valores del registro EN EJECUCIÓN, para ver de qué cuelga cada decisión, y se
  // restauran siempre. Con el código de antes, las tres mitades fallan.
  const TAB_AMP = { esquema: 'HR', nombre: 'I+D&T' }
  const reglasOracle = REGLAS.oracle.barraTermina
  const reglasPg = REGLAS.postgres.barraTermina
  try {
    // La vista en bloque NO cuelga de `barraTermina` (una bandera LÉXICA): con la bandera
    // cambiada en los dos motores, cada uno enseña lo suyo.
    REGLAS.oracle.barraTermina = false
    REGLAS.postgres.barraTermina = true
    const o = sentenciaDeCambio('oracle', TAB_AMP, PK, { tipo: 'borrar', clave: ['1'] })
    const p = sentenciaDeCambio('postgres', { esquema: 'public', nombre: 'e' + LF + 'mp' }, PK, { tipo: 'borrar', clave: ['1'] })
    check('Oracle sin `barraTermina`: el nombre con `&` sigue yendo en su bloque (lo decide su módulo)', o.terminador === '\n/' && o.vista.startsWith('BEGIN\n'), j(o.vista.slice(0, 30)))
    check('PG con `barraTermina`: la sentencia de siempre con `;` (tampoco la hereda)', p.terminador === ';' && p.vista.startsWith('DELETE FROM'), j(p.vista.slice(0, 30)))
  } finally {
    REGLAS.oracle.barraTermina = reglasOracle
    REGLAS.postgres.barraTermina = reglasPg
  }
  const sesionOracle = MOTORES.oracle.sesion.identidadSinPk
  const sesionPg = MOTORES.postgres.sesion.identidadSinPk
  const sesionSqlite = MOTORES.sqlite.sesion.identidadSinPk
  try {
    // SQLite fuera del juego de papeles de abajo: sin ROWID mientras dura.
    MOTORES.sqlite.sesion.identidadSinPk = 'unicaNoNula'
    // Un TERCER valor de `identidadSinPk` no cae en la rama «no tiene ROWID»: el `switch`
    // con `nunca` lanza (y el compilador lo habría marcado antes).
    ;(MOTORES.postgres.sesion as { identidadSinPk: string }).identidadSinPk = 'ninguna'
    const tercero = lanza(() => sentenciaDeCambio('postgres', OBJ, RID, { tipo: 'borrar', clave: ['a'] }))
    check(
      'un valor nuevo de identidadSinPk no se toma por «sin ROWID»: lanza el `nunca`',
      tercero === 'OTRO: Error: Caso sin contemplar en identificaPorRowid: «ninguna»',
      String(tercero)
    )
    // El mensaje nombra a los motores con ROWID desde el REGISTRO: con los papeles
    // cambiados, dice el otro nombre.
    MOTORES.oracle.sesion.identidadSinPk = 'unicaNoNula'
    MOTORES.postgres.sesion.identidadSinPk = 'rowid'
    const cambiado = lanza(() => sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['a'] }))
    check('el mensaje sale del registro, no escrito a mano: «ROWID solo existe en PostgreSQL.»', cambiado === 'ROWID solo existe en PostgreSQL.', String(cambiado))
    const pgRid = sentenciaDeCambio('postgres', OBJ, RID, { tipo: 'borrar', clave: ['a'] })
    check('y el motor que declara ROWID lo usa (con su marcador de bind)', pgRid.sql === 'DELETE FROM "HR"."EMP" WHERE ROWID = $1', pgRid.sql)
    // Sin NINGÚN motor con ROWID, la frase no se queda a medias («…existe en .»).
    MOTORES.postgres.sesion.identidadSinPk = 'unicaNoNula'
    const ninguno = lanza(() => sentenciaDeCambio('oracle', OBJ, RID, { tipo: 'borrar', clave: ['a'] }))
    check('sin ningún motor con ROWID: una frase entera, no «ROWID solo existe en .»', ninguno === 'Ningún motor identifica las filas por su ROWID.', String(ninguno))
  } finally {
    MOTORES.oracle.sesion.identidadSinPk = sesionOracle
    MOTORES.postgres.sesion.identidadSinPk = sesionPg
    MOTORES.sqlite.sesion.identidadSinPk = sesionSqlite
  }
  check(
    'restaurado: todo vuelve a ser lo de siempre',
    REGLAS.oracle.barraTermina === true && MOTORES.oracle.sesion.identidadSinPk === 'rowid' && MOTORES.postgres.sesion.identidadSinPk === 'unicaNoNula',
    ''
  )

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
