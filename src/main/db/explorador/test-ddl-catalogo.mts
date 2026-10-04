#!/usr/bin/env node
// =============================================================================
// Prueba de «Ver DDL»: el SQL y los generadores puros de `ddlCatalogo.ts`, sin base de datos.
// (node src/main/db/explorador/test-ddl-catalogo.mts)
// Fija el bloque de DBMS_METADATA, `limpiarDdlOracle`, los fallos que se repliegan, el DDL
// reconstruido de Oracle, PostgreSQL (tablas, particiones, herencia, vistas, tipos) y el `leerDdl`
// de cada motor con un lector falso. Contra servidores: `test-db-postgres.mts` y `test-db-oracle.mts`.
// =============================================================================

import type { DbColumnaInfo, DbIndiceInfo, DbRefObjeto, DbRestriccionInfo } from '../../../shared/db-explorador-ipc.ts'
import type { LectorDdl } from './motores/catalogo.ts'
import { CATALOGO_ORACLE } from './motores/catalogoOracle.ts'
import { CATALOGO_POSTGRES } from './motores/catalogoPostgres.ts'
import type { DialectoCatalogo, FilaCatalogo } from './motores/tipos.ts'
import { FalloTrabajador, type SalidaTextoTrabajador } from './protocoloTrabajador.ts'
import {
  avisoRepliegue,
  ddlDesdeFuenteOracle,
  ddlRutinaPg,
  ddlSecuenciaOracle,
  ddlSecuenciaPg,
  ddlSinonimoOracle,
  ddlTablaOracleDesdeCatalogo,
  ddlTablaPg,
  ddlTipoPg,
  ddlVistaPg,
  limpiarDdlOracle,
  literalCadena,
  mapearRelacionPg,
  motivoRepliegueDdl,
  sqlDdlOracle,
  sqlRelacionPg,
  sqlSecuenciaPg,
  sqlTipoPg,
  tieneDdlOracle,
  tieneDdlPg,
  TOPE_DDL
} from './ddlCatalogo.ts'

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

function col(nombre: string, tipo: string, extra: Partial<DbColumnaInfo> = {}): DbColumnaInfo {
  return { nombre, posicion: 1, tipo, nullable: true, pk: null, ...extra }
}

const j = (x: unknown): string => JSON.stringify(x)

async function main(): Promise<void> {
  hr('(1) El bloque de DBMS_METADATA')
  {
    const b = sqlDdlOracle({ esquema: 'HR', nombre: 'EMP', tipo: 'tabla' })
    check('tabla: TABLE, esquema y nombre por bind, nunca en el texto', b.binds.tipo === 'TABLE' && b.binds.esq === 'HR' && b.binds.obj === 'EMP' && !/\bEMP\b/.test(b.sql), JSON.stringify(b.binds))
    check('un solo bloque con la transformación de SESIÓN y el CLOB por bind :ddl', /^DECLARE/.test(b.sql) && /SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE/.test(b.sql) && /'SEGMENT_ATTRIBUTES', FALSE/.test(b.sql) && /:ddl := h;/.test(b.sql), 'ok')
    check('índices: los que NO respaldan una PK o UNIQUE (esos ya van en el CREATE TABLE)', /NOT EXISTS \(SELECT 1 FROM all_constraints k/.test(b.sql) && /constraint_type IN \('P', 'U'\)/.test(b.sql), 'ok')
    check('comentarios: ORA-31608 (no hay) no es un error', /SQLCODE <> -31608/.test(b.sql), 'ok')
    const r = sqlDdlOracle({ esquema: 'HR', nombre: 'P', tipo: 'rutina' })
    check('rutina: sin tipo, lo resuelve el bloque en ALL_OBJECTS', r.binds.tipo === null && /object_type IN \('PROCEDURE', 'FUNCTION'\)/.test(r.sql), JSON.stringify(r.binds))
    check('sin FETCH/OFFSET (la 11.2 no los tiene)', !/\bFETCH\b|\bOFFSET\b/i.test(b.sql), 'ok')
    const tipos = { tabla: 'TABLE', vista: 'VIEW', vistaMaterializada: 'MATERIALIZED_VIEW', paquete: 'PACKAGE', secuencia: 'SEQUENCE', sinonimo: 'SYNONYM', tipoObjeto: 'TYPE', tipoColeccion: 'TYPE', disparador: 'TRIGGER' } as const
    const mal = Object.entries(tipos).filter(([t, m]) => sqlDdlOracle({ esquema: 'E', nombre: 'N', tipo: t as keyof typeof tipos }).binds.tipo !== m)
    check('cada tipo del árbol de Oracle con el suyo de DBMS_METADATA', mal.length === 0 && tieneDdlOracle('rutina') && !tieneDdlOracle('tipo'), mal.join(','))
    check('PG tiene DDL de todos sus tipos del árbol', ['tabla', 'tablaForanea', 'vista', 'vistaMaterializada', 'secuencia', 'rutina', 'tipo'].every((t) => tieneDdlPg(t as never)) && !tieneDdlPg('paquete'), 'ok')
  }

  hr('(2) limpiarDdlOracle con la salida REAL de una 21c')
  {
    const tabla =
      '\n  CREATE TABLE "TESSERA"."SD_PED" \n   (\t"ID" NUMBER, \n\t"CLI_ID" NUMBER, \n\t PRIMARY KEY ("ID")\n  USING INDEX  ENABLE\n   ) ;\n' +
      '\n  CREATE INDEX "TESSERA"."SD_PED_CLI" ON "TESSERA"."SD_PED" ("CLI_ID") \n  ;\n' +
      '\n   COMMENT ON COLUMN "TESSERA"."SD_PED"."ID" IS \'x\';\n   COMMENT ON TABLE "TESSERA"."SD_PED"  IS \'y\';\n'
    const l = limpiarDdlOracle(tabla)
    const lineas = l.split('\n')
    check('la primera sentencia empieza sin sangría', lineas[0] === 'CREATE TABLE "TESSERA"."SD_PED"', JSON.stringify(lineas[0]))
    check('el cuerpo del CREATE TABLE conserva su sangrado', lineas[1] === '   (\t"ID" NUMBER,', JSON.stringify(lineas[1]))
    check('el ; que sale solo en su línea se pega al índice', l.includes('ON "TESSERA"."SD_PED" ("CLI_ID");'), l)
    check('cada sentencia separada por UNA línea en blanco, y los COMMENT sin sangría', /\) ;\n\nCREATE INDEX/.test(l) && /;\n\nCOMMENT ON COLUMN/.test(l) && /;\nCOMMENT ON TABLE/.test(l) === false, JSON.stringify(l))
    check('sin blancos al final de línea', lineas.every((x) => x === x.replace(/\s+$/, '')), 'ok')
    const paquete =
      '\n  CREATE OR REPLACE EDITIONABLE PACKAGE "T"."P" AS PROCEDURE p; END;\n/\n\n  CREATE OR REPLACE EDITIONABLE PACKAGE BODY "T"."P" AS\n  PROCEDURE p IS\n  BEGIN\n    NULL;\n  END;\nEND;\n/'
    const lp = limpiarDdlOracle(paquete)
    check(
      'paquete: spec y cuerpo, cada uno tras su /, y el cuerpo con su sangrado intacto',
      lp === 'CREATE OR REPLACE EDITIONABLE PACKAGE "T"."P" AS PROCEDURE p; END;\n/\n\nCREATE OR REPLACE EDITIONABLE PACKAGE BODY "T"."P" AS\n  PROCEDURE p IS\n  BEGIN\n    NULL;\n  END;\nEND;\n/',
      JSON.stringify(lp)
    )
    const disparador = '\n  CREATE OR REPLACE TRIGGER "T"."TR" BEFORE INSERT ON X FOR EACH ROW BEGIN NULL; END;\n/\nALTER TRIGGER "T"."TR" ENABLE;'
    check('disparador: el ALTER … ENABLE tras la / es otra sentencia', limpiarDdlOracle(disparador).endsWith('/\n\nALTER TRIGGER "T"."TR" ENABLE;'), JSON.stringify(limpiarDdlOracle(disparador)))

    // El cuerpo de una unidad de PL/SQL es la fuente de SOURCE$ y sale ÍNTEGRO: líneas
    // vacías entre procedimientos, un literal con una línea vacía, otro con blancos
    // finales y un EXECUTE IMMEDIATE cuyo literal tiene un CREATE tras un `;`. El
    // paquete y la vista son lo que devolvió de verdad una 21c; allí, recompilar desde
    // el DDL limpio dejó USER_SOURCE igual línea a línea (salvo la 1, que Oracle
    // reescribe con el nombre citado de la cabecera, limpio o no).
    const cuerpo = [
      '  PROCEDURE p1 IS',
      "    v VARCHAR2(20) := 'a",
      '',
      "b';",
      "    w VARCHAR2(20) := 'x   ",
      "y';",
      '  BEGIN',
      "    EXECUTE IMMEDIATE 'BEGIN NULL; END;",
      "      CREATE TABLE x (a NUMBER)';",
      '  END;',
      '',
      '',
      '  PROCEDURE p2 IS',
      '  BEGIN',
      '    NULL;   ',
      '  END;',
      'END;'
    ].join('\n')
    const cabeza = 'CREATE OR REPLACE EDITIONABLE PACKAGE BODY "TESSERA"."H10_PKG" AS'
    const conHuecos = limpiarDdlOracle(`\n  ${cabeza}\n${cuerpo}\n/`)
    check('PL/SQL: el cuerpo sale idéntico byte a byte (solo cambia la sangría del CREATE)', conHuecos === `${cabeza}\n${cuerpo}\n/`, JSON.stringify(conHuecos))
    check("PL/SQL: el literal 'a' + línea vacía + 'b' conserva su línea vacía", conHuecos.includes(":= 'a\n\nb';"), JSON.stringify(conHuecos))
    check('PL/SQL: el literal con blancos finales los conserva', conHuecos.includes(":= 'x   \ny';"), JSON.stringify(conHuecos))
    check(
      'PL/SQL: la línea del literal que empieza por CREATE tras un ; no se re-sangra ni se separa',
      conHuecos.includes("'BEGIN NULL; END;\n      CREATE TABLE x (a NUMBER)';"),
      JSON.stringify(conHuecos)
    )
    const lineaNull = (s: string): number => s.split('\n').findIndex((x) => x.trim() === 'NULL;')
    check(
      'PL/SQL: la numeración cuadra con la fuente (NULL; en la línea 16 de la unidad, como en USER_SOURCE)',
      lineaNull(conHuecos) + 1 === 16 && lineaNull(`${cabeza}\n${cuerpo}`) + 1 === 16,
      String(lineaNull(conHuecos) + 1)
    )
    const espec = 'CREATE OR REPLACE EDITIONABLE PACKAGE "TESSERA"."H10_PKG" AS\n  PROCEDURE p1;\n\n  PROCEDURE p2;\nEND;'
    const dosUnidades = limpiarDdlOracle(`\n  ${espec}\n/\n${cabeza}\n${cuerpo}\n/`)
    check(
      'PL/SQL (21c real): especificación y cuerpo, cada uno íntegro y separados por UNA línea en blanco',
      dosUnidades === `${espec}\n/\n\n${cabeza}\n${cuerpo}\n/`,
      JSON.stringify(dosUnidades)
    )
    const vista = limpiarDdlOracle('\n  CREATE OR REPLACE FORCE EDITIONABLE VIEW "TESSERA"."H10_V" ("A", "B") AS \n  SELECT 1 AS a,\n\n       2 AS b FROM dual;')
    check('vista (21c real): la línea vacía DENTRO de su consulta se queda', vista === 'CREATE OR REPLACE FORCE EDITIONABLE VIEW "TESSERA"."H10_V" ("A", "B") AS\n  SELECT 1 AS a,\n\n       2 AS b FROM dual;', JSON.stringify(vista))
    // La mitad negativa: ENTRE sentencias, varias líneas vacías dan exactamente UNA.
    const entre = limpiarDdlOracle('\n  CREATE TABLE "T"."A" ("X" NUMBER) ;\n\n\n\n   COMMENT ON TABLE "T"."A"  IS \'a\';\n\n\n')
    check('entre sentencias, varias líneas vacías dan exactamente UNA (y ninguna al final)', entre === 'CREATE TABLE "T"."A" ("X" NUMBER) ;\n\nCOMMENT ON TABLE "T"."A"  IS \'a\';', JSON.stringify(entre))
    const puntoTrasHueco = limpiarDdlOracle('\n  CREATE INDEX "T"."I" ON "T"."A" ("X") \n\n  ;\n')
    check('el ; suelto se pega a la última línea CON texto aunque haya una vacía entre medias', puntoTrasHueco === 'CREATE INDEX "T"."I" ON "T"."A" ("X");', JSON.stringify(puntoTrasHueco))
  }

  hr('(3) Qué fallos de DBMS_METADATA se repliegan')
  {
    const casos: Array<[string | undefined, string, boolean]> = [
      ['ORA-31603', 'ORA-31603: object "T" of type TABLE not found in schema "HR"', true],
      ['ORA-39212', 'ORA-39212: installation error: XSL stylesheets not loaded correctly', true],
      ['ORA-06502', 'ORA-06502: PL/SQL: numeric or value error\nORA-31605: the following was returned from LpxXSLResetAllVars', true],
      ['ORA-01031', 'ORA-01031: insufficient privileges', true],
      ['ORA-06550', "ORA-06550: line 1\nPLS-00201: identifier 'DBMS_METADATA.GET_DDL' must be declared", true],
      ['ORA-01403', 'ORA-01403: no data found', true],
      ['ORA-00942', 'ORA-00942: table or view does not exist', false],
      ['ORA-03113', 'ORA-03113: end-of-file on communication channel', false],
      [undefined, 'algo raro', false]
    ]
    const mal = casos.filter(([c, m, esperado]) => (motivoRepliegueDdl(c, m) !== null) !== esperado)
    check('se repliegan los medidos (31603, 39212/31605, 1031, PLS-00201, 1403); no una pérdida ni lo demás', mal.length === 0, mal.map((x) => x[0]).join(','))
    const aviso = avisoRepliegue(motivoRepliegueDdl('ORA-31603', 'x') ?? '', 'tabla')
    check('el aviso dice por qué y qué falta', /SELECT_CATALOG_ROLE/.test(aviso) && /sin restricciones CHECK/.test(aviso), aviso)
  }

  hr('(4) Repliegue de Oracle desde el catálogo')
  {
    const t = ddlTablaOracleDesdeCatalogo({
      esquema: 'HR',
      nombre: 'CLI',
      columnas: [
        col('ID', 'NUMBER(10)', { nullable: false, pk: 1 }),
        col('NOMBRE', 'VARCHAR2(40 CHAR)', { nullable: false, porDefecto: "'x'", comentario: "De O'Brien" }),
        col('EMAIL', 'VARCHAR2(100)')
      ],
      restricciones: [
        { nombre: 'CLI_PK', tipo: 'pk', columnas: ['ID'] },
        { nombre: 'SYS_C0012', tipo: 'unica', columnas: ['EMAIL'] },
        { nombre: 'CLI_FK', tipo: 'fk', columnas: ['ID'], referencia: { esquema: 'HR', tabla: 'OTRA', columnas: ['ID'] } }
      ],
      indices: [
        { nombre: 'CLI_PK', unico: true, columnas: ['ID'] },
        { nombre: 'SYS_C0012', unico: true, columnas: ['EMAIL'] },
        { nombre: 'CLI_IX', unico: false, columnas: ['NOMBRE', 'EMAIL'] }
      ],
      comentario: 'Clientes'
    })
    check('columnas con DEFAULT y NOT NULL', t.includes(`  "NOMBRE" VARCHAR2(40 CHAR) DEFAULT 'x' NOT NULL,`) && t.includes('  "ID" NUMBER(10) NOT NULL,'), t)
    check('PK con nombre; la UNIQUE de nombre de sistema (SYS_C…) sin él', t.includes('CONSTRAINT "CLI_PK" PRIMARY KEY ("ID")') && t.includes('  UNIQUE ("EMAIL")') && !t.includes('SYS_C0012'), t)
    check('FK con su referencia calificada', t.includes('CONSTRAINT "CLI_FK" FOREIGN KEY ("ID") REFERENCES "HR"."OTRA" ("ID")'), t)
    check('solo el índice que no respalda una restricción', t.includes('CREATE INDEX "HR"."CLI_IX" ON "HR"."CLI" ("NOMBRE", "EMAIL");') && !t.includes('INDEX "HR"."CLI_PK"'), t)
    check("comentarios con la comilla duplicada", t.includes(`COMMENT ON TABLE "HR"."CLI" IS 'Clientes';`) && t.includes(`COMMENT ON COLUMN "HR"."CLI"."NOMBRE" IS 'De O''Brien';`), t)
    const s = ddlSecuenciaOracle('HR', 'SQ', [['1', '9999999999999999999999999999', '5', 'N', 'N', '0', '10']])
    check('secuencia: START WITH el siguiente, NOCACHE con 0, NOORDER y NOCYCLE', s === 'CREATE SEQUENCE "HR"."SQ"\n  MINVALUE 1\n  MAXVALUE 9999999999999999999999999999\n  INCREMENT BY 5\n  START WITH 10\n  NOCACHE\n  NOORDER\n  NOCYCLE;', JSON.stringify(s))
    check('secuencia que no se ve -> null', ddlSecuenciaOracle('HR', 'SQ', []) === null, 'null')
    check('sinónimo privado', ddlSinonimoOracle('HR', 'S', { esquema: 'HR', nombre: 'CLI', dblink: null }) === 'CREATE SYNONYM "HR"."S" FOR "HR"."CLI";', '')
    check('sinónimo PUBLIC', ddlSinonimoOracle('PUBLIC', 'DUAL', { esquema: 'SYS', nombre: 'DUAL', dblink: null }) === 'CREATE PUBLIC SYNONYM "DUAL" FOR "SYS"."DUAL";', '')
    check('sinónimo remoto con su @enlace', ddlSinonimoOracle('HR', 'R', { esquema: '', nombre: 'EMP', dblink: 'REMOTO.EMPRESA.COM' }) === 'CREATE SYNONYM "HR"."R" FOR "EMP"@REMOTO.EMPRESA.COM;', '')
    const vista = ddlDesdeFuenteOracle('vista', { partes: [{ titulo: 'Definición', texto: 'CREATE OR REPLACE VIEW "HR"."V" AS\nselect 1 from dual  ' }], origen: 'ALL_VIEWS' })
    check('vista desde su fuente: con ;', vista === 'CREATE OR REPLACE VIEW "HR"."V" AS\nselect 1 from dual;', JSON.stringify(vista))
    const pkg = ddlDesdeFuenteOracle('paquete', {
      partes: [
        { titulo: 'Especificación', texto: 'CREATE OR REPLACE PACKAGE p AS\nEND p;\n' },
        { titulo: 'Cuerpo', texto: 'CREATE OR REPLACE PACKAGE BODY p AS\nEND p;' }
      ],
      origen: 'ALL_SOURCE'
    })
    check('PL/SQL desde su fuente: cada parte con su /', pkg === 'CREATE OR REPLACE PACKAGE p AS\nEND p;\n/\n\nCREATE OR REPLACE PACKAGE BODY p AS\nEND p;\n/', JSON.stringify(pkg))
    check('sin fuente -> null', ddlDesdeFuenteOracle('rutina', { partes: [], origen: 'ALL_SOURCE' }) === null, 'null')
  }

  hr('(5) PostgreSQL desde el catálogo')
  {
    const rel = mapearRelacionPg([['r', 'Clientes de "Ana"', null, 'p', null, null, null]])
    check('relación: relkind, comentario, sin partición ni foránea', rel?.relkind === 'r' && rel.comentario === 'Clientes de "Ana"' && !rel.unlogged && rel.opciones.length === 0, JSON.stringify(rel))
    const columnas = [
      col('id', 'integer', { nullable: false, porDefecto: 'GENERATED ALWAYS AS IDENTITY', pk: 1 }),
      col('nombre', 'text', { nullable: false, porDefecto: "'x'::text", comentario: "l'nombre" }),
      col('doble', 'integer', { porDefecto: 'GENERATED ALWAYS AS ((id * 2)) STORED' }),
      col('Mayús', 'numeric(10,2)')
    ]
    const restricciones: DbRestriccionInfo[] = [
      { nombre: 'cli_fk', tipo: 'fk', columnas: ['id'], definicion: 'FOREIGN KEY (id) REFERENCES otra(id)' },
      { nombre: 'cli_pkey', tipo: 'pk', columnas: ['id'], definicion: 'PRIMARY KEY (id)' },
      { nombre: 'cli_chk', tipo: 'check', columnas: ['id'], definicion: 'CHECK ((id > 0))' },
      { nombre: 'cli_u', tipo: 'unica', columnas: ['nombre'], definicion: 'UNIQUE (nombre)' }
    ]
    const indices: DbIndiceInfo[] = [
      { nombre: 'cli_pkey', unico: true, columnas: ['id'], definicion: 'CREATE UNIQUE INDEX cli_pkey ON public.cli USING btree (id)' },
      { nombre: 'cli_u', unico: true, columnas: ['nombre'], definicion: 'CREATE UNIQUE INDEX cli_u ON public.cli USING btree (nombre)' },
      { nombre: 'cli_ix', unico: false, columnas: ['lower(nombre)'], definicion: 'CREATE INDEX cli_ix ON public.cli USING btree (lower(nombre)) WHERE (id > 10)' }
    ]
    const t = ddlTablaPg({ esquema: 'public', nombre: 'cli', relacion: rel ?? { relkind: 'r', unlogged: false, opciones: [] }, columnas, restricciones, indices })
    check('CREATE TABLE con los identificadores citados solo si hace falta', t.startsWith('CREATE TABLE public.cli (\n') && t.includes('    "Mayús" numeric(10,2)'), t)
    check('identidad y generada como su cláusula; DEFAULT y NOT NULL', t.includes('    id integer GENERATED ALWAYS AS IDENTITY NOT NULL,') && t.includes('    doble integer GENERATED ALWAYS AS ((id * 2)) STORED,') && t.includes("    nombre text DEFAULT 'x'::text NOT NULL,"), t)
    const orden = ['cli_pkey', 'cli_u', 'cli_chk', 'cli_fk'].map((n) => t.indexOf(`CONSTRAINT ${n} `))
    check('restricciones de pg_get_constraintdef, en orden PK, UNIQUE, CHECK, FK', orden.every((x, i) => x > 0 && (i === 0 || x > orden[i - 1])), JSON.stringify(orden))
    check('índices: solo el que no respalda una restricción, con su definición entera', t.includes('CREATE INDEX cli_ix ON public.cli USING btree (lower(nombre)) WHERE (id > 10);') && !t.includes('CREATE UNIQUE INDEX'), t)
    check('comentarios de la tabla y la columna, con comillas', t.includes(`COMMENT ON TABLE public.cli IS 'Clientes de "Ana"';`) && t.includes(`COMMENT ON COLUMN public.cli.nombre IS 'l''nombre';`), t)
    const part = ddlTablaPg({ esquema: 'ventas', nombre: 'Hechos', relacion: { relkind: 'p', unlogged: true, particion: 'RANGE (fecha)', opciones: [] }, columnas: [col('fecha', 'date')], restricciones: [], indices: [] })
    check('particionada y UNLOGGED, nombre citado', part === 'CREATE UNLOGGED TABLE ventas."Hechos" (\n    fecha date\n)\nPARTITION BY RANGE (fecha);', JSON.stringify(part))
    const foranea = ddlTablaPg({ esquema: 'public', nombre: 'ft', relacion: { relkind: 'f', unlogged: false, servidor: 'srv', opciones: ['schema_name=remoto', "table_name=t'x"] }, columnas: [col('a', 'integer')], restricciones: [], indices: [] })
    check("foránea: CREATE FOREIGN TABLE con SERVER y OPTIONS (clave 'valor')", foranea === "CREATE FOREIGN TABLE public.ft (\n    a integer\n)\nSERVER srv\nOPTIONS (schema_name 'remoto', table_name 't''x');", JSON.stringify(foranea))
    check('tabla normal: ni INHERITS ni ATTACH PARTITION (la mitad negativa)', !t.includes('INHERITS') && !t.includes('ATTACH') && !part.includes('INHERITS') && !part.includes('ATTACH'), 'ok')
    check('relación con la fila de 7 columnas de antes: sin límite, padres ni heredadas', rel?.limite === undefined && rel?.padres === undefined && rel?.columnasHeredadas === undefined && rel?.restriccionesHeredadas === undefined, JSON.stringify(rel))

    // Herencia y particiones, con las filas REALES de un PG 16 (ver `filas` de cada caso).
    const relPart = mapearRelacionPg([
      ['r', null, null, 'p', null, null, null, "FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')", ['v'], ['ventas'], ['id', 'fecha', 'importe'], ['ventas_2024_pkey', 'ventas_importe_check'], []]
    ])
    check(
      'relación de una partición: su límite, su padre y lo que hereda',
      relPart?.limite === "FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')" &&
        JSON.stringify(relPart.padres) === '[{"esquema":"v","nombre":"ventas"}]' &&
        JSON.stringify(relPart.columnasHeredadas) === '["id","fecha","importe"]' &&
        relPart.noNulasPropias === undefined,
      JSON.stringify(relPart)
    )
    const particion = ddlTablaPg({
      esquema: 'v',
      nombre: 'ventas_2024',
      relacion: relPart ?? { relkind: 'r', unlogged: false, opciones: [] },
      columnas: [col('id', 'integer', { nullable: false, pk: 1 }), col('fecha', 'date', { nullable: false, pk: 2 }), col('importe', 'numeric')],
      restricciones: [
        { nombre: 'ventas_importe_check', tipo: 'check', columnas: ['importe'], definicion: 'CHECK ((importe >= (0)::numeric))' },
        { nombre: 'ventas_2024_pkey', tipo: 'pk', columnas: ['id', 'fecha'], definicion: 'PRIMARY KEY (id, fecha)' }
      ],
      indices: [
        { nombre: 'ventas_2024_importe_idx', unico: false, columnas: ['importe'], definicion: 'CREATE INDEX ventas_2024_importe_idx ON v.ventas_2024 USING btree (importe)' },
        { nombre: 'ventas_2024_pkey', unico: true, columnas: ['id', 'fecha'], definicion: 'CREATE UNIQUE INDEX ventas_2024_pkey ON v.ventas_2024 USING btree (id, fecha)' }
      ]
    })
    check(
      'partición: CREATE TABLE entero (sin filtrar lo heredado), sus índices y el ATTACH PARTITION al padre',
      particion ===
        'CREATE TABLE v.ventas_2024 (\n    id integer NOT NULL,\n    fecha date NOT NULL,\n    importe numeric,\n' +
          '    CONSTRAINT ventas_2024_pkey PRIMARY KEY (id, fecha),\n    CONSTRAINT ventas_importe_check CHECK ((importe >= (0)::numeric))\n);\n\n' +
          'CREATE INDEX ventas_2024_importe_idx ON v.ventas_2024 USING btree (importe);\n\n' +
          "ALTER TABLE ONLY v.ventas ATTACH PARTITION v.ventas_2024 FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');",
      JSON.stringify(particion)
    )
    check(
      'partición: el ATTACH va DESPUÉS de los CREATE INDEX (antes, el CREATE INDEX falla con «ya existe»)',
      particion.indexOf('ATTACH PARTITION') > particion.lastIndexOf('CREATE INDEX') && !particion.includes('INHERITS'),
      'ok'
    )
    const relHija = mapearRelacionPg([
      ['r', null, null, 'p', null, null, null, null, ['v', 'v'], ['padre', 'otro'], ['id', 'nombre', 'nota', 'tag'], ['padre_nombre_ck'], ['nota']]
    ])
    const hija = ddlTablaPg({
      esquema: 'v',
      nombre: 'hija',
      relacion: relHija ?? { relkind: 'r', unlogged: false, opciones: [] },
      columnas: [
        col('id', 'integer', { nullable: false }),
        col('nombre', 'text', { nullable: false, porDefecto: "'propio'::text" }),
        col('nota', 'text', { nullable: false }),
        col('tag', 'text'),
        col('extra', 'integer')
      ],
      restricciones: [{ nombre: 'padre_nombre_ck', tipo: 'check', columnas: ['nombre'], definicion: "CHECK ((nombre <> ''::text))" }],
      indices: []
    })
    check(
      'hija: sin lo heredado, con INHERITS de sus padres en orden, y lo que cambió sobre lo heredado (DEFAULT, NOT NULL propio)',
      hija ===
        'CREATE TABLE v.hija (\n    extra integer\n)\nINHERITS (v.padre, v.otro);\n\n' +
          "ALTER TABLE ONLY v.hija ALTER COLUMN nombre SET DEFAULT 'propio'::text;\n" +
          'ALTER TABLE ONLY v.hija ALTER COLUMN nota SET NOT NULL;',
      JSON.stringify(hija)
    )
    check('hija: ni el CHECK heredado ni las columnas heredadas se repiten', !hija.includes('padre_nombre_ck') && !/^\s+(id|nombre|nota|tag) /m.test(hija), 'ok')
    const vacia = ddlTablaPg({
      esquema: 'v',
      nombre: 'hija_vacia',
      relacion: { relkind: 'r', unlogged: false, opciones: [], padres: [{ esquema: 'v', nombre: 'padre' }], columnasHeredadas: ['id', 'doble'] },
      columnas: [col('id', 'integer', { nullable: false }), col('doble', 'integer', { porDefecto: 'GENERATED ALWAYS AS ((id * 2)) STORED' })],
      restricciones: [],
      indices: []
    })
    check('hija sin columnas propias: `(\\n)` como pg_dump, y una generada heredada sin SET DEFAULT', vacia === 'CREATE TABLE v.hija_vacia (\n)\nINHERITS (v.padre);', JSON.stringify(vacia))
    const v = ddlVistaPg({ esquema: 'public', nombre: 'v', relacion: { relkind: 'v', unlogged: false, definicion: ' SELECT 1 AS x;', opciones: [], comentario: 'vista' }, columnas: [], indices: [] })
    check('vista: CREATE OR REPLACE VIEW con UN ; y su comentario', v === "CREATE OR REPLACE VIEW public.v AS\n SELECT 1 AS x;\n\nCOMMENT ON VIEW public.v IS 'vista';", JSON.stringify(v))
    const m = ddlVistaPg({ esquema: 'public', nombre: 'm', relacion: { relkind: 'm', unlogged: false, definicion: ' SELECT 1 AS x;', opciones: [] }, columnas: [], indices: [{ nombre: 'm_ix', unico: false, columnas: ['x'], definicion: 'CREATE INDEX m_ix ON public.m USING btree (x)' }] })
    check('materializada: WITH DATA y sus índices', m === 'CREATE MATERIALIZED VIEW public.m AS\n SELECT 1 AS x\nWITH DATA;\n\nCREATE INDEX m_ix ON public.m USING btree (x);', JSON.stringify(m))
    check('vista sin definición visible -> null', ddlVistaPg({ esquema: 'p', nombre: 'v', relacion: { relkind: 'v', unlogged: false, opciones: [] }, columnas: [], indices: [] }) === null, 'null')
    const sq = ddlSecuenciaPg('public', 'pedido_id_seq', [['integer', '1', '1', '1', '2147483647', '1', false, 'public.pedido', 'id', null]])
    check('secuencia con AS, valores y OWNED BY', sq === 'CREATE SEQUENCE public.pedido_id_seq\n    AS integer\n    START WITH 1\n    INCREMENT BY 1\n    MINVALUE 1\n    MAXVALUE 2147483647\n    CACHE 1;\n\nALTER SEQUENCE public.pedido_id_seq OWNED BY public.pedido.id;', JSON.stringify(sq))
    const sqCiclo = ddlSecuenciaPg('public', 's', [['bigint', '1000', '1', '1', '9223372036854775807', '1', 't', null, null, 'facturas']])
    check('secuencia con CYCLE, sin dueño y con comentario', sqCiclo !== null && sqCiclo.includes('    CYCLE;') && !sqCiclo.includes('OWNED BY') && sqCiclo.endsWith("COMMENT ON SEQUENCE public.s IS 'facturas';"), JSON.stringify(sqCiclo))
    const en = ddlTipoPg('public', 'estado', [['e', null, false, null, null, ['activo', "de O'Brien"], [], [], [], [], null]])
    check('enum', en === "CREATE TYPE public.estado AS ENUM (\n    'activo',\n    'de O''Brien'\n);", JSON.stringify(en))
    const comp = ddlTipoPg('public', 'par', [['c', null, false, null, 'un par', [], ['a', 'Be'], ['integer', 'text'], [], [], null]])
    check('compuesto con comentario', comp === 'CREATE TYPE public.par AS (\n    a integer,\n    "Be" text\n);\n\nCOMMENT ON TYPE public.par IS \'un par\';', JSON.stringify(comp))
    const dom = ddlTipoPg('public', 'positivo', [['d', 'integer', true, '1', null, [], [], [], ['positivo_check'], ['CHECK ((VALUE > 0))'], null]])
    check('dominio con DEFAULT, NOT NULL y su CHECK', dom === 'CREATE DOMAIN public.positivo AS integer\n    DEFAULT 1\n    NOT NULL\n    CONSTRAINT positivo_check CHECK ((VALUE > 0));', JSON.stringify(dom))
    const rango = ddlTipoPg('public', 'rango', [['r', null, false, null, null, [], [], [], [], [], 'numeric']])
    check('rango', rango === 'CREATE TYPE public.rango AS RANGE (\n    SUBTYPE = numeric\n);', JSON.stringify(rango))
    check('tipo desconocido o invisible -> null', ddlTipoPg('p', 't', []) === null && ddlTipoPg('p', 't', [['b', null, false, null, null, [], [], [], [], [], null]]) === null, 'null')
    const fn = ddlRutinaPg({ partes: [{ titulo: 'Definición', texto: 'CREATE OR REPLACE FUNCTION public.doble(x integer)\n RETURNS integer\n LANGUAGE sql\nAS $function$ SELECT x * 2 $function$\n' }], origen: 'pg_get_functiondef' })
    check('rutina: pg_get_functiondef con el ; que no trae', fn !== null && fn.endsWith('$function$;'), JSON.stringify(fn))
    const sqls = [sqlRelacionPg('e', 'o'), sqlSecuenciaPg('e', 'o'), sqlTipoPg('e', 'o')]
    check('las consultas de PG van con binds $1/$2, sin nombres en el texto', sqls.every((c) => JSON.stringify(c.binds) === '["e","o"]' && /\$1/.test(c.sql) && /\$2/.test(c.sql) && !/'o'/.test(c.sql)), 'ok')
    check('literalCadena duplica las comillas', literalCadena("a'b''c") === "'a''b''''c'", literalCadena("a'b''c"))
  }

  hr('(6) leerDdl de cada motor, con un lector falso')
  {
    const ORA: DialectoCatalogo = { motor: 'oracle', versionMayor: 11 }
    const PG: DialectoCatalogo = { motor: 'postgres', versionMayor: 12 }
    /** Qué se mandó (primera línea de cada consulta o bloque), en orden. */
    interface Falso {
      lector: LectorDdl
      mandado: string[]
    }
    const falso = (
      d: DialectoCatalogo,
      filas: (sql: string) => FilaCatalogo[],
      bloque: () => Promise<SalidaTextoTrabajador | null> = async () => null
    ): Falso => {
      const mandado: string[] = []
      return {
        mandado,
        lector: {
          dialecto: d,
          construir: (fn) => fn(),
          consultar: async (c) => {
            mandado.push(c.sql.split('\n')[0])
            return filas(c.sql)
          },
          fallo: (m) => new Error(`seguro: ${m}`),
          bloqueTexto: async (sql) => {
            mandado.push(sql.split('\n')[0])
            return bloque()
          }
        }
      }
    }
    const lanza = async (f: () => Promise<unknown>): Promise<unknown> => {
      try {
        await f()
        return null
      } catch (e) {
        return e
      }
    }
    const texto = (t: string): (() => Promise<SalidaTextoTrabajador>) => async () => ({ texto: t, longitud: t.length, recortado: false })
    const errorOra = (codigo: string, mensaje = `${codigo}: prueba`): (() => Promise<never>) => async () => {
      throw new FalloTrabajador({ clase: 'servidor', codigo, mensaje }, 'ejecutar')
    }
    const SQL_COLUMNAS_ORA = CATALOGO_ORACLE.sqlColumnas(ORA, 'HR', 'T').sql.split('\n')[0]
    const SQL_RESTRICCIONES_ORA = CATALOGO_ORACLE.sqlRestricciones(ORA, 'HR', 'T').sql.split('\n')[0]
    const SQL_INDICES_ORA = CATALOGO_ORACLE.sqlIndices(ORA, 'HR', 'T').sql.split('\n')[0]
    const BLOQUE = sqlDdlOracle({ esquema: 'HR', nombre: 'T', tipo: 'tabla' }).sql.split('\n')[0]
    const tabla: DbRefObjeto = { esquema: 'HR', nombre: 'T', tipo: 'tabla' }

    // Oracle, DBMS_METADATA da el texto: se limpia y es lo único que se manda.
    const bruto = '\r\n  CREATE TABLE "HR"."T" \r\n   (\t"A" NUMBER\r\n   ) ;\r\n'
    const o1 = falso(ORA, () => [], texto(bruto))
    const r1 = await CATALOGO_ORACLE.leerDdl(o1.lector, tabla)
    check(
      'oracle: con DBMS_METADATA, su texto limpio, origen DBMS_METADATA y solo el bloque',
      j(r1) === j({ partes: [{ titulo: 'DDL', texto: limpiarDdlOracle(bruto) }], origen: 'DBMS_METADATA' }) && j(o1.mandado) === j([BLOQUE]),
      j({ r1, mandado: o1.mandado })
    )
    const o2 = falso(ORA, () => [], async () => ({ texto: 'CREATE TABLE x;', longitud: TOPE_DDL + 1, recortado: true }))
    const r2 = await CATALOGO_ORACLE.leerDdl(o2.lector, tabla)
    check('oracle: recortado, con su aviso', r2.aviso === `El DDL pasa de ${TOPE_DDL} caracteres: se enseña recortado.`, j(r2))
    // Vacío (o NULL): repliegue; una tabla sin columnas visibles no tiene DDL.
    for (const [nombre, bloque] of [['vacío', texto('  \n ')], ['NULL', async () => null]] as const) {
      const o = falso(ORA, () => [], bloque)
      const r = await CATALOGO_ORACLE.leerDdl(o.lector, tabla)
      check(
        `oracle: DDL ${nombre} → repliegue; sin columnas, «No hay DDL visible» con el motivo`,
        j(r) === j({ partes: [], origen: 'ALL_TAB_COLUMNS', aviso: 'No hay DDL visible: el objeto no existe o faltan privilegios para verlo (DBMS_METADATA: devolvió un DDL vacío).' }) &&
          j(o.mandado) === j([BLOQUE, SQL_COLUMNAS_ORA]),
        j({ r, mandado: o.mandado })
      )
    }
    // ORA-31603: repliegue de la tabla, en el orden de siempre.
    const filasOra = (sql: string): FilaCatalogo[] =>
      /FROM all_tab_columns/.test(sql)
        ? [['ID', 'NUMBER', 22, 0, null, 10, 0, 'N', null, 1, null]]
        : /all_tab_comments/.test(sql)
          ? [['Clientes']]
          : []
    const o3 = falso(ORA, filasOra, errorOra('ORA-31603'))
    const r3 = await CATALOGO_ORACLE.leerDdl(o3.lector, tabla)
    const motivo31603 = motivoRepliegueDdl('ORA-31603', 'ORA-31603: prueba') ?? ''
    check(
      'oracle: ORA-31603 → tabla reconstruida (columnas, restricciones, índices, comentario, en ese orden) y su aviso',
      r3.origen === 'ALL_TAB_COLUMNS' &&
        r3.aviso === avisoRepliegue(motivo31603, 'tabla') &&
        r3.partes.length === 1 &&
        r3.partes[0].texto.includes('COMMENT ON TABLE "HR"."T" IS \'Clientes\';') &&
        j(o3.mandado) === j([BLOQUE, SQL_COLUMNAS_ORA, SQL_RESTRICCIONES_ORA, SQL_INDICES_ORA, 'SELECT comments FROM all_tab_comments WHERE owner = :esq AND table_name = :obj']),
      j({ r3, mandado: o3.mandado })
    )
    // Un fallo que el catálogo no suple se relanza TAL CUAL (el gestor lo clasifica).
    const o4 = falso(ORA, filasOra, errorOra('ORA-00942'))
    const e4 = await lanza(() => CATALOGO_ORACLE.leerDdl(o4.lector, tabla))
    check('oracle: ORA-00942 no se repliega: se relanza el mismo fallo, sin más consultas', e4 instanceof FalloTrabajador && e4.error.codigo === 'ORA-00942' && o4.mandado.length === 1, j({ e4: String(e4), mandado: o4.mandado }))
    const raro = new Error('no es del trabajador')
    const o5 = falso(ORA, filasOra, async () => {
      throw raro
    })
    check('oracle: un error que no es del trabajador se relanza tal cual', (await lanza(() => CATALOGO_ORACLE.leerDdl(o5.lector, tabla))) === raro, 'mismo objeto')
    // Sinónimo, secuencia y vista por su repliegue.
    const o6 = falso(ORA, (sql) => (/all_synonyms/.test(sql) ? [['HR', 'CLI', null]] : []), errorOra('ORA-39212'))
    const r6 = await CATALOGO_ORACLE.leerDdl(o6.lector, { esquema: 'HR', nombre: 'S', tipo: 'sinonimo' })
    check(
      'oracle: sinónimo por ALL_SYNONYMS (XDK ausente)',
      j(r6) === j({ partes: [{ titulo: 'DDL', texto: 'CREATE SYNONYM "HR"."S" FOR "HR"."CLI";' }], origen: 'ALL_SYNONYMS', aviso: avisoRepliegue(motivoRepliegueDdl('ORA-39212', '') ?? '', 'catalogo') }),
      j(r6)
    )
    const o7 = falso(ORA, () => [], async () => null)
    const r7 = await CATALOGO_ORACLE.leerDdl(o7.lector, { esquema: 'HR', nombre: 'SQ', tipo: 'secuencia' })
    check('oracle: secuencia que no se ve → «No hay DDL visible» con origen ALL_SEQUENCES', r7.origen === 'ALL_SEQUENCES' && r7.partes.length === 0 && /DBMS_METADATA: devolvió un DDL vacío/.test(r7.aviso ?? ''), j(r7))
    const o8 = falso(ORA, (sql) => (/FROM all_views/.test(sql) ? [['select 1 from dual']] : []), errorOra('ORA-01031'))
    const r8 = await CATALOGO_ORACLE.leerDdl(o8.lector, { esquema: 'HR', nombre: 'V', tipo: 'vista' })
    check(
      'oracle: vista desde su fuente, con el aviso de la fuente',
      j(r8) === j({ partes: [{ titulo: 'DDL', texto: 'CREATE OR REPLACE VIEW "HR"."V" AS\nselect 1 from dual;' }], origen: 'ALL_VIEWS', aviso: 'DBMS_METADATA no devolvió el DDL (ORA-01031: privilegios insuficientes): DDL reconstruido desde su fuente.' }),
      j(r8)
    )
    // La fuente trae su PROPIO aviso (un paquete sin cuerpo) y el del repliegue va
    // delante, separados por un espacio. Sin este caso, perder el aviso de la fuente solo lo
    // veía el diferencial contra el controlador de antes.
    const paquete: DbRefObjeto = { esquema: 'HR', nombre: 'PK', tipo: 'paquete' }
    const specSola: FilaCatalogo[] = [
      ['PACKAGE', 1, 'PACKAGE pk AS\n'],
      ['PACKAGE', 2, '  PROCEDURE p;\n'],
      ['PACKAGE', 3, 'END pk;\n']
    ]
    const o10 = falso(ORA, (sql) => (/FROM all_source/.test(sql) ? specSola : []), errorOra('ORA-31603'))
    const r10 = await CATALOGO_ORACLE.leerDdl(o10.lector, paquete)
    const avisoFuente = CATALOGO_ORACLE.mapearFuente(ORA, paquete, specSola).aviso ?? ''
    check(
      'oracle: paquete sin cuerpo por su fuente, con el aviso del repliegue y DESPUÉS el de la fuente',
      r10.origen === 'ALL_SOURCE' &&
        r10.partes.length === 1 &&
        avisoFuente !== '' &&
        r10.aviso === `${avisoRepliegue(motivo31603, 'fuente')} ${avisoFuente}`,
      j({ r10, avisoFuente })
    )
    const o9 = falso(ORA, () => [])
    const e9 = await lanza(() => CATALOGO_ORACLE.leerDdl(o9.lector, { esquema: 'HR', nombre: 'F', tipo: 'tablaForanea' }))
    check(
      'oracle: un tipo sin DDL lanza el mensaje de siempre sin mandar nada',
      e9 instanceof Error && e9.message === 'Catálogo: «DDL de tablaForanea» no existe en Oracle' && o9.mandado.length === 0,
      String(e9)
    )

    // PostgreSQL: generado desde el catálogo, con las consultas de cada forma.
    const SQL_RELACION = sqlRelacionPg('p', 't').sql.split('\n')[0]
    const SQL_COLUMNAS_PG = CATALOGO_POSTGRES.sqlColumnas(PG, 'p', 't').sql.split('\n')[0]
    const SQL_RESTRICCIONES_PG = CATALOGO_POSTGRES.sqlRestricciones(PG, 'p', 't').sql.split('\n')[0]
    const SQL_INDICES_PG = CATALOGO_POSTGRES.sqlIndices(PG, 'p', 't').sql.split('\n')[0]
    const p1 = falso(PG, () => [])
    const q1 = await CATALOGO_POSTGRES.leerDdl(p1.lector, { esquema: 'p', nombre: 't', tipo: 'tabla' })
    check(
      'postgres: sin relación visible, «No hay DDL visible» con origen pg_class y una sola consulta',
      j(q1) === j({ partes: [], origen: 'pg_class', aviso: 'No hay DDL visible: el objeto no existe o faltan privilegios para verlo.' }) && j(p1.mandado) === j([SQL_RELACION]),
      j({ q1, mandado: p1.mandado })
    )
    const relacion = (relkind: string) => (sql: string): FilaCatalogo[] =>
      sql.split('\n')[0] === SQL_RELACION
        ? [[relkind, null, null, 'p', relkind === 'r' ? null : 'SELECT 1', null, null, null, [], [], [], [], []]]
        : sql.split('\n')[0] === SQL_COLUMNAS_PG
          ? [['a', 'integer', false, null, 1, null, '', '', null]]
          : []
    const formas: Array<[DbRefObjeto['tipo'], string, string[]]> = [
      ['tabla', 'r', [SQL_RELACION, SQL_COLUMNAS_PG, SQL_RESTRICCIONES_PG, SQL_INDICES_PG]],
      ['vista', 'v', [SQL_RELACION, SQL_COLUMNAS_PG]],
      ['vistaMaterializada', 'm', [SQL_RELACION, SQL_COLUMNAS_PG, SQL_INDICES_PG]]
    ]
    for (const [tipo, relkind, esperado] of formas) {
      const p = falso(PG, relacion(relkind))
      const q = await CATALOGO_POSTGRES.leerDdl(p.lector, { esquema: 'p', nombre: 't', tipo })
      check(`postgres: ${tipo} (relkind ${relkind}), las consultas de su forma y en su orden`, q.partes.length === 1 && j(p.mandado) === j(esperado), j({ q, mandado: p.mandado }))
    }
    const p2 = falso(PG, () => [])
    const e2 = await lanza(() => CATALOGO_POSTGRES.leerDdl(p2.lector, { esquema: 'p', nombre: 'k', tipo: 'paquete' }))
    check(
      'postgres: un tipo sin DDL lanza por lector.fallo («… en PostgreSQL.») sin mandar nada',
      e2 instanceof Error && e2.message === 'seguro: Ese tipo de objeto no tiene DDL en PostgreSQL.' && p2.mandado.length === 0,
      String(e2)
    )
    const p3 = falso(PG, (sql) => (/pg_get_functiondef/.test(sql) ? [['CREATE OR REPLACE FUNCTION p.f()\n RETURNS integer\n LANGUAGE sql\nAS $$ SELECT 1 $$\n']] : []))
    const q3 = await CATALOGO_POSTGRES.leerDdl(p3.lector, { esquema: 'p', nombre: 'f', tipo: 'rutina', firma: '' })
    check('postgres: rutina por pg_get_functiondef, con su ;', q3.origen === 'pg_get_functiondef' && q3.partes.length === 1 && q3.partes[0].texto.endsWith('$$;'), j(q3))
  }

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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
