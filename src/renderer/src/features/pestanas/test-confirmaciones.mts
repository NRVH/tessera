#!/usr/bin/env node
// =============================================================================
// Prueba de `confirmaciones.ts` (npm run test:confirmaciones-pestanas): cambiar la carpeta de un
// proyecto confirma salvo que sea la misma; hibernar (y cambiar la red, que lo hiberna) con un
// agente trabajando, con una terminal que ejecuta algo, con terminales que no se pudieron mirar o
// si falló la consulta, y nunca con todo en reposo.
// =============================================================================

import { confirmacionHibernar, decidirTrasConsulta, reemplazoPideConfirmacion } from './confirmaciones.ts'

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
  hr('Cambiar la carpeta de un proyecto')
  check('otra carpeta -> confirma', reemplazoPideConfirmacion('/w/uno', '/w/dos') === true, 'true')
  check('la misma carpeta -> no confirma (solo la despierta)', reemplazoPideConfirmacion('/w/uno', '/w/uno') === false, 'false')

  hr('Hibernar el perfil (y cambiar su red, que lo hiberna: misma regla)')
  const reposo = confirmacionHibernar(false, { abiertas: 2, enMarcha: 0 })
  check('terminales en reposo y sin agente -> no confirma', reposo === null, JSON.stringify(reposo))
  const sinNada = confirmacionHibernar(false, { abiertas: 0, enMarcha: 0 })
  check('sin terminales ni agente -> no confirma', sinNada === null, JSON.stringify(sinNada))
  const enMarcha = confirmacionHibernar(false, { abiertas: 3, enMarcha: 2 })
  check(
    'dos terminales ejecutando algo -> confirma y las cuenta',
    enMarcha !== null && !enMarcha.agente && enMarcha.terminales?.tipo === 'en-marcha' && enMarcha.terminales.n === 2,
    JSON.stringify(enMarcha)
  )
  const agente = confirmacionHibernar(true, { abiertas: 1, enMarcha: 0 })
  check('agente trabajando, terminal en reposo -> confirma solo por el agente', agente !== null && agente.agente && agente.terminales === null, JSON.stringify(agente))
  const ambos = confirmacionHibernar(true, { abiertas: 1, enMarcha: 1 })
  check(
    'agente trabajando y terminal ejecutando -> nombra las dos cosas',
    ambos !== null && ambos.agente && ambos.terminales?.tipo === 'en-marcha',
    JSON.stringify(ambos)
  )
  const sinMirar = confirmacionHibernar(false, { abiertas: 2, enMarcha: null })
  check(
    'no se pudo mirar qué ejecutan -> confirma por las abiertas',
    sinMirar !== null && sinMirar.terminales?.tipo === 'abiertas' && sinMirar.terminales.n === 2,
    JSON.stringify(sinMirar)
  )
  const sinMirarNinguna = confirmacionHibernar(false, { abiertas: 0, enMarcha: null })
  check('no se pudo mirar pero no hay terminales -> no confirma', sinMirarNinguna === null, JSON.stringify(sinMirarNinguna))
  const fallo = confirmacionHibernar(false, null)
  check('falló la consulta -> confirma sin cifra', fallo !== null && fallo.terminales?.tipo === 'sin-saber', JSON.stringify(fallo))

  hr('Al volver la consulta: el estado de ese momento, no el de la pulsación')
  const viva = { existe: true, hibernado: false, trabajando: false }
  const reposoT = { abiertas: 1, enMarcha: 0 }
  const d1 = decidirTrasConsulta({ ...viva, existe: false }, { abiertas: 1, enMarcha: 3 })
  check('el perfil se borró mientras tanto -> nada', d1.tipo === 'nada', JSON.stringify(d1))
  const d2 = decidirTrasConsulta({ ...viva, hibernado: true, trabajando: true }, null)
  check('ya se hibernó mientras tanto -> ya-hibernado, sin preguntar', d2.tipo === 'ya-hibernado', JSON.stringify(d2))
  const d3 = decidirTrasConsulta({ ...viva, trabajando: true }, reposoT)
  check('un agente empezó a trabajar durante la consulta -> pregunta', d3.tipo === 'preguntar' && d3.confirmacion.agente, JSON.stringify(d3))
  const d4 = decidirTrasConsulta(viva, reposoT)
  check('todo en reposo -> ejecuta', d4.tipo === 'ejecutar', JSON.stringify(d4))
  const d5 = decidirTrasConsulta(viva, { abiertas: 2, enMarcha: 1 })
  check('una terminal ejecuta algo -> pregunta', d5.tipo === 'preguntar' && d5.confirmacion.terminales?.tipo === 'en-marcha', JSON.stringify(d5))

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
