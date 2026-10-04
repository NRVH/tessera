#!/usr/bin/env node
// =============================================================================
// Prueba del SQL de catálogo y sus mapeadores, por la fachada `catalogoSql.ts`.
// (node src/main/db/explorador/test-catalogo-sql.mts  ·  npm run test:db-catalogo)
// Puro. Fija el SQL de Oracle (11.2 sin `oracle_maintained`, sin FETCH ni OFFSET), los binds
// (un nombre malicioso solo viaja en ellos), el troceado de listas, las FKs de Oracle en tres
// consultas, los tipos declarados y los mapeadores fila -> DTO. Cada motor: `motores/test-catalogo-motores.mts`.
// =============================================================================

import {
  aBool,
  aLista,
  aNumero,
  aplicarPosicionesPk,
  citarIdent,
  CLAVES_POR_CONSULTA,
  clavesReferenciablesOracle,
  esEsquemaSistemaOracle,
  filasFksOracle,
  leerFksOracle,
  formatearTipoOracle,
  mapearClavePrimaria,
  mapearColumnas,
  mapearConteos,
  mapearEsquemaPorDefecto,
  mapearEsquemas,
  mapearFuente,
  mapearIndices,
  mapearNombres,
  mapearNombresPublicos,
  mapearObjetos,
  mapearRestricciones,
  mapearSinonimo,
  mapearTipoDeObjeto,
  mapearFks,
  paresDeFksOracle,
  RESTRICCIONES_POR_CONSULTA,
  sqlClavePrimaria,
  sqlColumnasDeRestricciones,
  sqlFks,
  sqlFksEntrantesOracle,
  sqlColumnas,
  sqlConteos,
  sqlEsquemaPorDefecto,
  sqlEsquemas,
  sqlFuente,
  sqlIndices,
  sqlNombres,
  sqlNombresPublicos,
  sqlObjetos,
  sqlResolverSinonimo,
  sqlRestricciones,
  sqlTipoDeObjeto,
  sqlTiposColumnas,
  mapearTiposColumnas,
  conTiposDeclarados,
  faltanTiposDeclarados,
  type ConsultaCatalogo,
  type DialectoCatalogo
} from './catalogoSql.ts'
import { COLUMNA_ROWID } from './sqlRejilla.ts'
import type { LectorCatalogo } from './motores/catalogo.ts'
import type { DbTipoObjeto } from '../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../shared/motores/index.ts'

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

const ORA11: DialectoCatalogo = { motor: 'oracle', versionMayor: 11 }
const ORA19: DialectoCatalogo = { motor: 'oracle', versionMayor: 19 }
const PG16: DialectoCatalogo = { motor: 'postgres', versionMayor: 16 }

const MALICIOSO = "X' OR '1'='1"

interface Etiquetada {
  que: string
  c: ConsultaCatalogo
  /** ¿La consulta recibe el esquema/objeto como parámetro? */
  conNombre: boolean
}

/** Todas las consultas que el catálogo sabe hacer para un dialecto. */
function todas(d: DialectoCatalogo, esquema: string, objeto: string): Etiquetada[] {
  const r: Etiquetada[] = [
    { que: 'esquemas', c: sqlEsquemas(d), conNombre: false },
    { que: 'esquemaPorDefecto', c: sqlEsquemaPorDefecto(d), conNombre: false },
    { que: 'conteos', c: sqlConteos(d, esquema), conNombre: true },
    { que: 'columnas', c: sqlColumnas(d, esquema, objeto), conNombre: true },
    { que: 'restricciones', c: sqlRestricciones(d, esquema, objeto), conNombre: true },
    { que: 'indices', c: sqlIndices(d, esquema, objeto), conNombre: true },
    { que: 'clavePrimaria', c: sqlClavePrimaria(d, esquema, objeto), conNombre: true },
    { que: 'fks', c: sqlFks(d, esquema, objeto), conNombre: true }
  ]
  if (d.motor === 'oracle') {
    for (const c of sqlFksEntrantesOracle(d, esquema, [objeto])) r.push({ que: 'fksEntrantes', c, conNombre: true })
    for (const c of sqlColumnasDeRestricciones(d, [[esquema, objeto]])) r.push({ que: 'columnasDeRestricciones', c, conNombre: true })
  }
  for (const tipo of descriptorSql(d.motor).catalogo.carpetas) {
    r.push({ que: `objetos:${tipo}`, c: sqlObjetos(d, esquema, tipo), conNombre: true })
  }
  const conFuente: DbTipoObjeto[] =
    d.motor === 'oracle'
      ? ['paquete', 'rutina', 'tipoObjeto', 'tipoColeccion', 'disparador', 'vista', 'vistaMaterializada']
      : ['vista', 'vistaMaterializada', 'rutina']
  for (const tipo of conFuente) {
    r.push({ que: `fuente:${tipo}`, c: sqlFuente(d, { esquema, nombre: objeto, tipo, firma: 'integer' }), conNombre: true })
  }
  if (d.motor === 'oracle') {
    r.push({ que: 'resolverSinonimo', c: sqlResolverSinonimo(d, esquema, objeto), conNombre: true })
    r.push({ que: 'tipoDeObjeto', c: sqlTipoDeObjeto(d, esquema, objeto), conNombre: true })
    r.push({ que: 'tiposColumnas', c: sqlTiposColumnas(d, esquema, objeto), conNombre: true })
    const pub = sqlNombresPublicos(d)
    if (pub) r.push({ que: 'nombresPublicos', c: pub, conNombre: false })
  }
  for (const c of sqlNombres(d, [esquema, 'OTRO'])) r.push({ que: 'nombres', c, conNombre: true })
  return r
}

/** Marcas `:x` de Oracle en el texto (fuera de literales entre comillas simples). */
function marcasOracle(sql: string): Set<string> {
  const sinLiterales = sql.replace(/'(?:[^']|'')*'/g, "''")
  const marcas = new Set<string>()
  const re = /:([A-Za-z_]\w*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sinLiterales)) !== null) marcas.add(m[1])
  return marcas
}

/** Mayor `$n` de PG en el texto. */
function maxMarcaPg(sql: string): number {
  let max = 0
  const re = /\$(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) max = Math.max(max, Number(m[1]))
  return max
}

function bindsContienen(c: ConsultaCatalogo, valor: string): boolean {
  const valores = Array.isArray(c.binds) ? c.binds : Object.values(c.binds)
  return valores.some((v) => v === valor || (Array.isArray(v) && v.indexOf(valor) >= 0))
}

function lanza(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

async function main(): Promise<void> {
  hr('(1) Esquemas por versión')
  {
    const s11 = sqlEsquemas(ORA11).sql
    const s19 = sqlEsquemas(ORA19).sql
    check('11.2 sin oracle_maintained', !/oracle_maintained/i.test(s11) && /FROM all_users/.test(s11), s11.replace(/\n/g, ' '))
    check('19 con oracle_maintained', /oracle_maintained/i.test(s19), s19.replace(/\n/g, ' '))
    const s12 = sqlEsquemas({ motor: 'oracle', versionMayor: 12 }).sql
    check('12 (12.1) ya usa oracle_maintained', /oracle_maintained/i.test(s12), 'ok')
    const spg = sqlEsquemas(PG16).sql
    check('PG excluye pg_toast y pg_temp_', spg.indexOf("NOT LIKE 'pg\\_toast%'") >= 0 && spg.indexOf("NOT LIKE 'pg\\_temp\\_%'") >= 0, spg.replace(/\n/g, ' '))
  }

  hr('(2) Oracle nunca usa FETCH ni OFFSET')
  {
    for (const d of [ORA11, ORA19]) {
      const malas = todas(d, 'APP', 'T').filter((q) => /\bFETCH\b|\bOFFSET\b/i.test(q.c.sql))
      check(`Oracle ${d.versionMayor}: ninguna consulta con FETCH/OFFSET`, malas.length === 0, malas.map((q) => q.que).join(',') || `${todas(d, 'APP', 'T').length} consultas limpias`)
    }
    const pgMalas = todas(PG16, 'public', 't').filter((q) => /\bLIMIT\b|\bOFFSET\b/i.test(q.c.sql))
    check('PG: el catálogo no pagina (sin LIMIT/OFFSET)', pgMalas.length === 0, pgMalas.map((q) => q.que).join(',') || 'ok')
  }

  hr('(3) Binds presentes y nombre malicioso fuera del texto')
  {
    for (const d of [ORA11, ORA19, PG16]) {
      const qs = todas(d, MALICIOSO, MALICIOSO)
      const enTexto = qs.filter((q) => q.c.sql.indexOf(MALICIOSO) >= 0 || q.c.sql.indexOf("'1'='1") >= 0)
      check(`${d.motor} ${d.versionMayor}: el nombre malicioso no aparece en ningún texto`, enTexto.length === 0, enTexto.map((q) => q.que).join(',') || `${qs.length} consultas`)
      const sinBind = qs.filter((q) => q.conNombre && !bindsContienen(q.c, MALICIOSO))
      check(`${d.motor} ${d.versionMayor}: viaja en los binds de todas las que lo reciben`, sinBind.length === 0, sinBind.map((q) => q.que).join(',') || 'ok')
      if (d.motor === 'oracle') {
        const incoherentes = qs.filter((q) => {
          const marcas = marcasOracle(q.c.sql)
          const claves = Array.isArray(q.c.binds) ? [] : Object.keys(q.c.binds)
          return claves.length !== marcas.size || claves.some((k) => !marcas.has(k))
        })
        check(`Oracle ${d.versionMayor}: cada :marca tiene su bind y viceversa`, incoherentes.length === 0, incoherentes.map((q) => `${q.que}[${Array.from(marcasOracle(q.c.sql)).join(',')}]`).join(' ') || 'ok')
        const posicionales = qs.filter((q) => Array.isArray(q.c.binds))
        check(`Oracle ${d.versionMayor}: binds con nombre, nunca posicionales`, posicionales.length === 0, 'ok')
      } else {
        const incoherentes = qs.filter((q) => !Array.isArray(q.c.binds) || maxMarcaPg(q.c.sql) !== q.c.binds.length)
        check('PG: cada $n tiene su posición y no sobra ninguna', incoherentes.length === 0, incoherentes.map((q) => q.que).join(',') || 'ok')
      }
    }
    const conteos = sqlConteos(ORA19, 'APP')
    check('Oracle: :esq en el texto y en los binds', /:esq\b/.test(conteos.sql) && !Array.isArray(conteos.binds) && conteos.binds.esq === 'APP', JSON.stringify(conteos.binds))
    const objPg = sqlObjetos(PG16, 'public', 'tabla')
    check("PG: relkind como text[] en $2 ('r','p' para tablas)", Array.isArray(objPg.binds) && objPg.binds[0] === 'public' && JSON.stringify(objPg.binds[1]) === '["r","p"]', JSON.stringify(objPg.binds))
    const fuentePg = sqlFuente(PG16, { esquema: 'public', nombre: 'f', tipo: 'rutina', firma: 'integer, text' })
    check('PG: la fuente de una rutina se busca por nombre Y firma', Array.isArray(fuentePg.binds) && fuentePg.binds[2] === 'integer, text', JSON.stringify(fuentePg.binds))
    const fuenteSinFirma = sqlFuente(PG16, { esquema: 'public', nombre: 'g', tipo: 'rutina' })
    check("PG: rutina sin firma = firma vacía ''", Array.isArray(fuenteSinFirma.binds) && fuenteSinFirma.binds[2] === '', JSON.stringify(fuenteSinFirma.binds))
    const pkg = sqlFuente(ORA11, { esquema: 'APP', nombre: 'PKG', tipo: 'paquete' })
    check('Oracle: paquete pide PACKAGE y PACKAGE BODY por bind', !Array.isArray(pkg.binds) && pkg.binds.t1 === 'PACKAGE' && pkg.binds.t2 === 'PACKAGE BODY', JSON.stringify(pkg.binds))
  }

  hr('(4) Autocompletado: binds troceados de 1000 en Oracle')
  {
    const muchos = Array.from({ length: 2500 }, (_, i) => `E${i}`)
    const qs = sqlNombres(ORA11, muchos)
    const tamanos = qs.map((q) => (Array.isArray(q.binds) ? -1 : Object.keys(q.binds).length))
    check('2500 esquemas -> 3 consultas de 1000, 1000 y 500', tamanos.join(',') === '1000,1000,500', tamanos.join(','))
    const maxMarcas = Math.max(...qs.map((q) => marcasOracle(q.sql).size))
    check('ninguna lista IN pasa de 1000 elementos (ORA-01795)', maxMarcas <= 1000, `${maxMarcas}`)
    const cubiertos = new Set<string>()
    for (const q of qs) if (!Array.isArray(q.binds)) for (const v of Object.values(q.binds)) cubiertos.add(String(v))
    check('todos los esquemas quedan cubiertos', cubiertos.size === 2500, `${cubiertos.size}`)
    check("filtra generated='N' y la papelera (BIN$)", /generated = 'N'/.test(qs[0].sql) && /NOT LIKE 'BIN\$%'/.test(qs[0].sql), 'ok')
    const pg = sqlNombres(PG16, ['public', 'ventas'])
    check('PG: una sola consulta con la lista como text[]', pg.length === 1 && Array.isArray(pg[0].binds) && JSON.stringify(pg[0].binds[0]) === '["public","ventas"]', JSON.stringify(pg[0].binds))
    check('sin esquemas: ninguna consulta', sqlNombres(ORA19, []).length === 0 && sqlNombres(PG16, []).length === 0, '0')
  }

  hr('(5) Lo que no existe en un motor')
  {
    check('PG no tiene paquetes', lanza(() => sqlObjetos(PG16, 'public', 'paquete')), 'lanza')
    check('Oracle no tiene tablas foráneas ni tipo PG', lanza(() => sqlObjetos(ORA19, 'APP', 'tablaForanea')) && lanza(() => sqlObjetos(ORA19, 'APP', 'tipo')), 'lanza')
    check('PG no tiene sinónimos', lanza(() => sqlResolverSinonimo(PG16, 'public', 'x')) && lanza(() => sqlTipoDeObjeto(PG16, 'public', 'x')), 'lanza')
    check('PG no tiene sinónimos públicos (null)', sqlNombresPublicos(PG16) === null, 'null')
    check('PG no lee tipos declarados: el del trabajador ya es el declarado (typmod)', lanza(() => sqlTiposColumnas(PG16, 'public', 't')), 'lanza')
    check('una tabla no tiene fuente en esta entrega', lanza(() => sqlFuente(ORA19, { esquema: 'A', nombre: 'T', tipo: 'tabla' })) && lanza(() => sqlFuente(PG16, { esquema: 'a', nombre: 't', tipo: 'tabla' })), 'lanza')
  }

  hr('(6a) Mapeadores: esquemas')
  {
    const filas11 = [
      ['APP', 0],
      ['APEX_040200', 0],
      ['SYS', '0'],
      ['SYSTEM', 0],
      ['VENTAS', 0],
      ['XDB', 0]
    ]
    const e11 = mapearEsquemas(ORA11, filas11, 'APP')
    check('11.2: propios, luego sistema (por la lista), PUBLIC al final', e11.map((e) => e.nombre).join(',') === 'APP,VENTAS,APEX_040200,SYS,SYSTEM,XDB,PUBLIC', e11.map((e) => e.nombre).join(','))
    check('11.2: marca sistema con ESQUEMAS_SISTEMA_ORACLE', e11.filter((e) => e.sistema).map((e) => e.nombre).join(',') === 'APEX_040200,SYS,SYSTEM,XDB', e11.filter((e) => e.sistema).map((e) => e.nombre).join(','))
    const app = e11[0]
    const pub = e11[e11.length - 1]
    check('el por defecto: visible y porDefecto', app.visible && app.porDefecto && !e11[1].visible, JSON.stringify(app))
    check('PUBLIC: pseudo, cuenta en M, no marcado por defecto', pub.pseudo === true && !pub.visible && !pub.porDefecto && e11.length === 7, JSON.stringify(pub))
    const e19 = mapearEsquemas(ORA19, [['APP', '0'], ['HR', 0], ['SYS', '1'], ['PUBLIC', 0]], 'APP')
    check('19: sistema por la columna oracle_maintained; PUBLIC no se duplica', e19.map((e) => `${e.nombre}${e.sistema ? '*' : ''}`).join(',') === 'APP,HR,SYS*,PUBLIC', e19.map((e) => `${e.nombre}${e.sistema ? '*' : ''}`).join(','))
    const ePg = mapearEsquemas(PG16, [['information_schema', 't'], ['pg_catalog', true], ['public', false], ['ventas', 'f']], 'public')
    check('PG: 4 esquemas ("1 de 4"), sistema al final, sin PUBLIC', ePg.map((e) => e.nombre).join(',') === 'public,ventas,information_schema,pg_catalog' && ePg.filter((e) => e.visible).length === 1, ePg.map((e) => e.nombre).join(','))
    const conPredicado = mapearEsquemas(PG16, [['public', false], ['ventas', false]], 'public', (e) => e.nombre === 'ventas')
    check('esVisible del llamador decide la casilla', !conPredicado[0].visible && conPredicado[1].visible && conPredicado[0].porDefecto, JSON.stringify(conPredicado))
    const pd = mapearEsquemaPorDefecto([['APP', 'APP_USER']])
    check('esquema por defecto y usuario', pd.esquema === 'APP' && pd.usuario === 'APP_USER' && mapearEsquemaPorDefecto([]).esquema === '', JSON.stringify(pd))
    check('esEsquemaSistemaOracle', esEsquemaSistemaOracle('APEX_180200') && esEsquemaSistemaOracle('FLOWS_030000') && !esEsquemaSistemaOracle('APEXX') && !esEsquemaSistemaOracle('APP'), 'ok')

    // la lista era a mano. Ahora la fija la DOCUMENTADA de la 11.2
    // («Oracle Database 2 Day + Security Guide 11g Release 2 (11.2)», E10575, «Predefined
    // User Accounts Provided by Oracle Database», tablas 3-1 y 3-2, más ASMSNMP de su
    // nota), y se contrasta con lo MEDIDO en bases reales (Docker de prueba).
    const DOC_11_2 = [
      // Tabla 3-1, administrativas (+ ASMSNMP, «solo si hay una instancia ASM»).
      'ANONYMOUS', 'CTXSYS', 'DBSNMP', 'EXFSYS', 'LBACSYS', 'MDSYS', 'MGMT_VIEW', 'OLAPSYS', 'ORDDATA', 'OWBSYS',
      'ORDPLUGINS', 'ORDSYS', 'OUTLN', 'SI_INFORMTN_SCHEMA', 'SYS', 'SYSMAN', 'SYSTEM', 'WK_TEST', 'WKSYS', 'WKPROXY',
      'WMSYS', 'XDB', 'ASMSNMP',
      // Tabla 3-2, no administrativas.
      'APEX_PUBLIC_USER', 'DIP', 'FLOWS_040100', 'FLOWS_FILES', 'MDDATA', 'ORACLE_OCM', 'SPATIAL_CSW_ADMIN_USR',
      'SPATIAL_WFS_ADMIN_USR', 'XS$NULL'
    ]
    const faltanDoc = DOC_11_2.filter((u) => !esEsquemaSistemaOracle(u))
    check(
      'B3: TODAS las cuentas predefinidas documentadas de la 11.2 cuentan como del sistema (antes faltaban WK_TEST, WKSYS, WKPROXY y ASMSNMP)',
      faltanDoc.length === 0,
      faltanDoc.length === 0 ? `${DOC_11_2.length} cuentas` : `faltan: ${faltanDoc.join(', ')}`
    )
    // DBA_USERS de un XE 11.2.0.2 (gvenzl/oracle-xe:11 y :11-slim, las dos imágenes quitan
    // APEX y los ejemplos): todas las de Oracle marcadas; OPS$ORACLE (la crea la imagen
    // para su comprobación de salud) y los usuarios de la prueba, no.
    const XE_11_2 = ['ANONYMOUS', 'CTXSYS', 'MDSYS', 'OUTLN', 'SYS', 'SYSTEM', 'XDB', 'XS$NULL']
    const faltanXe = XE_11_2.filter((u) => !esEsquemaSistemaOracle(u))
    check(
      'B3: medido en un XE 11.2 real (DBA_USERS): las de Oracle marcadas, OPS$ORACLE y TESSERA no',
      faltanXe.length === 0 && !esEsquemaSistemaOracle('OPS$ORACLE') && !esEsquemaSistemaOracle('TESSERA'),
      faltanXe.join(', ') || `${XE_11_2.length} de Oracle`
    )
    // ALL_USERS con oracle_maintained = 'Y' de una 21c real (XEPDB1): la lista también la
    // usa `edicionRejilla.ts` en 12c+ para no ofrecer editar lo del sistema.
    const MANTENIDAS_21C = [
      'ANONYMOUS', 'APPQOSSYS', 'AUDSYS', 'DBSFWUSER', 'DBSNMP', 'DGPDB_INT', 'DIP', 'DVF', 'DVSYS', 'GGSYS',
      'GSMADMIN_INTERNAL', 'GSMCATUSER', 'GSMUSER', 'LBACSYS', 'ORACLE_OCM', 'OUTLN', 'REMOTE_SCHEDULER_AGENT', 'SYS',
      'SYS$UMF', 'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC', 'SYSTEM', 'XDB', 'XS$NULL'
    ]
    const faltan21 = MANTENIDAS_21C.filter((u) => !esEsquemaSistemaOracle(u))
    check('B3: las 26 que una 21c real marca oracle_maintained = Y también (faltaba DGPDB_INT)', faltan21.length === 0, faltan21.join(', ') || `${MANTENIDAS_21C.length} cuentas`)
    const EJEMPLO = ['BI', 'HR', 'OE', 'PM', 'IX', 'SH', 'SCOTT', 'PDBADMIN']
    const ejemploMarcados = EJEMPLO.filter((u) => esEsquemaSistemaOracle(u))
    check(
      'B3 NEGATIVO: los esquemas de EJEMPLO (tabla 3-3), SCOTT y PDBADMIN no son del sistema (oracle_maintained = N)',
      ejemploMarcados.length === 0,
      ejemploMarcados.join(', ') || 'ninguno'
    )
  }

  hr('(6b) Mapeadores: conteos y objetos')
  {
    const c = mapearConteos('oracle', [['tabla', '27'], ['vista', 4], ['tipoObjeto', 2], ['raro', 9]])
    check('Oracle: números como texto o número; todas las carpetas presentes', c.tabla === 27 && c.vista === 4 && c.tipoObjeto === 2 && c.tipoColeccion === 0 && c.disparador === 0 && Object.keys(c).length === descriptorSql('oracle').catalogo.carpetas.length, JSON.stringify(c))
    const cp = mapearConteos('postgres', [['tabla', 3], ['rutina', 1]])
    check('PG: solo sus carpetas', cp.tabla === 3 && cp.rutina === 1 && cp.tablaForanea === 0 && !('paquete' in cp), JSON.stringify(cp))
    const tablas = mapearObjetos('APP', 'tabla', [['APPLICATION', null, null, '  Apps  ', null, null], ['EMPTY', null, null, null, null, null]])
    check('tablas con comentario (recortado) y sin él', tablas[0].comentario === 'Apps' && !('comentario' in tablas[1]) && tablas[0].esquema === 'APP' && tablas[0].tipo === 'tabla', JSON.stringify(tablas))
    const paquetes = mapearObjetos('APP', 'paquete', [['PKG', null, 'INVALID', null, null, null], ['OK', null, 'VALID', null, null, null]])
    check('paquetes: estado invalido/valido', paquetes[0].estado === 'invalido' && paquetes[1].estado === 'valido', JSON.stringify(paquetes))
    const rutinas = mapearObjetos('public', 'rutina', [['f', 'FUNCTION', null, null, 'integer, text', null], ['g', 'PROCEDURE', null, null, '', null]])
    check("rutinas PG: firma (y la vacía se conserva como '')", rutinas[0].firma === 'integer, text' && rutinas[1].firma === '' && rutinas[1].subtipo === 'PROCEDURE', JSON.stringify(rutinas))
    const disparadores = mapearObjetos('APP', 'disparador', [['TRG', 'DISABLED', 'VALID', null, null, 'EMP']])
    check('disparadores: tabla a la que pertenecen', disparadores[0].tabla === 'EMP' && disparadores[0].subtipo === 'DISABLED', JSON.stringify(disparadores))
    const tipos = sqlObjetos(ORA19, 'APP', 'tipoColeccion').sql
    check('tipos de colección filtran COLLECTION y excluyen SYS_PLSQL_', /typecode = 'COLLECTION'/.test(tipos) && tipos.indexOf("NOT LIKE 'SYS\\_PLSQL\\_%' ESCAPE '\\'") >= 0, 'ok')
    const conteoSql = sqlConteos(ORA11, 'APP').sql
    check('conteos Oracle: un viaje con UNION ALL y los filtros de tablas', (conteoSql.match(/UNION ALL/g) ?? []).length === 8 && /dropped = 'NO'/.test(conteoSql) && /iot_type/.test(conteoSql) && /all_mviews m/.test(conteoSql), `${(conteoSql.match(/UNION ALL/g) ?? []).length} UNION ALL`)
    const sin = sqlObjetos(ORA19, 'APP', 'sinonimo').sql
    check('sinónimos por ALL_OBJECTS, nunca ALL_SYNONYMS', /all_objects/.test(sin) && !/all_synonyms/i.test(sin), 'ok')
  }

  hr('(6c) Mapeadores: columnas y clave primaria')
  {
    const ora = mapearColumnas('oracle', [
      ['ID', 'NUMBER', 22, 0, null, '10', '0', 'N', null, '1', null],
      ['NAME', 'VARCHAR2', 160, 40, 'C', null, null, 'Y', "'sin nombre'  \n", 2, 'Nombre visible'],
      ['CREATED', 'TIMESTAMP(6) WITH TIME ZONE', 13, 0, null, null, 6, 'Y', 'SYSTIMESTAMP ', 3, null]
    ])
    check('Oracle: tipos formateados', ora.map((c) => c.tipo).join(' | ') === 'NUMBER(10) | VARCHAR2(40 CHAR) | TIMESTAMP(6) WITH TIME ZONE', ora.map((c) => c.tipo).join(' | '))
    check('Oracle: nullable, posición, defecto recortado y comentario', !ora[0].nullable && ora[1].nullable && ora[0].posicion === 1 && ora[1].porDefecto === "'sin nombre'" && ora[1].comentario === 'Nombre visible' && ora[2].porDefecto === 'SYSTIMESTAMP', JSON.stringify(ora[1]))
    check('Oracle: la PK no sale de las columnas (null)', ora.every((c) => c.pk === null), 'null')
    const conPk = aplicarPosicionesPk(ora, mapearClavePrimaria([['ID']]))
    check('aplicarPosicionesPk pone la posición y no muta', conPk[0].pk === 1 && conPk[1].pk === null && ora[0].pk === null, JSON.stringify(conPk.map((c) => c.pk)))
    const pg = mapearColumnas('postgres', [
      ['id', 'integer', false, null, 1, null, 'a', '', 1],
      ['doble', 'integer', 't', '(id * 2)', 2, null, '', 's', null],
      ['creado', 'timestamp with time zone', true, 'now()', 3, 'Alta', '', '', null],
      ['otro', 'bigint', 'f', null, '4', null, 'd', '', '2']
    ])
    check('PG: identidad, generada, defecto y pk', pg[0].porDefecto === 'GENERATED ALWAYS AS IDENTITY' && pg[0].pk === 1 && !pg[0].nullable && pg[1].porDefecto === 'GENERATED ALWAYS AS ((id * 2)) STORED' && pg[2].porDefecto === 'now()' && pg[2].comentario === 'Alta' && pg[3].porDefecto === 'GENERATED BY DEFAULT AS IDENTITY' && pg[3].pk === 2 && pg[3].posicion === 4, JSON.stringify(pg.map((c) => [c.porDefecto, c.pk])))
    const colSql = sqlColumnas(ORA11, 'APP', 'T').sql
    check('Oracle: columnas con ALL_COL_COMMENTS y ORDER BY column_id', /all_col_comments/.test(colSql) && /ORDER BY c\.column_id/.test(colSql), 'ok')
  }

  hr('(6d) Mapeadores: restricciones e índices')
  {
    const ora = mapearRestricciones('oracle', [
      ['PK_T', 'P', 'ID', null, null, null],
      ['FK_T_U', 'R', 'USER_ID', 'SEG', 'USERS', 'ID'],
      ['FK_T_U', 'R', 'ORG_ID', 'SEG', 'USERS', 'ORG'],
      ['UK_T', 'U', 'CODE', null, null, null]
    ])
    check('Oracle: agrupa por restricción', ora.length === 3 && ora[0].tipo === 'pk' && ora[1].tipo === 'fk' && ora[2].tipo === 'unica', ora.map((r) => `${r.nombre}:${r.tipo}`).join(','))
    check('Oracle: FK con columnas y referencia en orden', ora[1].columnas.join(',') === 'USER_ID,ORG_ID' && ora[1].referencia?.esquema === 'SEG' && ora[1].referencia.tabla === 'USERS' && ora[1].referencia.columnas.join(',') === 'ID,ORG', JSON.stringify(ora[1]))
    const pg = mapearRestricciones('postgres', [
      ['t_pkey', 'p', 'PRIMARY KEY (id)', '{id}', null, null, '{}'],
      ['t_fk', 'f', 'FOREIGN KEY (a, b) REFERENCES u(x, y)', ['a', 'b'], 'public', 'u', ['x', 'y']],
      ['t_chk', 'c', 'CHECK (("col a" > 0))', '{"col a"}', null, null, null],
      ['t_excl', 'x', 'EXCLUDE …', '{r}', null, null, null]
    ])
    check('PG: tipos pk/fk/check/exclusion', pg.map((r) => r.tipo).join(',') === 'pk,fk,check,exclusion', pg.map((r) => r.tipo).join(','))
    check('PG: arrays como literal de texto o ya parseados', pg[0].columnas.join(',') === 'id' && pg[1].columnas.join(',') === 'a,b' && pg[2].columnas[0] === 'col a', JSON.stringify(pg.map((r) => r.columnas)))
    check('PG: referencia de la FK', pg[1].referencia?.tabla === 'u' && pg[1].referencia.columnas.join(',') === 'x,y' && !('referencia' in pg[0]), JSON.stringify(pg[1].referencia))
    const io = mapearIndices('oracle', [
      ['PK_T', 'UNIQUE', 'ID'],
      ['IX_T', 'NONUNIQUE', 'A'],
      ['IX_T', 'NONUNIQUE', 'B']
    ])
    check('Oracle: índices agrupados, único y columnas en orden', io.length === 2 && io[0].unico && !io[1].unico && io[1].columnas.join(',') === 'A,B', JSON.stringify(io))
    const ip = mapearIndices('postgres', [
      ['t_pkey', true, true, 'btree', '{id}'],
      ['t_expr', 'f', 'f', 'btree', ['lower(name)', 'b']]
    ])
    check('PG: índices con expresiones', ip[0].unico && !ip[1].unico && ip[1].columnas.join('|') === 'lower(name)|b', JSON.stringify(ip))
    // «Ver DDL» usa la definición del servidor tal cual (solo PG; Oracle la da DBMS_METADATA).
    check('PG: restricción con su definición de pg_get_constraintdef', pg[2].definicion === 'CHECK (("col a" > 0))' && ora.every((r) => r.definicion === undefined), JSON.stringify(pg[2]))
    const ipd = mapearIndices('postgres', [
      ['t_expr', 'f', 'f', 'btree', ['lower(name)'], 'CREATE INDEX t_expr ON public.t USING btree (lower(name))'],
      ['t_sin', 'f', 'f', 'btree', ['a'], null]
    ])
    check('PG: índice con su definición de pg_get_indexdef (y sin ella si no llega)', ipd[0].definicion === 'CREATE INDEX t_expr ON public.t USING btree (lower(name))' && ipd[1].definicion === undefined && io.every((i) => i.definicion === undefined), JSON.stringify(ipd))
    check('PG: sqlIndices pide la definición entera', /pg_get_indexdef\(x\.indexrelid\)/.test(sqlIndices({ motor: 'postgres', versionMayor: 16 }, 'public', 't').sql), 'ok')
  }

  hr('(6e) Mapeadores: fuente')
  {
    const pkg = { esquema: 'APP', nombre: 'PKG', tipo: 'paquete' as const }
    const f1 = mapearFuente(ORA19, pkg, [
      ['PACKAGE', 1, 'PACKAGE pkg AS\n'],
      ['PACKAGE', 2, '  PROCEDURE p;\n'],
      ['PACKAGE', 3, 'END pkg;\n'],
      ['PACKAGE BODY', 1, 'PACKAGE BODY pkg AS\n'],
      ['PACKAGE BODY', 2, 'END pkg;\n']
    ])
    check('paquete: Especificación y Cuerpo con CREATE OR REPLACE', f1.partes.length === 2 && f1.partes[0].titulo === 'Especificación' && f1.partes[1].titulo === 'Cuerpo' && f1.partes[0].texto.startsWith('CREATE OR REPLACE PACKAGE pkg AS\n  PROCEDURE p;') && f1.partes[1].texto.startsWith('CREATE OR REPLACE PACKAGE BODY pkg AS') && f1.aviso === undefined && f1.origen === 'ALL_SOURCE', JSON.stringify(f1.partes.map((p) => p.titulo)))
    const f2 = mapearFuente(ORA19, pkg, [['PACKAGE', 1, 'PACKAGE pkg AS\n'], ['PACKAGE', 2, 'END;\n']])
    check('paquete sin cuerpo visible: aviso de privilegios', f2.partes.length === 1 && /cuerpo/i.test(f2.aviso ?? ''), String(f2.aviso))
    const f3 = mapearFuente(ORA19, pkg, [['PACKAGE', 1, 'PACKAGE pkg wrapped\n'], ['PACKAGE', 2, 'a000000\n'], ['PACKAGE BODY', 1, 'PACKAGE BODY pkg wrapped\n']])
    check('código wrapped: aviso de ofuscado', /wrapped/i.test(f3.aviso ?? ''), String(f3.aviso))
    const f4 = mapearFuente(ORA19, pkg, [])
    check('sin filas: sin partes y aviso', f4.partes.length === 0 && /no hay fuente/i.test(f4.aviso ?? ''), String(f4.aviso))
    const tipoSinCuerpo = mapearFuente(ORA19, { esquema: 'APP', nombre: 'T_OBJ', tipo: 'tipoObjeto' }, [['TYPE', 1, 'TYPE t_obj AS OBJECT (a NUMBER);\n']])
    check('un tipo sin cuerpo es normal: sin aviso', tipoSinCuerpo.partes.length === 1 && tipoSinCuerpo.aviso === undefined, String(tipoSinCuerpo.aviso))
    const proc = mapearFuente(ORA19, { esquema: 'APP', nombre: 'P', tipo: 'rutina' }, [['PROCEDURE', 1, 'PROCEDURE p IS\n'], ['PROCEDURE', 2, 'BEGIN NULL; END;\n']])
    check('rutina Oracle: Definición', proc.partes.length === 1 && proc.partes[0].titulo === 'Definición' && proc.partes[0].texto.startsWith('CREATE OR REPLACE PROCEDURE p IS'), proc.partes[0]?.titulo ?? '')
    const vista = mapearFuente(ORA11, { esquema: 'A"B', nombre: 'V', tipo: 'vista' }, [['SELECT 1 FROM dual']])
    check('vista Oracle: cabecera con identificadores citados ("A""B")', vista.partes[0].texto === 'CREATE OR REPLACE VIEW "A""B"."V" AS\nSELECT 1 FROM dual' && vista.origen === 'ALL_VIEWS', vista.partes[0].texto.replace(/\n/g, '\\n'))
    const mv = mapearFuente(ORA11, { esquema: 'APP', nombre: 'MV', tipo: 'vistaMaterializada' }, [['SELECT * FROM t']])
    check('vista materializada Oracle: ALL_MVIEWS', mv.origen === 'ALL_MVIEWS' && mv.partes[0].texto.startsWith('CREATE MATERIALIZED VIEW "APP"."MV" AS\n'), mv.partes[0].texto.split('\n')[0])
    const vpg = mapearFuente(PG16, { esquema: 'public', nombre: 'v', tipo: 'vista' }, [[' SELECT t.id\n   FROM t;']])
    check('vista PG: pg_get_viewdef con cabecera', vpg.origen === 'pg_get_viewdef' && vpg.partes[0].texto.startsWith('CREATE OR REPLACE VIEW "public"."v" AS\nSELECT t.id'), vpg.partes[0].texto.split('\n').slice(0, 2).join('\\n'))
    const fpg = mapearFuente(PG16, { esquema: 'public', nombre: 'f', tipo: 'rutina', firma: '' }, [['CREATE OR REPLACE FUNCTION public.f()\n RETURNS integer\n']])
    check('rutina PG: pg_get_functiondef tal cual', fpg.origen === 'pg_get_functiondef' && fpg.partes[0].texto.startsWith('CREATE OR REPLACE FUNCTION public.f()'), fpg.origen)
    const nada = mapearFuente(PG16, { esquema: 'public', nombre: 'f', tipo: 'rutina' }, [])
    check('PG sin filas: aviso', nada.partes.length === 0 && nada.aviso !== undefined, String(nada.aviso))
  }

  hr('(6f) Mapeadores: sinónimos, nombres y públicos')
  {
    check('sinónimo local', JSON.stringify(mapearSinonimo([['APP', 'T', null]])) === '{"esquema":"APP","nombre":"T","dblink":null}', JSON.stringify(mapearSinonimo([['APP', 'T', null]])))
    check('sinónimo remoto conserva el enlace', mapearSinonimo([['APP', 'T', 'REMOTA.EMPRESA']])?.dblink === 'REMOTA.EMPRESA', 'ok')
    check('sin sinónimo: null', mapearSinonimo([]) === null, 'null')
    check('tipo del destino: gana la vista materializada a su tabla', mapearTipoDeObjeto([['TABLE'], ['MATERIALIZED VIEW']]) === 'vistaMaterializada', String(mapearTipoDeObjeto([['TABLE'], ['MATERIALIZED VIEW']])))
    check('tipo del destino: vista / nada', mapearTipoDeObjeto([['VIEW']]) === 'vista' && mapearTipoDeObjeto([]) === null, 'ok')
    const filas = [
      ['APP', 'T1', 'TABLE'],
      ['APP', 'MV', 'TABLE'],
      ['APP', 'MV', 'MATERIALIZED VIEW'],
      ['APP', 'PKG', 'PACKAGE'],
      ['HR', 'T1', 'TABLE'],
      ['APP', 'IX', 'INDEX']
    ]
    const idx = mapearNombres('oracle', filas, 'APP')
    check('Oracle: esquemas indexados, sin duplicados, MV como vista materializada', idx.esquemas.join(',') === 'APP,HR' && idx.objetos.length === 4 && idx.objetos.some((o) => o[0] === 'MV' && o[2] === 'vistaMaterializada') && idx.truncado === undefined, JSON.stringify(idx.objetos))
    check('el mismo nombre en dos esquemas son dos entradas', idx.objetos.filter((o) => o[0] === 'T1').map((o) => idx.esquemas[o[1]]).join(',') === 'APP,HR', 'ok')
    const corto = mapearNombres('oracle', filas, 'APP', 2)
    check('tope: corta y marca truncado', corto.objetos.length === 2 && corto.truncado === true, `${corto.objetos.length} ${String(corto.truncado)}`)
    const parte1 = mapearNombres('postgres', [['public', 't', 'r'], ['public', 'f', 'F'], ['public', 'f', 'F']], 'public')
    const parte2 = mapearNombres('postgres', [['ventas', 'v', 'v'], ['public', 't', 'r'], ['ventas', 's', 'S']], 'public', undefined, parte1)
    check('PG: sobrecargas deduplicadas; fusión por esquemas sin mutar la base', parte1.objetos.length === 2 && parte2.objetos.length === 4 && parte2.esquemas.join(',') === 'public,ventas' && parte1.esquemas.length === 1, JSON.stringify(parte2.objetos))
    check('PG: relkind -> tipo', parte2.objetos.map((o) => o[2]).join(',') === 'tabla,rutina,vista,secuencia', parte2.objetos.map((o) => o[2]).join(','))
    const pub = mapearNombresPublicos([['DUAL'], ['ALL_USERS'], ['DUAL'], [null]])
    check('públicos: sin duplicados y ordenados', pub.join(',') === 'ALL_USERS,DUAL', pub.join(','))
    const pubSql = sqlNombresPublicos(ORA11)
    check("públicos: owner 'PUBLIC' y SYNONYM, sin binds", pubSql !== null && /owner = 'PUBLIC'/.test(pubSql.sql) && /'SYNONYM'/.test(pubSql.sql), pubSql?.sql ?? '')
  }

  hr('(6g) Claves ajenas: SQL por versión y mapeadores')
  {
    // tres consultas cortas en Oracle. Medido con un diccionario GRANDE (142 000
    // restricciones, 19 000 FK): la única con OR y RULE tardaba 45 s y hasta más de 5 min;
    // así, milisegundos. El RULE SOLO en las entrantes y SOLO en la 11g (sin él, 0,5-140 s;
    // en las propias y en las columnas empeoraba).
    const p11 = sqlFks(ORA11, 'E', 'T').sql
    const e11 = sqlFksEntrantesOracle(ORA11, 'E', ['T_PK'])[0]?.sql ?? ''
    const c11 = sqlColumnasDeRestricciones(ORA11, [['E', 'X']])[0].sql
    check('11g: RULE solo en las entrantes (ni en las propias ni en las columnas)', !/RULE/.test(p11) && /\/\*\+ RULE \*\//.test(e11) && !/RULE/.test(c11), 'RULE solo en el paso 2')
    const p19 = sqlFks(ORA19, 'E', 'T').sql
    check('19: sin hint en ninguna', !/RULE/.test(p19) && !/RULE/.test(sqlFksEntrantesOracle(ORA19, 'E', ['T_PK'])[0].sql) && !/RULE/.test(sqlColumnasDeRestricciones(ORA19, [['E', 'X']])[0].sql), 'sin RULE')
    check(
      'las R, P y U DE la tabla por owner + table_name, sin OR ni subconsulta (lo que recorría todas las FK)',
      /WHERE owner = :esq AND table_name = :obj/.test(p19) && /constraint_type IN \('R', 'P', 'U'\)/.test(p19) && !/\bOR\b/.test(p19) && !/SELECT[\s\S]*SELECT/.test(p19),
      p19
    )
    check(
      'por r_owner + r_constraint_name IN (lista); sin claves no hay consulta',
      /constraint_type = 'R'/.test(e11) && /r_owner = :esq AND r_constraint_name IN \(:k0\)/.test(e11) && sqlFksEntrantesOracle(ORA19, 'E', []).length === 0,
      e11
    )
    const muchasClaves = Array.from({ length: CLAVES_POR_CONSULTA + 3 }, (_, i) => `K${i}`)
    const trozosClaves = sqlFksEntrantesOracle(ORA19, 'E', [...muchasClaves, 'K0'])
    check(
      `troceado de ${CLAVES_POR_CONSULTA} en ${CLAVES_POR_CONSULTA} (+ el dueño), sin repetidas`,
      trozosClaves.length === 2 && Object.keys(trozosClaves[0].binds).length === CLAVES_POR_CONSULTA + 1 && Object.keys(trozosClaves[1].binds).length === 4,
      `${trozosClaves.length} consultas`
    )
    check("PG: contype 'f' sin las copias de las particiones", /contype = 'f' AND k\.conparentid = 0/.test(sqlFks(PG16, 'e', 't').sql), 'conparentid = 0')
    const muchos: Array<[string, string]> = []
    for (let i = 0; i < RESTRICCIONES_POR_CONSULTA + 10; i++) muchos.push(['E', `FK${i}`])
    muchos.push(['E', 'FK0'])
    const trozos = sqlColumnasDeRestricciones(ORA19, muchos)
    const binds0 = trozos[0]?.binds as Record<string, string>
    check(
      `columnas troceadas de ${RESTRICCIONES_POR_CONSULTA} en ${RESTRICCIONES_POR_CONSULTA} (+ una bind por dueño) y sin repetidas`,
      trozos.length === 2 && Object.keys(binds0).length === RESTRICCIONES_POR_CONSULTA + 1 && Object.keys(trozos[1].binds).length === 11,
      `${trozos.length} consultas`
    )
    const dosDuenos = sqlColumnasDeRestricciones(ORA19, [['APP', 'A_FK'], ['GEO', 'P_PK'], ['APP', 'B_PK'], ['APP', 'A_FK']])
    check(
      'UNA CONSULTA POR DUEÑO (owner = :o AND constraint_name IN (…)): ni tuplas (1,7 s) ni ramas por OR (0,6-0,9 s medidos)',
      dosDuenos.length === 2 &&
        dosDuenos.every((c) => /WHERE owner = :o AND constraint_name IN \(:c0(, :c1)?\)/.test(c.sql) && !/\bOR\b/.test(c.sql) && !/\(owner, constraint_name\) IN/.test(c.sql)) &&
        JSON.stringify(dosDuenos.map((c) => c.binds)) === JSON.stringify([{ o: 'APP', c0: 'A_FK', c1: 'B_PK' }, { o: 'GEO', c0: 'P_PK' }]),
      JSON.stringify(dosDuenos.map((c) => c.binds))
    )
    check('PG no tiene el segundo ni el tercer paso', lanza(() => sqlColumnasDeRestricciones(PG16, [['e', 't']])) && lanza(() => sqlFksEntrantesOracle(PG16, 'e', ['k'])), 'lanza')

    // Oracle: la tabla PADRE con una FK a sí misma (JEFE), una hija por la PK compuesta y
    // otra por la UNIQUE, y una FK de PADRE a otro esquema.
    const restricciones = [
      ['APP', 'HIJA', 'HIJA_FK', 'APP', 'PADRE_PK'],
      ['APP', 'OTRA', 'OTRA_FK', 'APP', 'PADRE_UK'],
      ['APP', 'PADRE', 'PADRE_JEFE', 'APP', 'PADRE_PK'],
      ['APP', 'PADRE', 'PADRE_PAIS', 'GEO', 'PAIS_PK']
    ]
    check('pares a completar: la FK y su destino', JSON.stringify(paresDeFksOracle(restricciones).slice(0, 2)) === JSON.stringify([['APP', 'HIJA_FK'], ['APP', 'PADRE_PK']]), 'ok')
    const columnas = [
      // Desordenadas a propósito: manda `position`.
      ['APP', 'HIJA_FK', 'HIJA', 'PB', 2],
      ['APP', 'HIJA_FK', 'HIJA', 'PA', 1],
      ['APP', 'PADRE_PK', 'PADRE', 'A', 1],
      ['APP', 'PADRE_PK', 'PADRE', 'B', 2],
      ['APP', 'PADRE_UK', 'PADRE', 'U', 1],
      ['APP', 'OTRA_FK', 'OTRA', 'PU', 1],
      ['APP', 'PADRE_JEFE', 'PADRE', 'JEFE_B', '2'],
      ['APP', 'PADRE_JEFE', 'PADRE', 'JEFE_A', '1'],
      ['APP', 'PADRE_PAIS', 'PADRE', 'PAIS', 1],
      ['GEO', 'PAIS_PK', 'PAIS', 'ID', 1]
    ]
    const r = mapearFks('oracle', 'APP', 'PADRE', restricciones, columnas)
    check(
      'salientes: JEFE (a sí misma) y PAIS (otro esquema), columnas en orden de posición',
      JSON.stringify(r.salientes.map((f) => [f.nombre, f.desde.columnas, f.hacia.esquema, f.hacia.tabla, f.hacia.columnas])) ===
        JSON.stringify([
          ['PADRE_JEFE', ['JEFE_A', 'JEFE_B'], 'APP', 'PADRE', ['A', 'B']],
          ['PADRE_PAIS', ['PAIS'], 'GEO', 'PAIS', ['ID']]
        ]),
      JSON.stringify(r.salientes)
    )
    check(
      'entrantes: HIJA por la PK compuesta, OTRA por la UNIQUE, y JEFE (también entra)',
      JSON.stringify(r.entrantes.map((f) => [f.nombre, f.desde.tabla, f.desde.columnas, f.hacia.columnas])) ===
        JSON.stringify([
          ['HIJA_FK', 'HIJA', ['PA', 'PB'], ['A', 'B']],
          ['OTRA_FK', 'OTRA', ['PU'], ['U']],
          ['PADRE_JEFE', 'PADRE', ['JEFE_A', 'JEFE_B'], ['A', 'B']]
        ]),
      JSON.stringify(r.entrantes)
    )
    // Medido en 11.2: un usuario que ve la hija pero NO el padre (otro esquema sin
    // permisos) recibe la FK de ALL_CONSTRAINTS sin las columnas del padre.
    const invisible = mapearFks(
      'oracle',
      'APP',
      'HIJA',
      [
        ['APP', 'HIJA', 'HIJA_FK', 'APP', 'PADRE_PK'],
        ['APP', 'HIJA', 'HIJA_OCULTA', 'PRIV', 'SECRETA_PK']
      ],
      [
        ['APP', 'HIJA_FK', 'HIJA', 'PA', 1],
        ['APP', 'PADRE_PK', 'PADRE', 'A', 1],
        ['APP', 'HIJA_OCULTA', 'HIJA', 'SID', 1]
      ]
    )
    check(
      'una FK hacia una tabla que el usuario no ve NO sale (sin tabla ni columnas no hay JOIN); la visible sí',
      JSON.stringify(invisible.salientes.map((f) => [f.nombre, f.hacia.tabla, f.hacia.columnas])) === JSON.stringify([['HIJA_FK', 'PADRE', ['A']]]) &&
        invisible.entrantes.length === 0,
      JSON.stringify(invisible)
    )
    const rpg = mapearFks('postgres', 'public', 'padre', [
      ['hija_fk', 'public', 'hija', '{pa,pb}', 'public', 'padre', ['a', 'b']],
      ['padre_jefe', 'public', 'padre', ['jefe'], 'public', 'padre', ['id']],
      ['padre_pais', 'public', 'padre', ['pais'], 'geo', 'pais', ['id']]
    ])
    check(
      'PG: salientes y entrantes, arrays como texto o parseados, autorreferencia en las dos',
      rpg.salientes.map((f) => f.nombre).join() === 'padre_jefe,padre_pais' &&
        rpg.entrantes.map((f) => f.nombre).join() === 'hija_fk,padre_jefe' &&
        JSON.stringify(rpg.entrantes[0].desde.columnas) === JSON.stringify(['pa', 'pb']),
      JSON.stringify(rpg)
    )
    check('sin FK: listas vacías', JSON.stringify(mapearFks('oracle', 'A', 'T', [], [])) === JSON.stringify({ salientes: [], entrantes: [] }), 'vacías')

    // `leerFksOracle`, con un lector falso que contesta según el paso: qué se pregunta,
    // en qué orden, y que el resultado es el de la consulta única de antes. (Recibe
    // un `LectorCatalogo`; que cada consulta pase por
    // `construir` lo fija el contrato de `motores/test-catalogo-motores.mts`.)
    const preguntas: ConsultaCatalogo[] = []
    const lector = (d: DialectoCatalogo, consultar: LectorCatalogo['consultar']): LectorCatalogo => ({
      dialecto: d,
      consultar,
      construir: (fn) => fn()
    })
    const falso =
      (propias: unknown[][], entrantes: unknown[][]) =>
      async (c: ConsultaCatalogo): Promise<unknown[][]> => {
        preguntas.push(c)
        // Como la base: solo las columnas del dueño y los nombres que se piden.
        if (/FROM all_cons_columns/.test(c.sql)) {
          const b = c.binds as Record<string, string>
          const nombres = new Set(Object.entries(b).filter(([k]) => k !== 'o').map(([, v]) => v))
          return columnas.filter((f) => f[0] === b.o && nombres.has(String(f[1])))
        }
        if (/r_constraint_name IN/.test(c.sql)) return entrantes
        return propias
      }
    const propiasPadre = [
      ['R', 'APP', 'PADRE', 'PADRE_JEFE', 'APP', 'PADRE_PK'],
      ['R', 'APP', 'PADRE', 'PADRE_PAIS', 'GEO', 'PAIS_PK'],
      ['P', 'APP', 'PADRE', 'PADRE_PK', null, null],
      ['U', 'APP', 'PADRE', 'PADRE_UK', null, null]
    ]
    // La FK a sí misma vuelve en las entrantes: tiene que salir UNA vez por lista.
    const entrantesPadre = [
      ['APP', 'OTRA', 'OTRA_FK', 'APP', 'PADRE_UK'],
      ['APP', 'PADRE', 'PADRE_JEFE', 'APP', 'PADRE_PK'],
      ['APP', 'HIJA', 'HIJA_FK', 'APP', 'PADRE_PK']
    ]
    const leido = await leerFksOracle(lector(ORA11, falso(propiasPadre, entrantesPadre)), 'APP', 'PADRE')
    check(
      'leerFksOracle: el MISMO resultado que la consulta única de antes (JEFE una vez en cada lista)',
      JSON.stringify(leido) === JSON.stringify(r),
      JSON.stringify({ salientes: leido.salientes.map((f) => f.nombre), entrantes: leido.entrantes.map((f) => f.nombre) })
    )
    const b2 = preguntas[1]?.binds as Record<string, string> | undefined
    check(
      'leerFksOracle: en orden, propias, entrantes de SUS claves y columnas (una por dueño: APP y GEO)',
      preguntas.length === 4 &&
        /constraint_type IN \('R', 'P', 'U'\)/.test(preguntas[0].sql) &&
        b2 !== undefined && b2.esq === 'APP' && b2.k0 === 'PADRE_PK' && b2.k1 === 'PADRE_UK' &&
        preguntas.slice(2).every((p) => /FROM all_cons_columns/.test(p.sql)) &&
        preguntas.slice(2).map((p) => (p.binds as Record<string, string>).o).join() === 'APP,GEO',
      preguntas.map((p) => p.sql.split('\n')[0]).join(' | ')
    )
    check(
      'filasFksOracle: únicas por (dueño, nombre) y en el orden de antes (dueño, tabla, nombre)',
      JSON.stringify(filasFksOracle(propiasPadre, entrantesPadre).map((f) => f[2])) === JSON.stringify(['HIJA_FK', 'OTRA_FK', 'PADRE_JEFE', 'PADRE_PAIS']) &&
        JSON.stringify(clavesReferenciablesOracle(propiasPadre)) === JSON.stringify(['PADRE_PK', 'PADRE_UK']),
      JSON.stringify(filasFksOracle(propiasPadre, entrantesPadre))
    )
    preguntas.length = 0
    const sinClaves = await leerFksOracle(lector(ORA19, falso([['R', 'APP', 'LOG', 'LOG_FK', 'APP', 'PADRE_PK']], [])), 'APP', 'LOG')
    const pregSinClaves = preguntas.length
    preguntas.length = 0
    const nada = await leerFksOracle(lector(ORA19, falso([], [])), 'APP', 'SUELTA')
    check(
      'sin PK/UNIQUE no se pregunta por entrantes; sin ninguna FK, tampoco por columnas',
      pregSinClaves === 2 && sinClaves.entrantes.length === 0 && preguntas.length === 1 && nada.salientes.length === 0 && nada.entrantes.length === 0,
      `con una FK y sin claves: ${pregSinClaves} preguntas · sin nada: ${preguntas.length}`
    )
  }

  hr('(7) formatearTipoOracle')
  {
    const casos: Array<[Parameters<typeof formatearTipoOracle>[0], string]> = [
      [{ tipo: 'VARCHAR2', longitud: 40, longitudCaracteres: 40, semantica: 'B' }, 'VARCHAR2(40)'],
      [{ tipo: 'VARCHAR2', longitud: 160, longitudCaracteres: 40, semantica: 'C' }, 'VARCHAR2(40 CHAR)'],
      [{ tipo: 'CHAR', longitud: 1, longitudCaracteres: 1, semantica: 'B' }, 'CHAR(1)'],
      [{ tipo: 'NVARCHAR2', longitud: 40, longitudCaracteres: 20, semantica: 'C' }, 'NVARCHAR2(20)'],
      [{ tipo: 'NUMBER', longitud: 22 }, 'NUMBER'],
      [{ tipo: 'NUMBER', longitud: 22, escala: 0 }, 'NUMBER(*,0)'],
      [{ tipo: 'NUMBER', precision: 10, escala: 0 }, 'NUMBER(10)'],
      [{ tipo: 'NUMBER', precision: 10, escala: 2 }, 'NUMBER(10,2)'],
      [{ tipo: 'FLOAT', precision: 126 }, 'FLOAT(126)'],
      [{ tipo: 'RAW', longitud: 16 }, 'RAW(16)'],
      [{ tipo: 'TIMESTAMP(6) WITH TIME ZONE', longitud: 13, escala: 6 }, 'TIMESTAMP(6) WITH TIME ZONE'],
      [{ tipo: 'INTERVAL DAY(2) TO SECOND(6)', longitud: 11 }, 'INTERVAL DAY(2) TO SECOND(6)'],
      [{ tipo: 'DATE', longitud: 7 }, 'DATE'],
      [{ tipo: 'CLOB', longitud: 4000 }, 'CLOB'],
      [{ tipo: 'SDO_GEOMETRY', longitud: 1 }, 'SDO_GEOMETRY']
    ]
    const malos = casos.filter(([c, esperado]) => formatearTipoOracle(c) !== esperado).map(([c, e]) => `${formatearTipoOracle(c)}≠${e}`)
    check(`${casos.length} tipos de Oracle`, malos.length === 0, malos.join(' | ') || 'todos')
  }

  hr('(7b) Tipos DECLARADOS de la pestaña de tabla')
  {
    // Las filas de `sqlTiposColumnas` como las devuelve el trabajador (números como texto),
    // con los valores MEDIDOS en ALL_TAB_COLUMNS de la 11.2 y la 21c.
    const filas = [
      ['VB', 'VARCHAR2', '40', '40', 'B', null, null, null],
      ['VC', 'VARCHAR2', '160', '40', 'C', null, null, null],
      ['CC', 'CHAR', '20', '5', 'C', null, null, null],
      ['NV', 'NVARCHAR2', '40', '20', 'C', null, null, null],
      ['I', 'NUMBER', '22', '0', null, null, '0', null],
      ['NNEG', 'NUMBER', '22', '0', null, '5', '-2', null],
      ['IDS', 'INTERVAL DAY(3) TO SECOND(2)', '11', '0', null, '3', '2', null],
      ['X', 'XMLTYPE', '2000', '0', null, null, null, 'PUBLIC'],
      ['G', 'SDO_GEOMETRY', '1', '0', null, null, null, 'MDSYS'],
      ['', 'VARCHAR2', '1', '1', 'B', null, null, null]
    ]
    const tipos = mapearTiposColumnas(filas)
    const esperados: Array<[string, string]> = [
      ['VB', 'VARCHAR2(40)'],
      ['VC', 'VARCHAR2(40 CHAR)'],
      ['CC', 'CHAR(5 CHAR)'],
      ['NV', 'NVARCHAR2(20)'],
      ['I', 'NUMBER(*,0)'],
      ['NNEG', 'NUMBER(5,-2)'],
      ['IDS', 'INTERVAL DAY(3) TO SECOND(2)'],
      ['X', 'XMLTYPE'],
      ['G', 'MDSYS.SDO_GEOMETRY']
    ]
    const mal = esperados.filter(([n, t]) => tipos.get(n) !== t).map(([n, t]) => `${n}: ${tipos.get(n)} ≠ ${t}`)
    check(
      'mapearTiposColumnas: el tipo como se DECLARÓ (con su unidad y su dueño; PUBLIC no), y una fila sin nombre se ignora',
      mal.length === 0 && tipos.size === esperados.length,
      mal.join(' | ') || [...tipos.entries()].map(([n, t]) => `${n}=${t}`).join(', ')
    )
    const sql = sqlTiposColumnas(ORA11, 'APP', 'T')
    check(
      'sqlTiposColumnas: ALL_TAB_COLUMNS por dueño y tabla, sin DATA_DEFAULT (un LONG) ni comentarios',
      /FROM all_tab_columns\s+WHERE owner = :esq AND table_name = :obj/.test(sql.sql) && !/data_default|comments/i.test(sql.sql),
      sql.sql.replace(/\s+/g, ' ')
    )
    const leidas = [
      { nombre: 'VC', tipoLogico: 'texto' as const, tipoMotor: 'VARCHAR2' },
      { nombre: 'NUEVA', tipoLogico: 'texto' as const, tipoMotor: 'VARCHAR2' },
      { nombre: COLUMNA_ROWID, tipoLogico: 'texto' as const, tipoMotor: 'VARCHAR2' }
    ]
    const antes = JSON.stringify(leidas)
    const con = conTiposDeclarados(leidas, tipos)
    check(
      'conTiposDeclarados: el declarado donde el catálogo conoce la columna; la nueva y la oculta del ROWID se quedan sin él, y no muta',
      con[0].tipoDeclarado === 'VARCHAR2(40 CHAR)' &&
        con[0].tipoMotor === 'VARCHAR2' &&
        !('tipoDeclarado' in con[1]) &&
        !('tipoDeclarado' in con[2]) &&
        JSON.stringify(leidas) === antes,
      JSON.stringify(con)
    )
    check(
      'faltanTiposDeclarados: una columna que el catálogo no conoce pide releerlo; la oculta del ROWID no',
      faltanTiposDeclarados(leidas, tipos) && !faltanTiposDeclarados([leidas[0], leidas[2]], tipos),
      `${faltanTiposDeclarados(leidas, tipos)} / ${faltanTiposDeclarados([leidas[0], leidas[2]], tipos)}`
    )
  }

  hr('(8) Utilidades')
  {
    check('citarIdent duplica comillas', citarIdent('A"B') === '"A""B"' && citarIdent('x') === '"x"', citarIdent('A"B'))
    const l = aLista('{a,"b,c","d\\"e",NULL,"NULL"}')
    check('aLista: literal de PG con comillas, escapes y NULL', JSON.stringify(l) === '["a","b,c","d\\"e","NULL"]', JSON.stringify(l))
    check('aLista: vacío y ya parseado', aLista('{}').length === 0 && aLista(null).length === 0 && aLista(['x', null]).join() === 'x', 'ok')
    check('aBool', aBool(true) && aBool('t') && aBool('Y') && aBool(1) && aBool('1') && !aBool('f') && !aBool(0) && !aBool(null) && !aBool('N'), 'ok')
    check('aNumero', aNumero('27') === 27 && aNumero(3) === 3 && aNumero(null) === null && aNumero('') === null && aNumero('x') === null && aNumero(BigInt(5)) === 5, 'ok')
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
