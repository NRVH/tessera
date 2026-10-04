#!/usr/bin/env node
// =============================================================================
// Prueba del ciclo de vida del sondeo del puente de BD en modo Docker (`DockerBridge`): a quién se sondea.
// Preparar dos perfiles, olvidar uno (el sondeo sigue), olvidar el otro (para), volver a preparar (rearranca),
// olvidar uno desconocido o dos veces (no-op), el buzón en disco sobrevive y `stop()` con perfiles vivos.
// Lógica pura sobre `fs`: corre sin Docker. (node src/main/db/test-db-docker-ciclo.mts)
// Decisiones: docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DockerBridge } from './dockerBridge.ts'

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
// Fixture: un puente sobre una raíz temporal. `ejecutar` nunca se llama (no se
// escribe ninguna petición), pero la dependencia es obligatoria.
// ---------------------------------------------------------------------------
const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-dbciclo-'))

function nuevoPuente(): DockerBridge {
  return new DockerBridge({
    raiz,
    // El cliente se COPIA al buzón en cada preparación. Basta con que la ruta
    // exista: aquí se apunta al cliente real del repo.
    clienteOrigen: path.join(process.cwd(), 'src', 'tdb', 'tdb-container.cjs'),
    ejecutar: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    log: () => {}
  })
}

function main(): void {
  const puente = nuevoPuente()

  try {
    // --- (1) dos perfiles preparados -----------------------------------------
    hr('(1) preparar dos perfiles: se sondean los dos')
    const buzonA = puente.prepararPerfil('perfil-a')
    puente.prepararPerfil('perfil-b')
    check(
      '(1) perfilesActivos=2 y sondeando=true',
      puente.perfilesActivos === 2 && puente.sondeando,
      `perfilesActivos=${puente.perfilesActivos} sondeando=${puente.sondeando}`
    )

    // --- (2) olvidar uno: el otro sigue --------------------------------------
    hr('(2) olvidar un perfil: queda uno y el sondeo SIGUE')
    puente.olvidarPerfil('perfil-a')
    check(
      '(2) perfilesActivos=1 y sondeando=true',
      puente.perfilesActivos === 1 && puente.sondeando,
      `perfilesActivos=${puente.perfilesActivos} sondeando=${puente.sondeando}`
    )

    // --- (3) olvidar el último: para del todo --------------------------------
    hr('(3) olvidar el último perfil: el sondeo PARA')
    puente.olvidarPerfil('perfil-b')
    check(
      '(3) perfilesActivos=0 y sondeando=false',
      puente.perfilesActivos === 0 && !puente.sondeando,
      `perfilesActivos=${puente.perfilesActivos} sondeando=${puente.sondeando}`
    )

    // --- (4) rearranque -------------------------------------------------------
    hr('(4) volver a preparar (despertar): el sondeo REARRANCA')
    puente.prepararPerfil('perfil-a')
    check(
      '(4) perfilesActivos=1 y sondeando=true',
      puente.perfilesActivos === 1 && puente.sondeando,
      `perfilesActivos=${puente.perfilesActivos} sondeando=${puente.sondeando}`
    )

    // --- (5) olvidar un desconocido no apaga nada ----------------------------
    hr('(5) olvidar un perfil que nunca se preparó: no-op')
    puente.olvidarPerfil('perfil-fantasma')
    check(
      '(5) sigue 1 perfil y sondeando',
      puente.perfilesActivos === 1 && puente.sondeando,
      `perfilesActivos=${puente.perfilesActivos} sondeando=${puente.sondeando}`
    )

    // --- (6) idempotencia ----------------------------------------------------
    hr('(6) olvidar dos veces el mismo perfil: idempotente')
    puente.olvidarPerfil('perfil-a')
    const trasPrimero = { n: puente.perfilesActivos, s: puente.sondeando }
    puente.olvidarPerfil('perfil-a')
    check(
      '(6) el segundo olvido no cambia nada',
      trasPrimero.n === 0 &&
        !trasPrimero.s &&
        puente.perfilesActivos === 0 &&
        !puente.sondeando,
      `tras 1º: n=${trasPrimero.n} s=${trasPrimero.s}; tras 2º: n=${puente.perfilesActivos} s=${puente.sondeando}`
    )

    // --- (7) el buzón en disco sobrevive -------------------------------------
    hr('(7) olvidar NO borra el buzón del disco (al despertar se reusa)')
    check(
      '(7) la carpeta y el lanzador siguen ahí',
      existsSync(buzonA) && existsSync(path.join(buzonA, 'tdb')),
      `buzon=${existsSync(buzonA)} lanzador=${existsSync(path.join(buzonA, 'tdb'))}`
    )

    // --- (8) stop() con perfiles vivos (cierre de la app) --------------------
    hr('(8) stop() explícito con perfiles vivos: para el sondeo')
    puente.prepararPerfil('perfil-c')
    const antesDeStop = puente.sondeando
    puente.stop()
    check(
      '(8) sondeando pasa de true a false',
      antesDeStop && !puente.sondeando,
      `antes=${antesDeStop} despues=${puente.sondeando}`
    )
  } finally {
    // Sin esto el proceso se quedaría colgado en el temporizador (aunque tenga
    // unref, más vale no depender de ello para salir).
    puente.stop()
    rmSync(raiz, { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
