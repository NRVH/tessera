#!/usr/bin/env node
// =============================================================================
// Prueba de limpiarDestinoBd: quitar de host/servicio lo que se copia pegado desde
// una consola web o una cadena JDBC.
// (node src/shared/test-destino-bd.mts)
// -----------------------------------------------------------------------------
// El caso que la motiva: una conexión guardada como
//   app@10.0.0.5:1521/http://db1.example.com
// fallaba con NJS-515 ("input string not in easy connect format"), y el error no
// menciona en ningún momento el `http://` que sobra.
// =============================================================================

import { limpiarDestinoBd, traiaEsquema } from './destinoBd.ts'

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

function main(): void {
  hr('(1) Lo que hay que quitar')
  const limpia: [string, string][] = [
    ['http://db1.example.com', 'db1.example.com'],
    ['https://db1.example.com', 'db1.example.com'],
    ['jdbc:oracle:thin:@10.0.0.5', '10.0.0.5'],
    ['jdbc:postgresql://srv-bd', 'srv-bd'],
    ['oracle://PRUEBAS', 'PRUEBAS'],
    ['  PRUEBAS  ', 'PRUEBAS'],
    ['/servicio/', 'servicio'],
    ['http://http://doble', 'doble']
  ]
  for (const [entrada, esperado] of limpia) {
    const salida = limpiarDestinoBd(entrada)
    check(`limpia ${JSON.stringify(entrada)}`, salida === esperado, JSON.stringify(salida))
  }

  hr('(2) Lo que NO se toca (una normalización que arregla de más conecta a otro sitio)')
  const intactos = [
    'db1.example.com',
    '10.0.0.5',
    'PRUEBAS',
    'SERVICIO_QA',
    'srv-bd.local',
    'base_con_guion_bajo'
  ]
  for (const v of intactos) {
    check(`respeta ${JSON.stringify(v)}`, limpiarDestinoBd(v) === v, JSON.stringify(limpiarDestinoBd(v)))
  }

  // EL CASO QUE SE ESCAPÓ LA PRIMERA VEZ. `host:puerto` se parece a un esquema y la
  // versión inicial se comía la parte de la izquierda: `srv-bd:1521` -> `1521`, o sea
  // el host guardado era el número de puerto. El test original solo probaba la IP
  // NUMÉRICA, que sobrevivía de casualidad (no empieza por letra) y daba por buena una
  // función rota para todos los hosts con nombre. Van los dos, y varios más.
  const conPuerto = [
    'srv-bd:1521',
    'localhost:5432',
    'db1.example.com:1521',
    '10.0.0.5:1521',
    'PRUEBAS:1521'
  ]
  for (const v of conPuerto) {
    check(
      `host con puerto intacto: ${JSON.stringify(v)}`,
      limpiarDestinoBd(v) === v,
      JSON.stringify(limpiarDestinoBd(v))
    )
  }
  check(
    'una IPv6 no se descuartiza',
    limpiarDestinoBd('fe80::1') === 'fe80::1',
    JSON.stringify(limpiarDestinoBd('fe80::1'))
  )

  hr('(3) Vacíos')
  for (const v of ['', '   ', null, undefined]) {
    check(`${JSON.stringify(v)} -> ''`, limpiarDestinoBd(v) === '', "''")
  }
  check("'http://' solo -> ''", limpiarDestinoBd('http://') === '', "''")

  hr('(4) traiaEsquema (para poder AVISAR de que se limpió)')
  check('con esquema', traiaEsquema('http://x'), 'true')
  check('sin esquema', !traiaEsquema('x'), 'false')
  check(
    'un host con puerto NO cuenta como esquema',
    !traiaEsquema('10.0.0.5:1521'),
    'false'
  )
  check('un host CON NOMBRE y puerto tampoco', !traiaEsquema('srv-bd:1521'), 'false')
  check('vacío', !traiaEsquema(''), 'false')

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
