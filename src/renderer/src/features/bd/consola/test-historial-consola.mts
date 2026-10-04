#!/usr/bin/env node
// =============================================================================
// Prueba del historial de consultas de la consola (npm run test:db-consola-historial): la
// hora, la fila, qué se inserta y con qué fin de línea, el cursor, borrar con el teclado
// (las dos plataformas y sus mitades negativas) y Enter con una lista vieja.
// =============================================================================

import type { DbEntradaHistorial } from '../../../../../shared/db-explorador-ipc.ts'
import {
  TEXTO_CONEXION_BORRADA,
  aliasHistorial,
  consultaHistorial,
  detalleHistorial,
  enterEnHistorial,
  esBorrarEntrada,
  glifoHistorial,
  horaHistorial,
  insercionHistorial,
  moverEnHistorial,
  primeraLineaSql
} from './historialConsola.ts'

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

function tecla(key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; repeat?: boolean } = {}) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    repeat: mods.repeat ?? false
  }
}

function main(): void {
  hr('(1) La hora')

  // Fechas LOCALES construidas con el constructor de partes: el test no depende del huso.
  const ahora = new Date(2026, 8, 26, 18, 30, 0).getTime()
  check('(1a) de hoy: hh:mm:ss', horaHistorial(new Date(2026, 8, 26, 9, 5, 7).getTime(), ahora) === '09:05:07', horaHistorial(new Date(2026, 8, 26, 9, 5, 7).getTime(), ahora))
  check('(1b) de este año: dd/mm hh:mm', horaHistorial(new Date(2026, 0, 3, 23, 59, 1).getTime(), ahora) === '03/01 23:59', horaHistorial(new Date(2026, 0, 3, 23, 59, 1).getTime(), ahora))
  check('(1c) de otro año: dd/mm/aaaa', horaHistorial(new Date(2025, 11, 31, 10, 0, 0).getTime(), ahora) === '31/12/2025', horaHistorial(new Date(2025, 11, 31, 10, 0, 0).getTime(), ahora))
  check(
    '(1d) ayer a las 23:59 no es «hoy» aunque falten menos de 24 h',
    horaHistorial(new Date(2026, 8, 25, 23, 59, 0).getTime(), new Date(2026, 8, 26, 0, 1, 0).getTime()) === '25/09 23:59',
    horaHistorial(new Date(2026, 8, 25, 23, 59, 0).getTime(), new Date(2026, 8, 26, 0, 1, 0).getTime())
  )

  hr('(2) Primera línea, alias, glifo y tooltip')

  check('(2a) salta las líneas en blanco y quita la sangría', primeraLineaSql('\n\n   select *\n  from t') === 'select * …', primeraLineaSql('\n\n   select *\n  from t'))
  check('(2b) una sola línea, sin « …»', primeraLineaSql('select 1') === 'select 1', primeraLineaSql('select 1'))
  check('(2c) recorte', primeraLineaSql('x'.repeat(300), 20).length === 20 && primeraLineaSql('x'.repeat(300), 20).endsWith('…'), primeraLineaSql('x'.repeat(300), 20))
  check('(2d) CRLF', primeraLineaSql('select 1\r\nfrom dual') === 'select 1 …', primeraLineaSql('select 1\r\nfrom dual'))
  const alias = new Map([['c1', 'PG-DEV']])
  check('(2e) alias de una conexión viva', aliasHistorial('c1', alias) === 'PG-DEV', aliasHistorial('c1', alias))
  check('(2f) una conexión que ya no existe', aliasHistorial('c9', alias) === TEXTO_CONEXION_BORRADA, aliasHistorial('c9', alias))
  check(
    '(2g) glifos: el vocabulario del margen',
    glifoHistorial('ok').simbolo === '✓' && glifoHistorial('error').simbolo === '✗' && glifoHistorial('cancelada').simbolo === '⊘',
    j([glifoHistorial('ok'), glifoHistorial('error'), glifoHistorial('cancelada')])
  )
  const e: DbEntradaHistorial = {
    id: 'h1',
    en: ahora,
    perfilId: 'p',
    conexionId: 'c1',
    consolaId: 'k',
    sql: 'select * from t',
    resultado: 'ok',
    ms: 1234,
    filas: 1,
    esquema: 'ventas'
  }
  const det = detalleHistorial(e, 'PG-DEV')
  check('(2h) tooltip: SQL entero y lo que pasó', det === 'select * from t\n\nCorrecta · 1 s 234 ms · 1 fila · PG-DEV · ventas', det)

  hr('(3) Qué se inserta')

  const vacio = { antes: '', despues: '' }
  const i1 = insercionHistorial('select * from t', 'oracle', vacio)
  check('(3a) en una línea vacía: la sentencia terminada con `;`', i1.texto === 'select * from t;' && i1.cursor === 16, j(i1))
  const i2 = insercionHistorial('  select 1  \n', 'postgres', { antes: 'select 2;', despues: '' })
  check('(3b) con texto ANTES del cursor: en una línea nueva; sin blancos sobrantes', i2.texto === '\nselect 1;' && i2.cursor === 10, j(i2))
  const i3 = insercionHistorial('select 1', 'postgres', { antes: '', despues: 'select 2;' })
  check('(3c) con texto DETRÁS: se abre línea después y el cursor queda antes del salto', i3.texto === 'select 1;\n' && i3.cursor === 9, j(i3))
  const i4 = insercionHistorial('select 1', 'postgres', { antes: '  ', despues: '  ' })
  check('(3d) solo blancos alrededor: sin saltos', i4.texto === 'select 1;', j(i4))
  const bloque = 'begin\n  null;\nend;'
  const i5 = insercionHistorial(bloque, 'oracle', vacio)
  check('(3e) un bloque PL/SQL de Oracle termina con `/` en su propia línea', i5.texto === 'begin\n  null;\nend;\n/', j(i5))
  const i6 = insercionHistorial('select 1;', 'oracle', vacio)
  check('(3f) si ya trae `;`, no se duplica', i6.texto === 'select 1;', j(i6))
  const i7 = insercionHistorial('SET SERVEROUTPUT ON', 'oracle', vacio)
  check('(3g) un comando del cliente no lleva terminador', i7.texto === 'SET SERVEROUTPUT ON', j(i7))
  const i8 = insercionHistorial("DO $$ BEGIN RAISE NOTICE 'x'; END $$", 'postgres', vacio)
  check('(3h) PG: un DO $$…$$ termina con `;` (no es un bloque de barra)', i8.texto === "DO $$ BEGIN RAISE NOTICE 'x'; END $$;", j(i8))
  const i9 = insercionHistorial('\\dt', 'postgres', vacio)
  check('(3i) PG: un metacomando de psql no lleva `;`', i9.texto === '\\dt', j(i9))

  // El FIN DE LÍNEA del modelo: Monaco reescribe los saltos de lo
  // insertado al del modelo, y en Windows una consola nace en CRLF. El cursor se cuenta
  // sobre el texto YA normalizado, o cae dentro de la sentencia (o se pasa de ella).
  const i10 = insercionHistorial('select *\nfrom emp', 'oracle', { antes: 'select 1;', despues: '' }, '\r\n')
  check(
    '(3j) modelo CRLF, entrada LF a mitad de línea: saltos en CRLF y el cursor tras el `;`',
    i10.texto === '\r\nselect *\r\nfrom emp;' && i10.cursor === 21 && i10.texto.slice(0, i10.cursor).endsWith('emp;'),
    j(i10)
  )
  const i11 = insercionHistorial('select *\r\nfrom emp', 'postgres', { antes: 'select 1;', despues: 'select 2;' }, '\n')
  check(
    '(3k) modelo LF, entrada CRLF (de una consola de Windows) con texto detrás: sin `\\r`, el sufijo fuera del cursor',
    i11.texto === '\nselect *\nfrom emp;\n' && i11.cursor === 19 && i11.texto.slice(i11.cursor) === '\n',
    j(i11)
  )
  const i12 = insercionHistorial(bloque, 'oracle', vacio, '\r\n')
  check(
    '(3l) PL/SQL en un modelo CRLF: la `/` en su propia línea con CRLF y el cursor detrás',
    i12.texto === 'begin\r\n  null;\r\nend;\r\n/' && i12.cursor === i12.texto.length,
    j(i12)
  )
  const i13 = insercionHistorial('begin\r\n  null;\r\nend;', 'oracle', { antes: 'x', despues: 'y' }, '\r\n')
  check(
    '(3m) PL/SQL CRLF a mitad de línea en un modelo CRLF: el cursor tras la `/`, antes del salto final',
    i13.texto === '\r\nbegin\r\n  null;\r\nend;\r\n/\r\n' && i13.texto.slice(0, i13.cursor).endsWith('\r\n/') && i13.texto.slice(i13.cursor) === '\r\n',
    j(i13)
  )
  // Mitad negativa: con '\n' y SQL solo LF, lo de (3a)-(3i) sale idéntico a no pasarlo.
  const casos: Array<[string, 'oracle' | 'postgres', { antes: string; despues: string }]> = [
    ['select * from t', 'oracle', vacio],
    ['  select 1  \n', 'postgres', { antes: 'select 2;', despues: '' }],
    ['select 1', 'postgres', { antes: '', despues: 'select 2;' }],
    ['select 1', 'postgres', { antes: '  ', despues: '  ' }],
    [bloque, 'oracle', { antes: 'a', despues: 'b' }],
    ['SET SERVEROUTPUT ON', 'oracle', vacio],
    ['\\dt', 'postgres', vacio]
  ]
  const distintos = casos.filter(([sql, d, ctx]) => j(insercionHistorial(sql, d, ctx, '\n')) !== j(insercionHistorial(sql, d, ctx)))
  check('(3n) con `\\n` explícito y SQL LF nada cambia respecto a no pasarlo', distintos.length === 0, j(distintos))
  // Y un texto ya en el fin de línea del modelo queda tal cual: Monaco no lo tocará.
  const crlf = 'select *\r\nfrom emp'
  const i14 = insercionHistorial(crlf, 'oracle', vacio, '\r\n')
  check('(3o) entrada CRLF en un modelo CRLF: el texto no cambia (más el `;`)', i14.texto === `${crlf};` && i14.cursor === crlf.length + 1, j(i14))

  // SQL Server: una unidad de ALCANCE DE LOTE no la cierra el `;` (llega
  // hasta el GO), así que se inserta con `GO` en su línea; lo demás, con `;` como siempre.
  const lote = 'DECLARE @x int = 1; SELECT @x'
  const s1 = insercionHistorial(lote, 'sqlserver', vacio)
  check('(3p) SQL Server: un DECLARE (alcance de lote) termina con `GO` en su propia línea', s1.texto === `${lote}\nGO` && s1.cursor === s1.texto.length, j(s1))
  const s2 = insercionHistorial('CREATE PROCEDURE dbo.p AS SELECT 1;', 'sqlserver', { antes: 'SELECT 2', despues: 'SELECT 3' }, '\r\n')
  check(
    '(3q) SQL Server: un CREATE PROCEDURE a mitad de líneas en un modelo CRLF: GO con CRLF y el cursor tras él',
    s2.texto === '\r\nCREATE PROCEDURE dbo.p AS SELECT 1;\r\nGO\r\n' && s2.texto.slice(0, s2.cursor).endsWith('\r\nGO') && s2.texto.slice(s2.cursor) === '\r\n',
    j(s2)
  )
  const s3 = insercionHistorial('SELECT * FROM dbo.t', 'sqlserver', vacio)
  check('(3r) NEGATIVO: una consulta normal de SQL Server lleva `;`, no GO', s3.texto === 'SELECT * FROM dbo.t;', j(s3))
  const s4 = insercionHistorial('BEGIN TRAN', 'sqlserver', vacio)
  check('(3s) NEGATIVO: BEGIN TRAN no es un bloque (lleva `;`)', s4.texto === 'BEGIN TRAN;', j(s4))
  const s5 = insercionHistorial('DECLARE @x int = 1\nGO', 'sqlserver', vacio)
  check('(3t) si ya trae su GO, no se duplica', s5.texto === 'DECLARE @x int = 1\nGO', j(s5))
  const s6 = insercionHistorial('begin\n  null;\nend;', 'postgres', vacio)
  check('(3u) NEGATIVO: en PG un BEGIN no es alcance de lote (sin GO)', !s6.texto.includes('GO'), j(s6))

  hr('(4) El cursor con el teclado')

  check('(4a) ↓ baja y se para al final', moverEnHistorial(0, 3, 'ArrowDown') === 1 && moverEnHistorial(2, 3, 'ArrowDown') === 2, 'ok')
  check('(4b) ↑ sube y se para arriba', moverEnHistorial(1, 3, 'ArrowUp') === 0 && moverEnHistorial(0, 3, 'ArrowUp') === 0, 'ok')
  check('(4c) páginas de 10, acotadas', moverEnHistorial(0, 25, 'PageDown') === 10 && moverEnHistorial(20, 25, 'PageDown') === 24 && moverEnHistorial(5, 25, 'PageUp') === 0, 'ok')
  check('(4d) una tecla que no es de moverse: null (la deja pasar al filtro)', moverEnHistorial(0, 3, 'a') === null && moverEnHistorial(0, 3, 'Home') === null, 'Home/End son del filtro')
  check('(4e) lista vacía', moverEnHistorial(0, 0, 'ArrowDown') === 0, 'ok')

  hr('(5) Borrar con el teclado (las dos plataformas)')

  check('(5a) [windows] Supr con el filtro vacío borra', esBorrarEntrada(tecla('Delete'), true, 'windows'), 'true')
  check('(5b) [windows] Supr con texto en el filtro NO (edita el filtro)', !esBorrarEntrada(tecla('Delete'), false, 'windows'), 'mitad negativa')
  check('(5c) [windows] ⌫ a secas NO', !esBorrarEntrada(tecla('Backspace'), true, 'windows'), 'mitad negativa')
  check('(5d) [windows] Supr en autorrepetición NO', !esBorrarEntrada(tecla('Delete', { repeat: true }), true, 'windows'), 'mitad negativa')
  check('(5e) [windows] Ctrl+Supr / Shift+Supr NO', !esBorrarEntrada(tecla('Delete', { ctrl: true }), true, 'windows') && !esBorrarEntrada(tecla('Delete', { shift: true }), true, 'windows'), 'mitad negativa')
  check('(5f) [mac] ⌘⌫ con el filtro vacío borra', esBorrarEntrada(tecla('Backspace', { meta: true }), true, 'mac'), 'true')
  check('(5g) [mac] fn+⌫ (Supr) también', esBorrarEntrada(tecla('Delete'), true, 'mac'), 'true')
  check('(5h) [mac] ⌫ a secas NO: vaciar el filtro con una de más se llevaría una entrada', !esBorrarEntrada(tecla('Backspace'), true, 'mac'), 'mitad negativa')
  check('(5i) [mac] ⌃⌫ NO', !esBorrarEntrada(tecla('Backspace', { ctrl: true }), true, 'mac'), 'mitad negativa')
  check('(5j) [windows] el ⌘⌫ de Mac (⊞+⌫) NO se cuela', !esBorrarEntrada(tecla('Backspace', { meta: true }), true, 'windows'), 'mitad negativa')

  hr('(6) Enter con la lista de OTRO filtro (la respuesta aún no llegó)')

  // La lista que se ve es la de la consulta con la que llegó; lo tecleado puede pedir ya
  // otra (150 ms de pausa + el IPC). Teclear «emp» y dar Enter en seguida insertaba la
  // fila activa de la lista VIEJA, que puede no casar con el filtro.
  const sinFiltro = consultaHistorial(true, '')
  const conFiltro = consultaHistorial(true, 'where id = $1')
  check(
    '(6a) la lista es la de lo tecleado: Enter inserta la activa',
    enterEnHistorial(conFiltro, conFiltro, 3) === 'insertar',
    'insertar'
  )
  check(
    '(6b) se tecleó un filtro y su lista no ha llegado: Enter ESPERA (no inserta la fila vieja)',
    enterEnHistorial(sinFiltro, conFiltro, 5) === 'esperar',
    'la vieja trae 5 filas que no casan con el filtro'
  )
  check(
    '(6c) la primera lista aún no llegó: espera',
    enterEnHistorial(null, sinFiltro, 0) === 'esperar',
    'esperar'
  )
  check(
    '(6d) la lista de lo tecleado está vacía: nada',
    enterEnHistorial(conFiltro, conFiltro, 0) === 'nada',
    'nada'
  )
  check(
    '(6e) conmutar «Solo esta conexión» también cambia la consulta',
    consultaHistorial(true, 'x') !== consultaHistorial(false, 'x') &&
      enterEnHistorial(consultaHistorial(true, 'x'), consultaHistorial(false, 'x'), 2) === 'esperar',
    'esperar'
  )
  check(
    '(6f) los blancos de los bordes no cambian la consulta (el main recibe el filtro recortado)',
    consultaHistorial(true, '  emp ') === consultaHistorial(true, 'emp'),
    'misma consulta'
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
