#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica PURA del autocompletado SQL (contexto, referencias, `*`,
// sugerencias, FKs y «Expandir columnas») en Oracle, PG, SQLite y SQL Server.
// El cursor se marca con `¦` dentro del SQL; el arnés lo quita, parte el texto con el
// divisor real y tokeniza la sentencia como lo hará el proveedor. Bajo `node` llano:
// nada de Monaco ni DOM en la cadena. (npm run test:db-autocompletado)
// Decisiones: docs/decisiones/bd/ui-autocompletado-contexto.md
// =============================================================================

import {
  admiteTresPartes,
  analizarContexto,
  contextoEnTexto,
  estrellaEn,
  palabraEnCursor,
  referencias,
  TIPOS_RELACION,
  type Contexto,
  type EstrellaSelect,
  type RefTabla
} from './contextoSql.ts'
import {
  aliasLibre,
  construirSugerencias,
  esquemaDeRef,
  esquemasLocales,
  listaDeEstrella,
  pendientesDeCarga,
  pendientesDeEstrella,
  resolverMiembro,
  sugerenciaEstrella,
  LIMITE_SUGERENCIAS,
  type DbObjetoNombre,
  type FuenteCatalogo,
  type Sugerencia
} from './sugerenciasSql.ts'
import { dividirSentencias, sentenciaEnCursor } from '../../../../../shared/sql/divisorSql.ts'
import { tokenizar } from '../../../../../shared/sql/lexicoSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { DbFk, DbRelacionesFk, DbTipoObjeto } from '../../../../../shared/db-explorador-ipc.ts'

const j = (v: unknown): string => JSON.stringify(v)

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Arnés
// ---------------------------------------------------------------------------
const MARCA = '¦'

function partir(conCursor: string): { texto: string; cursor: number } {
  const cursor = conCursor.indexOf(MARCA)
  if (cursor < 0) throw new Error('falta la marca del cursor en: ' + conCursor)
  return { texto: conCursor.slice(0, cursor) + conCursor.slice(cursor + MARCA.length), cursor }
}

/** Como el proveedor: `contextoEnTexto` sobre el texto entero del modelo. */
function ctx(conCursor: string, d: DialectoSql = 'oracle'): Contexto {
  const { texto, cursor } = partir(conCursor)
  return contextoEnTexto(texto, cursor, d)
}

function refsDe(sql: string, d: DialectoSql = 'oracle'): RefTabla[] {
  return referencias(tokenizar(sql, d), d, sql)
}

function fmtRef(r: RefTabla): string {
  return (r.esquema !== null ? r.esquema + '.' : '') + r.nombre + (r.alias !== null ? ' ' + r.alias : '')
}

function fmt(c: Contexto): string {
  switch (c.tipo) {
    case 'ninguno':
      return 'ninguno'
    case 'palabrasClave':
      return `palabrasClave(${JSON.stringify(c.prefijo)})`
    case 'objetos':
      return `objetos(${JSON.stringify(c.prefijo)}, esq=${c.esquema}, tipos=${c.tipos ? c.tipos.join('|') : '*'})`
    case 'columnas':
      return `columnas(${JSON.stringify(c.prefijo)}, [${c.tablas.map(fmtRef).join(', ')}], obj=${c.conObjetos}, claves=${c.conClaves})`
    case 'miembro':
      return `miembro(${JSON.stringify(c.prefijo)}, [${c.calificador.join('.')}], [${c.tablas.map(fmtRef).join(', ')}])`
  }
}

function mismasTablas(a: RefTabla[], esperado: string[]): boolean {
  const fa = a.map(fmtRef)
  return fa.length === esperado.length && fa.every((x, i) => x === esperado[i])
}

function esObjetos(c: Contexto, esquema: string | null, prefijo = ''): boolean {
  return c.tipo === 'objetos' && c.esquema === esquema && c.prefijo === prefijo
}

function mismosTipos(a: readonly DbTipoObjeto[] | undefined, b: readonly DbTipoObjeto[] | undefined): boolean {
  if (!a || !b) return a === b
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// --- Catálogo falso --------------------------------------------------------------

interface DatosFuente {
  actual: string | null
  objetos: DbObjetoNombre[]
  columnas: Record<string, string[]>
  esquemas: string[]
  publicos: string[]
}

function fuenteDe(datos: DatosFuente): FuenteCatalogo & { pedidasColumnas: string[] } {
  const pedidas: string[] = []
  return {
    pedidasColumnas: pedidas,
    objetos: (esquema) => (esquema === null ? datos.objetos : datos.objetos.filter((o) => o.esquema === esquema)),
    columnas: (esquema, tabla) => {
      pedidas.push(esquema + '.' + tabla)
      const c = datos.columnas[esquema + '.' + tabla]
      return c === undefined ? null : c
    },
    esquemas: () => datos.esquemas,
    esquemaActual: () => datos.actual,
    publicos: () => datos.publicos
  }
}

function obj(esquema: string, nombre: string, tipo: DbTipoObjeto = 'tabla'): DbObjetoNombre {
  return { esquema, nombre, tipo }
}

const ORACLE: DatosFuente = {
  actual: 'ADMDEMO',
  objetos: [
    obj('ADMDEMO', 'USER_PROFILE'),
    obj('ADMDEMO', 'PROFILE'),
    obj('ADMDEMO', 'PROFILE_V', 'vista'),
    obj('ADMDEMO', 'APPLICATION'),
    obj('ADMDEMO', 'LEVEL'),
    obj('ADMDEMO', 'SEQ_PROFILE', 'secuencia'),
    obj('ADMDEMO', 'PKG_PROFILE', 'paquete'),
    obj('ADMDEMO', 'P_ALTA', 'rutina'),
    obj('HR', 'PROFILES'),
    obj('HR', 'emp_minus'),
    obj('HR', 'EMP'),
    obj('SYS', 'DBA_PROFILES', 'vista')
  ],
  columnas: {
    'ADMDEMO.PROFILE': ['ID', 'NAME', 'ENABLED'],
    'ADMDEMO.USER_PROFILE': ['ID', 'USER_ID', 'PROFILE_ID'],
    'HR.EMP': ['EMPNO', 'ENAME', 'SAL', 'DEPTNO', 'select'],
    'PUBLIC.ALL_USERS': ['USERNAME', 'USER_ID']
  },
  esquemas: ['ADMDEMO', 'HR', 'SYS', 'PROFILER', 'PUBLIC'],
  publicos: ['DUAL', 'PROFILE_PUB', 'ALL_USERS']
}

const POSTGRES: DatosFuente = {
  actual: 'app',
  objetos: [
    obj('app', 'perfil'),
    obj('public', 'profile'),
    obj('public', 'user_profile'),
    obj('ventas', 'Profile'),
    obj('ventas', 'profiles'),
    obj('ventas', 'select'),
    obj('pg_catalog', 'pg_proc')
  ],
  columnas: {
    'public.profile': ['id', 'name', 'Enabled'],
    'ventas.profiles': ['id', 'total']
  },
  esquemas: ['app', 'public', 'ventas', 'pg_catalog'],
  publicos: []
}

const OP_ORA = { dialecto: 'oracle' as const, alias: 'QA-DEMO' }
const OP_PG = { dialecto: 'postgres' as const, alias: 'LOCAL-PG' }

function etiquetas(s: Sugerencia[]): string[] {
  return s.map((x) => x.etiqueta + (x.detalle ? x.detalle : ''))
}

function indice(s: Sugerencia[], etiqueta: string, detalle?: string): number {
  return s.findIndex((x) => x.etiqueta === etiqueta && (detalle === undefined || x.detalle === detalle))
}

function ordenada(s: Sugerencia[]): boolean {
  for (let i = 1; i < s.length; i++) if (s[i - 1].orden > s[i].orden) return false
  return true
}

// ---------------------------------------------------------------------------
function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Contextos de OBJETOS')
  {
    const casos: Array<[string, DialectoSql, string | null, string, readonly DbTipoObjeto[] | undefined]> = [
      ['select * from ¦', 'oracle', null, '', TIPOS_RELACION],
      ['select * from us¦', 'oracle', null, 'us', TIPOS_RELACION],
      ['select * from emp e join ¦', 'oracle', null, '', TIPOS_RELACION],
      ['select * from emp e left outer join de¦', 'oracle', null, 'de', TIPOS_RELACION],
      ['select * from emp e, ¦', 'oracle', null, '', TIPOS_RELACION],
      ['update ¦', 'oracle', null, '', TIPOS_RELACION],
      ['insert into ¦', 'postgres', null, '', TIPOS_RELACION],
      ['delete from ¦ where x = 1', 'oracle', null, '', TIPOS_RELACION],
      ['merge into t using ¦', 'oracle', null, '', TIPOS_RELACION],
      ['truncate table ¦', 'postgres', null, '', TIPOS_RELACION],
      ['desc ¦', 'oracle', null, '', undefined],
      ['call ¦', 'postgres', null, '', ['rutina', 'paquete', 'sinonimo']],
      ['drop view ¦', 'oracle', null, '', ['vista']],
      ['drop materialized view ¦', 'postgres', null, '', ['vistaMaterializada']],
      ['drop package body pk¦', 'oracle', null, 'pk', ['paquete']],
      ['select * from admdemo.¦', 'oracle', 'ADMDEMO', '', TIPOS_RELACION],
      ['select * from admdemo.us¦ u where u.id = 1', 'oracle', 'ADMDEMO', 'us', TIPOS_RELACION],
      ['select * from Ventas.¦', 'postgres', 'ventas', '', TIPOS_RELACION],
      ['select * from "Ventas".pro¦', 'postgres', 'Ventas', 'pro', TIPOS_RELACION],
      ['select * from (select * from ¦)', 'oracle', null, '', TIPOS_RELACION],
      ['begin\n  select 1 into v from dual;\n  update ¦', 'oracle', null, '', TIPOS_RELACION],
      ['select 1 from dual;\nselect * from pro¦', 'oracle', null, 'pro', TIPOS_RELACION],
      ['create index ix on ¦', 'postgres', null, '', undefined]
    ]
    for (const [sql, d, esq, pre, tipos] of casos) {
      const c = ctx(sql, d)
      const ok = esObjetos(c, esq, pre) && c.tipo === 'objetos' && mismosTipos(c.tipos, tipos)
      check(`${d}: ${JSON.stringify(sql)} -> objetos`, ok, fmt(c))
    }
  }

  // -------------------------------------------------------------------------
  hr('(2) Contextos de COLUMNAS')
  {
    const casos: Array<[string, DialectoSql, string[], boolean | null]> = [
      // [sql, dialecto, tablas esperadas, conClaves (null = no se mira)]
      ['select ¦ from emp', 'oracle', ['EMP'], true],
      ['select a, ¦ from emp e', 'oracle', ['EMP E'], false],
      ['select a ¦ from emp e', 'oracle', ['EMP E'], true],
      ['select * from emp where ¦', 'oracle', ['EMP'], true],
      ['select * from emp where a = ¦', 'oracle', ['EMP'], false],
      ["select * from emp where a = 'x' ¦", 'oracle', ['EMP'], true],
      ['select * from emp where a = 1 and na¦', 'oracle', ['EMP'], false],
      ['select * from emp e join dept d on ¦', 'oracle', ['EMP E', 'DEPT D'], true],
      ['update hr.emp set ¦', 'oracle', ['HR.EMP'], true],
      ['update emp e set sal = 1 where ¦', 'oracle', ['EMP E'], true],
      ['select * from emp order by ¦', 'postgres', ['emp'], true],
      ['select deptno from emp group by ¦', 'oracle', ['EMP'], true],
      ['select deptno from emp group by deptno having ¦', 'oracle', ['EMP'], true],
      ['select count(¦) from emp', 'oracle', ['EMP'], true],
      ['select extract(year from ¦) from emp', 'oracle', ['EMP'], true],
      ['select * from emp where x in (select ¦ from dept)', 'oracle', ['EMP', 'DEPT'], true],
      ['select * from emp where x in (¦', 'oracle', ['EMP'], true],
      ['select * from emp where (a = 1 or ¦', 'oracle', ['EMP'], false],
      ['select row_number() over (partition by ¦) from emp', 'oracle', ['EMP'], true],
      ['select * from a join b using (¦', 'postgres', ['a', 'b'], false],
      ['begin\n  update emp set ¦', 'oracle', ['EMP'], true]
    ]
    for (const [sql, d, tablas, conClaves] of casos) {
      const c = ctx(sql, d)
      const ok =
        c.tipo === 'columnas' &&
        mismasTablas(c.tablas, tablas) &&
        c.conObjetos === (tablas.length === 0) &&
        (conClaves === null || c.conClaves === conClaves)
      check(`${d}: ${JSON.stringify(sql)} -> columnas`, ok, fmt(c))
    }
    const ins = ctx('insert into hr.emp (empno, ¦) select 1, 2 from dual')
    check(
      'insert into hr.emp (…, ¦): solo las columnas de ESA tabla, sin claves',
      ins.tipo === 'columnas' && mismasTablas(ins.tablas, ['HR.EMP']) && !ins.conClaves,
      fmt(ins)
    )
    const sinFrom = ctx('select pro¦')
    check(
      'select pro¦ (sin FROM): columnas SIN tablas -> conObjetos',
      sinFrom.tipo === 'columnas' && sinFrom.tablas.length === 0 && sinFrom.conObjetos && sinFrom.prefijo === 'pro',
      fmt(sinFrom)
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) `alias.` y `ESQ.` como miembro (con el FROM detrás del cursor)')
  {
    const a = ctx('select e.¦ from emp e')
    check(
      'select e.¦ from emp e -> miembro [E] con EMP E',
      a.tipo === 'miembro' && a.calificador.join('.') === 'E' && mismasTablas(a.tablas, ['EMP E']) && a.prefijo === '',
      fmt(a)
    )
    const b = ctx('select e.en¦, d.dname\n  from hr.emp e\n  join dept d on d.deptno = e.deptno')
    check(
      'e.en¦ con el FROM en líneas de abajo: prefijo y tablas',
      b.tipo === 'miembro' && b.prefijo === 'en' && mismasTablas(b.tablas, ['HR.EMP E', 'DEPT D']),
      fmt(b)
    )
    const c = ctx('select E.¦ from Emp E', 'postgres')
    check(
      'PG pliega a minúsculas: E. -> [e], Emp -> emp',
      c.tipo === 'miembro' && c.calificador.join('.') === 'e' && mismasTablas(c.tablas, ['emp e']),
      fmt(c)
    )
    const d = ctx('select t.¦ from public."Perfil" as t', 'postgres')
    check(
      'PG con AS y nombre citado: [t] con public.Perfil t',
      d.tipo === 'miembro' && d.calificador.join('.') === 't' && mismasTablas(d.tablas, ['public.Perfil t']),
      fmt(d)
    )
    const e = ctx('select * from emp e where e.¦ = 1')
    check('en el WHERE: miembro [E]', e.tipo === 'miembro' && e.calificador.join('.') === 'E', fmt(e))
    const f = ctx('select admdemo.¦')
    check('select admdemo.¦ -> miembro [ADMDEMO] (se resuelve a esquema)', f.tipo === 'miembro' && f.calificador.join('.') === 'ADMDEMO', fmt(f))
    const g = ctx('select hr.emp.¦ from hr.emp')
    check('hr.emp.¦ -> miembro [HR, EMP]', g.tipo === 'miembro' && g.calificador.join('.') === 'HR.EMP', fmt(g))
    const h = ctx('with x as (select 1 a from dual) select x.¦ from x join emp e on 1 = 1')
    check(
      'el CTE no es una tabla del catálogo: fuera de las referencias',
      h.tipo === 'miembro' && mismasTablas(h.tablas, ['EMP E']),
      fmt(h)
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) NINGUNO: cadena, comentario, dólar-comillas, número, alias')
  {
    const casos: Array<[string, DialectoSql]> = [
      ["select 'abc¦' from dual", 'oracle'],
      ["select 'sin cerrar¦", 'oracle'],
      ["select q'[it's ¦]' from dual", 'oracle'],
      ['select * from emp -- comentario¦', 'oracle'],
      ['select * from emp -- comentario ¦\n', 'oracle'],
      ['select /* bloque ¦ */ 1 from dual', 'oracle'],
      ['select /* sin cerrar ¦', 'postgres'],
      ['select 1 from dual;\n-- nota suelta ¦\nselect 2 from dual', 'oracle'],
      ['select 1 from dual; -- tras el punto y coma ¦', 'oracle'],
      ['create function f() returns int as $$ select ¦ $$ language sql', 'postgres'],
      ['select 12¦', 'oracle'],
      ['select * from emp where id = :id¦', 'oracle'],
      ['select * from emp as ¦', 'postgres'],
      ['select sal as ¦ from emp', 'oracle'],
      ['select "Mi¦', 'postgres']
    ]
    for (const [sql, d] of casos) {
      const c = ctx(sql, d)
      check(`${d}: ${JSON.stringify(sql)} -> ninguno`, c.tipo === 'ninguno', fmt(c))
    }
    const cerrado = ctx("select * from emp where a = 'x'¦")
    check("justo DETRÁS de una cadena cerrada ya no es cadena", cerrado.tipo === 'columnas', fmt(cerrado))
    const trasBloque = ctx('select /* c */ ¦ from emp')
    check('tras un comentario de bloque cerrado: columnas', trasBloque.tipo === 'columnas', fmt(trasBloque))
  }

  // -------------------------------------------------------------------------
  hr('(5) PALABRAS CLAVE')
  {
    const casos: Array<[string, DialectoSql, string]> = [
      ['¦', 'oracle', ''],
      ['sel¦', 'oracle', 'sel'],
      ['SeL¦', 'postgres', 'SeL'],
      ['select * from emp ¦', 'oracle', ''],
      ['select * from emp e wh¦', 'oracle', 'wh'],
      ['select * from emp e join dept d ¦', 'oracle', ''],
      ['select 1 from dual;\n¦', 'oracle', ''],
      ['select 1 from dual;¦', 'oracle', ''],
      ['create ¦', 'oracle', ''],
      ['create view v as ¦', 'oracle', ''],
      ['insert into t (a) values (¦', 'oracle', ''],
      ['select * from emp where exists (¦', 'oracle', ''],
      ['select * from (¦', 'postgres', ''],
      ['alter session set ¦', 'oracle', ''],
      ['select * from emp for update ¦', 'oracle', ''],
      ['select a from t union ¦', 'postgres', ''],
      ['create table t (id ¦', 'oracle', ''],
      ['merge into t using (¦', 'oracle', '']
    ]
    for (const [sql, d, pre] of casos) {
      const c = ctx(sql, d)
      check(`${d}: ${JSON.stringify(sql)} -> palabrasClave`, c.tipo === 'palabrasClave' && c.prefijo === pre, fmt(c))
    }
    const sinTexto = analizarContexto(tokenizar('sel', 'oracle'), 3, 'oracle')
    check(
      'sin `texto`, el prefijo sale del léxico (en mayúsculas)',
      sinTexto.tipo === 'palabrasClave' && sinTexto.prefijo === 'SEL',
      fmt(sinTexto)
    )
    const rel = 'select * from dual;\nselect * from ¦'
    const { texto, cursor } = partir(rel)
    const s = sentenciaEnCursor(dividirSentencias(texto, 'oracle'), texto, cursor)
    const suelta = s ? texto.slice(s.desde) : ''
    const relativo = s ? analizarContexto(tokenizar(suelta, 'oracle'), cursor - s.desde, 'oracle', suelta) : null
    check(
      'cursor RELATIVO a la sentencia suelta: mismas coordenadas que sus tokens',
      relativo !== null && esObjetos(relativo, null),
      relativo ? fmt(relativo) : 'sin sentencia'
    )
  }

  // -------------------------------------------------------------------------
  hr('(6) referencias()')
  {
    const casos: Array<[string, DialectoSql, string[]]> = [
      [
        'select * from a.emp e, dept d join sal s on s.id = e.id where e.x in (select 1 from bonus b)',
        'oracle',
        ['A.EMP E', 'DEPT D', 'SAL S', 'BONUS B']
      ],
      [
        'update public."Ventas" v set x = 1 from Clientes c where c.id = v.id',
        'postgres',
        ['public.Ventas v', 'clientes c']
      ],
      ['merge into t1 a using t2 b on (a.id = b.id) when matched then update set a.x = b.x', 'oracle', ['T1 A', 'T2 B']],
      ['insert into t (a, b) select a, b from u', 'oracle', ['T', 'U']],
      ['select * from generate_series(1, 3) g join x on true', 'postgres', ['x']],
      ['select extract(year from fecha), trim(both from nombre) from t', 'oracle', ['T']],
      ['select * from dual', 'oracle', []],
      ['select sysdate from sys.dual d', 'oracle', []],
      // Mitades negativas (`tablaFicticia`): solo DUAL o SYS.DUAL, y solo en Oracle.
      ['select * from hr.dual', 'oracle', ['HR.DUAL']],
      ['select * from dual', 'postgres', ['dual']],
      ['delete emp where x = 1', 'oracle', ['EMP']],
      ['select * from emp@remoto.dominio e', 'oracle', ['EMP E']],
      ['select * from t where a is distinct from b', 'postgres', ['t']],
      ['with recursive r (n) as (select 1 union all select n + 1 from r) select * from r, s', 'postgres', ['s']],
      ['select a into v_a from emp where 1 = 1', 'oracle', ['EMP']],
      ['select * from emp e left join emp j on j.mgr = e.empno', 'oracle', ['EMP E', 'EMP J']],
      ['select * from only padre p', 'postgres', ['padre p']],
      ['select * from t where x in (select y from u) order by 1', 'oracle', ['T', 'U']],
      ['select * from emp e -- , dept d\nwhere 1 = 1', 'oracle', ['EMP E']],
      ['select * from ventas.Ñandú n', 'postgres', ['ventas.Ñandú n']]
    ]
    for (const [sql, d, esperado] of casos) {
      const r = refsDe(sql, d)
      check(`${d}: ${JSON.stringify(sql).slice(0, 70)}`, mismasTablas(r, esperado), `[${r.map(fmtRef).join(', ')}]`)
    }
  }

  // -------------------------------------------------------------------------
  hr('(7) palabraEnCursor')
  {
    const t = 'select USER$A#B, x from t'
    const p = palabraEnCursor(t, 10)
    check(
      'Oracle: `$` y `#` son parte de la palabra; prefijo hasta el cursor',
      p.palabra === 'USER$A#B' && p.desde === 7 && p.hasta === 15 && p.prefijo === 'USE',
      JSON.stringify(p)
    )
    const pg = palabraEnCursor(t, 10, 'postgres')
    check('PG: `#` es un operador y corta la palabra', pg.palabra === 'USER$A' && pg.hasta === 13, JSON.stringify(pg))
    const nx = palabraEnCursor('select AÑO_FISCAL', 10)
    check('letras no ASCII (AÑO) cuentan como en el léxico', nx.palabra === 'AÑO_FISCAL' && nx.prefijo === 'AÑO', JSON.stringify(nx))
    const vacio = palabraEnCursor('select * from ', 14)
    check('tras un blanco: palabra vacía en el cursor', vacio.palabra === '' && vacio.desde === 14 && vacio.hasta === 14, JSON.stringify(vacio))
    const punto = palabraEnCursor('e.ename', 2)
    check('tras el punto: empieza tras él', punto.desde === 2 && punto.palabra === 'ename' && punto.prefijo === '', JSON.stringify(punto))
    const fuera = palabraEnCursor('abc', 99)
    check('offset fuera de rango se acota', fuera.palabra === 'abc' && fuera.prefijo === 'abc', JSON.stringify(fuera))
  }

  // -------------------------------------------------------------------------
  hr('(8) Sugerencias: subcadena, niveles, PUBLIC y palabras clave')
  {
    const f = fuenteDe(ORACLE)
    const s = construirSugerencias({ tipo: 'objetos', prefijo: 'PROFIL', esquema: null }, f, OP_ORA)
    check(
      "'PROFIL' encuentra USER_PROFILE y DBA_PROFILES (subcadena)",
      indice(s, 'USER_PROFILE') >= 0 && indice(s, 'DBA_PROFILES') >= 0,
      etiquetas(s).join(', ')
    )
    const s2 = construirSugerencias({ tipo: 'objetos', prefijo: 'profil', esquema: null }, f, OP_ORA)
    check(
      'sin distinguir mayúsculas: profil da lo mismo que PROFIL',
      JSON.stringify(etiquetas(s2)) === JSON.stringify(etiquetas(s)),
      `${s2.length} sugerencias`
    )
    check('la lista sale ordenada por `orden`', ordenada(s) && ordenada(s2), s.map((x) => x.orden.slice(0, 9)).join(' '))

    const n = construirSugerencias({ tipo: 'objetos', prefijo: 'PROFILE', esquema: null }, f, OP_ORA)
    const orden = [
      indice(n, 'PROFILE', ' (ADMDEMO)'), // 0 exacta
      indice(n, 'PROFILE_V'), // 1 prefijo, esquema actual
      indice(n, 'PROFILES'), // 2 prefijo, otro esquema
      indice(n, 'PROFILER'), // 2 prefijo, esquema (tras los objetos)
      indice(n, 'USER_PROFILE'), // 3 subcadena, esquema actual
      indice(n, 'DBA_PROFILES'), // 4 subcadena, otro esquema
      indice(n, 'PROFILE_PUB') // 5 PUBLIC
    ]
    check(
      'niveles: exacta < prefijo local < prefijo otro < subcadena local < subcadena otro < PUBLIC',
      orden.every((x) => x >= 0) && orden.every((x, i) => i === 0 || orden[i - 1] < x),
      etiquetas(n).join(' | ')
    )
    const niveles = [
      [n[indice(n, 'PROFILE', ' (ADMDEMO)')], '0'],
      [n[indice(n, 'PROFILE_V')], '1'],
      [n[indice(n, 'PROFILES')], '2'],
      [n[indice(n, 'USER_PROFILE')], '3'],
      [n[indice(n, 'DBA_PROFILES')], '4'],
      [n[indice(n, 'PROFILE_PUB')], '5']
    ] as Array<[Sugerencia | undefined, string]>
    check(
      'el primer carácter de `orden` es el nivel',
      niveles.every(([x, nv]) => x !== undefined && x.orden[0] === nv),
      niveles.map(([x]) => (x ? x.etiqueta + '=' + x.orden[0] : '?')).join(' ')
    )
    const pub = n[indice(n, 'PROFILE_PUB')]
    check(
      'PUBLIC: detalle (PUBLIC), sin calificar, tipo sinónimo',
      pub !== undefined && pub.detalle === ' (PUBLIC)' && pub.insertar === 'PROFILE_PUB' && pub.tipo === 'sinonimo',
      JSON.stringify(pub)
    )
    const exactoPub = construirSugerencias({ tipo: 'objetos', prefijo: 'dual', esquema: null }, f, OP_ORA)
    check(
      'un PUBLIC EXACTO sube al nivel 0 (DUAL)',
      exactoPub.length > 0 && exactoPub[0].etiqueta === 'DUAL' && exactoPub[0].orden[0] === '0',
      etiquetas(exactoPub).join(', ')
    )

    const col = construirSugerencias(
      { tipo: 'columnas', prefijo: 'se', tablas: [{ esquema: 'HR', nombre: 'EMP', alias: 'E' }], conObjetos: false, conClaves: true },
      f,
      OP_ORA
    )
    const iCol = indice(col, 'select', ' (EMP)')
    const claves = col.filter((x) => x.tipo === 'palabraClave')
    const primeraClave = col.findIndex((x) => x.tipo === 'palabraClave')
    check(
      'columnas primero y palabras clave AL FINAL (nivel 6)',
      iCol >= 0 && claves.length > 0 && primeraClave > iCol && col.slice(primeraClave).every((x) => x.tipo === 'palabraClave'),
      etiquetas(col).join(', ')
    )
    check(
      'palabras clave con la caja tecleada (se -> select) y sin alias en la descripción',
      claves.some((x) => x.etiqueta === 'select' && x.insertar === 'select') && claves.every((x) => x.descripcion === '' && x.orden[0] === '6'),
      claves.map((x) => x.etiqueta).join(' ')
    )
    check(
      'palabras clave solo por PREFIJO (se no trae CASE ni ELSE)',
      claves.length > 0 && claves.every((x) => x.etiqueta.indexOf('se') === 0),
      claves.map((x) => x.etiqueta).join(' ')
    )
    check(
      'una columna llamada como una reservada se cita (select -> "select")',
      col[iCol] !== undefined && col[iCol].insertar === '"select"' && col[iCol].descripcion === 'QA-DEMO',
      JSON.stringify(col[iCol])
    )
    const mayus = construirSugerencias({ tipo: 'palabrasClave', prefijo: 'SEL' }, f, OP_ORA)
    const vacio = construirSugerencias({ tipo: 'palabrasClave', prefijo: '' }, f, OP_ORA)
    const vacioMin = construirSugerencias({ tipo: 'palabrasClave', prefijo: '' }, f, { ...OP_ORA, cajaClaves: 'minus' })
    check(
      'SEL -> SELECT; sin prefijo, MAYÚSCULAS por defecto o la caja pedida',
      mayus[0].etiqueta === 'SELECT' &&
        vacio.every((x) => x.etiqueta === x.etiqueta.toUpperCase()) &&
        vacioMin.every((x) => x.etiqueta === x.etiqueta.toLowerCase()),
      `${mayus[0].etiqueta} / ${vacio[0].etiqueta} / ${vacioMin[0].etiqueta}`
    )
    const sub = construirSugerencias({ tipo: 'palabrasClave', prefijo: 'join' }, f, OP_ORA)
    check('palabra clave: exacta antes que prefijo', sub[0].etiqueta === 'join', etiquetas(sub).join(', '))

    const conObj = construirSugerencias(
      { tipo: 'columnas', prefijo: 'pro', tablas: [], conObjetos: true, conClaves: true },
      f,
      OP_ORA
    )
    const iPub = indice(conObj, 'PROFILE_PUB')
    const iUltObj = conObj.map((x) => x.tipo !== 'palabraClave' && x.detalle !== ' (PUBLIC)').lastIndexOf(true)
    const iPrimClave = conObj.findIndex((x) => x.tipo === 'palabraClave')
    check(
      'select pro¦ sin FROM: objetos, luego PUBLIC, luego palabras clave',
      iPub > iUltObj && (iPrimClave < 0 || iPrimClave > iPub),
      etiquetas(conObj).join(', ')
    )
  }

  // -------------------------------------------------------------------------
  hr('(9) Sugerencias: citado y calificación por motor')
  {
    const f = fuenteDe(ORACLE)
    const s = construirSugerencias({ tipo: 'objetos', prefijo: '', esquema: null }, f, OP_ORA)
    const por = (e: string, esq: string): Sugerencia | undefined => s[indice(s, e, ' (' + esq + ')')]
    const prof = por('PROFILE', 'ADMDEMO')
    const hrProf = por('PROFILES', 'HR')
    const minus = por('emp_minus', 'HR')
    const level = por('LEVEL', 'ADMDEMO')
    check('Oracle, esquema actual: sin calificar', prof !== undefined && prof.insertar === 'PROFILE', JSON.stringify(prof))
    check('Oracle, otro esquema: ESQ.NOMBRE', hrProf !== undefined && hrProf.insertar === 'HR.PROFILES', JSON.stringify(hrProf))
    check(
      'Oracle, nombre en minúsculas: se cita (HR."emp_minus")',
      minus !== undefined && minus.insertar === 'HR."emp_minus"',
      JSON.stringify(minus)
    )
    check('Oracle, reservada: se cita ("LEVEL")', level !== undefined && level.insertar === '"LEVEL"', JSON.stringify(level))
    check(
      'la fila de la captura: etiqueta, detalle ` (ESQUEMA)` y descripción = alias',
      prof !== undefined && prof.detalle === ' (ADMDEMO)' && prof.descripcion === 'QA-DEMO' && prof.tipo === 'tabla',
      JSON.stringify(prof)
    )
    const esq = s[indice(s, 'PROFILER')]
    check('los esquemas se ofrecen (para seguir con `ESQ.`)', esq !== undefined && esq.tipo === 'esquema' && esq.insertar === 'PROFILER', JSON.stringify(esq))

    const g = fuenteDe(POSTGRES)
    const p = construirSugerencias({ tipo: 'objetos', prefijo: 'pro', esquema: null }, g, OP_PG)
    const pubProf = p[indice(p, 'profile', ' (public)')]
    check(
      "PG: `select * from pro` -> `profile (public)  ALIAS`, sin calificar",
      pubProf !== undefined && pubProf.insertar === 'profile' && pubProf.descripcion === 'LOCAL-PG' && pubProf.orden[0] === '1',
      JSON.stringify(pubProf)
    )
    const mixta = p[indice(p, 'Profile', ' (ventas)')]
    check('PG: mayúsculas en el nombre -> ventas."Profile"', mixta !== undefined && mixta.insertar === 'ventas."Profile"', JSON.stringify(mixta))
    const ventas = p[indice(p, 'profiles', ' (ventas)')]
    check(
      'PG: otro esquema -> ventas.profiles, nivel 2',
      ventas !== undefined && ventas.insertar === 'ventas.profiles' && ventas.orden[0] === '2',
      JSON.stringify(ventas)
    )
    const sel = construirSugerencias({ tipo: 'objetos', prefijo: 'sel', esquema: null }, g, OP_PG)
    const reservada = sel[indice(sel, 'select', ' (ventas)')]
    check('PG: reservada -> ventas."select"', reservada !== undefined && reservada.insertar === 'ventas."select"', JSON.stringify(reservada))
    const perfil = construirSugerencias({ tipo: 'objetos', prefijo: 'perf', esquema: null }, g, OP_PG)
    check(
      'PG: el esquema actual (app) también es local',
      perfil.length > 0 && perfil[0].etiqueta === 'perfil' && perfil[0].insertar === 'perfil' && perfil[0].orden[0] === '1',
      JSON.stringify(perfil[0])
    )
    const expl = construirSugerencias({ tipo: 'objetos', prefijo: '', esquema: 'HR' }, f, OP_ORA)
    check(
      '`HR.` explícito: solo HR y SIN calificar (el esquema ya está escrito)',
      expl.length === 3 && expl.every((x) => x.detalle === ' (HR)' && x.insertar.indexOf('HR.') !== 0),
      expl.map((x) => x.insertar).join(', ')
    )
    const vistas = construirSugerencias({ tipo: 'objetos', prefijo: '', esquema: null, tipos: ['vista'] }, f, OP_ORA)
    check(
      'filtro por tipos (DROP VIEW): solo vistas, sin PUBLIC',
      vistas.filter((x) => x.tipo !== 'esquema').every((x) => x.tipo === 'vista') && indice(vistas, 'PROFILE_V') >= 0 && indice(vistas, 'DUAL') < 0,
      etiquetas(vistas).join(', ')
    )
    const rel = construirSugerencias({ tipo: 'objetos', prefijo: 'prof', esquema: null, tipos: TIPOS_RELACION }, f, OP_ORA)
    check(
      'en un FROM no salen secuencias ni paquetes',
      indice(rel, 'SEQ_PROFILE') < 0 && indice(rel, 'PKG_PROFILE') < 0 && indice(rel, 'PROFILE') >= 0,
      etiquetas(rel).join(', ')
    )
    const inv = construirSugerencias({ tipo: 'objetos', prefijo: 'p', esquema: null, tipos: ['rutina', 'paquete', 'sinonimo'] }, f, OP_ORA)
    check(
      'CALL/EXEC: rutinas y paquetes',
      indice(inv, 'P_ALTA') >= 0 && indice(inv, 'PKG_PROFILE') >= 0 && indice(inv, 'PROFILE') < 0,
      etiquetas(inv).join(', ')
    )
    check('ninguno -> sin sugerencias', construirSugerencias({ tipo: 'ninguno' }, f, OP_ORA).length === 0, '[]')
  }

  // -------------------------------------------------------------------------
  hr('(10) Miembro: alias -> tabla -> esquema, de punta a punta')
  {
    const f = fuenteDe(ORACLE)
    const a = construirSugerencias(ctx('select e.¦ from hr.emp e'), f, OP_ORA)
    check(
      'alias con el FROM detrás: columnas de HR.EMP en el orden de la tabla',
      a.length === 5 && a[0].etiqueta === 'EMPNO' && a[1].etiqueta === 'ENAME' && a.every((x) => x.tipo === 'columna' && x.detalle === ' (EMP)'),
      etiquetas(a).join(', ')
    )
    const b = construirSugerencias(ctx('select p.na¦ from profile p'), f, OP_ORA)
    check(
      'alias de una tabla sin calificar: esquema actual; prefijo antes que subcadena (NAME, ENABLED)',
      b.length === 2 && b[0].etiqueta === 'NAME' && b[1].etiqueta === 'ENABLED',
      etiquetas(b).join(', ')
    )
    const c = construirSugerencias(ctx('select profile.¦ from profile'), f, OP_ORA)
    check('nombre de la tabla como calificador', c.length === 3 && c[0].etiqueta === 'ID', etiquetas(c).join(', '))
    const d = construirSugerencias(ctx('select user_profile.¦'), f, OP_ORA)
    check('tabla local fuera del FROM', d.length === 3 && d[2].etiqueta === 'PROFILE_ID', etiquetas(d).join(', '))
    const e = construirSugerencias(ctx('select hr.¦'), f, OP_ORA)
    check(
      'esquema: sus objetos, sin calificar',
      e.length === 3 && e.every((x) => x.detalle === ' (HR)') && indice(e, 'emp_minus') >= 0 && e[indice(e, 'emp_minus')].insertar === '"emp_minus"',
      e.map((x) => x.insertar).join(', ')
    )
    const g = construirSugerencias(ctx('select u.¦ from all_users u'), f, OP_ORA)
    check('sinónimo PUBLIC en el FROM: columnas pedidas como PUBLIC.X', g.length === 2 && g[0].etiqueta === 'USERNAME', etiquetas(g).join(', '))
    const h = construirSugerencias(ctx('select public.pro¦'), f, OP_ORA)
    check('`PUBLIC.`: los sinónimos públicos, sin calificar', h.length === 1 && h[0].insertar === 'PROFILE_PUB', etiquetas(h).join(', '))
    const i = construirSugerencias(ctx('select zz.¦ from emp e'), f, OP_ORA)
    check('calificador desconocido: nada', i.length === 0, '[]')
    const j = construirSugerencias(ctx('select hr.emp.en¦'), f, OP_ORA)
    check('ESQ.TABLA.: columnas de esa tabla', j.length === 1 && j[0].etiqueta === 'ENAME', etiquetas(j).join(', '))

    const pg = fuenteDe(POSTGRES)
    const k = construirSugerencias(ctx('select P.¦ from Profile P', 'postgres'), pg, OP_PG)
    const en = k[indice(k, 'Enabled')]
    check(
      'PG: alias plegado, tabla en public y columna con mayúscula citada',
      k.length === 3 && en !== undefined && en.insertar === '"Enabled"',
      k.map((x) => x.insertar).join(', ')
    )
    const dm = resolverMiembro(['X'], [{ esquema: null, nombre: 'PROFILE', alias: 'X' }], f, 'oracle')
    check('resolverMiembro: alias -> columnas de ADMDEMO.PROFILE', dm.tipo === 'columnas' && dm.esquema === 'ADMDEMO' && dm.tabla === 'PROFILE', JSON.stringify(dm))
    const dm2 = resolverMiembro(['PROFILE'], [], f, 'oracle')
    const dm3 = resolverMiembro(['PROFILER'], [], f, 'oracle')
    check(
      'resolverMiembro: tabla local antes que esquema; si no, esquema',
      dm2.tipo === 'columnas' && dm3.tipo === 'objetos' && dm3.esquema === 'PROFILER',
      JSON.stringify([dm2, dm3])
    )
  }

  // -------------------------------------------------------------------------
  hr('(11) Pendientes de carga y tope')
  {
    const f = fuenteDe(ORACLE)
    const p1 = pendientesDeCarga(ctx('select ¦ from emp e join nueva n on 1 = 1'), f, 'oracle')
    check(
      'columnas que faltan en caché: ADMDEMO.EMP y ADMDEMO.NUEVA',
      p1.columnas.length === 2 && p1.columnas[0].tabla === 'EMP' && p1.columnas[0].esquema === 'ADMDEMO' && p1.columnas[1].tabla === 'NUEVA',
      JSON.stringify(p1)
    )
    const p2 = pendientesDeCarga(ctx('select * from profiler.¦'), f, 'oracle')
    check('`ESQ.` de un esquema sin objetos cargados: se pide', p2.esquemas.length === 1 && p2.esquemas[0] === 'PROFILER', JSON.stringify(p2))
    const p3 = pendientesDeCarga(ctx('select p.¦ from profile p'), f, 'oracle')
    check('todo en caché: nada pendiente', p3.columnas.length === 0 && p3.esquemas.length === 0, JSON.stringify(p3))

    // Índice grande: 200 000 nombres en 100 esquemas.
    const grandes: DbObjetoNombre[] = []
    for (let i = 0; i < 200000; i++) {
      grandes.push(obj('E' + (i % 100), 'TABLA_' + ((i * 7919) % 200000).toString(36).toUpperCase() + '_' + i))
    }
    const big = fuenteDe({ ...ORACLE, actual: 'E7', objetos: grandes, esquemas: [], publicos: [] })
    let t0 = Date.now()
    const todo = construirSugerencias({ tipo: 'objetos', prefijo: '', esquema: null }, big, OP_ORA)
    const msTodo = Date.now() - t0
    t0 = Date.now()
    const sub = construirSugerencias({ tipo: 'objetos', prefijo: 'a_1', esquema: null }, big, OP_ORA)
    const msSub = Date.now() - t0
    check(
      `200 000 nombres sin prefijo: como mucho ${LIMITE_SUGERENCIAS}, ordenadas, primero el esquema actual`,
      todo.length === LIMITE_SUGERENCIAS && ordenada(todo) && todo[0].detalle === ' (E7)',
      `${todo.length} en ${msTodo} ms; primera ${todo[0].etiqueta}${todo[0].detalle}`
    )
    const referencia = grandes
      .filter((o) => o.nombre.toLowerCase().indexOf('a_1') >= 0)
      .length
    check(
      'con subcadena: mismo número que un filtro ingenuo (acotado al tope) y ordenadas',
      sub.length === Math.min(referencia, LIMITE_SUGERENCIAS) && ordenada(sub),
      `${sub.length} de ${referencia} en ${msSub} ms`
    )
    const tope = construirSugerencias({ tipo: 'objetos', prefijo: '', esquema: null }, big, { ...OP_ORA, limite: 20 })
    const ordenIngenuo = todo.slice(0, 20).map((x) => x.orden).join('|')
    check('`limite` recorta sin cambiar el orden (los 20 primeros son los mismos)', tope.map((x) => x.orden).join('|') === ordenIngenuo, `${tope.length}`)
    check('coste razonable (< 1500 ms cada una)', msTodo < 1500 && msSub < 1500, `${msTodo} ms / ${msSub} ms`)
  }

  // -------------------------------------------------------------------------
  hr('(12) Contexto de JOIN y de ON (para las FKs)')
  {
    const a = ctx('select * from clientes c join ¦')
    check(
      'tras JOIN: objetos con las tablas de la izquierda, alias usados y caja del JOIN',
      a.tipo === 'objetos' && !!a.join && mismasTablas(a.join.previas, ['CLIENTES C']) && a.join.caja === 'minus' && a.join.usados.indexOf('C') >= 0,
      j(a)
    )
    check('`expuesto` es el alias TAL CUAL (c, no C)', a.tipo === 'objetos' && a.join?.previas[0].expuesto === 'c', j(a.tipo === 'objetos' ? a.join?.previas[0] : null))
    const b = ctx('SELECT * FROM clientes c JOIN pedidos p ON p.cliente_id = c.id LEFT JOIN ¦')
    check(
      'segundo JOIN: las dos de la izquierda, en orden; caja MAYÚSCULAS',
      b.tipo === 'objetos' && !!b.join && mismasTablas(b.join.previas, ['CLIENTES C', 'PEDIDOS P']) && b.join.caja === 'mayus',
      j(b)
    )
    const c = ctx('select * from a, hr.b join ¦')
    check('lista del FROM con coma y esquema: [A, HR.B]; expuesto de hr.b es «b»', c.tipo === 'objetos' && !!c.join && mismasTablas(c.join.previas, ['A', 'HR.B']) && c.join.previas[1].expuesto === 'b', j(c))
    const d = ctx('select * from x where y in (select * from t1 join ¦)')
    check('en una subconsulta, solo las de SU nivel', d.tipo === 'objetos' && !!d.join && mismasTablas(d.join.previas, ['T1']), j(d))
    const e = ctx('select * from a union select * from b join ¦')
    check('tras UNION, solo las de la consulta nueva', e.tipo === 'objetos' && !!e.join && mismasTablas(e.join.previas, ['B']), j(e))
    const f = ctx('select * from clientes c join ventas.¦')
    check('JOIN ESQ.¦: objetos de ese esquema, con join', f.tipo === 'objetos' && f.esquema === 'VENTAS' && !!f.join, j(f))
    const g = ctx('select * from clientes c join pe¦')
    check('JOIN pe¦: prefijo y join', g.tipo === 'objetos' && g.prefijo === 'pe' && !!g.join, j(g))
    check('la palabra a medio escribir NO cuenta como usada', g.tipo === 'objetos' && !!g.join && j(g.join.usados) === j(['C']), j(g.tipo === 'objetos' ? g.join?.usados : null))
    const h = ctx('select * from "Mi Tabla" join ¦', 'postgres')
    check('un nombre citado se expone citado', h.tipo === 'objetos' && h.join?.previas[0].expuesto === '"Mi Tabla"', j(h))
    const noJoin = ctx('select * from ¦')
    check('tras FROM: sin join', noJoin.tipo === 'objetos' && noJoin.join === undefined, j(noJoin))
    for (const [sql, d] of [
      ['select * from a natural join ¦', 'postgres'],
      ['select * from a natural left outer join ¦', 'postgres'],
      ['select * from a cross join ¦', 'oracle'],
      ['select * from a cross apply ¦', 'oracle'],
      ['select * from a outer apply ¦', 'oracle']
    ] as const) {
      const c = ctx(sql, d)
      check(`${JSON.stringify(sql)}: objetos SIN join (no lleva ON)`, c.tipo === 'objetos' && c.join === undefined, fmt(c))
    }
    const tras = ctx('select * from a cross join b join ¦')
    check('un JOIN normal tras un CROSS JOIN sí', tras.tipo === 'objetos' && !!tras.join && mismasTablas(tras.join.previas, ['A', 'B']), fmt(tras))

    const on = ctx('select * from emp e join dept d on ¦')
    check(
      'tras ON: columnas con la condición (nueva DEPT D, previas [EMP E])',
      on.tipo === 'columnas' && !!on.condicion && fmtRef(on.condicion.nueva) === 'DEPT D' && mismasTablas(on.condicion.previas, ['EMP E']) && on.condicion.caja === 'minus',
      j(on)
    )
    const and = ctx('select * from emp e join dept d on d.x = e.y and ¦')
    check('tras AND dentro del ON: también', and.tipo === 'columnas' && !!and.condicion, fmt(and))
    const paren = ctx('select * from emp e join dept d on (¦')
    check('ON (¦: también (el grupo es transparente)', paren.tipo === 'columnas' && !!paren.condicion, fmt(paren))
    const pref = ctx('select * from emp e join dept d on de¦')
    check('ON de¦: con prefijo, también', pref.tipo === 'columnas' && !!pref.condicion && pref.prefijo === 'de', fmt(pref))
    const tres = ctx('select * from a join b on b.x = a.x join c on ¦')
    check('tercer JOIN: nueva C, previas [A, B]', tres.tipo === 'columnas' && !!tres.condicion && fmtRef(tres.condicion.nueva) === 'C' && mismasTablas(tres.condicion.previas, ['A', 'B']), j(tres))
    // Mitades negativas.
    const medio = ctx('select * from emp e join dept d on d.x = ¦')
    check('tras `=`: NO (es el otro lado de una condición)', medio.tipo === 'columnas' && medio.condicion === undefined, fmt(medio))
    const donde = ctx('select * from emp e join dept d on d.x = e.y where ¦')
    check('en el WHERE: NO', donde.tipo === 'columnas' && donde.condicion === undefined, fmt(donde))
    const coma = ctx('select * from emp e, dept d where ¦')
    check('join a la antigua (coma + WHERE): NO', coma.tipo === 'columnas' && coma.condicion === undefined, fmt(coma))
    const using = ctx('select * from emp e join dept d using (¦', 'postgres')
    check('JOIN … USING (: NO', using.tipo === 'columnas' && using.condicion === undefined, fmt(using))
    const indice = ctx('create index ix on ¦', 'postgres')
    check('el ON de CREATE INDEX: NO (sigue siendo objetos)', indice.tipo === 'objetos' && indice.join === undefined, fmt(indice))
  }

  // -------------------------------------------------------------------------
  hr('(13) El `*` de la lista del SELECT')
  {
    const est = (conCursor: string, d: DialectoSql = 'oracle'): EstrellaSelect | null => {
      const { texto, cursor } = partir(conCursor)
      return estrellaEn(texto, cursor, cursor, d)
    }
    const tablas = (e: EstrellaSelect | null): string => (e === null ? 'null' : e.tablas === null ? 'no sustituible' : e.tablas.map(fmtRef).join(', '))
    const a = est('select *¦ from emp e')
    check('select *¦ from emp e: rango del *, sin calificador, [EMP E]', a !== null && a.desde === 7 && a.hasta === 8 && a.calificador === null && tablas(a) === 'EMP E', j(a))
    const b = est('select e.*¦ from emp e join dept d on d.deptno = e.deptno')
    check(
      'e.*: calificador [E], escrito «e», rango de «e.*», las dos tablas',
      b !== null && j(b.calificador) === '["E"]' && b.calificadorEscrito === 'e' && b.desde === 7 && b.hasta === 10 && tablas(b) === 'EMP E, DEPT D',
      j(b)
    )
    check('con el cursor DELANTE del * también (acción de código)', est('select ¦* from t') !== null, 'toca')
    check('select a, *¦ from t (PG): sí', tablas(est('select a, *¦ from t', 'postgres')) === 't', tablas(est('select a, *¦ from t', 'postgres')))
    check('select distinct *¦ from t: sí', tablas(est('select distinct *¦ from t')) === 'T', 'T')
    check('count(*¦): no', est('select count(*¦) from emp') === null, 'null')
    check('a *¦ b: no (multiplicación)', est('select a *¦ b from t') === null, 'null')
    check('where x = 2 *¦ 3: no', est('select 1 from t where x = 2 *¦ 3') === null, 'null')
    check('subconsulta en el FROM: no sustituible', tablas(est('select *¦ from (select 1 x from dual)')) === 'no sustituible', tablas(est('select *¦ from (select 1 x from dual)')))
    check('CTE: no sustituible', tablas(est('with c as (select 1 x from dual) select *¦ from c')) === 'no sustituible', 'cte')
    check('JOIN … USING: no sustituible (el * funde la columna común)', tablas(est('select *¦ from a join b using (id)', 'postgres')) === 'no sustituible', 'using')
    check('NATURAL JOIN: no sustituible', tablas(est('select *¦ from a natural join b', 'postgres')) === 'no sustituible', 'natural')
    check('PIVOT: no sustituible', tablas(est("select *¦ from t pivot (sum(x) for y in ('a'))")) === 'no sustituible', 'pivot')
    check('el * de una subconsulta: las tablas de ESA', tablas(est('select * from t where x in (select *¦ from u join v on v.a = u.a) and z = 1')) === 'U, V', tablas(est('select * from t where x in (select *¦ from u join v on v.a = u.a) and z = 1')))
    check('coma, JOIN con ON y WHERE detrás', tablas(est('select *¦ from a, b left join c on c.x = b.x where 1 = 1 order by 1')) === 'A, B, C', tablas(est('select *¦ from a, b left join c on c.x = b.x where 1 = 1 order by 1')))
    check('sin FROM: []', tablas(est('select *¦')) === '', tablas(est('select *¦')))
    check('INSERT … SELECT *', tablas(est('insert into t select *¦ from u')) === 'U', tablas(est('insert into t select *¦ from u')))
  }

  // -------------------------------------------------------------------------
  hr('(14) Sugerencias por FK')
  {
    const fk = (nombre: string, de: [string, string, string[]], a: [string, string, string[]]): DbFk => ({
      nombre,
      desde: { esquema: de[0], tabla: de[1], columnas: de[2] },
      hacia: { esquema: a[0], tabla: a[1], columnas: a[2] }
    })
    const PED_CLI = fk('FK_PED_CLI', ['ADMDEMO', 'PEDIDOS', ['CLIENTE_ID']], ['ADMDEMO', 'CLIENTES', ['ID']])
    const LIN_PED = fk('FK_LIN_PED', ['ADMDEMO', 'LINEAS', ['PEDIDO_ID']], ['ADMDEMO', 'PEDIDOS', ['ID']])
    const LIN_X = fk('FK_LIN_X', ['ADMDEMO', 'LINEAS', ['A', 'B']], ['HR', 'OTRA_TABLA', ['A1', 'B1']])
    const JEFE = fk('FK_EMP_JEFE', ['HR', 'EMP', ['JEFE']], ['HR', 'EMP', ['EMPNO']])
    const rel: Record<string, DbRelacionesFk> = {
      'ADMDEMO.CLIENTES': { salientes: [], entrantes: [PED_CLI] },
      'ADMDEMO.PEDIDOS': { salientes: [PED_CLI], entrantes: [LIN_PED] },
      'ADMDEMO.LINEAS': { salientes: [LIN_PED, LIN_X], entrantes: [] },
      'HR.EMP': { salientes: [JEFE], entrantes: [JEFE] }
    }
    const datos: DatosFuente = {
      ...ORACLE,
      objetos: [...ORACLE.objetos, obj('ADMDEMO', 'CLIENTES'), obj('ADMDEMO', 'PEDIDOS'), obj('ADMDEMO', 'LINEAS'), obj('HR', 'OTRA_TABLA')],
      columnas: {
        ...ORACLE.columnas,
        'ADMDEMO.CLIENTES': ['ID', 'NOMBRE'],
        'ADMDEMO.PEDIDOS': ['ID', 'CLIENTE_ID', 'FECHA']
      }
    }
    const conFks = (base: FuenteCatalogo, r: Record<string, DbRelacionesFk>): FuenteCatalogo => ({
      ...base,
      fks: (esquema, tabla) => r[esquema + '.' + tabla] ?? null
    })
    const fuente = conFks(fuenteDe(datos), rel)
    const sug = (conCursor: string, fu: FuenteCatalogo = fuente, d: DialectoSql = 'oracle'): Sugerencia[] =>
      construirSugerencias(ctx(conCursor, d), fu, d === 'oracle' ? OP_ORA : OP_PG)

    const s1 = sug('select * from clientes c join ¦')
    check(
      'JOIN tras clientes: PRIMERO «PEDIDOS p on p.CLIENTE_ID = c.ID», tipo join, con la FK de detalle',
      s1[0]?.insertar === 'PEDIDOS p on p.CLIENTE_ID = c.ID' && s1[0].tipo === 'join' && s1[0].detalle === ' (FK_PED_CLI)' && s1[0].orden[0] === '/',
      j(s1.slice(0, 3))
    )
    check('y después los objetos de siempre, ordenados', ordenada(s1) && s1.some((x) => x.tipo === 'tabla'), `${s1.length} sugerencias`)
    const s2 = sug('SELECT * FROM pedidos p JOIN ¦')
    check(
      'PEDIDOS tiene una saliente y una entrante: CLIENTES c y LINEAS l, con ON en mayúsculas',
      j(s2.filter((x) => x.tipo === 'join').map((x) => x.insertar)) === j(['CLIENTES c ON c.ID = p.CLIENTE_ID', 'LINEAS l ON l.PEDIDO_ID = p.ID']),
      j(s2.filter((x) => x.tipo === 'join').map((x) => x.insertar))
    )
    const s3 = sug('select * from pedidos c join ¦')
    check('alias ocupado: c1', s3.some((x) => x.insertar === 'CLIENTES c1 on c1.ID = c.CLIENTE_ID'), j(s3.filter((x) => x.tipo === 'join').map((x) => x.insertar)))
    const s4 = sug('select * from clientes c join li¦')
    check('JOIN li¦: el filtro va sobre el nombre (ninguna FK de clientes a LINEAS)', s4.every((x) => x.tipo !== 'join'), j(s4.slice(0, 3).map((x) => x.etiqueta)))
    const s5 = sug('select * from clientes c join pe¦')
    check('JOIN pe¦: la de PEDIDOS', s5[0]?.tipo === 'join' && s5[0].insertar.startsWith('PEDIDOS p '), j(s5[0]))
    const s5b = sug('select * from pedidos p join c¦')
    check('JOIN c¦: el alias es «c» (lo tecleado no lo ocupa)', s5b[0]?.insertar === 'CLIENTES c on c.ID = p.CLIENTE_ID', j(s5b[0]))
    const s6 = sug('select * from hr.emp e join ¦')
    check(
      'autorreferencia en otro esquema: las dos direcciones, calificadas (HR no es el actual)',
      j(s6.filter((x) => x.tipo === 'join').map((x) => x.insertar)) === j(['HR.EMP e1 on e1.EMPNO = e.JEFE', 'HR.EMP e1 on e1.JEFE = e.EMPNO']),
      j(s6.filter((x) => x.tipo === 'join').map((x) => x.insertar))
    )
    const s7 = sug('select * from lineas l join ¦')
    check(
      'FK de dos columnas: AND entre los pares; alias «ot» para OTRA_TABLA',
      s7.some((x) => x.insertar === 'HR.OTRA_TABLA ot on ot.A1 = l.A and ot.B1 = l.B'),
      j(s7.filter((x) => x.tipo === 'join').map((x) => x.insertar))
    )
    const s8 = sug('select * from lineas l join hr.¦')
    check(
      'JOIN hr.¦: solo las de HR y SIN calificar (ya está escrito)',
      j(s8.filter((x) => x.tipo === 'join').map((x) => x.insertar)) === j(['OTRA_TABLA ot on ot.A1 = l.A and ot.B1 = l.B']),
      j(s8.filter((x) => x.tipo === 'join').map((x) => x.insertar))
    )
    const s9 = sug('select * from clientes c join ¦', fuenteDe(datos))
    check('una fuente sin FKs: ninguna (y lo demás igual)', s9.every((x) => x.tipo !== 'join') && s9.length > 0, `${s9.length}`)

    const o1 = sug('select * from clientes c join pedidos p on ¦')
    check(
      'ON: PRIMERO la condición «p.CLIENTE_ID = c.ID» (tipo condicion, sin alias de conexión)',
      o1[0]?.insertar === 'p.CLIENTE_ID = c.ID' && o1[0].tipo === 'condicion' && o1[0].descripcion === '' && o1[0].orden[0] === '/',
      j(o1.slice(0, 2))
    )
    check('y después las columnas', o1.some((x) => x.tipo === 'columna'), `${o1.length}`)
    const o2 = sug('select * from pedidos p join clientes c on ¦')
    check('al revés (la nueva es la referenciada): «c.ID = p.CLIENTE_ID»', o2[0]?.insertar === 'c.ID = p.CLIENTE_ID', j(o2[0]))
    const o3 = sug('select * from clientes c join pedidos p on c.x = p.y and ¦')
    check('tras AND: también', o3[0]?.tipo === 'condicion', j(o3[0]))
    const o4 = sug('select * from clientes c join pedidos p on zz¦')
    check('ON zz¦: ninguna condición', o4.every((x) => x.tipo !== 'condicion'), `${o4.length}`)
    const o5 = sug('select * from clientes c join pedidos p on cli¦')
    check('ON cli¦: la condición casa por subcadena (CLIENTE_ID)', o5[0]?.tipo === 'condicion', j(o5[0]))
    const o6 = sug('select * from hr.emp e join hr.emp j on ¦')
    check(
      'autorreferencia: las dos condiciones',
      j(o6.filter((x) => x.tipo === 'condicion').map((x) => x.insertar)) === j(['j.JEFE = e.EMPNO', 'j.EMPNO = e.JEFE']),
      j(o6.filter((x) => x.tipo === 'condicion').map((x) => x.insertar))
    )
    const o7 = sug('select * from clientes c join pedidos p on p.x = ¦')
    check('tras `=`: ninguna condición', o7.every((x) => x.tipo !== 'condicion'), `${o7.length}`)

    // PG: citado por motor.
    const pgRel: Record<string, DbRelacionesFk> = {
      'public.profile': {
        salientes: [],
        entrantes: [fk('fk_mod', ['public', 'Module', ['profileId']], ['public', 'profile', ['id']])]
      }
    }
    const pg = conFks(fuenteDe({ ...POSTGRES, objetos: [...POSTGRES.objetos, obj('public', 'Module')] }), pgRel)
    const p1 = construirSugerencias(ctx('select * from profile pr join ¦', 'postgres'), pg, OP_PG)
    check(
      'PG: tabla y columna con mayúsculas van citadas; public es local (sin calificar)',
      p1[0]?.insertar === '"Module" m on m."profileId" = pr.id',
      j(p1[0])
    )

    // Pendientes de carga.
    const sinCargar = conFks(fuenteDe(datos), {})
    const pend = pendientesDeCarga(ctx('select * from clientes c join pedidos p join ¦'), sinCargar, 'oracle')
    check('JOIN sin FKs en caché: pide las de las dos previas', j(pend.fks) === j([{ esquema: 'ADMDEMO', tabla: 'CLIENTES' }, { esquema: 'ADMDEMO', tabla: 'PEDIDOS' }]), j(pend))
    const pendOn = pendientesDeCarga(ctx('select * from clientes c join pedidos p on ¦'), sinCargar, 'oracle')
    check('ON sin FKs: pide las de la tabla nueva (traen las dos direcciones)', j(pendOn.fks) === j([{ esquema: 'ADMDEMO', tabla: 'PEDIDOS' }]), j(pendOn.fks))
    const pendYa = pendientesDeCarga(ctx('select * from clientes c join ¦'), fuente, 'oracle')
    check('con las FKs en caché: nada', pendYa.fks.length === 0, j(pendYa))
    const pendSin = pendientesDeCarga(ctx('select * from clientes c join ¦'), fuenteDe(datos), 'oracle')
    check('una fuente sin FKs no las pide', pendSin.fks.length === 0, j(pendSin))

    // Revisión: lo OBSOLETO se vuelve a pedir (nadie más recarga las FKs tras un DDL).
    const obsoletas: FuenteCatalogo = { ...fuente, obsoleto: (que) => que === 'fks' }
    const pendObs = pendientesDeCarga(ctx('select * from clientes c join ¦'), obsoletas, 'oracle')
    check('FKs en caché pero OBSOLETAS: se vuelven a pedir', j(pendObs.fks) === j([{ esquema: 'ADMDEMO', tabla: 'CLIENTES' }]), j(pendObs))
    check('…y mientras, se sugieren las que hay', sug('select * from clientes c join ¦', obsoletas)[0]?.tipo === 'join', j(sug('select * from clientes c join ¦', obsoletas)[0]))
    // Revisión: una tabla por enlace no la describe el catálogo local.
    const remota = sug('select * from clientes@remota c join ¦')
    check('tras una tabla por enlace (clientes@remota): ninguna FK (serían las de la local)', remota.every((x) => x.tipo !== 'join'), j(remota.slice(0, 2).map((x) => x.insertar)))
    check('…ni se piden', pendientesDeCarga(ctx('select * from clientes@remota c join ¦'), sinCargar, 'oracle').fks.length === 0, 'vacío')
    const remotaOn = sug('select * from clientes c join pedidos@remota p on ¦')
    check('ON de una tabla por enlace: ninguna condición', remotaOn.every((x) => x.tipo !== 'condicion'), j(remotaOn.slice(0, 2).map((x) => x.insertar)))

    // Alias libres.
    check('aliasLibre: order_items -> oi', aliasLibre('order_items', [], 'postgres') === 'oi', aliasLibre('order_items', [], 'postgres'))
    check('aliasLibre: CLIENTES con C usado -> c1', aliasLibre('CLIENTES', ['C'], 'oracle') === 'c1', aliasLibre('CLIENTES', ['C'], 'oracle'))
    check('aliasLibre: nunca una palabra reservada (O_N -> on1, A_S -> as1)', aliasLibre('O_N', [], 'oracle') === 'on1' && aliasLibre('A_S', [], 'postgres') === 'as1', aliasLibre('O_N', [], 'oracle') + ' ' + aliasLibre('A_S', [], 'postgres'))
    check('aliasLibre: Mi Tabla -> mt; 123 -> t', aliasLibre('Mi Tabla', [], 'postgres') === 'mt' && aliasLibre('123', [], 'postgres') === 't', aliasLibre('Mi Tabla', [], 'postgres'))
  }

  // -------------------------------------------------------------------------
  hr('(15) «Expandir columnas»')
  {
    const datos: DatosFuente = {
      ...ORACLE,
      objetos: [...ORACLE.objetos, obj('ADMDEMO', 'CLIENTES'), obj('ADMDEMO', 'PEDIDOS')],
      columnas: { ...ORACLE.columnas, 'ADMDEMO.CLIENTES': ['ID', 'NOMBRE'], 'ADMDEMO.PEDIDOS': ['ID', 'CLIENTE_ID', 'fecha'] }
    }
    const fuente = fuenteDe(datos)
    const lista = (conCursor: string, fu: FuenteCatalogo = fuente, d: DialectoSql = 'oracle'): string | null => {
      const { texto, cursor } = partir(conCursor)
      const e = estrellaEn(texto, cursor, cursor, d)
      return e ? listaDeEstrella(e, fu, d) : null
    }
    check('una tabla: sin calificar', lista('select *¦ from clientes c') === 'ID, NOMBRE', j(lista('select *¦ from clientes c')))
    check(
      'dos tablas: calificadas con su alias tal cual, y citada la columna en minúsculas',
      lista('select *¦ from clientes c join pedidos P on P.cliente_id = c.id') === 'c.ID, c.NOMBRE, P.ID, P.CLIENTE_ID, P."fecha"',
      j(lista('select *¦ from clientes c join pedidos P on P.cliente_id = c.id'))
    )
    check(
      'p.*: solo esa, calificada como se escribió',
      lista('select c.nombre, p.*¦ from clientes c join pedidos p on p.cliente_id = c.id') === 'p.ID, p.CLIENTE_ID, p."fecha"',
      j(lista('select c.nombre, p.*¦ from clientes c join pedidos p on p.cliente_id = c.id'))
    )
    check('sin alias y con dos tablas: el nombre como se escribió', lista('select *¦ from clientes, admdemo.pedidos') === 'clientes.ID, clientes.NOMBRE, pedidos.ID, pedidos.CLIENTE_ID, pedidos."fecha"', j(lista('select *¦ from clientes, admdemo.pedidos')))
    check('una tabla sin columnas en caché: null (nunca una lista a medias)', lista('select *¦ from clientes c join application a on 1 = 1') === null, 'null')
    check('un alias que no existe: null', lista('select x.*¦ from clientes c') === null, 'null')
    const pgF = fuenteDe(POSTGRES)
    check('PG: citado por motor (Enabled)', lista('select *¦ from profile', pgF, 'postgres') === 'id, name, "Enabled"', j(lista('select *¦ from profile', pgF, 'postgres')))

    const { texto, cursor } = partir('select p.*¦ from pedidos p')
    const e = estrellaEn(texto, cursor, cursor, 'oracle')
    const s = e ? sugerenciaEstrella(e, texto, fuente, OP_ORA) : null
    check(
      'el ítem: «Expandir columnas», rango de «p.*», filtro «p.*», primero en el orden, vista previa en el detalle',
      s !== null && s.etiqueta === 'Expandir columnas' && s.rango?.desde === 7 && s.rango?.hasta === 10 && s.filtro === 'p.*' && s.orden[0] === '/' && s.insertar === 'p.ID, p.CLIENTE_ID, p."fecha"' && s.detalle.indexOf('p.ID') >= 0,
      j(s)
    )
    const falta = e ? pendientesDeEstrella(e, fuenteDe({ ...datos, columnas: {} }), 'oracle') : null
    check('pendientes: las columnas de las tablas que cubre', j(falta?.columnas) === j([{ esquema: 'ADMDEMO', tabla: 'PEDIDOS' }]), j(falta))

    // Revisión: por enlace, la EMP local no describe la remota.
    check('sobre una tabla por enlace (pedidos@remota): null', lista('select *¦ from pedidos@remota') === null, j(lista('select *¦ from pedidos@remota')))
    check(
      'c.* local con otra por enlace en el FROM: sí, solo la local',
      lista('select c.*¦ from clientes c join pedidos@remota p on p.cliente_id = c.id') === 'c.ID, c.NOMBRE',
      j(lista('select c.*¦ from clientes c join pedidos@remota p on p.cliente_id = c.id'))
    )
    // Revisión: columnas OBSOLETAS (un ALTER TABLE … ADD desde que se cargaron).
    const obs: FuenteCatalogo = { ...fuente, obsoleto: (que, _esq, tabla) => que === 'columnas' && tabla === 'PEDIDOS' }
    check('columnas obsoletas: null (la lista tendría menos columnas que el *)', lista('select *¦ from pedidos', obs) === null, j(lista('select *¦ from pedidos', obs)))
    check('las de otra tabla, al día: sí', lista('select *¦ from clientes', obs) === 'ID, NOMBRE', j(lista('select *¦ from clientes', obs)))
    const po = partir('select *¦ from pedidos')
    const eo = estrellaEn(po.texto, po.cursor, po.cursor, 'oracle')
    const pendObs = eo ? pendientesDeEstrella(eo, obs, 'oracle') : null
    check('…y se vuelven a pedir aunque estén en caché', j(pendObs?.columnas) === j([{ esquema: 'ADMDEMO', tabla: 'PEDIDOS' }]), j(pendObs))
  }

  // -------------------------------------------------------------------------
  hr('(16) Lo que cambia por motor (esquema implícito, pseudo-esquema PUBLIC) sale del descriptor')
  // -------------------------------------------------------------------------
  {
    // `public` implícito en PG (catalogo.esquemaImplicito), y en Oracle nada.
    check('esquemasLocales PG: el actual y public', j(esquemasLocales(fuenteDe(POSTGRES), 'postgres')) === j(['app', 'public']), j(esquemasLocales(fuenteDe(POSTGRES), 'postgres')))
    const enPublic = esquemasLocales(fuenteDe({ ...POSTGRES, actual: 'public' }), 'postgres')
    check('esquemasLocales PG con public de actual: sin repetirlo', j(enPublic) === j(['public']), j(enPublic))
    const sinSesion = esquemasLocales(fuenteDe({ ...POSTGRES, actual: null }), 'postgres')
    check('esquemasLocales PG sin esquema actual: public', j(sinSesion) === j(['public']), j(sinSesion))
    check('esquemasLocales Oracle: solo el actual', j(esquemasLocales(fuenteDe(ORACLE), 'oracle')) === j(['ADMDEMO']), j(esquemasLocales(fuenteDe(ORACLE), 'oracle')))

    // El pseudo-esquema PUBLIC (catalogo.pseudoEsquemaPublico) solo existe en Oracle.
    const ref = (nombre: string): RefTabla => ({ esquema: null, nombre, alias: null }) as RefTabla
    check('esquemaDeRef Oracle: un sinónimo público va a PUBLIC', esquemaDeRef(ref('PROFILE_PUB'), fuenteDe(ORACLE), 'oracle') === 'PUBLIC', String(esquemaDeRef(ref('PROFILE_PUB'), fuenteDe(ORACLE), 'oracle')))
    const pgConPublicos = fuenteDe({ ...POSTGRES, publicos: ['x'] })
    check('esquemaDeRef PG: nunca PUBLIC, aunque la fuente diera públicos (como antes)', esquemaDeRef(ref('x'), pgConPublicos, 'postgres') === 'app', String(esquemaDeRef(ref('x'), pgConPublicos, 'postgres')))
    const oraSinPub = fuenteDe({ ...ORACLE, esquemas: ['ADMDEMO'] })
    check('resolverMiembro Oracle: `PUBLIC.` son objetos aunque no esté en la lista', j(resolverMiembro(['PUBLIC'], [], oraSinPub, 'oracle')) === j({ tipo: 'objetos', esquema: 'PUBLIC' }), j(resolverMiembro(['PUBLIC'], [], oraSinPub, 'oracle')))
    check('resolverMiembro PG: "PUBLIC" no es nada especial', j(resolverMiembro(['PUBLIC'], [], fuenteDe(POSTGRES), 'postgres')) === j({ tipo: 'desconocido' }), j(resolverMiembro(['PUBLIC'], [], fuenteDe(POSTGRES), 'postgres')))
    const pOra = pendientesDeCarga(ctx('select * from public.¦'), fuenteDe(ORACLE), 'oracle')
    check('pendientes Oracle: `PUBLIC.` no pide cargar el esquema', pOra.esquemas.length === 0, j(pOra))
    const pPg = pendientesDeCarga(ctx('select * from "PUBLIC".¦', 'postgres'), fuenteDe(POSTGRES), 'postgres')
    check('pendientes PG: un esquema llamado "PUBLIC" se pide como cualquier otro', j(pPg.esquemas) === j(['PUBLIC']), j(pPg))
    const pubOra = construirSugerencias({ tipo: 'objetos', prefijo: 'profile_p', esquema: 'PUBLIC' }, fuenteDe(ORACLE), OP_ORA)
    check('`PUBLIC.` en Oracle: sinónimos con esquema PUBLIC', pubOra.length === 1 && pubOra[0].etiqueta === 'PROFILE_PUB' && pubOra[0].tipo === 'sinonimo', etiquetas(pubOra).join(', '))
    const sinPubPg = construirSugerencias({ tipo: 'objetos', prefijo: 'prof', esquema: null }, fuenteDe(POSTGRES), OP_PG)
    check('PG: ningún candidato como sinónimo público', sinPubPg.every((x) => x.detalle !== ' (PUBLIC)' && x.tipo !== 'sinonimo'), etiquetas(sinPubPg).join(', '))
    // La ÚNICA diferencia con el código de antes (revisión E2, medida con un diferencial
    // de ~24 000 comparaciones): una fuente que ROMPA el contrato de `publicos()` en PG.
    // Antes, los sin calificar se sugerían igual como `(PUBLIC)`; ahora el pseudo-esquema
    // del descriptor manda en los tres sitios que los leen. En la app es inalcanzable:
    // `CatalogoAutocompletado.publicos()` da [] en PG (fijado en test-proveedor-sql).
    const pgRoto = construirSugerencias({ tipo: 'objetos', prefijo: '', esquema: null }, pgConPublicos, OP_PG)
    check('PG con una fuente que diera públicos: ninguno se sugiere (el pseudo-esquema manda)', pgRoto.every((x) => x.tipo !== 'sinonimo'), etiquetas(pgRoto).join(', '))
  }

  // -------------------------------------------------------------------------
  hr('(17) SQL Server: nombres de tres partes y la caja \'insensibleUnicode\'')
  // -------------------------------------------------------------------------
  {
    check('SQL Server admite tres partes; Oracle, PG y SQLite no', admiteTresPartes('sqlserver') && !admiteTresPartes('oracle') && !admiteTresPartes('postgres') && !admiteTresPartes('sqlite'), 'ok')
    const c1 = ctx('select * from ventas.dbo.¦', 'sqlserver')
    check('`FROM ventas.dbo.¦`: objetos de dbo en la base ventas', c1.tipo === 'objetos' && c1.esquema === 'dbo' && c1.base === 'ventas', j(c1))
    const c2 = ctx('select * from dbo.¦', 'sqlserver')
    check('`FROM dbo.¦`: sin base (la de la consola)', c2.tipo === 'objetos' && c2.esquema === 'dbo' && !('base' in c2), j(c2))
    const cOra = ctx('select * from a.b.¦', 'oracle')
    check('Oracle `a.b.¦`: sin base, como antes', cOra.tipo === 'objetos' && !('base' in cOra), j(cOra))
    const refs = refsDe('select * from ventas.dbo.t x join dbo.u y on 1=1', 'sqlserver')
    check('la tabla de tres partes lleva su base; la de dos, no', refs[0]?.base === 'ventas' && refs[0].esquema === 'dbo' && refs[1] !== undefined && !('base' in refs[1]), j(refs))
    check('Oracle: una referencia a.b.c no lleva base', !('base' in (refsDe('select * from a.b.c', 'oracle')[0] ?? {})), j(refsDe('select * from a.b.c', 'oracle')))

    // Una fuente con dos bases: la de la consola y `ventas`, con otra tabla `t`.
    const pedidas: string[] = []
    const fuente: FuenteCatalogo = {
      objetos: (esquema, base) =>
        base === 'ventas'
          ? esquema === 'dbo'
            ? [obj('dbo', 'Pedidos'), obj('dbo', 'Ñandú')]
            : []
          : esquema === null || esquema === 'dbo'
            ? [obj('dbo', 'Clientes')]
            : [],
      columnas: (esquema, tabla, base) => {
        pedidas.push(`${base ?? '-'}.${esquema}.${tabla}`)
        if (base === 'ventas' && esquema === 'dbo' && tabla === 'Pedidos') return ['ID', 'IMPORTE']
        if (base === undefined && esquema === 'dbo' && tabla === 'Clientes') return ['ID', 'NOMBRE']
        return null
      },
      esquemas: () => ['dbo', 'ventas_esq'],
      esquemaActual: () => null,
      publicos: () => []
    }
    const OP_SQLS = { dialecto: 'sqlserver' as const, alias: 'SQLS' }
    const s1 = construirSugerencias(c1, fuente, OP_SQLS)
    const nombres = (s: Sugerencia[]): string[] => s.map((x) => x.etiqueta).sort()
    check('`ventas.dbo.¦` sugiere los objetos de ESA base (y no los de la consola)', j(nombres(s1)) === j(['Pedidos', 'Ñandú']), j(etiquetas(s1)))
    const cMiembro = ctx('select x.¦ from ventas.dbo.Pedidos x', 'sqlserver')
    const s2 = construirSugerencias(cMiembro, fuente, OP_SQLS)
    check('`x.` con x de otra base: las columnas de ESA tabla', j(nombres(s2)) === j(['ID', 'IMPORTE']), j(etiquetas(s2)))
    const cTres = ctx('select ventas.dbo.Pedidos.¦', 'sqlserver')
    check('`ventas.dbo.Pedidos.¦` (miembro de tres partes): sus columnas', cTres.tipo === 'miembro' && resolverMiembro(cTres.calificador, cTres.tablas, fuente, 'sqlserver').tipo === 'columnas' && j(resolverMiembro(cTres.calificador, cTres.tablas, fuente, 'sqlserver')) === j({ tipo: 'columnas', esquema: 'dbo', tabla: 'Pedidos', base: 'ventas' }), j(cTres))
    // Lo que falta de otra base se pide aparte (y sin tocar la lista de siempre).
    const vacia: FuenteCatalogo = { ...fuente, objetos: () => [], columnas: () => null }
    const p1 = pendientesDeCarga(c1, vacia, 'sqlserver')
    check('pendientes: `deBase` con la base y el esquema', j(p1.deBase) === j([{ base: 'ventas', esquema: 'dbo' }]) && p1.esquemas.length === 0, j(p1))
    const p2 = pendientesDeCarga(cMiembro, vacia, 'sqlserver')
    check('pendientes: las columnas de otra base llevan su base', j(p2.columnas) === j([{ esquema: 'dbo', tabla: 'Pedidos', base: 'ventas' }]), j(p2))
    const pOra = pendientesDeCarga(ctx('select * from HR.¦', 'oracle'), { ...vacia, esquemas: () => ['HR'] }, 'oracle')
    check('Oracle: pendientes con la forma de siempre (sin `deBase`)', !('deBase' in pOra), j(pOra))
    // Ni FKs ni «Expandir columnas» a través de otra base (serían las de otra tabla).
    const est = estrellaEn('select * from ventas.dbo.Pedidos', 8, 8, 'sqlserver')
    check('`*` de una tabla de otra base: no se expande', est !== null && listaDeEstrella(est, fuente, 'sqlserver') === null, j(est))
    const estLocal = estrellaEn('select * from dbo.Clientes', 8, 8, 'sqlserver')
    check('`*` de una de la base de la consola: sí', estLocal !== null && listaDeEstrella(estLocal, fuente, 'sqlserver') === 'ID, NOMBRE', j(estLocal && listaDeEstrella(estLocal, fuente, 'sqlserver')))

    // La caja 'insensibleUnicode': `DBO.` es el esquema `dbo`, y `ñandú` casa con `Ñandú`.
    const cMay = ctx('select DBO.¦', 'sqlserver')
    check('`DBO.` en el SELECT: los objetos de dbo (sin caja)', cMay.tipo === 'miembro' && resolverMiembro(cMay.calificador, cMay.tablas, fuente, 'sqlserver').tipo === 'objetos', j(cMay.tipo === 'miembro' ? resolverMiembro(cMay.calificador, cMay.tablas, fuente, 'sqlserver') : cMay))
    // La mitad negativa: en Oracle la comparación es EXACTA (lo escrito llega plegado); un
    // calificador `Hr` que no pasó por el plegado no es el esquema HR.
    const oraFuente: FuenteCatalogo = { ...fuente, objetos: () => [], columnas: () => null, esquemas: () => ['HR'] }
    check(
      'Oracle: el esquema se reconoce EXACTO (HR sí, Hr no)',
      resolverMiembro(['HR'], [], oraFuente, 'oracle').tipo === 'objetos' && resolverMiembro(['Hr'], [], oraFuente, 'oracle').tipo === 'desconocido',
      'ok'
    )
    const sN = construirSugerencias({ tipo: 'objetos', prefijo: 'ñan', esquema: 'dbo', base: 'ventas' }, fuente, OP_SQLS)
    check('prefijo `ñan` encuentra `Ñandú` (sin caja en toda letra)', nombres(sN).includes('Ñandú'), j(etiquetas(sN)))

    // (Integración.) El `GO` en su línea parte el trozo del cursor como el `;`: lo de otro
    // lote no aporta tablas ni alias. `contextoEnTexto` ya acota por la sentencia del divisor;
    // aquí se llama a `analizarContexto` con los tokens del texto ENTERO, que es lo que cubre.
    const entero = (conCursor: string): Contexto => {
      const { texto, cursor } = partir(conCursor)
      return analizarContexto(tokenizar(texto, 'sqlserver'), cursor, 'sqlserver', texto)
    }
    const tGo = entero('select a from dbo.t x\nGO\nx.¦')
    check('tras un GO, el alias `x` del lote anterior ya no resuelve (sin tablas)', tGo.tipo === 'miembro' && tGo.tablas.length === 0, j(tGo))
    const tGo2 = entero('select a from dbo.t\nGO\nwhere ¦')
    check('tras un GO, un WHERE suelto no ve la tabla del lote anterior', tGo2.tipo === 'columnas' && tGo2.tablas.length === 0, j(tGo2))
    const tSin = entero('select a from dbo.t x\nx.¦')
    check('NEGATIVO: sin GO (misma sentencia) el alias sí resuelve', tSin.tipo === 'miembro' && tSin.tablas.length === 1, j(tSin))
    const tMedio = entero('select ¦ from dbo.t\nGO\nselect 1 from dbo.u')
    check('el lote del cursor manda: sus tablas y no las del siguiente', tMedio.tipo === 'columnas' && j(tMedio.tablas.map((r) => r.nombre)) === j(['t']), j(tMedio))
    const tCtx = ctx('select a from dbo.t x\nGO\nx.¦', 'sqlserver')
    check('y por `contextoEnTexto` (el divisor ya corta en el GO) lo mismo', tCtx.tipo === 'miembro' && tCtx.tablas.length === 0, j(tCtx))
  }

  // -------------------------------------------------------------------------
  // Reporte final
  // -------------------------------------------------------------------------
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
