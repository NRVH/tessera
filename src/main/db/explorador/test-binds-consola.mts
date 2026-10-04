#!/usr/bin/env node
// =============================================================================
// Prueba de los binds de consola (`bindsConsola.ts`): la forma de lo que manda el renderer, las
// claves de Oracle, que solo viajen los parámetros usados, el array posicional de PG con su
// tope, la forma mixta de SQLite y el relleno con NULL del EXPLAIN. Las reglas de casado de
// node-oracledb se midieron contra servidores reales. (npm run test:db-binds)
// =============================================================================

import { MOTORES } from '../../../shared/motores/index.ts'
import { dividirSentencias } from '../../../shared/sql/divisorSql.ts'
import { parametrosSql } from '../../../shared/sql/parametrosSql.ts'
import { bindsParaTrabajador, claveOracle, MAX_BINDS, MAX_TEXTO_BINDS, validarBinds } from './bindsConsola.ts'

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

function main(): void {
  hr('(1) validarBinds')
  check('ausente -> undefined', j(validarBinds(undefined)) === j({ ok: true }) && validarBinds(null).ok, j(validarBinds(undefined)))
  const v1 = validarBinds({ ID: '5', N: null })
  check('objeto con texto y null', v1.ok && j(v1.binds) === j({ ID: '5', N: null }), j(v1))
  check('un array no', !validarBinds(['5']).ok, j(validarBinds(['5'])))
  check('un número no (siempre texto)', !validarBinds({ ID: 5 }).ok, j(validarBinds({ ID: 5 })))
  check('un objeto como valor no', !validarBinds({ ID: { salida: 'texto' } }).ok, 'rechazado (no se cuela un bind de salida)')
  check('clave vacía no', !validarBinds({ '': '1' }).ok, 'rechazada')
  const muchas: Record<string, string> = {}
  for (let i = 0; i <= MAX_BINDS; i++) muchas[`K${i}`] = '1'
  check(`más de ${MAX_BINDS} claves no`, !validarBinds(muchas).ok, 'rechazado')
  check('valores demasiado grandes no', !validarBinds({ A: 'x'.repeat(MAX_TEXTO_BINDS + 1) }).ok, 'rechazado')

  hr('(2) claveOracle')
  const casos: Array<[string, string]> = [
    ['ID', 'ID'],
    ['1', '1'],
    ['A_B$C#1', 'A_B$C#1'],
    ['AÑO', 'AÑO'],
    ['Id', '"Id"'],
    ['a b', '"a b"'],
    ['1A', '"1A"']
  ]
  for (const [c, e] of casos) check(`${c} -> ${e}`, claveOracle(c) === e, claveOracle(c))

  hr('(3) Oracle: solo los usados, por nombre')
  const sqlO = 'select * from t where id = :id and nombre = :"Nombre" or id = :ID and x = :1'
  const po = parametrosSql(sqlO, 'oracle')
  const ro = bindsParaTrabajador(po, { ID: '5', Nombre: 'Ana', '1': '7', SOBRA: 'x' }, 'oracle')
  check(
    'claves ID, "Nombre" y 1; la que sobra no viaja',
    ro.ok && j(ro.binds) === j({ ID: '5', '"Nombre"': 'Ana', '1': '7' }),
    j(ro)
  )
  const rnull = bindsParaTrabajador(parametrosSql('select :x from dual', 'oracle'), { X: null }, 'oracle')
  check('NULL explícito viaja como null', rnull.ok && j(rnull.binds) === j({ X: null }), j(rnull))

  hr('(4) PG: posicionales 1..n')
  const rp = bindsParaTrabajador(parametrosSql('select $2, $1, $2', 'postgres'), { '1': 'a', '2': 'b' }, 'postgres')
  check('array en orden de número', rp.ok && j(rp.binds) === j(['a', 'b']), j(rp))
  const rh = bindsParaTrabajador(parametrosSql('select $1, $3', 'postgres'), { '1': 'a', '3': 'c' }, 'postgres')
  check('un hueco va como NULL (lo rechaza el servidor con su error)', rh.ok && j(rh.binds) === j(['a', null, 'c']), j(rh))
  // `$n` por encima del tope del protocolo: sin reservar el array (antes, mil millones de NULL en el main).
  const t0 = Date.now()
  const rg = bindsParaTrabajador(parametrosSql('select $1000000000', 'postgres'), { '1000000000': 'x' }, 'postgres')
  const msG = Date.now() - t0
  check('`$1000000000`: rechazado sin construir el array, nombrado como se escribió', !rg.ok && rg.faltan.length === 0 && /\$1000000000/.test(rg.mensaje) && msG < 500, `${j(rg)} en ${msG} ms`)
  // El texto de PG, AL BYTE, y el nombre del motor sale
  // del registro (con la etiqueta de PG cambiada a propósito, y restaurada, la sigue): un
  // «PostgreSQL» escrito a mano pasaría el primero y no el segundo.
  check(
    'el mensaje de PG es el de siempre, al byte',
    !rg.ok && rg.mensaje === 'PostgreSQL admite como mucho $65535: $1000000000 no puede enviarse.',
    rg.ok ? '' : rg.mensaje
  )
  const descriptorPg = MOTORES.postgres as { etiqueta: string }
  const etiquetaPg = descriptorPg.etiqueta
  let conOtra = ''
  try {
    descriptorPg.etiqueta = 'PG de prueba'
    const r = bindsParaTrabajador(parametrosSql('select $70000', 'postgres'), { '70000': 'x' }, 'postgres')
    conOtra = r.ok ? '' : r.mensaje
  } finally {
    descriptorPg.etiqueta = etiquetaPg
  }
  check('y nombra la etiqueta del registro (cambiada: «PG de prueba»)', conOtra === 'PG de prueba admite como mucho $65535: $70000 no puede enviarse.', conOtra)
  const rTope = bindsParaTrabajador(parametrosSql('select $65535', 'postgres'), { '65535': 'x' }, 'postgres')
  check(
    'NEGATIVO: `$65535`, el tope, sí se manda (65534 NULL y el valor)',
    rTope.ok && Array.isArray(rTope.binds) && rTope.binds.length === 65535 && rTope.binds[65534] === 'x',
    rTope.ok && Array.isArray(rTope.binds) ? `${rTope.binds.length}` : j(rTope)
  )
  const r01 = bindsParaTrabajador(parametrosSql('select $01', 'postgres'), { '1': 'b' }, 'postgres')
  check('`$01` es `$1`: su valor llega (antes iba NULL)', r01.ok && j(r01.binds) === j(['b']), j(r01))

  hr('(5) Faltan')
  const rf = bindsParaTrabajador(parametrosSql('select * from t where a = :a and b = :"Be"', 'oracle'), { A: '1' }, 'oracle')
  check(
    'ok:false con las claves y el mensaje con el nombre ESCRITO',
    !rf.ok && j(rf.faltan) === j(['Be']) && /:"Be"/.test(rf.mensaje),
    j(rf)
  )
  const rf2 = bindsParaTrabajador(parametrosSql('select $1, $2', 'postgres'), undefined, 'postgres')
  check('sin binds: faltan todos, en plural', !rf2.ok && j(rf2.faltan) === j(['1', '2']) && /\$1, \$2/.test(rf2.mensaje), j(rf2))

  hr('(6) rellenar (EXPLAIN de Oracle en thin)')
  const rr = bindsParaTrabajador(parametrosSql('select * from t where a = :a and b = :b', 'oracle'), { A: '1' }, 'oracle', true)
  check('lo que falta va como NULL', rr.ok && j(rr.binds) === j({ A: '1', B: null }), j(rr))

  hr('(7) Sin parámetros')
  const rs = bindsParaTrabajador(parametrosSql("select ':x' from dual -- :y", 'oracle'), { X: '1' }, 'oracle')
  check('binds ausente aunque el renderer mande valores', rs.ok && rs.binds === undefined, j(rs))
  const rt = bindsParaTrabajador(
    parametrosSql('CREATE OR REPLACE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN :new.a := 1; END;', 'oracle'),
    { NEW: 'x' },
    'oracle'
  )
  check('el :new de un disparador no es un parámetro', rt.ok && rt.binds === undefined, j(rt))

  hr('(8) EXEC: el texto traducido conserva los binds')
  const st = dividirSentencias('EXEC p(:x, :y)', 'oracle')[0]
  const pe = parametrosSql(st.texto, 'oracle')
  const re = bindsParaTrabajador(pe, { X: '1', Y: '2' }, 'oracle')
  check('BEGIN p(:x, :y); END; con X e Y', /^BEGIN/.test(st.texto) && re.ok && j(re.binds) === j({ X: '1', Y: '2' }), `${st.texto} ${j(re)}`)

  hr('(9) SQLite (`sqliteMixto`) — nombres completos y anónimos por índice')
  const sq = (sql: string, binds: Record<string, string | null>, rellenar = false): ReturnType<typeof bindsParaTrabajador> =>
    bindsParaTrabajador(parametrosSql(sql, 'sqlite'), binds, 'sqlite', rellenar, sql)
  const s1 = sq('select * from t where a = :a and b = :b or a = :a', { a: '1', b: '2', sobra: 'x' })
  check(':a y :b: nombrados con su prefijo, sin anónimos (sus índices son de nombre), y el que sobra no viaja', s1.ok && j(s1.binds) === j({ nombrados: { ':a': '1', ':b': '2' }, anonimos: [] }), j(s1))
  const s2 = sq('select :a', {})
  check('el que falta es `parametros` con su clave', !s2.ok && j(s2.faltan) === '["a"]', j(s2))
  const s3 = bindsParaTrabajador(parametrosSql('select :a', 'sqlite'), { a: '1' }, 'sqlite')
  check('NEGATIVO: sin el texto no se enlaza (no se sabe qué índice toca a cada uno)', !s3.ok && /texto de la sentencia/.test(s3.mensaje), j(s3))
  const s4 = sq('create trigger tr after insert on t begin select :x; end', {})
  check('el :x del cuerpo de un CREATE TRIGGER no es un parámetro', s4.ok && s4.binds === undefined, j(s4))
  // La mezcla entera solo cuando el léxico ya da `?`, `?NNN`, `@x` y `$x` (sus banderas son
  // del grupo del léxico); hasta entonces se dice y no se da por buena.
  const mezcla = 'select ?, :a, ?5, @a, $b, ?'
  const claves = parametrosSql(mezcla, 'sqlite').map((p) => p.clave)
  if (claves.length === 5) {
    const s5 = sq(mezcla, { '1': 'uno', a: 'A', '5': 'cinco', b: 'B', '8': 'ocho' })
    // Índices de SQLite: ?=1, :a=2, ?5=5, @a=6, $b=7, ?=8. Anónimos: los que no son de un
    // nombre con :/@/$ (1, 3, 4, 5, 8), con NULL en los huecos.
    check(
      'la mezcla: :a y @a son dos nombres (misma clave), y los anónimos van por índice con sus huecos',
      s5.ok && j(s5.binds) === j({ nombrados: { ':a': 'A', '@a': 'A', $b: 'B' }, anonimos: ['uno', null, null, 'cinco', 'ocho'] }),
      j(s5)
    )
  } else {
    console.log(`  (el léxico aún no da todos los marcadores de SQLite: ${claves.join(',')}; la mezcla queda para cuando los dé)`)
  }
  const s6 = sq('select ?40000', { '40000': 'x' })
  check('NEGATIVO: un índice por encima del tope de SQLite no reserva nada', parametrosSql('select ?40000', 'sqlite').length === 0 || (!s6.ok && /\?32766/.test(s6.mensaje)), j(s6))

  hr('(10) `:a` y `?1` son el MISMO hueco en SQLite — se avisa')
  const choque = sq('select :a, ?1', { a: 'A', '1': 'uno' })
  check(
    'con `:a, ?1` se envía (SQL válido), el valor que va es el de :a y el resultado lo avisa',
    choque.ok && j(choque.binds) === j({ nombrados: { ':a': 'A' }, anonimos: [] }) && choque.aviso === 'En SQLite, ?1 y :a son el MISMO parámetro: se usó el valor de :a y el de ?1 no.',
    j(choque)
  )
  const sinChoque = sq('select ?1, :a', { '1': 'uno', a: 'A' })
  check('NEGATIVO: `?1, :a` no chocan (:a toma el 2) y no se avisa', sinChoque.ok && sinChoque.aviso === undefined, j(sinChoque))
  const dosChoques = sq('select :a, @b, ?2, ?1, ?1', { a: 'A', b: 'B', '1': 'x', '2': 'y' })
  check('dos parejas (y una repetida una sola vez): un aviso que las nombra', dosChoques.ok && (dosChoques.aviso ?? '').includes('(?2 y @b; ?1 y :a)'), j(dosChoques))
  const ora = bindsParaTrabajador(parametrosSql('select :a, :1 from dual', 'oracle'), { A: 'x', a: 'x', '1': 'y' }, 'oracle')
  const pg = bindsParaTrabajador(parametrosSql('select $1, $1', 'postgres'), { '1': 'y' }, 'postgres')
  check('NEGATIVO: Oracle y PG nunca avisan', ora.ok && pg.ok && !('aviso' in ora) && !('aviso' in pg), j({ ora, pg }))

  hr('RESULTADO')
  const pasan = results.filter((r) => r.pass).length
  const todas = pasan === results.length
  for (const r of results) if (!r.pass) console.log(`  FAIL: ${r.name}`)
  hr(`VEREDICTO: ${pasan}/${results.length} PASS — ${todas ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(todas ? 0 : 1)
}

main()
