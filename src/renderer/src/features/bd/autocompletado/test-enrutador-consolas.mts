#!/usr/bin/env node
// =============================================================================
// Prueba del enrutador de consolas (URI -> consola) del autocompletado SQL: forma de
// la URI, una URI ajena da null, el esquema se lee al preguntar, registrar la misma
// URI sustituye y la baja vieja no quita la ruta nueva.
// (npm run test:db-enrutador-consolas)
// =============================================================================

import {
  esUriDeConsola,
  registrarRutaConsola,
  rutaDeModelo,
  rutasDeConexion,
  rutasRegistradas,
  uriConsola,
  type RutaConsola
} from './enrutadorConsolas.ts'

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

function ruta(consolaId: string, conexionId: string, alias: string, esquema: () => string | null): RutaConsola {
  return { consolaId, conexionId, alias, dialecto: 'postgres', esquema }
}

hr('(1) uriConsola')
{
  const u = uriConsola('c-123')
  check('forma tessera-db://consola/<id>.sql', u === 'tessera-db://consola/c-123.sql', u)
  const raro = uriConsola('a b/c')
  check('el id va codificado (espacio y barra)', raro === 'tessera-db://consola/a%20b%2Fc.sql', raro)
}

hr('(2) registrar y encontrar')
{
  const u = uriConsola('c1')
  const baja = registrarRutaConsola(u, ruta('c1', 'x1', 'QA', () => 'public'))
  const r = rutaDeModelo(u)
  check('encuentra la ruta registrada', r !== null && r.conexionId === 'x1' && r.alias === 'QA', JSON.stringify(r && { c: r.conexionId, a: r.alias }))
  check('un .sql de archivos no es de ninguna consola', rutaDeModelo('file:///proyecto/a.sql') === null, 'null')
  baja()
  check('la baja la quita', rutaDeModelo(u) === null && rutasRegistradas() === 0, `registradas=${rutasRegistradas()}`)
}

hr('(3) el esquema es vivo')
{
  let esquema: string | null = null
  const u = uriConsola('c2')
  const baja = registrarRutaConsola(u, ruta('c2', 'x1', 'QA', () => esquema))
  const antes = rutaDeModelo(u)?.esquema()
  esquema = 'ventas'
  const despues = rutaDeModelo(u)?.esquema()
  check('lee el esquema al preguntar', antes === null && despues === 'ventas', `${antes} -> ${despues}`)
  baja()
}

hr('(4) registrar la misma URI sustituye')
{
  const u = uriConsola('c3')
  const b1 = registrarRutaConsola(u, ruta('c3', 'x1', 'QA', () => null))
  const b2 = registrarRutaConsola(u, ruta('c3', 'x1', 'QA-2', () => null))
  check('gana la última', rutaDeModelo(u)?.alias === 'QA-2' && rutasRegistradas() === 1, `alias=${rutaDeModelo(u)?.alias}`)
  hr('(5) la baja vieja no quita la nueva')
  b1()
  check('tras la baja de la vieja sigue la nueva', rutaDeModelo(u)?.alias === 'QA-2', `alias=${rutaDeModelo(u)?.alias}`)
  b2()
  check('la baja de la nueva sí la quita', rutaDeModelo(u) === null, 'null')
}

hr('(6) rutasDeConexion')
{
  const bs = [
    registrarRutaConsola(uriConsola('a'), ruta('a', 'x1', 'QA', () => null)),
    registrarRutaConsola(uriConsola('b'), ruta('b', 'x2', 'PROD', () => null)),
    registrarRutaConsola(uriConsola('c'), ruta('c', 'x1', 'QA', () => null))
  ]
  const de1 = rutasDeConexion('x1').map((r) => r.consolaId).sort()
  check('dos consolas de x1', de1.join(',') === 'a,c', de1.join(','))
  check('ninguna de una conexión sin consolas', rutasDeConexion('zz').length === 0, '0')
  bs.forEach((b) => b())
  check('todas dadas de baja', rutasRegistradas() === 0, `registradas=${rutasRegistradas()}`)
}

hr('(7) esUriDeConsola')
{
  check('positiva', esUriDeConsola(uriConsola('z')), uriConsola('z'))
  check('negativa: archivo', !esUriDeConsola('file:///a.sql'), 'file:///a.sql')
  check('negativa: inmemory', !esUriDeConsola('inmemory://model/1'), 'inmemory://model/1')
}

const pasados = results.filter((r) => r.pass).length
const allPass = pasados === results.length
console.log(`\nVEREDICTO: ${pasados}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
