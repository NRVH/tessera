#!/usr/bin/env node
// =============================================================================
// Prueba pura, sin servidor, de lo que el main pide a SQL Server: la rejilla OFFSET/FETCH, el
// plan de SHOWPLAN_XML, el DDL de tabla, el SQL del catálogo, la sesión (edición, EXPLAIN, clave
// binaria), la caché con la base en la clave y el TEXTSIZE del trabajador. Lo que necesita el
// servidor de verdad está en `test-db-sqlserver.mts`.
// =============================================================================

import { createRequire } from 'node:module'
import { CacheCatalogo } from './CacheCatalogo.ts'
import { mapearBases, sqlBases, sqlColumnas, sqlEsquemaPorDefecto, sqlIndices, sqlObjetos, sqlRestricciones } from './catalogoSql.ts'
import { ddlSecuenciaSqlServer, ddlTablaSqlServer, ddlTipoSqlServer, ddlSinonimoSqlServer } from './ddlCatalogo.ts'
import { MOTORES_EXPLORADOR } from './motores/index.ts'
import type { DialectoCatalogo } from './motores/tipos.ts'
import { planDesdeXmlSqlServer } from './planSql.ts'
import { esFalloTrabajador, FalloTrabajador } from './protocoloTrabajador.ts'
import { campoDeErrorEnLinea, construirConsultaTabla, esErrorRejilla, type ConsultaRejilla } from './sqlRejilla.ts'
import { construirConsultaValor, esErrorValor } from './valorCelda.ts'

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
const require_ = createRequire(import.meta.url)

const D: DialectoCatalogo = { motor: 'sqlserver', versionMayor: 16 }
const DB: DialectoCatalogo = { motor: 'sqlserver', versionMayor: 16, base: 'ven]tas' }

/** Un plan de SHOWPLAN_XML de SQL Server 2022 (el de un JOIN con WHERE), recortado a lo que se lee. */
const PLAN_XML = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4295.3">
<BatchSequence><Batch><Statements>
<StmtSimple StatementText="SELECT c.nombre, p.total FROM dbo.cliente c JOIN dbo.pedido p ON p.cliente_id = c.id WHERE c.id = 1" StatementId="1" StatementType="SELECT">
<QueryPlan>
<RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="2" AvgRowSize="23" EstimatedTotalSubtreeCost="0.0065782">
<OutputList/>
<NestedLoops Optimized="0">
<RelOp NodeId="1" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" AvgRowSize="115" EstimatedTotalSubtreeCost="0.0032831">
<IndexScan Ordered="1">
<Object Database="[tx]" Schema="[dbo]" Table="[cliente]" Index="[PK_cliente]" IndexKind="Clustered"/>
<SeekPredicates><SeekPredicateNew><SeekKeys><Prefix ScanType="EQ"><RangeColumns/><RangeExpressions>
<ScalarOperator ScalarString="(1)"><Const ConstValue="(1)"/></ScalarOperator>
</RangeExpressions></Prefix></SeekKeys></SeekPredicateNew></SeekPredicates>
</IndexScan>
</RelOp>
<RelOp NodeId="2" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="2" AvgRowSize="19" EstimatedTotalSubtreeCost="0.0032853">
<IndexScan Ordered="0">
<Object Database="[tx]" Schema="[dbo]" Table="[pedido]" Index="[PK_pedido]" IndexKind="Clustered"/>
<Predicate><ScalarOperator ScalarString="[tx].[dbo].[pedido].[cliente_id] as [p].[cliente_id]=(1)"><Compare CompareOp="EQ"/></ScalarOperator></Predicate>
</IndexScan>
</RelOp>
</NestedLoops>
</RelOp>
</QueryPlan>
</StmtSimple>
</Statements></Batch></BatchSequence>
</ShowPlanXML>`

async function main(): Promise<void> {
  hr('(1) Rejilla OFFSET/FETCH')
  const conPk = construirConsultaTabla({
    dialecto: 'sqlserver',
    objeto: { esquema: 'dbo', nombre: 'cliente' },
    pkColumnas: ['id'],
    n: 501,
    desde: 500,
    forma: 'offsetFetch'
  })
  check(
    'sin ORDER BY del usuario: por la PK, `OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY`, [desde, n]',
    !esErrorRejilla(conPk) && conPk.sql === 'SELECT * FROM "dbo"."cliente"\nORDER BY "id"\nOFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY' && j(conPk.binds) === j([500, 501]) && !conPk.sinOrdenEstable,
    j(conPk)
  )
  const sinOrden = construirConsultaTabla({ dialecto: 'sqlserver', objeto: { esquema: 'dbo', nombre: 'x' }, n: 10, desde: 0, forma: 'offsetFetch' })
  check(
    'sin PK ni orden: `ORDER BY (SELECT NULL)` (OFFSET sin ORDER BY es un error) y el aviso',
    !esErrorRejilla(sinOrden) && /\nORDER BY \(SELECT NULL\)\nOFFSET @p1/.test(sinOrden.sql) && sinOrden.sinOrdenEstable === true,
    j(sinOrden)
  )
  const conUsuario = construirConsultaTabla({
    dialecto: 'sqlserver',
    objeto: { esquema: 'dbo', nombre: 'x' },
    where: 'a = 1 -- comentario',
    orderBy: 'b DESC',
    pkColumnas: ['id'],
    n: 10,
    desde: 0,
    forma: 'offsetFetch'
  })
  check(
    'con WHERE y ORDER BY del usuario: sus fragmentos en sus líneas, sin la PK',
    !esErrorRejilla(conUsuario) &&
      conUsuario.sql === 'SELECT * FROM "dbo"."x"\nWHERE (\na = 1 -- comentario\n)\nORDER BY b DESC\nOFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY' &&
      !conUsuario.sinOrdenEstable,
    j(conUsuario)
  )
  const conBase = construirConsultaTabla({ dialecto: 'sqlserver', objeto: { esquema: 'dbo', nombre: 'x', base: 'otra' }, n: 10, desde: 0, forma: 'offsetFetch' })
  check('con base: el nombre de tres partes', !esErrorRejilla(conBase) && conBase.sql.startsWith('SELECT * FROM "otra"."dbo"."x"'), j(conBase))
  const basePg = construirConsultaTabla({ dialecto: 'postgres', objeto: { esquema: 'public', nombre: 'x', base: 'otra' }, n: 10, desde: 0, forma: 'limitOffset' })
  check('una base en un motor sin nivel «Bases» es un error', esErrorRejilla(basePg) && /no tiene bases/.test(basePg.error), j(basePg))
  const c = conUsuario as ConsultaRejilla
  check(
    'la línea de un error de sintaxis del WHERE va a su campo (línea 3 = la del fragmento)',
    j(campoDeErrorEnLinea(c, 3)) === j({ campo: 'where', posicion: 0 }) && campoDeErrorEnLinea(c, 1) === null && campoDeErrorEnLinea(c, 99) === null,
    j([campoDeErrorEnLinea(c, 3), campoDeErrorEnLinea(c, 1)])
  )
  const valor = construirConsultaValor({
    dialecto: 'sqlserver',
    esquema: 'dbo',
    nombre: 't',
    columna: 'c',
    pk: [{ nombre: 'k', binario: true }, { nombre: 'b', binario: false }],
    clave: ['0x0A0B', true],
    base: 'otra'
  })
  check(
    'valor completo: clave binaria con CONVERT(varbinary(max), @p1, 2), booleano 1, base de tres partes',
    !esErrorValor(valor) && valor.sql === 'SELECT "c" FROM "otra"."dbo"."t"\nWHERE "k" = CONVERT(varbinary(max), @p1, 2) AND "b" = @p2' && j(valor.binds) === j(['0A0B', '1']),
    j(valor)
  )

  hr('(2) Plan de SHOWPLAN_XML')
  const plan = planDesdeXmlSqlServer([PLAN_XML])
  check(
    'árbol: el join arriba y sus dos hijos, con objeto (índice), filas y coste',
    j(plan.nodos.map((n) => [n.id, n.padre, n.operacion, n.objeto ?? null, n.filas ?? null])) ===
      j([
        [1, null, 'Nested Loops', null, 2],
        [2, 1, 'Clustered Index Seek', 'dbo.cliente (PK_cliente)', 1],
        [3, 1, 'Clustered Index Scan', 'dbo.pedido (PK_pedido)', 2]
      ]) &&
      plan.nodos[0].opciones === 'Inner Join' &&
      plan.nodos[0].coste === 0.0065782,
    j(plan.nodos)
  )
  check(
    'predicados: el del seek y el del scan (solo el de fuera)',
    j(plan.nodos[1].detalle) === j(['(1)']) && j(plan.nodos[2].detalle) === j(['[tx].[dbo].[pedido].[cliente_id] as [p].[cliente_id]=(1)']),
    j(plan.nodos.map((n) => n.detalle))
  )
  check(
    'texto con la sentencia y la sangría de SHOWPLAN_TEXT',
    plan.texto.startsWith('[SELECT] SELECT c.nombre') && /\n\|--Nested Loops \[Inner Join\] {2}filas=2 coste=0\.0065782\n {3}\|--Clustered Index Seek\(dbo\.cliente \(PK_cliente\)\)/.test(plan.texto),
    plan.texto
  )
  let lanzo = false
  try {
    planDesdeXmlSqlServer(['<nada/>'])
  } catch {
    lanzo = true
  }
  check('un XML que no es un plan lanza', lanzo, String(lanzo))
  const entidades = planDesdeXmlSqlServer(['<StmtSimple StatementText="SELECT &apos;a&lt;b&apos; &amp;&#65;" StatementType="SELECT"/>'])
  check('las entidades de XML se deshacen', entidades.texto === "[SELECT] SELECT 'a<b' &A", entidades.texto)

  hr('(3) DDL generado')
  const tabla = ddlTablaSqlServer({
    esquema: 'dbo',
    nombre: 'ped]ido',
    columnas: [
      { nombre: 'id', tipo: 'int', nullable: false, identidad: { semilla: '1', incremento: '1' } },
      { nombre: 'total', tipo: 'money', nullable: false, defecto: '((0))' },
      { nombre: 'doble', tipo: 'int', nullable: true, calculada: { expresion: '([id]*(2))', persistida: true } }
    ],
    restricciones: [
      { nombre: 'PK_p', tipo: 'pk', columnas: [{ nombre: 'id', descendente: false }], agrupada: true },
      { nombre: 'UQ_t', tipo: 'unica', columnas: [{ nombre: 'total', descendente: true }], agrupada: false },
      { nombre: 'FK_c', tipo: 'fk', columnas: [{ nombre: 'id', descendente: false }], referencia: { esquema: 'dbo', tabla: 'cliente', columnas: ['id'] }, alBorrar: 'CASCADE', alActualizar: 'SET NULL' },
      { nombre: 'CK_t', tipo: 'check', columnas: [], definicion: '([total]>(0))' }
    ],
    indices: [
      { nombre: 'PK_p', unico: true, deRestriccion: true, tipo: 'CLUSTERED', columnas: [{ nombre: 'id', descendente: false }], incluidas: [], esquema: 'dbo', tabla: 'ped]ido' },
      { nombre: 'ix', unico: false, deRestriccion: false, tipo: 'NONCLUSTERED', columnas: [{ nombre: 'total', descendente: true }], incluidas: ['doble'], filtro: '([total]>(0))', esquema: 'dbo', tabla: 'ped]ido' },
      { nombre: 'ix_xml', unico: false, deRestriccion: false, tipo: 'XML', columnas: [], incluidas: [], esquema: 'dbo', tabla: 'ped]ido' }
    ]
  })
  check(
    'CREATE TABLE: IDENTITY, DEFAULT, calculada, PK/UNIQUE con su índice, FK con acciones, CHECK; `]` doblado',
    tabla ===
      [
        'CREATE TABLE [dbo].[ped]]ido] (',
        '    [id] int IDENTITY(1,1) NOT NULL,',
        '    [total] money NOT NULL DEFAULT ((0)),',
        '    [doble] AS ([id]*(2)) PERSISTED,',
        '    CONSTRAINT [PK_p] PRIMARY KEY CLUSTERED ([id] ASC),',
        '    CONSTRAINT [UQ_t] UNIQUE NONCLUSTERED ([total] DESC),',
        '    CONSTRAINT [FK_c] FOREIGN KEY ([id]) REFERENCES [dbo].[cliente] ([id]) ON DELETE CASCADE ON UPDATE SET NULL,',
        '    CONSTRAINT [CK_t] CHECK ([total]>(0))',
        ');',
        '',
        'CREATE NONCLUSTERED INDEX [ix] ON [dbo].[ped]]ido] ([total] DESC) INCLUDE ([doble]) WHERE ([total]>(0));',
        '-- El índice [ix_xml] (XML) no se puede reconstruir aquí.'
      ].join('\n'),
    tabla
  )
  check(
    'secuencia sin caché, sinónimo, alias NULL y tipo de tabla',
    ddlSecuenciaSqlServer('dbo', 's', [['int', '1', '1', '1', '10', true, false, null]]) ===
      'CREATE SEQUENCE [dbo].[s]\n    AS int\n    START WITH 1\n    INCREMENT BY 1\n    MINVALUE 1\n    MAXVALUE 10\n    CYCLE\n    NO CACHE;' &&
      ddlSinonimoSqlServer('dbo', 'y', [['[otra].[dbo].[t]']]) === 'CREATE SYNONYM [dbo].[y] FOR [otra].[dbo].[t];' &&
      ddlTipoSqlServer('dbo', 'A', [[false, 'varchar(10)', true, null, null, null, null]]) === 'CREATE TYPE [dbo].[A] FROM varchar(10) NULL;' &&
      ddlTipoSqlServer('dbo', 'T', [[true, 'sysname', false, 'id', 'int', false, 1], [true, 'sysname', false, 'n', '[dbo].[A]', true, 2]]) ===
        'CREATE TYPE [dbo].[T] AS TABLE (\n    [id] int NOT NULL,\n    [n] [dbo].[A] NULL\n);' &&
      ddlSecuenciaSqlServer('dbo', 'x', []) === null,
    'ok'
  )

  hr('(4) SQL del catálogo')
  const cols = sqlColumnas(DB, 'dbo', 't')
  const todas = [cols, sqlRestricciones(DB, 'dbo', 't'), sqlIndices(DB, 'dbo', 't'), sqlObjetos(DB, 'dbo', 'tabla'), sqlObjetos(DB, 'dbo', 'tipo')]
  check(
    'con base: todo `sys.` va con el nombre de tres partes (y `]` doblado), y ninguna función que resuelva en la base de la sesión',
    todas.every((q) => !/(?<!\[ven\]\]tas\]\.)\bsys\./.test(q.sql) && !/SCHEMA_NAME\(|OBJECT_NAME\(|OBJECT_DEFINITION\(|OBJECTPROPERTY\(/.test(q.sql)),
    j(todas.map((q) => q.sql.slice(0, 60)))
  )
  check('los nombres van por bind (@p1, @p2), sin STRING_AGG', j(cols.binds) === j(['dbo', 't']) && /@p1/.test(cols.sql) && todas.every((q) => !/STRING_AGG/i.test(q.sql)), j(cols.binds))
  check('sin base, el SQL de la base de la sesión (sin prefijo)', !/\]\.sys\./.test(sqlColumnas(D, 'dbo', 't').sql) && /FROM sys\.columns c/.test(sqlColumnas(D, 'dbo', 't').sql), sqlColumnas(D, 'dbo', 't').sql.slice(0, 120))
  check(
    'el esquema por defecto: el de la sesión sin base; en otra base, el del usuario allí (o dbo)',
    sqlEsquemaPorDefecto(D).sql === 'SELECT SCHEMA_NAME(), USER_NAME()' && /\[ven\]\]tas\]\.sys\.database_principals/.test(sqlEsquemaPorDefecto(DB).sql),
    sqlEsquemaPorDefecto(DB).sql
  )
  const cat = MOTORES_EXPLORADOR.sqlserver.catalogo
  const restr = cat.mapearRestricciones([
    ['FK_x', 'F', null, 'a', 'dbo', 'r', 'ra', 1, 'CASCADE', 'NO_ACTION', null, false],
    ['FK_x', 'F', null, 'b', 'dbo', 'r', 'rb', 2, 'CASCADE', 'NO_ACTION', null, false],
    ['PK_t', 'PK', null, 'id', null, null, null, 1, null, null, 'CLUSTERED', false]
  ])
  check(
    'restricciones: una fila por columna, agrupadas en orden',
    j(restr) === j([
      { nombre: 'FK_x', tipo: 'fk', columnas: ['a', 'b'], referencia: { esquema: 'dbo', tabla: 'r', columnas: ['ra', 'rb'] } },
      { nombre: 'PK_t', tipo: 'pk', columnas: ['id'] }
    ]),
    j(restr)
  )
  const fks = cat.mapearFks('dbo', 't', [
    ['FK_1', 'dbo', 'hija', 'a', 'dbo', 't', 'id', 1],
    ['FK_2', 'dbo', 't', 'r1', 'dbo', 'otra', 'k1', 1],
    ['FK_2', 'dbo', 't', 'r2', 'dbo', 'otra', 'k2', 2]
  ], [])
  check('FKs agrupadas por columna: una entrante y una saliente de dos columnas', fks.entrantes.length === 1 && j(fks.salientes[0]?.desde.columnas) === j(['r1', 'r2']), j(fks))
  const bases = mapearBases(
    [
      ['master', 1, 1],
      ['ventas', 0, 1],
      ['cerrada', 0, 0]
    ],
    'master'
  )
  check(
    'bases: las del sistema al final, la por defecto visible, la sin acceso marcada',
    j(bases.map((b) => [b.nombre, b.sistema, b.visible, b.porDefecto, b.accesible])) ===
      j([
        ['ventas', false, false, false, true],
        ['cerrada', false, false, false, false],
        ['master', true, true, true, true]
      ]),
    j(bases)
  )
  let pgBases = ''
  try {
    sqlBases({ motor: 'postgres', versionMayor: 16 })
  } catch (e) {
    pgBases = (e as Error).message
  }
  check('un motor sin nivel «Bases» lanza al pedirle las bases', /nivel «Bases»/.test(pgBases), pgBases)
  check('sqlBases de SQL Server: sys.databases con HAS_DBACCESS', /sys\.databases/.test(sqlBases(D).sql) && /HAS_DBACCESS/.test(sqlBases(D).sql), sqlBases(D).sql)
  const sino = cat.sqlResolverSinonimo(DB, 'dbo', 's')
  check('resolver un sinónimo: PARSENAME del destino y la base si es OTRA', /PARSENAME\(sn\.base_object_name, 3\) = N'ven\]tas'/.test(sino.sql), sino.sql)

  hr('(5) Sesión')
  const ses = MOTORES_EXPLORADOR.sqlserver.sesion
  check(
    'el «esquema» de la consola es la base: `USE [a]]b]`; null vuelve a la de la conexión; sin ninguna, nada',
    j(ses.sqlFijarEsquema('a]b', 'x')) === j({ sql: 'USE [a]]b]', binds: [] }) &&
      j(ses.sqlFijarEsquema(null, 'x')) === j({ sql: 'USE [x]', binds: [] }) &&
      ses.sqlFijarEsquema(null, null) === null &&
      ses.sqlLeerEsquema().sql === 'SELECT DB_NAME()',
    'ok'
  )
  check('911 y 916 degradan; otro código no', ses.esquemaInexistente('911') && ses.esquemaInexistente('916') && !ses.esquemaInexistente('208') && !ses.esquemaInexistente(null), 'ok')
  check('sin errores de compilación que leer', ses.sqlErroresCompilacion({} as never) === null, 'null')
  const fila = (nombre: string, tipo: string, base: string, ident = 0, calc = 0, periodo = 0): unknown[] => [nombre, tipo, base, ident, calc, periodo, 0, false]
  const edicion = [
    fila('id', 'int', 'int', 1),
    fila('c', 'int', 'int', 0, 1),
    fila('v', 'timestamp', 'timestamp'),
    fila('b', 'varbinary(max)', 'varbinary'),
    // Un tipo CLR llega con la base 'clr' (`is_assembly_type`,): del sistema o de
    // un ensamblado del usuario.
    fila('g', 'geography', 'clr'),
    fila('u', '[dbo].[Punto]', 'clr'),
    fila('s', 'sql_variant', 'sql_variant'),
    fila('p', 'datetime2(7)', 'datetime2', 0, 0, 1),
    fila('n', 'nvarchar(50)', 'nvarchar'),
    fila('t', '[dbo].[Telefono]', 'nvarchar')
  ].map((f) => ses.columnaEdicion(f))
  check(
    'no editables: IDENTITY, calculada, rowversion, binaria, CLR, sql_variant y periodo; nvarchar y un alias sí',
    j(edicion.map((e) => [e.nombre, e.noEditable !== null, e.binaria])) ===
      j([
        ['id', true, false],
        ['c', true, false],
        ['v', true, true],
        ['b', true, true],
        ['g', true, false],
        ['u', true, false],
        ['s', true, false],
        ['p', true, false],
        ['n', false, false],
        ['t', false, false]
      ]),
    j(edicion.map((e) => [e.nombre, e.noEditable]))
  )
  {
    const sqlEd = ses.sqlColumnasEdicion(16, 'dbo', 't').sql
    check(
      "el tipo base de un CLR sale de `is_assembly_type` ('clr'), no del join por system_type_id (que da NULL)",
      /CASE WHEN t\.is_assembly_type = 1 THEN 'clr' ELSE bt\.name END/.test(sqlEd),
      sqlEd
    )
  }
  check(
    'la tabla de historia de una temporal es interna',
    ses.marcasTablaEdicion(['x', 'int', 'int', 0, 0, 0, 1, false]).interna === true && ses.marcasTablaEdicion(['x', 'int', 'int', 0, 0, 0, 0, false]).interna === false,
    'ok'
  )
  check(
    'columnas de edición: la base en el nombre de tres partes; sin periodo antes de 2016',
    /\[b\]\.sys\.columns/.test(ses.sqlColumnasEdicion(16, 'dbo', 't', 'b').sql) && /generated_always_type/.test(ses.sqlColumnasEdicion(13, 'dbo', 't').sql) && !/generated_always_type/.test(ses.sqlColumnasEdicion(12, 'dbo', 't').sql),
    'ok'
  )
  check(
    'clave binaria como binario de verdad; booleano 1/0; tipos binarios',
    j(ses.bindClaveBinaria('0A0B')) === j({ sqlite: 'blob', valor: '0A0B' }) &&
      ses.bindBooleano(true) === '1' &&
      ses.bindBooleano(false) === '0' &&
      ses.esTipoBinario('VARBINARY(MAX)') &&
      ses.esTipoBinario('BINARY(16)') &&
      ses.esTipoBinario('IMAGE') &&
      !ses.esTipoBinario('NVARCHAR(10)'),
    'ok'
  )
  check(
    "el bloqueo al leer (1222) es 'bloqueo' solo en SQL Server",
    ses.esBloqueoAlLeer('1222') &&
      !ses.esBloqueoAlLeer('208') &&
      !MOTORES_EXPLORADOR.postgres.sesion.esBloqueoAlLeer('1222') &&
      !MOTORES_EXPLORADOR.oracle.sesion.esBloqueoAlLeer('1222') &&
      !MOTORES_EXPLORADOR.sqlite.sesion.esBloqueoAlLeer('1222'),
    'ok'
  )
  check(
    '«Enviar» espera 10 s por transacción con SET LOCK_TIMEOUT (ms), vence con 1222',
    ses.esperaBloqueo.forma === 'porTransaccion' && ses.esperaBloqueo.codigoVencida === '1222' && (ses.esperaBloqueo.forma === 'porTransaccion' ? ses.esperaBloqueo.sqlTope(10) : '') === 'SET LOCK_TIMEOUT 10000',
    'ok'
  )

  hr('(5b) EXPLAIN: de quién es el error')
  {
    // Un contexto de mentira: la sentencia y el `SET SHOWPLAN_XML OFF` fallan o no a voluntad,
    // y se apunta cada `prefijo` (el ÚLTIMO es el que ve el gestor al tratar el error).
    const fallo = (codigo: string): FalloTrabajador => new FalloTrabajador({ mensaje: `error ${codigo}`, codigo, clase: 'servidor' } as never, 'ejecutar')
    const correr = async (falla: { sentencia?: string; off?: string }): Promise<{ lanzado: unknown; prefijos: Array<string | null> }> => {
      const prefijos: Array<string | null> = []
      const ctx = {
        texto: 'SELECT *\nFROM t\nWHER id = 1',
        binds: undefined,
        conParametros: false,
        soloLectura: false,
        t0: Date.now(),
        estadoTx: () => 'ninguna',
        txManual: () => false,
        modoDriver: () => undefined,
        ejecutar: async (sql: string) => {
          if (sql === 'SET SHOWPLAN_XML OFF' && falla.off) throw fallo(falla.off)
          if (sql.startsWith('SET SHOWPLAN_XML')) return { tipo: 'hecho', comando: null, ms: 0, tx: 'ninguna' }
          if (falla.sentencia) throw fallo(falla.sentencia)
          return { tipo: 'filas', filasJson: '[]', nFilas: 0, msEjecucion: 0, msLectura: 0, tx: 'ninguna' }
        },
        accionTx: async () => 'ninguna',
        prefijo: (p: string | null) => {
          prefijos.push(p)
        },
        fijarTx: () => undefined,
        nuevoIdPlan: () => 'p1',
        error: (_m: string, mensaje: string) => new Error(mensaje)
      }
      try {
        await ses.explicar(ctx as never)
        return { lanzado: null, prefijos }
      } catch (e) {
        return { lanzado: e, prefijos }
      }
    }
    const codigoDe = (e: unknown): string | undefined => (esFalloTrabajador(e) ? e.error.codigo : undefined)
    const a = await correr({ sentencia: '102' })
    check(
      'la sentencia falla: lanza SU error con el prefijo PUESTO ("": la ✗ se ubica en el texto)',
      codigoDe(a.lanzado) === '102' && a.prefijos[a.prefijos.length - 1] === '',
      j({ codigo: codigoDe(a.lanzado), prefijos: a.prefijos })
    )
    const b = await correr({ sentencia: '102', off: '999' })
    check('la sentencia falla y el OFF también: manda el error de la SENTENCIA, no el del OFF', codigoDe(b.lanzado) === '102' && b.prefijos[b.prefijos.length - 1] === '', j({ codigo: codigoDe(b.lanzado), prefijos: b.prefijos }))
    const c = await correr({ off: '999' })
    check('la sentencia va bien y el OFF falla: el error del OFF, SIN prefijo (no es de la sentencia)', codigoDe(c.lanzado) === '999' && c.prefijos[c.prefijos.length - 1] === null, j({ codigo: codigoDe(c.lanzado), prefijos: c.prefijos }))
  }

  hr('(6) Caché con la base')
  const eventos: unknown[] = []
  const cache = new CacheCatalogo({ emitir: (e) => eventos.push(e) })
  cache.guardar('c', { familia: 'objetos', esquema: 'dbo', resto: ['tabla'] }, 'sesion')
  cache.guardar('c', { familia: 'objetos', esquema: 'dbo', resto: ['tabla'], base: 'a' }, 'en a')
  cache.guardar('c', { familia: 'objetos', esquema: 'dbo', resto: ['tabla'], base: 'b' }, 'en b')
  check(
    'el mismo dbo en tres bases son tres entradas',
    cache.obtener('c', { familia: 'objetos', esquema: 'dbo', resto: ['tabla'] }) === 'sesion' &&
      cache.obtener('c', { familia: 'objetos', esquema: 'dbo', resto: ['tabla'], base: 'a' }) === 'en a' &&
      cache.tamano('c') === 3,
    String(cache.tamano('c'))
  )
  cache.invalidar('c', { esquema: 'dbo', base: 'a', motivo: 'refrescar' })
  check(
    'invalidar dbo en la base a no toca las otras',
    cache.obtener('c', { familia: 'objetos', esquema: 'dbo', resto: ['tabla'], base: 'a' }) === undefined && cache.tamano('c') === 2,
    String(cache.tamano('c'))
  )
  cache.invalidar('c', { esquema: 'dbo', motivo: 'ddl' })
  check('invalidar dbo sin base lo quita en todas', cache.tamano('c') === 0, String(cache.tamano('c')))

  hr('(7) Trabajador (piezas puras)')
  const w = require_('../../../tdb/sesionSqlserver.cjs') as {
    textsizeDe(t: { topeCelda: number }): number
    propositoDe(rol: string, accion: string): string
    instalarComandoDone(): { activo: boolean }
  }
  check('TEXTSIZE = tope × 2 + 2 bytes; sin tope, el máximo', w.textsizeDe({ topeCelda: 65536 }) === 131074 && w.textsizeDe({ topeCelda: 0 }) === 2147483647, 'ok')
  check(
    'propósito de cada sesión (el inicio de `sqlInicioSesion`)',
    w.propositoDe('meta', 'meta') === 'meta' && w.propositoDe('consola', 'consola') === 'consola' && w.propositoDe('datos', 'exportar') === 'exportar' && w.propositoDe('datos', 'enviar') === 'datos',
    'ok'
  )
  check('el `curCmd` de tedious engancha (tedious fijado)', w.instalarComandoDone().activo === true, j(w.instalarComandoDone()))

  hr('RESULTADO (PASS/FAIL)')
  const pasan = results.filter((r) => r.pass).length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
  process.exit(pasan === results.length ? 0 : 1)
}

void main()
