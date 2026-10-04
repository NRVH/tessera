#!/usr/bin/env node
// =============================================================================
// Prueba de TAPAR CONTRASEÑAS antes de guardar en el historial (npm run test:sql-secretos).
// (node src/shared/sql/test-sql-secretos.mts)
// Oracle (`IDENTIFIED BY`, `VALUES`, `REPLACE`), PG (`PASSWORD`), `password=` en cadenas y MITADES NEGATIVAS: sin
// contraseña, columnas y comentarios, un bind, y el texto sin nada que tapar (el MISMO objeto).
// =============================================================================

import { SECRETO_TAPADO, taparSecretosSql } from './secretosSql.ts'

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

function igual(nombre: string, entrada: string, d: 'oracle' | 'postgres', esperado: string): void {
  const r = taparSecretosSql(entrada, d)
  check(nombre, r === esperado, JSON.stringify(r))
}

function main(): void {
  hr('(1) Oracle: IDENTIFIED BY')
  igual('CREATE USER … IDENTIFIED BY palabra', 'CREATE USER ana IDENTIFIED BY Secreto1', 'oracle', 'CREATE USER ana IDENTIFIED BY ***')
  igual(
    'citada: conserva las comillas',
    'create user ana identified by "p@ss w0rd" default tablespace users',
    'oracle',
    'create user ana identified by "***" default tablespace users'
  )
  igual(
    'IDENTIFIED BY VALUES con el hash',
    "ALTER USER ana IDENTIFIED BY VALUES 'S:0123ABCD;H:FFEE'",
    'oracle',
    "ALTER USER ana IDENTIFIED BY VALUES '***'"
  )
  igual(
    'REPLACE: también la contraseña vieja',
    'ALTER USER ana IDENTIFIED BY Nueva1 REPLACE Vieja1',
    'oracle',
    'ALTER USER ana IDENTIFIED BY *** REPLACE ***'
  )
  igual(
    'CREATE DATABASE LINK … CONNECT TO u IDENTIFIED BY …',
    "CREATE DATABASE LINK l CONNECT TO u IDENTIFIED BY clave USING 'tns'",
    'oracle',
    "CREATE DATABASE LINK l CONNECT TO u IDENTIFIED BY *** USING 'tns'"
  )
  igual('GRANT … IDENTIFIED BY (sintaxis antigua)', 'GRANT CONNECT TO ana IDENTIFIED BY clave', 'oracle', 'GRANT CONNECT TO ana IDENTIFIED BY ***')
  igual(
    'con comentarios en medio',
    'CREATE USER ana IDENTIFIED /* c */ BY -- x\n  Clave9',
    'oracle',
    'CREATE USER ana IDENTIFIED /* c */ BY -- x\n  ***'
  )
  igual('dos en un texto', 'ALTER USER a IDENTIFIED BY x1;\nALTER USER b IDENTIFIED BY x2', 'oracle', 'ALTER USER a IDENTIFIED BY ***;\nALTER USER b IDENTIFIED BY ***')
  // Sin comillas y con símbolos el léxico la parte en varios tokens; Oracle la rechaza,
  // pero llegó al servidor y se anota: antes quedaba `***!2024`.
  igual('sin comillas y con símbolos: TODA', 'ALTER USER a IDENTIFIED BY Secr3t!2024 ACCOUNT UNLOCK', 'oracle', 'ALTER USER a IDENTIFIED BY *** ACCOUNT UNLOCK')
  igual('`p@ss` y `123abc`: enteras', 'CREATE USER a IDENTIFIED BY p@ss;\nCREATE USER b IDENTIFIED BY 123abc', 'oracle', 'CREATE USER a IDENTIFIED BY ***;\nCREATE USER b IDENTIFIED BY ***')
  igual('REPLACE con la vieja partida', 'ALTER USER a IDENTIFIED BY n-1 REPLACE v-1', 'oracle', 'ALTER USER a IDENTIFIED BY *** REPLACE ***')
  igual('NEGATIVO: el `;` pegado no se tapa', 'ALTER USER a IDENTIFIED BY clave;', 'oracle', 'ALTER USER a IDENTIFIED BY ***;')

  hr('(2) PG: PASSWORD')
  igual("CREATE ROLE … PASSWORD '…'", "CREATE ROLE ana LOGIN PASSWORD 'secreto'", 'postgres', "CREATE ROLE ana LOGIN PASSWORD '***'")
  igual("ALTER USER … WITH ENCRYPTED PASSWORD '…'", "alter user ana with encrypted password 'md5abc'", 'postgres', "alter user ana with encrypted password '***'")
  igual(
    "USER MAPPING … OPTIONS (user 'u', password 'p')",
    "CREATE USER MAPPING FOR ana SERVER s OPTIONS (user 'u', password 'p4ss')",
    'postgres',
    "CREATE USER MAPPING FOR ana SERVER s OPTIONS (user 'u', password '***')"
  )
  igual("E'…' también", "CREATE ROLE ana PASSWORD E'con\\'comilla'", 'postgres', "CREATE ROLE ana PASSWORD '***'")

  hr('(3) password= dentro de una cadena de conexión')
  igual(
    "dblink_connect('host=… password=…')",
    "SELECT dblink_connect('c', 'host=db user=u password=s3cr3t dbname=x')",
    'postgres',
    "SELECT dblink_connect('c', 'host=db user=u password=*** dbname=x')"
  )
  igual("con espacios y ';'", "SELECT f('Server=x;Password = abc;Db=y')", 'oracle', "SELECT f('Server=x;Password = ***;Db=y')")
  // El valor entre comillas de libpq: antes la regex no casaba y la contraseña ENTERA iba al historial.
  igual(
    "valor entre comillas de libpq (`''…''` en una cadena SQL)",
    "SELECT dblink_connect('host=h password=''sec reto'' dbname=d')",
    'postgres',
    "SELECT dblink_connect('host=h password=''***'' dbname=d')"
  )
  igual(
    "en una E'…' (`\\'…\\'`)",
    "SELECT dblink_connect(E'host=h password=\\'sec reto\\' dbname=d')",
    'postgres',
    "SELECT dblink_connect(E'host=h password=\\'***\\' dbname=d')"
  )
  igual("en un `$$…$$` (`'…'`)", "SELECT dblink_connect($$host=h password='sec reto' dbname=d$$)", 'postgres', "SELECT dblink_connect($$host=h password='***' dbname=d$$)")
  // La forma URL de la misma contraseña: antes iba entera al historial.
  igual(
    'URI de conexión: usuario:clave@host',
    "SELECT dblink_connect('c', 'postgresql://ana:s3cr3t@db:5432/x')",
    'postgres',
    "SELECT dblink_connect('c', 'postgresql://ana:***@db:5432/x')"
  )
  igual('URI de Oracle también', "SELECT f('oracle://u:p4ss!@h/svc') FROM dual", 'oracle', "SELECT f('oracle://u:***@h/svc') FROM dual")
  igual(
    'NEGATIVO: una URI sin usuario conserva el puerto',
    "SELECT dblink_connect('c', 'postgresql://db:5432/x')",
    'postgres',
    "SELECT dblink_connect('c', 'postgresql://db:5432/x')"
  )
  igual("NEGATIVO: una URL http sin credenciales", "SELECT 'https://ejemplo.com/a:b' FROM dual", 'oracle', "SELECT 'https://ejemplo.com/a:b' FROM dual")

  hr('(4) Mitades negativas: nada que tapar')
  const iguales: Array<[string, string, 'oracle' | 'postgres']> = [
    ['IDENTIFIED EXTERNALLY', 'CREATE USER ops$ana IDENTIFIED EXTERNALLY', 'oracle'],
    ["IDENTIFIED GLOBALLY AS 'cn=…' (no es una contraseña)", "CREATE USER ana IDENTIFIED GLOBALLY AS 'cn=ana,o=x'", 'oracle'],
    ['IDENTIFIED BY :bind (el valor no está en el texto)', 'ALTER USER ana IDENTIFIED BY :clave', 'oracle'],
    ['PASSWORD NULL', 'ALTER ROLE ana PASSWORD NULL', 'postgres'],
    ['PASSWORD EXPIRE (Oracle)', 'ALTER USER ana PASSWORD EXPIRE', 'oracle'],
    ['una columna password en un SELECT', 'SELECT password, usuario FROM cuentas WHERE id = 1', 'postgres'],
    ["UPDATE … SET password = 'x' (datos, no la credencial)", "UPDATE cuentas SET password = 'x' WHERE id = 1", 'postgres'],
    ['en un comentario', "SELECT 1 FROM dual -- identified by secreto\n/* password 'x' */", 'oracle'],
    ["en una cadena sin password=", "SELECT 'identified by secreto' FROM dual", 'oracle'],
    ['texto normal', 'SELECT * FROM t WHERE a = 1', 'oracle']
  ]
  for (const [nombre, sql, d] of iguales) {
    const r = taparSecretosSql(sql, d)
    check(nombre, r === sql && !r.includes(SECRETO_TAPADO), JSON.stringify(r))
  }
  const intacto = 'SELECT 1 FROM dual'
  check('sin nada que tapar devuelve el MISMO texto', taparSecretosSql(intacto, 'oracle') === intacto, 'idéntico')
  // q-quote de Oracle: la cadena entera es una sola.
  igual("q'[…]' detrás de IDENTIFIED BY (es una cadena)", "ALTER USER a IDENTIFIED BY q'[x'y]'", 'oracle', "ALTER USER a IDENTIFIED BY '***'")

  hr('RESULTADO')
  const pasan = results.filter((r) => r.pass).length
  const todas = pasan === results.length
  for (const r of results) if (!r.pass) console.log(`  FAIL: ${r.name}`)
  hr(`VEREDICTO: ${pasan}/${results.length} PASS — ${todas ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(todas ? 0 : 1)
}

main()
