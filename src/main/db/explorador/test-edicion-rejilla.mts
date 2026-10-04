#!/usr/bin/env node
// =============================================================================
// Prueba de la edición de la rejilla en el main (edicionRejilla*.ts) y de las reglas de
// producción (produccion.ts), puras. Fija, cada regla con su mitad negativa: la identidad de
// una fila y cuándo se pregunta al catálogo, la validación de «Enviar», las sentencias y sus
// binds por motor, los originales comparables, el candado por lotes con su bisección y los mensajes.
// Decisiones: docs/decisiones/bd/rejilla-edicion-identidad.md, docs/decisiones/bd/rejilla-envio-bloqueos.md
// =============================================================================

import { DB_VALOR_MAX, type DbCambioFila, type DbCelda, type DbColumnaResultado, type DbIdentidadFila } from '../../../shared/db-explorador-ipc.ts'
import { sentenciaDeCambio } from '../../../shared/sql/dmlRejilla.ts'
// La rejilla de verdad, para la paridad de los originales (11b): es pura (sin React ni DOM).
import { aCambiosFila, borrarFilas, columnaComparable, SIN_CAMBIOS } from '../../../renderer/src/features/bd/rejilla/cambiosRejilla.ts'
import {
  COLUMNA_ROWID,
  columnasFueraDelCatalogo,
  comparablesDe,
  conMarcasDeTabla,
  decidirIdentidad,
  esEsperaDeBloqueo,
  esEsquemaDelSistema,
  esIdentidad,
  esOcupadaSinEspera,
  ESPERA_BLOQUEO_ENVIO_S,
  filasConRelleno,
  filasPorLote,
  identidadAntesDeLeer,
  loteDeBloqueo,
  lotesDeBloqueo,
  mapearColumnasEdicion,
  mapearTablaEdicion,
  mapearUnicaNoNula,
  MAX_CAMBIOS_ENVIO,
  mensajeFalloCommit,
  mensajeFilaBloqueada,
  mensajeFilas,
  mismaIdentidad,
  MOTIVO_SIN_CLAVE_PG,
  MOTIVO_SOLO_LECTURA,
  necesitaUnica,
  noEditablesDe,
  notaSinCulpable,
  originalesComparables,
  prepararEnvio,
  primerCulpable,
  puedeSerEditable,
  sqlColumnasEdicion,
  sqlEsperaBloqueoTransaccion,
  sqlUnicaNoNula,
  validarCambios,
  validarFormaEnvio,
  type ColumnaEdicion,
  type EntradaIdentidad
} from './edicionRejilla.ts'
import { MAX_ELEMENTOS_LISTA_IN } from './limites.ts'
import { MOTORES_EXPLORADOR } from './motores/index.ts'
import { enEsqueleto } from './motores/filasCatalogo.ts'
import { esProduccion, exigeConfirmacion, mensajeProduccion, txModoInicialConsola } from './produccion.ts'
import { descriptorSql, IDS_MOTORES_SQL } from '../../../shared/motores/index.ts'
import { esEsquemaSistemaOracle } from '../../../shared/motores/oracle.ts'

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

const BASE: EntradaIdentidad = { motor: 'postgres', soloLectura: false, sistema: false, tipo: 'tabla', remoto: false, pk: [], unica: null }

function columna(nombre: string, extra: Partial<ColumnaEdicion> = {}): ColumnaEdicion {
  return { nombre, tipo: 'text', noEditable: null, binaria: false, lob: null, nacional: false, comparable: null, ...extra }
}

// Asíncrona: la bisección del candado (`primerCulpable`) lo es.
async function main(): Promise<void> {
  hr('(1) Identidad de la fila')
  {
    const ro = decidirIdentidad({ ...BASE, soloLectura: true, pk: ['id'] })
    check('solo lectura: ninguna, AUNQUE tenga PK', ro.tipo === 'ninguna' && ro.motivo === MOTIVO_SOLO_LECTURA, j(ro))
    const roOra = decidirIdentidad({ ...BASE, motor: 'oracle', soloLectura: true })
    check('solo lectura en Oracle sin PK: ninguna (y por tanto SIN columna ROWID)', roOra.tipo === 'ninguna', j(roOra))
    for (const tipo of ['vista', 'vistaMaterializada', 'tablaForanea'] as const) {
      const r = decidirIdentidad({ ...BASE, motor: 'oracle', tipo, pk: ['ID'] })
      check(`${tipo}: ninguna con su motivo (aunque traiga PK)`, r.tipo === 'ninguna' && r.motivo.length > 10, j(r))
    }
    const remoto = decidirIdentidad({ ...BASE, motor: 'oracle', remoto: true })
    check('un sinónimo remoto (@dblink): ninguna', remoto.tipo === 'ninguna' && /dblink/.test(remoto.motivo), j(remoto))
    const pk = decidirIdentidad({ ...BASE, pk: ['id', 'n'] })
    check('con PK: pk con sus columnas en orden', j(pk) === j({ tipo: 'pk', columnas: ['id', 'n'] }), j(pk))
    const pkOra = decidirIdentidad({ ...BASE, motor: 'oracle', pk: ['ID'] })
    check('Oracle con PK: pk (NO el ROWID)', pkOra.tipo === 'pk', j(pkOra))
    const rowid = decidirIdentidad({ ...BASE, motor: 'oracle' })
    check('Oracle sin PK: rowid con la columna oculta', j(rowid) === j({ tipo: 'rowid', columna: COLUMNA_ROWID }), j(rowid))
    const unica = decidirIdentidad({ ...BASE, unica: ['codigo'] })
    check('PG sin PK con una UNIQUE NOT NULL: pk con sus columnas', j(unica) === j({ tipo: 'pk', columnas: ['codigo'] }), j(unica))
    const nada = decidirIdentidad(BASE)
    check('PG sin PK ni UNIQUE NOT NULL: ninguna con su motivo', nada.tipo === 'ninguna' && nada.motivo === MOTIVO_SIN_CLAVE_PG, j(nada))
    const dual = decidirIdentidad({ ...BASE, motor: 'oracle', sistema: esEsquemaDelSistema('oracle', 'SYS') })
    check('una tabla del sistema (SYS.DUAL, sin PK): ninguna, NO su ROWID', dual.tipo === 'ninguna' && /sistema/.test(dual.motivo), j(dual))
    check(
      'esquemas del sistema: SYS, SYSTEM; pg_catalog, information_schema',
      esEsquemaDelSistema('oracle', 'SYS') && esEsquemaDelSistema('oracle', 'SYSTEM') && esEsquemaDelSistema('postgres', 'pg_catalog') && esEsquemaDelSistema('postgres', 'information_schema'),
      'sí'
    )
    check(
      'NEGATIVO: los de usuario no (HR, public, un «sys» en minúsculas de PG)',
      !esEsquemaDelSistema('oracle', 'HR') && !esEsquemaDelSistema('postgres', 'public') && !esEsquemaDelSistema('postgres', 'sys'),
      'no'
    )
    check('NEGATIVO: una tabla del sistema de PG no pregunta por la UNIQUE', !necesitaUnica({ ...BASE, sistema: true }), 'no')
    const temporal = decidirIdentidad({ ...BASE, motor: 'oracle', pk: ['ID'], temporal: true })
    check('una tabla TEMPORAL: ninguna, aunque tenga PK («Enviar» escribe desde otra sesión)', temporal.tipo === 'ninguna' && /temporal/.test(temporal.motivo), j(temporal))
    const externa = decidirIdentidad({ ...BASE, motor: 'oracle', externa: true })
    check('una tabla EXTERNA de Oracle: ninguna, y por tanto sin columna ROWID (daría ORA-01410)', externa.tipo === 'ninguna' && /externa/.test(externa.motivo), j(externa))
    check('NEGATIVO: una temporal de PG no pregunta por la UNIQUE', !necesitaUnica({ ...BASE, temporal: true }), 'no')
    check('puedeSerEditable: tabla de usuario en escritura', puedeSerEditable(BASE), 'sí')
    check(
      'NEGATIVO: solo lectura, remoto, del sistema o no tabla: sin preguntar al catálogo',
      !puedeSerEditable({ ...BASE, soloLectura: true }) && !puedeSerEditable({ ...BASE, remoto: true }) && !puedeSerEditable({ ...BASE, sistema: true }) && !puedeSerEditable({ ...BASE, tipo: 'vista' }),
      'no'
    )
    const unicaOra = decidirIdentidad({ ...BASE, motor: 'oracle', unica: ['X'] })
    check('NEGATIVO: en Oracle una UNIQUE no cuenta (el ROWID siempre sirve)', unicaOra.tipo === 'rowid', j(unicaOra))
    check('se pregunta por la UNIQUE: PG, tabla, escritura, sin PK', necesitaUnica(BASE), 'sí')
    check(
      'NEGATIVO: no se pregunta en Oracle, en solo lectura, con PK, en una vista ni en remoto',
      !necesitaUnica({ ...BASE, motor: 'oracle' }) &&
        !necesitaUnica({ ...BASE, soloLectura: true }) &&
        !necesitaUnica({ ...BASE, pk: ['id'] }) &&
        !necesitaUnica({ ...BASE, tipo: 'vista' }) &&
        !necesitaUnica({ ...BASE, remoto: true }),
      'no'
    )
    const copia = ['a']
    const d = decidirIdentidad({ ...BASE, pk: copia })
    copia.push('b')
    check('la identidad no comparte el array de la PK', d.tipo === 'pk' && d.columnas.length === 1, j(d))
  }

  hr('(2) La identidad que manda el renderer')
  {
    const pk: DbIdentidadFila = { tipo: 'pk', columnas: ['a', 'b'] }
    check('misma PK, mismo orden: coincide', mismaIdentidad(pk, { tipo: 'pk', columnas: ['a', 'b'] }), 'sí')
    check('NEGATIVO: otro orden no coincide (los valores de la clave irían cruzados)', !mismaIdentidad(pk, { tipo: 'pk', columnas: ['b', 'a'] }), 'no')
    check('NEGATIVO: una columna de menos no coincide', !mismaIdentidad(pk, { tipo: 'pk', columnas: ['a'] }), 'no')
    check('rowid con la misma columna coincide', mismaIdentidad({ tipo: 'rowid', columna: COLUMNA_ROWID }, { tipo: 'rowid', columna: COLUMNA_ROWID }), 'sí')
    check('NEGATIVO: rowid frente a pk no coincide', !mismaIdentidad({ tipo: 'rowid', columna: COLUMNA_ROWID }, pk), 'no')
    check('NEGATIVO: ninguna nunca coincide (no hay con qué escribir)', !mismaIdentidad({ tipo: 'ninguna', motivo: 'x' }, { tipo: 'ninguna', motivo: 'x' }), 'no')
    check('forma válida: pk, rowid y ninguna', esIdentidad(pk) && esIdentidad({ tipo: 'rowid', columna: 'R' }) && esIdentidad({ tipo: 'ninguna', motivo: '' }), 'sí')
    const malas: unknown[] = [null, [], { tipo: 'pk', columnas: [] }, { tipo: 'pk', columnas: [1] }, { tipo: 'pk' }, { tipo: 'rowid' }, { tipo: 'rowid', columna: '' }, { tipo: 'otra' }]
    check('NEGATIVO: formas malas no pasan', malas.every((m) => !esIdentidad(m)), j(malas.filter((m) => esIdentidad(m))))
  }

  hr('(3) Columnas editables: el SQL y lo que no se edita')
  {
    const o11 = sqlColumnasEdicion({ motor: 'oracle', versionMayor: 11 }, 'HR', 'EMP')
    const o21 = sqlColumnasEdicion({ motor: 'oracle', versionMayor: 21 }, 'HR', 'EMP')
    check('Oracle 11.2: ALL_TAB_COLS sin ALL_TAB_IDENTITY_COLS (no existe antes de la 12.1)', /all_tab_cols/i.test(o11.sql) && !/identity/i.test(o11.sql), o11.sql)
    check('Oracle 12+: la generación de la identidad sale de ALL_TAB_IDENTITY_COLS', /all_tab_identity_cols/i.test(o21.sql), o21.sql)
    check('Oracle: fuera las columnas ocultas, y con binds (nunca el nombre en el texto)', /hidden_column = 'NO'/.test(o21.sql) && j(o21.binds) === j({ esq: 'HR', obj: 'EMP' }) && !o21.sql.includes('EMP'), j(o21.binds))
    const pg = sqlColumnasEdicion({ motor: 'postgres', versionMayor: 16 }, 'public', 'cliente')
    check('PG: attgenerated y attidentity, con binds posicionales', /attgenerated/.test(pg.sql) && /attidentity/.test(pg.sql) && j(pg.binds) === j(['public', 'cliente']), j(pg.binds))

    const ora = mapearColumnasEdicion('oracle', [
      ['ID', 'NUMBER', null, 'NO', null],
      ['NOMBRE', 'VARCHAR2', null, 'NO', null],
      ['DOC', 'CLOB', null, 'NO', null],
      ['NDOC', 'NCLOB', null, 'NO', null],
      ['FOTO', 'BLOB', null, 'NO', null],
      ['HUELLA', 'RAW', null, 'NO', null],
      ['TOTAL', 'NUMBER', null, 'YES', null],
      ['N_SIEMPRE', 'NUMBER', null, 'NO', 'ALWAYS'],
      ['N_DEFECTO', 'NUMBER', null, 'NO', 'BY DEFAULT'],
      ['XML', 'XMLTYPE', 'SYS', 'NO', null],
      ['GEO', 'SDO_GEOMETRY', 'MDSYS', 'NO', null],
      ['VIEJO', 'LONG', null, 'NO', null],
      ['MARCA', 'TIMESTAMP(6) WITH TIME ZONE', null, 'NO', null],
      ['PLAZO', 'INTERVAL DAY(2) TO SECOND(6)', null, 'NO', null],
      ['ALTA', 'DATE', null, 'NO', null]
    ])
    const de = (n: string): ColumnaEdicion | undefined => ora.find((c) => c.nombre === n)
    const editables = ['ID', 'NOMBRE', 'DOC', 'NDOC', 'N_DEFECTO', 'MARCA', 'PLAZO', 'ALTA']
    const noEd = ['FOTO', 'HUELLA', 'TOTAL', 'N_SIEMPRE', 'XML', 'GEO', 'VIEJO']
    check('Oracle: editables los escalares, el CLOB, la identidad BY DEFAULT, fechas e intervalos', editables.every((n) => de(n)?.noEditable === null), j(editables.map((n) => [n, de(n)?.noEditable])))
    check('Oracle NEGATIVO: no editables BLOB, RAW, virtual, identidad ALWAYS, XMLTYPE, objetos y LONG', noEd.every((n) => typeof de(n)?.noEditable === 'string'), j(noEd.map((n) => [n, de(n)?.noEditable])))
    check('Oracle: CLOB y NCLOB marcan su bind de LOB; el resto no', de('DOC')?.lob === 'clob' && de('NDOC')?.lob === 'nclob' && de('NOMBRE')?.lob === null, j([de('DOC')?.lob, de('NDOC')?.lob]))
    check('Oracle: BLOB y RAW son binarias (su clave se convierte)', de('FOTO')?.binaria === true && de('HUELLA')?.binaria === true && de('ID')?.binaria === false, 'ok')
    check('Oracle: los motivos dicen por qué', /virtual/i.test(de('TOTAL')?.noEditable ?? '') && /ALWAYS/.test(de('N_SIEMPRE')?.noEditable ?? '') && /XMLTYPE/.test(de('XML')?.noEditable ?? ''), j([de('TOTAL')?.noEditable, de('N_SIEMPRE')?.noEditable]))

    const pgc = mapearColumnasEdicion('postgres', [
      ['id', 'integer', 'int4', '', 'a'],
      ['id2', 'integer', 'int4', '', 'd'],
      ['nombre', 'text', 'text', '', ''],
      ['total', 'numeric', 'numeric', 's', ''],
      ['foto', 'bytea', 'bytea', '', ''],
      ['huella', 'dominio_bin', 'bytea', '', ''],
      ['datos', 'jsonb', 'jsonb', '', ''],
      ['estado', 'extra.estado', 'estado', '', '']
    ])
    const dp = (n: string): ColumnaEdicion | undefined => pgc.find((c) => c.nombre === n)
    check('PG: identidad ALWAYS y columna generada no; BY DEFAULT sí', typeof dp('id')?.noEditable === 'string' && typeof dp('total')?.noEditable === 'string' && dp('id2')?.noEditable === null, j([dp('id')?.noEditable, dp('total')?.noEditable]))
    check('PG: bytea y un dominio sobre bytea son binarias y no se editan', dp('foto')?.binaria === true && dp('huella')?.binaria === true && typeof dp('huella')?.noEditable === 'string', j(dp('huella')))
    check('PG NEGATIVO: json, enum y texto se editan (todo tipo tiene entrada de texto)', ['nombre', 'datos', 'estado'].every((n) => dp(n)?.noEditable === null), 'ok')
    check('PG: nunca un bind de LOB', pgc.every((c) => c.lob === null), 'ok')
    const lista = noEditablesDe(ora)
    check('noEditablesDe: solo las no editables, con su motivo', lista.length === noEd.length && lista.every((x) => noEd.indexOf(x.columna) >= 0 && x.motivo.length > 0), j(lista.map((x) => x.columna)))
    check('NEGATIVO: una fila sin nombre no cuenta', mapearColumnasEdicion('oracle', [[null, 'NUMBER', null, 'NO', null]]).length === 0, 'ok')
    check(
      'Oracle: temporal y externa salen de subconsultas en la MISMA consulta, sin ALL_TABLES',
      /all_objects o WHERE o\.owner = :esq/.test(o11.sql) && /all_external_tables/.test(o11.sql) && !/all_tables/i.test(o11.sql),
      o11.sql
    )
    check('PG: la persistencia de la tabla (temporal)', /relpersistence/.test(pg.sql), pg.sql)
    const tOra = mapearTablaEdicion('oracle', [['ID', 'NUMBER', null, 'NO', null, 'Y', '0'], ['V', 'VARCHAR2', null, 'NO', null, 'Y', '0']])
    check('Oracle: GTT (temporary Y) marcada temporal, no externa, con sus columnas', tOra.temporal && !tOra.externa && tOra.columnas.length === 2, j(tOra))
    const tExt = mapearTablaEdicion('oracle', [['A', 'VARCHAR2', null, 'NO', null, 'N', 1]])
    check('Oracle: externa (la cuenta llega como número)', tExt.externa && !tExt.temporal, j(tExt))
    const tNormal = mapearTablaEdicion('oracle', [['A', 'VARCHAR2', null, 'NO', null, 'N', '0']])
    check('NEGATIVO Oracle: una tabla normal, ni temporal ni externa', !tNormal.temporal && !tNormal.externa, j(tNormal))
    const tPg = mapearTablaEdicion('postgres', [['id', 'integer', 'int4', '', '', 't']])
    const tPgNormal = mapearTablaEdicion('postgres', [['id', 'integer', 'int4', '', '', 'p']])
    check('PG: relpersistence t -> temporal; p (o u) no; nunca externa', tPg.temporal && !tPgNormal.temporal && !tPg.externa, j([tPg.temporal, tPgNormal.temporal]))
    check('NEGATIVO: sin filas, nada marcado', (() => { const t = mapearTablaEdicion('oracle', []); return !t.temporal && !t.externa && t.columnas.length === 0 })(), 'ok')

    // en 12c+ el árbol decide «del sistema» por
    // `oracle_maintained`, y la rejilla solo por la lista escrita a mano: una cuenta de
    // Oracle de una versión futura que no estuviera en la lista salía editable.
    check(
      'Oracle 12+: oracle_maintained del esquema en la MISMA consulta (subconsulta a ALL_USERS por :esq); 11.2 sin ella (no existe)',
      /\(SELECT u\.oracle_maintained FROM all_users u WHERE u\.username = :esq\)/.test(o21.sql) && !/oracle_maintained/.test(o11.sql),
      o21.sql
    )
    const tMant = mapearTablaEdicion('oracle', [['A', 'VARCHAR2', null, 'NO', null, 'N', '0', 'Y']])
    const tNoMant = mapearTablaEdicion('oracle', [['A', 'VARCHAR2', null, 'NO', null, 'N', '0', 'N']])
    const t11 = mapearTablaEdicion('oracle', [['A', 'VARCHAR2', null, 'NO', null, 'N', '0', null]])
    const tPgM = mapearTablaEdicion('postgres', [['id', 'integer', 'int4', '', '', 'p', 'Y']])
    check(
      "mantenidaPorOracle: 'Y' sí; 'N', NULL (11.2) y PG no",
      tMant.mantenidaPorOracle && !tNoMant.mantenidaPorOracle && !t11.mantenidaPorOracle && !tPgM.mantenidaPorOracle,
      j([tMant.mantenidaPorOracle, tNoMant.mantenidaPorOracle, t11.mantenidaPorOracle, tPgM.mantenidaPorOracle])
    )
    // Una cuenta 'Y' que NO está en la lista escrita a mano (una de una versión futura).
    const baseFutura = { motor: 'oracle' as const, soloLectura: false, sistema: esEsquemaDelSistema('oracle', 'CUENTA_23AI_NUEVA'), tipo: 'tabla' as const, remoto: false, pk: [] as string[] }
    const conMant = conMarcasDeTabla(baseFutura, tMant)
    check(
      'una tabla SIN PK de una cuenta que mantiene Oracle y la lista no conoce: del sistema, NO editable (antes salía por ROWID)',
      !baseFutura.sistema && conMant.sistema && decidirIdentidad({ ...conMant, unica: null }).tipo === 'ninguna',
      j(decidirIdentidad({ ...conMant, unica: null }))
    )
    const sinMant = conMarcasDeTabla(baseFutura, tNoMant)
    check(
      "NEGATIVO: la misma cuenta con 'N' (una de usuario): se edita por ROWID como siempre",
      !sinMant.sistema && decidirIdentidad({ ...sinMant, unica: null }).tipo === 'rowid',
      j(decidirIdentidad({ ...sinMant, unica: null }))
    )
    const listaYa = conMarcasDeTabla({ ...baseFutura, sistema: true }, tNoMant)
    const cacheVieja = conMarcasDeTabla(baseFutura, { temporal: false, externa: false })
    check(
      'NEGATIVO: aditivo (lo que la lista ya marca sigue marcado aunque diga N) y una caché sin la marca no inventa nada',
      listaYa.sistema && !cacheVieja.sistema && !conMarcasDeTabla(baseFutura, tMant).temporal,
      j([listaYa.sistema, cacheVieja.sistema])
    )
  }

  hr('(4) UNIQUE con todas sus columnas NOT NULL (PG)')
  {
    const q = sqlUnicaNoNula({ motor: 'postgres', versionMayor: 16 }, 'public', 't')
    check('mira RESTRICCIONES (contype u) y exige todas NOT NULL, la más corta primero', /contype = 'u'/.test(q.sql) && /NOT b\.attnotnull/.test(q.sql) && /ORDER BY cardinality\(k\.conkey\)/.test(q.sql) && j(q.binds) === j(['public', 't']), q.sql)
    check('la primera restricción, con sus columnas en orden', j(mapearUnicaNoNula([['uq_a', 'a'], ['uq_a', 'b'], ['uq_c', 'c']])) === j(['a', 'b']), 'ok')
    check('NEGATIVO: sin filas, null', mapearUnicaNoNula([]) === null, 'null')
    // la consulta se MUDÓ a la sesión de PG. Al byte la de
    // antes (copiada de `edicionRejilla.ts`), y la DECIDE el motor: cambiada a
    // propósito en el registro, sale la cambiada; Oracle no la tiene y lo dice.
    const deAntes = [
      'SELECT k.conname, a.attname',
      '  FROM pg_constraint k',
      '  JOIN pg_class c ON c.oid = k.conrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS u(num, orden) ON true',
      '  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num',
      " WHERE n.nspname = $1 AND c.relname = $2 AND k.contype = 'u'",
      '   AND NOT EXISTS (',
      '     SELECT 1 FROM unnest(k.conkey) AS x(num)',
      '       JOIN pg_attribute b ON b.attrelid = k.conrelid AND b.attnum = x.num',
      '      WHERE NOT b.attnotnull)',
      ' ORDER BY cardinality(k.conkey), k.conname, u.orden'
    ].join('\n')
    check('PG: el SQL de antes, al byte', q.sql === deAntes, q.sql === deAntes ? 'igual' : q.sql)
    const sesionPg = MOTORES_EXPLORADOR.postgres.sesion
    const original = sesionPg.sqlUnicaNoNula
    sesionPg.sqlUnicaNoNula = (e, o) => ({ sql: 'SELECT marca', binds: [e, o] })
    let seguida: string
    try {
      seguida = sqlUnicaNoNula({ motor: 'postgres', versionMayor: 16 }, 'public', 't').sql
    } finally {
      sesionPg.sqlUnicaNoNula = original
    }
    check('la consulta la decide la sesión del motor (cambiada a propósito, se sigue)', seguida === 'SELECT marca', seguida)
    let deOracle: string
    try {
      deOracle = sqlUnicaNoNula({ motor: 'oracle', versionMayor: 21 }, 'HR', 'T').sql
    } catch (e) {
      deOracle = `lanza: ${(e as Error).message}`
    }
    check('NEGATIVO: Oracle no identifica así y lo dice con nombre', deOracle === 'lanza: Catálogo: «UNIQUE NOT NULL como identidad de la fila» no existe en Oracle', deOracle)
  }

  hr('(5) La forma de «Enviar»')
  {
    const bueno = {
      conexionId: 'c1',
      peticionId: 'p1',
      objeto: { esquema: 'public', nombre: 't', tipo: 'tabla' },
      identidad: { tipo: 'pk', columnas: ['id'] },
      cambios: [
        { tipo: 'actualizar', clave: ['1'], valores: { nombre: 'x', nota: null }, sobra: 1 },
        { tipo: 'insertar', valores: { id: '2' } },
        { tipo: 'borrar', clave: [true] }
      ],
      confirmado: true
    }
    const v = validarFormaEnvio(bueno)
    check('una petición bien formada pasa, con confirmado', v.ok && v.valor.cambios.length === 3 && v.valor.confirmado === true, j(v))
    check('se COPIA: una propiedad de más no viaja', v.ok && !('sobra' in v.valor.cambios[0]), v.ok ? j(v.valor.cambios[0]) : '')
    const sinConf = validarFormaEnvio({ ...bueno, confirmado: undefined })
    check('sin confirmado: false', sinConf.ok && sinConf.valor.confirmado === false, j(sinConf.ok && sinConf.valor.confirmado))
    const malas: Array<[string, unknown]> = [
      ['no es un objeto', null],
      ['sin conexionId', { ...bueno, conexionId: '' }],
      ['sin peticionId', { ...bueno, peticionId: 3 }],
      ['identidad mala', { ...bueno, identidad: { tipo: 'pk', columnas: [] } }],
      ['sin cambios', { ...bueno, cambios: [] }],
      ['cambios no es un array', { ...bueno, cambios: {} }],
      ['demasiados cambios', { ...bueno, cambios: Array.from({ length: MAX_CAMBIOS_ENVIO + 1 }, () => ({ tipo: 'borrar', clave: ['1'] })) }],
      ['tipo desconocido', { ...bueno, cambios: [{ tipo: 'truncar' }] }],
      ['clave vacía', { ...bueno, cambios: [{ tipo: 'borrar', clave: [] }] }],
      ['clave con un número', { ...bueno, cambios: [{ tipo: 'borrar', clave: [1] }] }],
      ['valores en array', { ...bueno, cambios: [{ tipo: 'insertar', valores: ['x'] }] }],
      ['un valor numérico', { ...bueno, cambios: [{ tipo: 'insertar', valores: { a: 1 } }] }],
      ['una columna sin nombre', { ...bueno, cambios: [{ tipo: 'insertar', valores: { '': 'x' } }] }],
      ['confirmado no booleano', { ...bueno, confirmado: 'true' }]
    ]
    for (const [nombre, req] of malas) {
      const r = validarFormaEnvio(req)
      check(`NEGATIVO: ${nombre}`, !r.ok && r.mensaje.length > 0, r.ok ? 'pasó' : r.mensaje)
    }
    const conIndice = validarFormaEnvio({ ...bueno, cambios: [bueno.cambios[1], { tipo: 'borrar', clave: [] }] })
    check('el mensaje dice qué cambio (1-based)', !conIndice.ok && /cambio 2/.test(conIndice.mensaje), conIndice.ok ? '' : conIndice.mensaje)
  }

  hr('(6) Las columnas que se escriben')
  {
    const cols = [columna('id'), columna('nombre'), columna('total', { noEditable: 'Columna generada: la calcula PostgreSQL.' })]
    const pk: DbIdentidadFila = { tipo: 'pk', columnas: ['id'] }
    check('existentes y editables: null', validarCambios(pk, [{ tipo: 'actualizar', clave: ['1'], valores: { nombre: 'x' } }], cols) === null, 'ok')
    const noExiste = validarCambios(pk, [{ tipo: 'insertar', valores: { id: '1' } }, { tipo: 'insertar', valores: { fantasma: '1' } }], cols)
    check('NEGATIVO: una columna que no existe, con su índice', noExiste?.indice === 1 && /fantasma/.test(noExiste.mensaje), j(noExiste))
    const generada = validarCambios(pk, [{ tipo: 'actualizar', clave: ['1'], valores: { total: '9' } }], cols)
    check('NEGATIVO: una columna no editable, con su motivo', generada?.indice === 0 && /generada/.test(generada.mensaje), j(generada))
    const rid: DbIdentidadFila = { tipo: 'rowid', columna: COLUMNA_ROWID }
    const escribeRowid = validarCambios(rid, [{ tipo: 'actualizar', clave: ['AAA'], valores: { [COLUMNA_ROWID]: 'x' } }], cols)
    check('NEGATIVO: la columna del ROWID nunca se escribe', escribeRowid?.indice === 0 && /ROWID/.test(escribeRowid.mensaje), j(escribeRowid))
    check('un borrado no escribe columnas', validarCambios(pk, [{ tipo: 'borrar', clave: ['1'] }], []) === null, 'ok')
  }

  hr('(7) Las sentencias: las de la vista previa, con los binds de su columna')
  {
    const objOra = { esquema: 'HR', nombre: 'DOCS' }
    const colsOra = [
      columna('ID', { tipo: 'NUMBER' }),
      columna('CUERPO', { tipo: 'CLOB', lob: 'clob' }),
      columna('NOTA', { tipo: 'NCLOB', lob: 'nclob' }),
      columna('GUID', { tipo: 'RAW', binaria: true, noEditable: 'Binaria: no se edita como texto.' })
    ]
    const largo = 'ñ'.repeat(3000) // 6000 bytes: no cabe en un VARCHAR2 de una sentencia SQL
    const cambios: DbCambioFila[] = [
      { tipo: 'actualizar', clave: ['7'], valores: { CUERPO: largo, NOTA: null } },
      { tipo: 'insertar', valores: { ID: '8', CUERPO: 'corto' } },
      { tipo: 'borrar', clave: ['9'] }
    ]
    const r = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['ID'] }, cambios, colsOra)
    check('se construye', r.ok && r.sentencias.length === 3, j(r.ok ? r.sentencias.map((s) => s.tipo) : r))
    if (r.ok) {
      const esperado = sentenciaDeCambio('oracle', objOra, { tipo: 'pk', columnas: ['ID'] }, cambios[0]).sql
      check('el SQL es EXACTAMENTE el de la vista previa (`sentenciaDeCambio`)', r.sentencias[0].sql === esperado, r.sentencias[0].sql)
      const b0 = r.sentencias[0].binds
      check('un texto hacia un CLOB va como bind de LOB, entero', typeof b0[0] === 'object' && b0[0] !== null && (b0[0] as { entrada: string }).entrada === 'clob' && (b0[0] as { valor: string }).valor === largo, j(typeof b0[0]))
      check('NULL hacia un NCLOB va como NULL a secas (no hace falta LOB)', b0[1] === null, j(b0[1]))
      check('NEGATIVO: la clave (NUMBER) va como texto', b0[2] === '7', j(b0[2]))
      const b1 = r.sentencias[1].binds
      check('NEGATIVO: un CLOB CORTO va como texto a secas (sin LOB temporal); el ID también', b1[0] === '8' && b1[1] === 'corto', j(b1))
      check('DELETE: solo la clave', j(r.sentencias[2].binds) === j(['9']) && r.sentencias[2].tipo === 'borrar', j(r.sentencias[2]))
    }
    const vacia = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['ID'] }, [{ tipo: 'actualizar', clave: ['1'], valores: { CUERPO: '' } }], colsOra)
    check("NEGATIVO: '' hacia un CLOB NO va como LOB (en thick sería un CLOB vacío, no el NULL de '' en Oracle)", vacia.ok && vacia.sentencias[0].binds[0] === '', vacia.ok ? j(vacia.sentencias[0].binds) : j(vacia))
    const justo = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['ID'] }, [{ tipo: 'actualizar', clave: ['1'], valores: { CUERPO: 'x'.repeat(1001) } }], colsOra)
    check('a partir de 1001 unidades, bind de LOB', justo.ok && typeof justo.sentencias[0].binds[0] === 'object', justo.ok ? typeof justo.sentencias[0].binds[0] : j(justo))
    const colsPg = [columna('id'), columna('cuerpo'), columna('guid', { tipo: 'bytea', binaria: true, noEditable: 'Binaria' })]
    const rp = prepararEnvio('postgres', { esquema: 'public', nombre: 'docs' }, { tipo: 'pk', columnas: ['guid'] }, [{ tipo: 'actualizar', clave: ['0xABCD'], valores: { cuerpo: largo } }], colsPg)
    check('PG: el texto largo va a secas (un text no tiene el tope)', rp.ok && rp.sentencias[0].binds[0] === largo, rp.ok ? j(typeof rp.sentencias[0].binds[0]) : j(rp))
    check('PG: la clave binaria pasa de 0x… a la entrada de bytea (\\x…)', rp.ok && rp.sentencias[0].binds[1] === '\\xABCD', rp.ok ? j(rp.sentencias[0].binds[1]) : '')
    const ro = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['GUID'] }, [{ tipo: 'borrar', clave: ['0x0A0B'] }], colsOra)
    check('Oracle: la clave binaria va en hexadecimal desnudo (HEXTORAW implícito)', ro.ok && ro.sentencias[0].binds[0] === '0A0B', ro.ok ? j(ro.sentencias[0].binds) : j(ro))
    const malaHex = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['GUID'] }, [{ tipo: 'borrar', clave: ['1'] }, { tipo: 'borrar', clave: ['zz'] }], colsOra)
    check('NEGATIVO: una clave binaria que no es hexadecimal, con su índice', !malaHex.ok && malaHex.indice === 0 && /hexadecimal/.test(malaHex.mensaje), j(malaHex))
    const rid = prepararEnvio('oracle', objOra, { tipo: 'rowid', columna: COLUMNA_ROWID }, [{ tipo: 'actualizar', clave: ['AAAR3sAAEAAAACXAAA'], valores: { CUERPO: 'x' } }], colsOra)
    check('ROWID: WHERE ROWID = :n y su valor tal cual', rid.ok && /WHERE ROWID = :2$/.test(rid.sentencias[0].sql) && rid.sentencias[0].binds[1] === 'AAAR3sAAEAAAACXAAA', rid.ok ? rid.sentencias[0].sql : j(rid))
    const nula = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['ID'] }, [{ tipo: 'borrar', clave: ['1'] }, { tipo: 'borrar', clave: [null] }], colsOra)
    check('NEGATIVO: una clave con NULL falla EN SU cambio, con el mensaje del constructor', !nula.ok && nula.indice === 1 && /Cambio 2: .*NULL/.test(nula.mensaje), j(nula))
    const vacioOra = prepararEnvio('oracle', objOra, { tipo: 'pk', columnas: ['ID'] }, [{ tipo: 'insertar', valores: {} }], colsOra)
    check('NEGATIVO: un INSERT vacío en Oracle no se construye', !vacioOra.ok && vacioOra.indice === 0, j(vacioOra))
    const ninguna = prepararEnvio('postgres', { esquema: 'public', nombre: 't' }, { tipo: 'ninguna', motivo: 'Sin clave.' }, [{ tipo: 'borrar', clave: ['1'] }], [])
    check("NEGATIVO: con identidad 'ninguna' no se construye nada", !ninguna.ok && /Sin clave/.test(ninguna.mensaje), j(ninguna))

    // EL JUEGO NACIONAL: el texto hacia una NCHAR/NVARCHAR2 (y un NCLOB corto) va
    // como bind NVARCHAR. Como VARCHAR pasaría por el juego de la base y, en una que no es
    // Unicode, lo que no cabe en él llegaría como «?». Las columnas, del mapeador REAL.
    const colsN = mapearColumnasEdicion('oracle', [
      ['K', 'NVARCHAR2', null, 'NO', null],
      ['NOM', 'NVARCHAR2', null, 'NO', null],
      ['C', 'NCHAR', null, 'NO', null],
      ['V', 'VARCHAR2', null, 'NO', null],
      ['NC', 'NCLOB', null, 'NO', null],
      ['OBJ', 'NVARCHAR2', 'HR', 'NO', null]
    ])
    check(
      'nacional: NCHAR, NVARCHAR2 y NCLOB; NO el VARCHAR2 ni un tipo de objeto que se llame igual',
      j(colsN.map((c) => c.nacional)) === j([true, true, true, false, true, false]),
      j(colsN.map((c) => [c.nombre, c.nacional]))
    )
    const PK_K = { tipo: 'pk' as const, columnas: ['K'] }
    const nLargo = 'x'.repeat(1001)
    const rn = prepararEnvio('oracle', objOra, PK_K, [{ tipo: 'actualizar', clave: ['汉'], valores: { NOM: '漢字', C: 'ñ', V: 'v', NC: 'corto' } }], colsN)
    const bn = rn.ok ? rn.sentencias[0].binds : []
    const esN = (b: unknown, valor: string): boolean => typeof b === 'object' && b !== null && (b as { entrada?: string }).entrada === 'nvarchar' && (b as { valor?: string }).valor === valor
    check(
      'UPDATE: NVARCHAR2, NCHAR, un NCLOB corto y la CLAVE nacional van como NVARCHAR; el VARCHAR2 a secas',
      rn.ok && esN(bn[0], '漢字') && esN(bn[1], 'ñ') && bn[2] === 'v' && esN(bn[3], 'corto') && esN(bn[4], '汉'),
      j(bn)
    )
    check(
      'el bloqueo (FOR UPDATE WAIT) de ese UPDATE lleva la clave nacional con el MISMO bind',
      rn.ok && rn.sentencias[0].bloqueo !== undefined && esN(rn.sentencias[0].bloqueo.binds[0], '汉'),
      rn.ok ? j(rn.sentencias[0].bloqueo) : j(rn)
    )
    const rnl = prepararEnvio('oracle', objOra, PK_K, [{ tipo: 'actualizar', clave: ['k'], valores: { NC: nLargo, NOM: '', C: null } }], colsN)
    const bnl = rnl.ok ? rnl.sentencias[0].binds : []
    check(
      "un NCLOB LARGO sigue como LOB nacional (nclob); '' y NULL, a secas (son NULL igual)",
      rnl.ok && (bnl[0] as { entrada?: string }).entrada === 'nclob' && bnl[1] === '' && bnl[2] === null,
      j(bnl.map((b) => (typeof b === 'object' && b !== null ? (b as { entrada: string }).entrada : b)))
    )
    const rnPg = prepararEnvio('postgres', { esquema: 'public', nombre: 't' }, { tipo: 'pk', columnas: ['K'] }, [{ tipo: 'actualizar', clave: ['k'], valores: { NOM: 'ñ' } }], colsN)
    check('NEGATIVO: en PG nunca (no tiene juego nacional)', rnPg.ok && rnPg.sentencias[0].binds.every((b) => typeof b === 'string'), rnPg.ok ? j(rnPg.sentencias[0].binds) : j(rnPg))
  }

  hr('(8) Un cambio que no tocó EXACTAMENTE una fila')
  {
    check('0 filas: la fila ya no está o cambió', /ya no está o cambió/.test(mensajeFilas(0, 'actualizar')) && /No se aplicó nada/.test(mensajeFilas(0, 'borrar')), mensajeFilas(0, 'actualizar'))
    check('más de una: la clave no identifica', /3 filas/.test(mensajeFilas(3, 'borrar')), mensajeFilas(3, 'borrar'))
    check('un INSERT con 0 filas lo dice de otro modo', /fila nueva/.test(mensajeFilas(0, 'insertar')), mensajeFilas(0, 'insertar'))
    // El COMMIT que falla (`indice: -1`).
    const srv = mensajeFalloCommit('23503 restricción diferida', 'servidor')
    check('COMMIT que falla por el SERVIDOR (restricción diferida): «No se aplicó nada», con el detalle', /No se aplicó nada/.test(srv) && /23503/.test(srv) && /COMMIT/.test(srv), srv)
    const perdidos = (['perdida', 'timeout', 'driver', 'cancelada'] as const).map((c) => mensajeFalloCommit('ORA-03113 fin de canal', c))
    perdidos.push(mensajeFalloCommit('interno', null))
    check(
      'NEGATIVO: una PÉRDIDA (o cualquier cosa que no sea el servidor) con el COMMIT en camino NO dice «no se aplicó nada»: dice que no se sabe y que se compruebe',
      perdidos.every((m) => !/No se aplicó nada/i.test(m) && /No se sabe/.test(m) && /comprueba/.test(m) && /COMMIT/.test(m)),
      JSON.stringify(perdidos)
    )
  }

  // Ahora la solo lectura entra por PARÁMETRO: la que IMPONE el explorador
  // (`soloLecturaImpuesta.ts`; en el producto, ninguna), nunca la casilla `readonly` de la
  // conexión, que es de los agentes. Una producción con la casilla marcada PIDE confirmación.
  hr('(9) Producción: Manual al nacer, confirmación, y la solo lectura impuesta manda')
  {
    const prod = { readonly: true, entorno: 'produccion' as const }
    const dev = { readonly: false, entorno: 'desarrollo' as const }
    const sin = { readonly: false, entorno: undefined }
    check('producción: la consola nace en Manual', txModoInicialConsola(prod, false) === 'manual', txModoInicialConsola(prod, false))
    check(
      'la casilla de los AGENTES no cuenta: producción con `readonly: true` nace en Manual y pide confirmación',
      txModoInicialConsola(prod, false) === 'manual' && exigeConfirmacion(prod, false, undefined),
      'ok'
    )
    check('NEGATIVO: con solo lectura IMPUESTA nace en Auto (invariante de la máquina)', txModoInicialConsola(prod, true) === 'auto', txModoInicialConsola(prod, true))
    check('NEGATIVO: desarrollo y sin entorno, en Auto como siempre', txModoInicialConsola(dev, false) === 'auto' && txModoInicialConsola(sin, false) === 'auto', 'auto')
    check('producción sin confirmado: se exige', exigeConfirmacion(prod, false, undefined) && exigeConfirmacion(prod, false, false), 'sí')
    check('con confirmado === true: no', !exigeConfirmacion(prod, false, true), 'no')
    check('NEGATIVO: un «true» que no es booleano no confirma', exigeConfirmacion(prod, false, 'true') && exigeConfirmacion(prod, false, 1), 'sí')
    check('NEGATIVO: fuera de producción nunca se exige', !exigeConfirmacion(dev, false, undefined) && !exigeConfirmacion(sin, false, undefined), 'no')
    check('NEGATIVO: con solo lectura impuesta tampoco (manda su guardia)', !exigeConfirmacion(prod, true, undefined), 'no')
    check('esProduccion', esProduccion(prod) && !esProduccion(dev) && !esProduccion({}), 'ok')
    const m = mensajeProduccion('ALFA-PROD', 'commit')
    check('el mensaje nombra la conexión, dice producción y que no se envió nada', m.includes('«ALFA-PROD»') && /PRODUCCIÓN/.test(m) && /COMMIT/.test(m) && /No se envió nada/.test(m), m)
  }

  hr('(10) identidad en paralelo con la página, y la caché vieja')
  {
    // `identidadAntesDeLeer` decide si el controlador ESPERA la identidad antes del
    // SELECT. Tiene que ser true en TODO caso en que `decidirIdentidad` pueda dar 'rowid'
    // (si no, la página saldría sin la columna oculta y la rejilla no podría escribir), y
    // false en el resto (si no, la primera apertura volvería a pagar el viaje de más). Se
    // recorren todas las combinaciones, con temporal/externa/unica en las dos posiciones:
    // esas las dice la consulta que se espera, así que no pueden decidir.
    let malos: string[] = []
    let paralelas = 0
    for (const motor of IDS_MOTORES_SQL) {
      for (const soloLectura of [false, true]) {
        for (const remoto of [false, true]) {
          for (const sistema of [false, true]) {
            for (const tipo of ['tabla', 'vista', 'vistaMaterializada', 'tablaForanea'] as const) {
              for (const pk of [[], ['ID']]) {
                const e = { motor, soloLectura, remoto, sistema, tipo, pk }
                const antes = identidadAntesDeLeer(e)
                if (!antes) paralelas++
                for (const temporal of [false, true]) {
                  for (const externa of [false, true]) {
                    for (const unica of [null, ['U']]) {
                      const puedeRowid = decidirIdentidad({ ...e, temporal, externa, unica }).tipo === 'rowid'
                      if (puedeRowid && !antes) malos.push(j({ ...e, temporal, externa, unica }))
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    check('toda combinación que puede dar ROWID espera la identidad antes de leer', malos.length === 0, malos.slice(0, 3).join(' | ') || 'ninguna')
    check('Oracle sin PK, tabla de usuario en escritura: espera (el SELECT lleva el ROWID)', identidadAntesDeLeer({ ...BASE, motor: 'oracle' }), 'sí')
    malos = []
    const noEsperan: Array<[string, Parameters<typeof identidadAntesDeLeer>[0]]> = [
      ['PG sin PK (la UNIQUE no cambia el SELECT)', BASE],
      ['PG con PK', { ...BASE, pk: ['id'] }],
      ['Oracle con PK', { ...BASE, motor: 'oracle', pk: ['ID'] }],
      ['Oracle en solo lectura', { ...BASE, motor: 'oracle', soloLectura: true }],
      ['una vista de Oracle', { ...BASE, motor: 'oracle', tipo: 'vista' }],
      ['algo remoto', { ...BASE, motor: 'oracle', remoto: true }],
      ['SYS.DUAL', { ...BASE, motor: 'oracle', sistema: true }]
    ]
    for (const [nombre, e] of noEsperan) if (identidadAntesDeLeer(e)) malos.push(nombre)
    check('NEGATIVO: todo lo demás va EN PARALELO (no espera el viaje de catálogo)', malos.length === 0 && paralelas > 0, malos.join(', ') || `${paralelas} combinaciones en paralelo`)

    // `columnasFueraDelCatalogo`: lo que delata una caché de edición anterior a un DDL
    // hecho FUERA de Tessera. La del ROWID nunca cuenta (no está en el catálogo).
    const cat = [columna('ID'), columna('NOMBRE')]
    check('una columna que la página trae y el catálogo no: se delata', j(columnasFueraDelCatalogo(['ID', 'NOMBRE', 'NUEVA'], cat)) === j(['NUEVA']), j(columnasFueraDelCatalogo(['ID', 'NOMBRE', 'NUEVA'], cat)))
    check(
      'NEGATIVO: la columna oculta del ROWID no cuenta (si contara, cada apertura sin PK de Oracle releería el catálogo)',
      columnasFueraDelCatalogo(['ID', 'NOMBRE', COLUMNA_ROWID], cat).length === 0,
      j(columnasFueraDelCatalogo(['ID', 'NOMBRE', COLUMNA_ROWID], cat))
    )
    check(
      'NEGATIVO: una columna que el catálogo tiene y la página no (borrada fuera) no obliga a releer',
      columnasFueraDelCatalogo(['ID'], cat).length === 0,
      j(columnasFueraDelCatalogo(['ID'], cat))
    )
    check('NEGATIVO: el nombre se compara EXACTO (Oracle distingue "Nueva" de NUEVA)', j(columnasFueraDelCatalogo(['id'], cat)) === j(['id']), j(columnasFueraDelCatalogo(['id'], cat)))
  }

  hr('(11) concurrencia optimista (`originales`) con la identidad ROWID')
  {
    // Qué columnas de Oracle se comparan EXACTAS con lo leído, por su tipo del catálogo.
    const ora = mapearColumnasEdicion('oracle', [
      ['V2', 'VARCHAR2', null, 'NO', null],
      ['CH', 'CHAR', null, 'NO', null],
      ['NUM', 'NUMBER', null, 'NO', null],
      ['VIRT', 'NUMBER', null, 'YES', null],
      ['ALTA', 'DATE', null, 'NO', null],
      ['TS6', 'TIMESTAMP(6)', null, 'NO', null],
      ['TS3Z', 'TIMESTAMP(3) WITH TIME ZONE', null, 'NO', null],
      ['TS9', 'TIMESTAMP(9)', null, 'NO', null],
      ['TSL', 'TIMESTAMP(6) WITH LOCAL TIME ZONE', null, 'NO', null],
      ['NV', 'NVARCHAR2', null, 'NO', null],
      ['NC', 'NCHAR', null, 'NO', null],
      ['FL', 'FLOAT', null, 'NO', null],
      ['BD', 'BINARY_DOUBLE', null, 'NO', null],
      ['BF', 'BINARY_FLOAT', null, 'NO', null],
      ['IV', 'INTERVAL DAY(2) TO SECOND(6)', null, 'NO', null],
      ['DOC', 'CLOB', null, 'NO', null],
      ['BL', 'BLOB', null, 'NO', null],
      ['RW', 'RAW', null, 'NO', null],
      ['LG', 'LONG', null, 'NO', null],
      ['XML', 'XMLTYPE', 'SYS', 'NO', null],
      ['OBJ', 'MI_TIPO', 'HR', 'NO', null],
      ['RID', 'ROWID', null, 'NO', null],
      ['URID', 'UROWID', null, 'NO', null]
    ])
    const comp = (n: string): string | null | undefined => ora.find((c) => c.nombre === n)?.comparable
    const si: Array<[string, string]> = [['V2', 'texto'], ['CH', 'texto'], ['NUM', 'numero'], ['VIRT', 'numero'], ['ALTA', 'fecha'], ['TS6', 'marca'], ['TS3Z', 'marcaZona']]
    check(
      'Oracle comparables: VARCHAR2, CHAR, NUMBER (también la VIRTUAL, que no se edita), DATE y TIMESTAMP de hasta 6 decimales, con zona',
      si.every(([n, f]) => comp(n) === f),
      j(si.map(([n]) => [n, comp(n)]))
    )
    const no = ['TS9', 'TSL', 'NV', 'NC', 'FL', 'BD', 'BF', 'IV', 'DOC', 'BL', 'RW', 'LG', 'XML', 'OBJ', 'RID', 'URID']
    check(
      'NEGATIVO: ni más de 6 decimales, ni hora LOCAL, ni N-tipos, ni coma flotante, ni INTERVAL, LOB, binarias, LONG, objetos o ROWID',
      no.every((n) => comp(n) === null),
      j(no.filter((n) => comp(n) !== null).map((n) => [n, comp(n)]))
    )
    const pgc = mapearColumnasEdicion('postgres', [['id', 'integer', 'int4', '', ''], ['nombre', 'text', 'text', '', '']])
    check('NEGATIVO: en PG nada (su identidad nunca es el ROWID)', pgc.every((c) => c.comparable === null), j(pgc.map((c) => c.comparable)))

    // La FORMA en «Enviar»: opcional, como los valores, copiada; mal formada, rechazada.
    const base = { conexionId: 'c1', peticionId: 'p', objeto: {}, identidad: { tipo: 'rowid', columna: COLUMNA_ROWID } }
    const bien = validarFormaEnvio({
      ...base,
      cambios: [
        { tipo: 'actualizar', clave: ['AAA'], valores: { V2: 'x' }, originales: { V2: 'viejo', NUM: null } },
        { tipo: 'borrar', clave: ['BBB'], originales: { NUM: '7' } },
        { tipo: 'insertar', valores: { V2: 'n' }, originales: { V2: 'no pinta nada' } },
        { tipo: 'borrar', clave: ['CCC'] }
      ]
    })
    const cs = bien.ok ? bien.valor.cambios : []
    check(
      'originales en actualizar y borrar: pasan COPIADOS; en insertar no viajan; sin ellos, nada',
      bien.ok &&
        j((cs[0] as { originales?: unknown }).originales) === j({ V2: 'viejo', NUM: null }) &&
        j((cs[1] as { originales?: unknown }).originales) === j({ NUM: '7' }) &&
        !('originales' in cs[2]) &&
        !('originales' in cs[3]),
      j(cs)
    )
    for (const [nombre, o] of [['en array', ['x']], ['un texto', 'x'], ['null', null]] as Array<[string, unknown]>) {
      const r = validarFormaEnvio({ ...base, cambios: [{ tipo: 'actualizar', clave: ['AAA'], valores: { V2: 'x' }, originales: o }] })
      check(`NEGATIVO: originales ${nombre} (no es un objeto): la petición se rechaza`, !r.ok && /originales/.test(r.mensaje), r.ok ? 'pasó' : r.mensaje)
    }
    // Una ENTRADA que no se entiende se descarta y el envío sigue: los originales son una
    // comprobación de más, y un booleano de una columna de PG no puede impedir guardar.
    const raras = validarFormaEnvio({
      ...base,
      cambios: [{ tipo: 'borrar', clave: ['AAA'], originales: { NUM: 7, B: true, '': 'x', OBJ: { a: 1 }, LARGO: 'x'.repeat(DB_VALOR_MAX + 1), V2: 'bien', NULA: null } }]
    })
    check(
      'las entradas raras (número, booleano, sin nombre, objeto, demasiado largo) se DESCARTAN; las buenas pasan',
      raras.ok && j((raras.valor.cambios[0] as { originales?: unknown }).originales) === j({ V2: 'bien', NULA: null }),
      raras.ok ? j(raras.valor.cambios[0]) : raras.mensaje
    )

    // El FILTRO del main.
    const rid: DbIdentidadFila = { tipo: 'rowid', columna: COLUMNA_ROWID }
    const leidos = {
      V2: 'Ana',
      CH: 'ab   ',
      NUM: '0.5',
      VIRT: '1.0E+125',
      ALTA: '2024-03-31 02:30:00',
      TS6: '2024-01-15 10:20:30.123456',
      TS3Z: '2024-01-15 10:20:30.123000 +01:00',
      NULA: null,
      DOC: 'un CLOB',
      NV: 'ñ',
      FL: '0.1',
      [COLUMNA_ROWID]: 'AAA',
      FANTASMA: 'x'
    }
    const conFantasma = [...ora, columna('NULA', { tipo: 'VARCHAR2', comparable: 'texto' })]
    const f = originalesComparables(rid, leidos, conFantasma)
    check(
      'con ROWID: se quedan las comparables (y un NULL); fuera el CLOB, el N-tipo, el FLOAT, la del ROWID y la que no está en el catálogo',
      j(Object.keys(f ?? {}).sort()) === j(['ALTA', 'CH', 'NULA', 'NUM', 'TS3Z', 'TS6', 'V2', 'VIRT']) && f?.NULA === null && f?.CH === 'ab   ',
      j(f)
    )
    check('NEGATIVO: con la PK, ninguno (identifica por el VALOR)', originalesComparables({ tipo: 'pk', columnas: ['ID'] }, leidos, conFantasma) === undefined, 'undefined')
    check('NEGATIVO: sin originales, o si no queda ninguno, undefined (el WHERE de siempre)', originalesComparables(rid, undefined, ora) === undefined && originalesComparables(rid, { DOC: 'x' }, ora) === undefined, 'undefined')
    const raros = originalesComparables(
      rid,
      { NUM: '~', ALTA: '-0044-03-15 00:00:00', TS6: '2024-01-15 10:20:30.123456789', TS3Z: '2024-01-15 10:20:30.123', V2: '~' },
      ora
    )
    check(
      'un valor que la sesión no sabe leer se descarta (NUMBER infinito, fecha con signo, 9 decimales, sin zona); el texto, nunca',
      j(raros) === j({ V2: '~' }),
      j(raros)
    )
    // Revisión: un texto leído CON PÉRDIDA (bytes inválidos en el juego de la base, que se
    // leen como U+FFFD) no casa nunca consigo mismo: medido en la 11.2 y la 21c, y en
    // test-db-oracle (27). Se descarta ESA comprobación; las demás siguen.
    const perdidos = originalesComparables(rid, { V2: 'A\uFFFDB', CH: '\uFFFD     ', NUM: '1' }, ora)
    check('un texto leído con pérdida (U+FFFD) se descarta; el resto de la fila sigue comprobándose', j(perdidos) === j({ NUM: '1' }), j(perdidos))
    const sanos = originalesComparables(rid, { V2: 'Ñandú 😀 ?', CH: 'ab   ' }, ora)
    check('NEGATIVO: un texto sin U+FFFD (acentos, emoji, un «?» de verdad, blancos) se queda', j(sanos) === j({ V2: 'Ñandú 😀 ?', CH: 'ab   ' }), j(sanos))
    const vacios = originalesComparables(rid, { NUM: '', ALTA: '' }, ora)
    check("'' se conserva (en Oracle ES NULL, y el constructor lo compara como tal)", j(vacios) === j({ NUM: '', ALTA: '' }), j(vacios))
    const viejaCache = originalesComparables(rid, { V2: 'x' }, [{ nombre: 'V2', tipo: 'VARCHAR2', noEditable: null, binaria: false, lob: null } as unknown as ColumnaEdicion])
    check('NEGATIVO: una columna de caché sin el campo `comparable` no se compara', viejaCache === undefined, j(viejaCache))

    // Lo que queda llega al WHERE de la MISMA sentencia de la vista previa.
    const obj = { esquema: 'HR', nombre: 'SIN_PK' }
    const cambios: DbCambioFila[] = [
      { tipo: 'actualizar', clave: ['AAAR3s'], valores: { V2: 'nuevo' }, originales: { V2: 'Ana', NUM: '0.5', DOC: 'fuera', NV: 'fuera', ALTA: null } },
      { tipo: 'borrar', clave: ['AAAR3t'], originales: { NUM: '7', FL: 'fuera' } }
    ]
    const r = prepararEnvio('oracle', obj, rid, cambios, ora)
    const esperado0 = sentenciaDeCambio('oracle', obj, rid, { tipo: 'actualizar', clave: ['AAAR3s'], valores: { V2: 'nuevo' }, originales: { V2: 'Ana', NUM: '0.5', ALTA: null } })
    const esperado1 = sentenciaDeCambio('oracle', obj, rid, { tipo: 'borrar', clave: ['AAAR3t'], originales: { NUM: '7' } })
    check(
      'el UPDATE y el DELETE son los de `sentenciaDeCambio` con SOLO los originales comparables',
      r.ok && r.sentencias[0].sql === esperado0.sql && j(r.sentencias[0].binds) === j(esperado0.binds) && r.sentencias[1].sql === esperado1.sql && j(r.sentencias[1].binds) === j(esperado1.binds),
      r.ok ? j(r.sentencias.map((s) => [s.sql, s.binds])) : j(r)
    )
    const donde = r.ok ? r.sentencias[0].sql.slice(r.sentencias[0].sql.indexOf(' WHERE ')) : ''
    check(
      '… y en su WHERE están las comparables y NO las descartadas',
      /"V2"/.test(donde) && /"NUM"/.test(donde) && /"ALTA"/.test(donde) && !/"DOC"|"NV"/.test(donde),
      donde
    )
    const sinOrig = prepararEnvio('oracle', obj, rid, [{ tipo: 'actualizar', clave: ['AAAR3s'], valores: { V2: 'nuevo' } }], ora)
    check('NEGATIVO: sin originales, el WHERE lleva solo el ROWID', sinOrig.ok && /WHERE ROWID = :2$/.test(sinOrig.sentencias[0].sql), sinOrig.ok ? sinOrig.sentencias[0].sql : j(sinOrig))
    const conPk = prepararEnvio('oracle', obj, { tipo: 'pk', columnas: ['NUM'] }, [{ tipo: 'actualizar', clave: ['1'], valores: { V2: 'x' }, originales: { V2: 'Ana' } }], ora)
    check('NEGATIVO: con la PK los originales no llegan al WHERE', conPk.ok && /WHERE "NUM" = :2$/.test(conPk.sentencias[0].sql), conPk.ok ? conPk.sentencias[0].sql : j(conPk))
    check(
      'el cambio que llegó no se toca (el filtro trabaja sobre una copia)',
      j((cambios[0] as { originales?: unknown }).originales) === j({ V2: 'Ana', NUM: '0.5', DOC: 'fuera', NV: 'fuera', ALTA: null }),
      j(cambios[0])
    )

    // (11b) La REGLA ES UNA (`shared/sql/originalesSql.ts`). La
    // rejilla elige con el `tipoMotor` del trabajador y la lista `comparables` que el main
    // manda al abrir; el main filtra con su catálogo. Aquí, las mismas columnas nombradas
    // por los dos lados (el catálogo de arriba y lo que da `tipoMotorOracle` de celdas.cjs):
    // lo que la rejilla manda, el main lo conserva ENTERO, así que la vista previa enseña
    // exactamente lo que corre. Antes se separaron dos veces (VARCHAR; el U+FFFD).
    const lista = comparablesDe(ora)
    check('comparablesDe: las del catálogo con `comparable`, en su orden', j(lista) === j(['V2', 'CH', 'NUM', 'VIRT', 'ALTA', 'TS6', 'TS3Z']), j(lista))
    const colR = (nombre: string, tipoLogico: DbColumnaResultado['tipoLogico'], tipoMotor: string): DbColumnaResultado => ({ nombre, tipoLogico, tipoMotor })
    // El trabajador da VARCHAR2 y CHAR sin tamaño (el driver no
    // sabe su unidad; ver `tipoMotorOracle`), que es lo que llega aquí.
    const delTrabajador: DbColumnaResultado[] = [
      colR('V2', 'texto', 'VARCHAR2'),
      colR('CH', 'texto', 'CHAR'),
      colR('NUM', 'numero', 'NUMBER'),
      colR('VIRT', 'numero', 'NUMBER'),
      colR('ALTA', 'fechaHora', 'DATE'),
      colR('TS6', 'fechaHora', 'TIMESTAMP(6)'),
      colR('TS3Z', 'fechaHora', 'TIMESTAMP(3) WITH TIME ZONE'),
      colR('TS9', 'fechaHora', 'TIMESTAMP(9)'),
      colR('TSL', 'fechaHora', 'TIMESTAMP(6) WITH LOCAL TIME ZONE'),
      colR('NV', 'texto', 'NVARCHAR2(80)'),
      colR('NC', 'texto', 'NCHAR(12)'),
      colR('FL', 'numero', 'FLOAT(126)'),
      colR('BD', 'numero', 'BINARY_DOUBLE'),
      colR('BF', 'numero', 'BINARY_FLOAT'),
      colR('IV', 'otro', 'INTERVAL DAY TO SECOND'),
      colR('DOC', 'lob', 'CLOB'),
      colR('BL', 'lob', 'BLOB'),
      colR('RW', 'binario', 'RAW(16)'),
      colR('LG', 'texto', 'LONG'),
      colR('XML', 'texto', 'XMLTYPE'),
      colR('OBJ', 'otro', 'HR.MI_TIPO'),
      colR('RID', 'texto', 'ROWID'),
      colR('URID', 'texto', 'UROWID'),
      colR(COLUMNA_ROWID, 'texto', 'VARCHAR2')
    ]
    const discrepan = delTrabajador
      .filter((c) => c.nombre !== COLUMNA_ROWID)
      .filter((c) => columnaComparable(c) !== (comp(c.nombre) !== null))
      .map((c) => c.nombre)
    check('la rejilla (por el tipoMotor) y el main (por el catálogo) deciden IGUAL en cada columna', discrepan.length === 0, j(discrepan))
    const filaBuena: DbCelda[] = [
      'Ana', 'ab   ', '0.5', '1.0E+125', '2024-03-31 02:30:00', '2024-01-15 10:20:30.123456', '2024-01-15 10:20:30.123000 +01:00',
      '2024-01-15 10:20:30.123456', '2024-01-15 10:20:30.500000', 'ñ', 'ñ  ', '0.1', '0.1', '0.1', '+01 02:03:04.000000', 'clob',
      '0x00', '0xAB', 'largo', '<a/>', '{}', 'AAAR3sAAEAAAAFbAAA', 'AAAR3s', 'AAAR3sAAEAAAAFbAAA'
    ]
    const filaRara: DbCelda[] = [...filaBuena]
    filaRara[0] = 'A' + String.fromCharCode(0xfffd) + 'B' // leído con pérdida
    filaRara[2] = '~' // NUMBER infinito
    filaRara[5] = null
    filaRara[23] = 'AAAR3sAAEAAAAFbAAB'
    const conv = aCambiosFila(borrarFilas(SIN_CAMBIOS, [{ tipo: 'servidor', f: 0 }, { tipo: 'servidor', f: 1 }]), {
      columnas: delTrabajador,
      identidad: rid,
      filas: [filaBuena, filaRara],
      comparables: lista
    })
    const mandados = conv.ok ? conv.cambios.map((c) => (c.tipo === 'insertar' ? undefined : c.originales)) : []
    const conservados = mandados.map((o) => originalesComparables(rid, o, ora))
    check(
      'lo que manda la rejilla, el main lo conserva ENTERO (la vista previa es lo que corre), también sin U+FFFD, «~» ni NULL de más',
      conv.ok && mandados.length === 2 && mandados.every((o) => o !== undefined) && j(conservados) === j(mandados),
      j({ mandados, conservados })
    )
    check(
      '… y son exactamente las siete comparables de la fila sana; en la rara, sin el texto con U+FFFD ni el «~», con el NULL',
      j(Object.keys(mandados[0] ?? {})) === j(lista) && j(mandados[1]) === j({ CH: 'ab   ', VIRT: '1.0E+125', ALTA: '2024-03-31 02:30:00', TS6: null, TS3Z: '2024-01-15 10:20:30.123000 +01:00' }),
      j(mandados)
    )
  }

  hr('(12) la espera de bloqueos de «Enviar», con tope')
  {
    const rid: DbIdentidadFila = { tipo: 'rowid', columna: COLUMNA_ROWID }
    const obj = { esquema: 'HR', nombre: 'DOCS' }
    const cols = [
      columna('ID', { tipo: 'NUMBER', comparable: 'numero' }),
      columna('V', { tipo: 'VARCHAR2', comparable: 'texto' }),
      columna('GUID', { tipo: 'RAW', binaria: true, noEditable: 'Binaria' })
    ]
    const cambios: DbCambioFila[] = [
      { tipo: 'actualizar', clave: ['AAAR3s'], valores: { V: 'nuevo' }, originales: { V: 'viejo', ID: '1' } },
      { tipo: 'insertar', valores: { ID: '9', V: 'x' } },
      { tipo: 'borrar', clave: ['AAAR3t'] }
    ]
    const r = prepararEnvio('oracle', obj, rid, cambios, cols)
    const del0 = sentenciaDeCambio('oracle', obj, rid, { tipo: 'borrar', clave: ['AAAR3s'] })
    const b0 = r.ok ? r.sentencias[0].bloqueo : undefined
    check(
      'Oracle UPDATE: lleva la IDENTIDAD de su fila (tabla, ROWID y su bind, los del WHERE de su DML) y NO los originales (los compara el DML)',
      b0 !== undefined && b0.tabla === '"HR"."DOCS"' && j(b0.columnas) === j(['ROWID']) && j(b0.binds) === j(['AAAR3s']) && j(b0.binds) === j(del0.binds) &&
        r.ok && /"V" = :\d/.test(r.sentencias[0].sql),
      j(b0)
    )
    const b2 = r.ok ? r.sentencias[2].bloqueo : undefined
    check('Oracle DELETE: también', b2 !== undefined && j(b2.columnas) === j(['ROWID']) && j(b2.binds) === j(['AAAR3t']), j(b2))
    check('NEGATIVO: un INSERT no lleva bloqueo (no hay fila que esperar antes)', r.ok && r.sentencias[1].bloqueo === undefined, r.ok ? j(r.sentencias[1]) : '')
    const conPk = prepararEnvio('oracle', obj, { tipo: 'pk', columnas: ['GUID'] }, [{ tipo: 'borrar', clave: ['0x0A0B'] }], cols)
    check(
      'con una clave BINARIA, la columna citada y su bind convertido como el del DML (hex desnudo)',
      conPk.ok && j(conPk.sentencias[0].bloqueo?.columnas) === j(['"GUID"']) && j(conPk.sentencias[0].bloqueo?.binds) === j(['0A0B']),
      conPk.ok ? j(conPk.sentencias[0].bloqueo) : j(conPk)
    )
    const pg = prepararEnvio('postgres', { esquema: 'public', nombre: 't' }, { tipo: 'pk', columnas: ['id'] }, [{ tipo: 'actualizar', clave: ['1'], valores: { v: 'x' } }, { tipo: 'borrar', clave: ['2'] }], [columna('id'), columna('v')])
    check('NEGATIVO: en PG ninguna sentencia lleva bloqueo (va el lock_timeout de la transacción)', pg.ok && pg.sentencias.every((s) => s.bloqueo === undefined), pg.ok ? j(pg.sentencias) : j(pg))
    check('NEGATIVO: y en PG no hay candados de lote', pg.ok && lotesDeBloqueo('postgres', pg.sentencias).length === 0, 'ok')

    // el candado POR LOTES (antes, un SELECT … FOR UPDATE por fila:
    // un viaje más por cambio). Ahora la sentencia es la de la sesión
    // de Oracle (`esperaBloqueo.sqlCandado`), con el texto de siempre.
    const lotes3 = r.ok ? lotesDeBloqueo('oracle', r.sentencias) : []
    check(
      `el envío de 3 (UPDATE, INSERT, DELETE): UN candado con las dos filas, ROWID IN (…) FOR UPDATE WAIT ${ESPERA_BLOQUEO_ENVIO_S}, relleno a potencia de dos`,
      lotes3.length === 1 && lotes3[0].sql === 'SELECT 1 FROM "HR"."DOCS" WHERE ROWID IN (:1, :2) FOR UPDATE WAIT 10' && j(lotes3[0].binds) === j(['AAAR3s', 'AAAR3t']) && j(lotes3[0].indices) === j([0, 2]),
      j(lotes3)
    )
    const muchos: DbCambioFila[] = Array.from({ length: 2500 }, (_, i) => (i % 5 === 4 ? { tipo: 'insertar', valores: { V: String(i) } } : { tipo: 'actualizar', clave: [`AAA${i}`], valores: { V: 'x' } }))
    const rm = prepararEnvio('oracle', obj, rid, muchos, cols)
    const lm = rm.ok ? lotesDeBloqueo('oracle', rm.sentencias) : []
    const conBloqueo = rm.ok ? rm.sentencias.filter((s) => s.bloqueo).length : 0
    check(
      `2500 cambios (2000 UPDATE y 500 INSERT): ${Math.ceil(2000 / MAX_ELEMENTOS_LISTA_IN)} candados de hasta ${MAX_ELEMENTOS_LISTA_IN} filas (ORA-01795), en el orden del envío y sin los INSERT`,
      conBloqueo === 2000 && lm.length === 2 && lm[0].indices.length === 1000 && lm[1].indices.length === 1000 &&
        j([...lm[0].indices, ...lm[1].indices]) === j(Array.from({ length: 2500 }, (_, i) => i).filter((i) => i % 5 !== 4)),
      j(lm.map((l) => [l.indices.length, l.binds.length, l.indices[0], l.indices[l.indices.length - 1]]))
    )
    const pocos = rm.ok ? lotesDeBloqueo('oracle', rm.sentencias.slice(0, 7)) : []
    check(
      'un lote de 6 filas va rellenado a 8 repitiendo la última clave (mismo texto para 5-8 filas)',
      pocos.length === 1 && pocos[0].binds.length === 8 && pocos[0].indices.length === 6 && pocos[0].binds[7] === pocos[0].binds[5] && (pocos[0].sql.match(/:\d+/g) ?? []).length === 8,
      j(pocos)
    )
    const tamanos = new Set<number>()
    for (let n = 1; n <= MAX_ELEMENTOS_LISTA_IN; n++) tamanos.add(filasConRelleno(n, MAX_ELEMENTOS_LISTA_IN))
    check(
      `de 1 a ${MAX_ELEMENTOS_LISTA_IN} filas, como mucho 11 textos distintos (1, 2, 4… 512 y el tope), y nunca menos filas de las pedidas`,
      tamanos.size === 11 && filasConRelleno(1, 1000) === 1 && filasConRelleno(600, 1000) === 1000 && filasConRelleno(300, 500) === 500 && filasConRelleno(1000, 1000) === 1000,
      j([...tamanos])
    )
    // Clave COMPUESTA: tuplas, y las que quepan en mil binds.
    const PK2: DbIdentidadFila = { tipo: 'pk', columnas: ['ID', 'V'] }
    const comp = prepararEnvio('oracle', obj, PK2, Array.from({ length: 1200 }, (_, i) => ({ tipo: 'borrar' as const, clave: [String(i), `k${i}`] })), cols)
    const lc = comp.ok ? lotesDeBloqueo('oracle', comp.sentencias) : []
    check(
      `clave compuesta: ("ID", "V") IN ((:1, :2), …), ${filasPorLote(2)} tuplas por candado (mil binds) y el último relleno a 256`,
      lc.length === 3 && lc[0].indices.length === 500 && lc[0].binds.length === 1000 && lc[2].indices.length === 200 && lc[2].binds.length === 512 &&
        lc[0].sql.startsWith('SELECT 1 FROM "HR"."DOCS" WHERE ("ID", "V") IN ((:1, :2), (:3, :4), ') && lc[0].sql.endsWith('(:999, :1000)) FOR UPDATE WAIT 10'),
      j(lc.map((l) => [l.indices.length, l.binds.length, l.sql.slice(0, 80)]))
    )
    const sonda = r.ok ? loteDeBloqueo('oracle', r.sentencias, [2], 'nowait') : null
    check('la sonda de la búsqueda: el mismo candado con NOWAIT (falla al instante)', sonda?.sql === 'SELECT 1 FROM "HR"."DOCS" WHERE ROWID IN (:1) FOR UPDATE NOWAIT' && j(sonda.binds) === j(['AAAR3t']), j(sonda))
    let mezcla = ''
    try {
      if (r.ok && conPk.ok) loteDeBloqueo('oracle', [r.sentencias[0], conPk.sentencias[0]], [0, 1], 'wait')
    } catch (e) {
      mezcla = e instanceof Error ? e.message : String(e)
    }
    check('NEGATIVO: un candado con filas de dos identidades distintas no se construye', /identidades distintas/.test(mezcla), mezcla)
    let enPg = ''
    try {
      if (r.ok) loteDeBloqueo('postgres', r.sentencias, [0], 'wait')
    } catch (e) {
      enPg = e instanceof Error ? e.message : String(e)
    }
    check('NEGATIVO: un motor que espera por transacción no construye candados por fila (no tiene con qué)', /espera por transacción/.test(enPg), enPg)
    const partido = r.ok && conPk.ok ? lotesDeBloqueo('oracle', [r.sentencias[0], conPk.sentencias[0], r.sentencias[2]]) : []
    check('… y los lotes se parten donde cambia la identidad (defensivo: un envío es de UNA tabla)', j(partido.map((l) => l.indices)) === j([[0], [1], [2]]), j(partido.map((l) => l.indices)))

    // La BISECCIÓN que encuentra el cambio de la fila bloqueada.
    const buscar = async (n: number, culpables: number[]): Promise<{ r: number | null; sondas: number }> => {
      let sondas = 0
      const indices = Array.from({ length: n }, (_, i) => i * 3)
      const res = await primerCulpable(indices, async (sub) => {
        sondas++
        return sub.some((x) => culpables.includes(x))
      })
      return { r: res, sondas }
    }
    const casos: Array<[number, number[]]> = [[1000, [0]], [1000, [2997]], [1000, [1500, 2400]], [7, [9]], [2, [3]], [1000, [3 * 511]]]
    const halladas = await Promise.all(casos.map(([n, c]) => buscar(n, c)))
    check(
      'encuentra el PRIMER cambio culpable en el orden del envío, con como mucho 2·log2(n) sondas (20 para 1000)',
      halladas.every((h, k) => h.r === Math.min(...casos[k][1]) && h.sondas <= 2 * Math.ceil(Math.log2(casos[k][0]))),
      j(halladas)
    )
    const suelta = await buscar(1000, [])
    check('si ya no falla ninguna mitad (la otra transacción la soltó): null, sin inventar', suelta.r === null && suelta.sondas <= 2, j(suelta))
    const uno = await buscar(1, [])
    check('un lote de una sola fila ES esa fila, sin sondas', uno.r === 0 && uno.sondas === 0, j(uno))
    let propagado = ''
    try {
      await primerCulpable([1, 2, 3], async () => {
        throw new Error('sesión perdida')
      })
    } catch (e) {
      propagado = e instanceof Error ? e.message : ''
    }
    check('lo que lanza la sonda (una pérdida, un Stop) sale tal cual: no hay culpable que buscar', propagado === 'sesión perdida', propagado)
    check(
      "el «ocupada» del NOWAIT (ORA-00054) es la espera del lote dicha sin esperar; NEGATIVO: ni el ORA-30006, ni un ROWID mal formado, ni sin código",
      esOcupadaSinEspera('oracle', 'ORA-00054') &&
        !esOcupadaSinEspera('oracle', 'ORA-30006') &&
        !esOcupadaSinEspera('oracle', 'ORA-01410') &&
        !esOcupadaSinEspera('oracle', undefined),
      'ok'
    )
    check(
      'NEGATIVO: PG no tiene sondas sin espera (espera por transacción): ningún código es su «ocupada»',
      !esOcupadaSinEspera('postgres', 'ORA-00054') && !esOcupadaSinEspera('postgres', '55P03') && !esOcupadaSinEspera('postgres', undefined),
      'ok'
    )
    const nota = notaSinCulpable(0, 999, true)
    check(
      'la nota cuando no se pudo señalar: los cambios del lote (base 1) y el porqué',
      nota === '(No se pudo saber cuál de los cambios 1 a 1000: al buscarla, la otra transacción ya la había soltado.)' && notaSinCulpable(4, 9, false) === '(No se pudo saber cuál de los cambios 5 a 10.)',
      nota
    )
    // El SQL de PG se lee de donde sale de verdad (la sesión de PG, por
    // `sqlEsperaBloqueoTransaccion`), no de una copia exportada solo para los tests.
    const topePg = sqlEsperaBloqueoTransaccion('postgres')
    check("PG: SET LOCAL lock_timeout = '10s' (muere con la transacción)", topePg === "SET LOCAL lock_timeout = '10s'", String(topePg))
    check('al vencer: ORA-30006 en Oracle (FOR UPDATE WAIT) y 55P03 en PG (lock_timeout)', esEsperaDeBloqueo('oracle', 'ORA-30006') && esEsperaDeBloqueo('postgres', '55P03'), 'sí')
    const noEsperas = ['ORA-00060', '40P01', 'ORA-00054', 'ORA-01013', '57014', undefined]
    check(
      'NEGATIVO: ni un deadlock, ni el NOWAIT, ni un Stop, ni sin código, en ninguno de los dos',
      IDS_MOTORES_SQL.every((m) => noEsperas.every((c) => !esEsperaDeBloqueo(m, c))),
      'no'
    )
    // el código es de CADA motor (`esperaBloqueo.codigoVencida`), no de
    // un conjunto con los de todos: el de un motor no cuenta en el otro.
    check(
      'el código de un motor no cuenta en el otro (antes, un conjunto común)',
      !esEsperaDeBloqueo('postgres', 'ORA-30006') && !esEsperaDeBloqueo('oracle', '55P03'),
      'ok'
    )
    const m = mensajeFilaBloqueada('actualizar')
    check(
      'el mensaje: bloqueada por otra transacción (quizá una consola tuya), no se aplicó nada, qué hacer',
      m === 'La fila está bloqueada por otra transacción (quizá una consola tuya con cambios sin confirmar). No se aplicó nada: confirma o revierte esa transacción y vuelve a enviar.' &&
        mensajeFilaBloqueada('borrar') === m,
      m
    )
    const mi = mensajeFilaBloqueada('insertar')
    check('un INSERT (PG) que choca con una clave sin confirmar lo dice con sus palabras', /fila nueva/.test(mi) && /No se aplicó nada/.test(mi) && /vuelve a enviar/.test(mi), mi)
  }

  hr('(13) Lo que decide el motor, sin literales y con los valores de antes')
  {
    // Los esquemas del sistema: la regla de antes, escrita aquí a mano (Oracle: la lista de
    // shared; PG: tres nombres exactos), contra lo que responde ahora el descriptor.
    const nombres = ['SYS', 'SYSTEM', 'XDB', 'APEX_040200', 'HR', 'SCOTT', 'sys', 'pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'public', 'PUBLIC', '']
    // (SQLite no tiene esquemas del sistema por nombre: solo `main`. SQL
    // Server: `sys`, `INFORMATION_SCHEMA`, `guest` y los de los roles fijos, por nombre EXACTO.)
    const reglaDeAntes = (m: string, n: string): boolean =>
      m === 'oracle'
        ? esEsquemaSistemaOracle(n)
        : m === 'postgres'
          ? n === 'pg_catalog' || n === 'information_schema' || n === 'pg_toast'
          : m === 'sqlserver'
            ? n === 'sys'
            : false
    const distintos = IDS_MOTORES_SQL.flatMap((m) => nombres.filter((n) => esEsquemaDelSistema(m, n) !== reglaDeAntes(m, n)).map((n) => `${m}/${n}`))
    check(`esEsquemaDelSistema: ${nombres.length} nombres por motor, la respuesta de antes`, distintos.length === 0, distintos.join(', ') || 'iguales')

    // La espera de bloqueos: la forma y su SQL son UN valor
    // de la sesión de cada motor (`esperaBloqueo`), y lo demás se DERIVA de él:
    // 'porTransaccion' ⇔ hay SQL de tope (el que lleva la forma), y 'porFila' ⇔ los
    // UPDATE/DELETE llevan la identidad de su fila para el candado.
    const incoherentes: string[] = []
    const COLS: ColumnaEdicion[] = [{ nombre: 'ID', tipo: 'NUMBER', noEditable: null, binaria: false, lob: null, nacional: false, comparable: null }]
    // Un motor cuya sesión del main es aún un ESQUELETO queda fuera mientras lo sea.
    for (const m of IDS_MOTORES_SQL.filter((x) => !enEsqueleto(() => MOTORES_EXPLORADOR[x].sesion.sqlLeerEsquema()))) {
      const espera = MOTORES_EXPLORADOR[m].sesion.esperaBloqueo
      const tope = sqlEsperaBloqueoTransaccion(m)
      const envio = prepararEnvio(m, { esquema: 'E', nombre: 'T' }, { tipo: 'pk', columnas: ['ID'] }, [{ tipo: 'borrar', clave: ['1'] }], COLS)
      const conBloqueo = envio.ok && envio.sentencias[0].bloqueo !== undefined
      // `?.`: con el código de antes no había `esperaBloqueo` en la sesión, y el caso tiene
      // que FALLAR, no reventar.
      const forma = (espera as typeof espera | undefined)?.forma
      const esperado = espera?.forma === 'porTransaccion' || espera?.forma === 'porArchivo' ? espera.sqlTope(ESPERA_BLOQUEO_ENVIO_S) : null
      if (forma === undefined || tope !== esperado) incoherentes.push(`${m}: ${String(forma)} y tope ${j(tope)}`)
      if ((forma === 'porFila') !== conBloqueo) incoherentes.push(`${m}: ${String(forma)} y bloqueo por fila ${String(conBloqueo)}`)
    }
    check('la forma de esperar de cada motor gobierna el tope de la transacción y el candado por fila', incoherentes.length === 0, incoherentes.join(' | ') || 'coherentes')
    check(
      "con los valores de antes: el tope de PG es EXACTAMENTE `SET LOCAL lock_timeout = '10s'`; Oracle no tiene ('porFila')",
      sqlEsperaBloqueoTransaccion('postgres') === "SET LOCAL lock_timeout = '10s'" && sqlEsperaBloqueoTransaccion('oracle') === null,
      j([sqlEsperaBloqueoTransaccion('postgres'), sqlEsperaBloqueoTransaccion('oracle')])
    )

    // La identidad sin PK: 'unicaNoNula' pregunta por la UNIQUE y no espera la identidad
    // antes de leer; 'rowid' al revés. Lo de antes: PG pregunta, Oracle espera.
    const base = { soloLectura: false, remoto: false, sistema: false, tipo: 'tabla' as const, pk: [] as string[] }
    const malas: string[] = []
    for (const m of IDS_MOTORES_SQL) {
      const sinPk = descriptorSql(m).sesion.identidadSinPk
      if (necesitaUnica({ ...base, motor: m }) !== (sinPk === 'unicaNoNula')) malas.push(`${m}: necesitaUnica`)
      if (identidadAntesDeLeer({ ...base, motor: m }) !== (sinPk === 'rowid')) malas.push(`${m}: identidadAntesDeLeer`)
    }
    check('identidadSinPk gobierna necesitaUnica e identidadAntesDeLeer', malas.length === 0, malas.join(', ') || 'ok')
    check(
      'con los valores de antes: PG pregunta por la UNIQUE, Oracle espera la identidad (ROWID)',
      necesitaUnica({ ...base, motor: 'postgres' }) && !necesitaUnica({ ...base, motor: 'oracle' }) && identidadAntesDeLeer({ ...base, motor: 'oracle' }) && !identidadAntesDeLeer({ ...base, motor: 'postgres' }),
      'ok'
    )

    // Cada motor tiene su sesión del main entera (lo exige el tipo; esto lo mira en ejecución).
    const metodos = [
      'sqlFijarEsquema',
      'sqlLeerEsquema',
      'esquemaInexistente',
      'mensajeEsquemaNoAplicado',
      'sqlErroresCompilacion',
      'sqlColumnasEdicion',
      'sqlUnicaNoNula',
      'sqlColumnaRowid',
      'marcasTablaEdicion',
      'columnaEdicion',
      'bindClaveBinaria',
      'bindTextoEdicion',
      'esTipoBinario',
      'bindBooleano',
      'ladoClaveBinaria',
      'explicar',
      'revertirTrasFalloDeExplicar'
    ] as const
    const faltan = IDS_MOTORES_SQL.flatMap((m) => metodos.filter((k) => typeof MOTORES_EXPLORADOR[m].sesion[k] !== 'function').map((k) => `${m}.${k}`))
    check('MOTORES_EXPLORADOR: cada motor implementa la sesión entera', faltan.length === 0, faltan.join(', ') || `${metodos.length} métodos × ${IDS_MOTORES_SQL.length}`)
  }

  hr('SQLite — identidad, columnas, clase de almacenamiento y espera por archivo')
  {
    // Filas de `sqlColumnasEdicion` de SQLite: [name, type, hidden, pk, tipo_tabla, wr, alias, esquema, tabla].
    const fila = (nombre: string, tipo: string, oculta = 0, extra: { tipoTabla?: string; alias?: string | null; tabla?: string } = {}): unknown[] => [
      nombre,
      tipo,
      oculta,
      0,
      extra.tipoTabla ?? 'table',
      0,
      extra.alias === undefined ? 'rowid' : extra.alias,
      'main',
      extra.tabla ?? 't'
    ]
    const t = mapearTablaEdicion('sqlite', [fila('id', 'INTEGER'), fila('foto', 'BLOB'), fila('doble', 'INT', 2), fila('suelta', ''), fila('alta', 'DATE'), fila('nombre', 'varchar(20)')])
    const porNombre = new Map(t.columnas.map((c) => [c.nombre, c]))
    check(
      'marcas de la tabla: ni temporal ni interna, alias rowid',
      !t.temporal && t.interna === false && t.aliasRowid === 'rowid' && !t.externa,
      JSON.stringify({ temporal: t.temporal, interna: t.interna, alias: t.aliasRowid })
    )
    check(
      'columnas: la generada y la BLOB no se escriben; la sin tipo sí',
      porNombre.get('doble')?.noEditable !== null && porNombre.get('foto')?.binaria === true && porNombre.get('foto')?.noEditable !== null && porNombre.get('suelta')?.noEditable === null,
      JSON.stringify(t.columnas.map((c) => [c.nombre, c.noEditable]))
    )
    check(
      'comparables por afinidad: numérica «numero», texto y DATE «texto»; sin tipo y BLOB, no',
      porNombre.get('id')?.comparable === 'numero' && porNombre.get('nombre')?.comparable === 'texto' && porNombre.get('alta')?.comparable === 'texto' && porNombre.get('suelta')?.comparable === null && porNombre.get('foto')?.comparable === null,
      JSON.stringify(t.columnas.map((c) => [c.nombre, c.comparable]))
    )
    const sombra = mapearTablaEdicion('sqlite', [fila('block', 'BLOB', 0, { tipoTabla: 'shadow', tabla: 'docs_data' })])
    const sistema = mapearTablaEdicion('sqlite', [fila('name', '', 0, { tabla: 'sqlite_sequence' })])
    const tapada = mapearTablaEdicion('sqlite', [fila('rowid', 'TEXT', 0, { alias: '_rowid_' })])
    check('sombra y sqlite_*: internas; rowid tapado: el alias siguiente', sombra.interna === true && sistema.interna === true && tapada.aliasRowid === '_rowid_', JSON.stringify([sombra.interna, sistema.interna, tapada.aliasRowid]))
    const base = { motor: 'sqlite' as const, soloLectura: false, sistema: false, tipo: 'tabla' as const, remoto: false, unica: null }
    const idPk = decidirIdentidad({ ...conMarcasDeTabla(base, t), pk: ['id'] })
    const idRowid = decidirIdentidad({ ...conMarcasDeTabla(base, t), pk: [] })
    const idTapada = decidirIdentidad({ ...conMarcasDeTabla(base, tapada), pk: [] })
    const idSombra = decidirIdentidad({ ...conMarcasDeTabla(base, sombra), pk: [] })
    const idVirtual = decidirIdentidad({ ...base, tipo: 'tablaVirtual', pk: [] })
    check(
      "identidad: pk; sin PK 'rowid'; rowid tapado, sombra y virtual 'ninguna' con su motivo",
      idPk.tipo === 'pk' &&
        idRowid.tipo === 'rowid' &&
        idTapada.tipo === 'ninguna' && /rowid/.test(idTapada.motivo) &&
        idSombra.tipo === 'ninguna' && /interna del motor/.test(idSombra.motivo) &&
        idVirtual.tipo === 'ninguna' && /tabla virtual/.test(idVirtual.motivo),
      JSON.stringify([idPk, idRowid, idTapada, idSombra, idVirtual])
    )
    // Oracle NO cambia: sin las marcas nuevas, su identidad y su entrada, al byte.
    const oracle = conMarcasDeTabla({ sistema: false }, { temporal: false, externa: false, mantenidaPorOracle: false })
    check('Oracle: conMarcasDeTabla no añade claves', JSON.stringify(oracle) === JSON.stringify({ sistema: false, temporal: false, externa: false }), JSON.stringify(oracle))
    const sesion = MOTORES_EXPLORADOR.sqlite.sesion
    const suelta = porNombre.get('suelta') as ColumnaEdicion
    const nombre = porNombre.get('nombre') as ColumnaEdicion
    const clases = ['43', '-7', '007', '1.5', '100.0', '1.0e+21', '1e3', 'abc', '9223372036854775808'].map((v) => sesion.bindTextoEdicion(suelta, v))
    check(
      'sin afinidad: entero y real canónicos conservan su clase; lo demás, texto',
      JSON.stringify(clases) ===
        JSON.stringify([
          { sqlite: 'entero', valor: '43' },
          { sqlite: 'entero', valor: '-7' },
          null,
          { sqlite: 'real', valor: '1.5' },
          { sqlite: 'real', valor: '100.0' },
          { sqlite: 'real', valor: '1.0e+21' },
          null,
          null,
          null
        ]),
      JSON.stringify(clases)
    )
    check('con afinidad (la convierte ella), texto a secas', sesion.bindTextoEdicion(nombre, '43') === null && sesion.bindTextoEdicion(porNombre.get('id') as ColumnaEdicion, '43') === null, 'null')
    check('la clave binaria viaja como BLOB', JSON.stringify(sesion.bindClaveBinaria('0aff')) === '{"sqlite":"blob","valor":"0aff"}', JSON.stringify(sesion.bindClaveBinaria('0aff')))
    check(
      "espera 'porArchivo': PRAGMA busy_timeout con la primera sentencia, SQLITE_BUSY al vencer, sin candado por fila",
      sqlEsperaBloqueoTransaccion('sqlite') === `PRAGMA busy_timeout = ${ESPERA_BLOQUEO_ENVIO_S * 1000}` && esEsperaDeBloqueo('sqlite', 'SQLITE_BUSY') && lotesDeBloqueo('sqlite', []).length === 0,
      String(sqlEsperaBloqueoTransaccion('sqlite'))
    )
    check('el alias del rowid: el del catálogo, y rowid por defecto', sesion.sqlColumnaRowid('_rowid_') === '_rowid_' && sesion.sqlColumnaRowid() === 'rowid' && sesion.sqlColumnaRowid('x; drop') === 'rowid', sesion.sqlColumnaRowid('oid'))
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

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
