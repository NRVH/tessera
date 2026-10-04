#!/usr/bin/env node
// =============================================================================
// Prueba de concurrencia de `ensureContainer` (npm run test:sandbox:race), contra Docker:
// N llamadas simultáneas del mismo perfil dan el MISMO handle y un solo contenedor, una
// posterior sigue funcionando (el coalescing no es una caché) y `stopContainer` no deja
// huérfanos. Perfil desechable `racetest`.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { SandboxManager } from './SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'

const RACE_PROFILE: Profile = {
  id: 'racetest',
  nombre: 'RaceTest',
  color: '#61afef',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/racetest/claude' }],
  sandbox: { habilitado: true }
}
const CONTAINER = `tessera-${RACE_PROFILE.id}`

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}

/** Nº de contenedores (corriendo o no) con nombre EXACTO CONTAINER. */
function containerCount(): number {
  const r = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Names}}'],
    { encoding: 'utf8' }
  )
  return r.stdout.split('\n').filter((l) => l.trim() === CONTAINER).length
}

async function main(): Promise<void> {
  const mgr = new SandboxManager()

  // Estado de partida limpio: si un run anterior dejó el contenedor, quítalo.
  hr('Preparación: asegurar que no hay contenedor previo del perfil desechable')
  await mgr.stopContainer(RACE_PROFILE).catch(() => {})
  check('(0) sin contenedor previo tras la limpieza', containerCount() === 0, `count=${containerCount()}`)

  // --- (a)+(b): N ensureContainer CONCURRENTES ------------------------------
  hr('(a)+(b) N ensureContainer concurrentes del MISMO perfil -> 1 contenedor, sin lanzar')
  const N = 5
  let threw: string | null = null
  let handles: Awaited<ReturnType<SandboxManager['ensureContainer']>>[] = []
  try {
    handles = await Promise.all(Array.from({ length: N }, () => mgr.ensureContainer(RACE_PROFILE)))
  } catch (err) {
    threw = err instanceof Error ? err.message : String(err)
  }
  check(
    `(a) las ${N} llamadas concurrentes resuelven sin lanzar`,
    threw === null && handles.length === N,
    threw === null ? `handles=${handles.length}` : `LANZÓ: ${threw}`
  )
  check(
    '(a.2) todas devuelven el MISMO handle (mismo containerName)',
    handles.length === N && handles.every((h) => h.containerName === CONTAINER),
    `names=${JSON.stringify(handles.map((h) => h.containerName))}`
  )
  check(
    '(b) se creó EXACTAMENTE 1 contenedor (la carrera no duplicó)',
    containerCount() === 1,
    `count=${containerCount()}`
  )

  // --- (c): llamada posterior (tras settlear) sigue idempotente -------------
  hr('(c) ensureContainer posterior (mapa ya limpio) reusa el contenedor')
  const again = await mgr.ensureContainer(RACE_PROFILE)
  check(
    '(c) reusa el mismo contenedor sin crear otro',
    again.containerName === CONTAINER && containerCount() === 1,
    `name=${again.containerName} count=${containerCount()}`
  )

  // --- (d): limpieza --------------------------------------------------------
  hr('(d) stopContainer deja limpio')
  await mgr.stopContainer(RACE_PROFILE)
  check('(d) sin contenedor tras stopContainer', containerCount() === 0, `count=${containerCount()}`)

  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[test:sandbox:race] error inesperado:', err)
  // Intento de limpieza best-effort para no dejar el contenedor desechable vivo.
  try {
    await new SandboxManager().stopContainer(RACE_PROFILE)
  } catch {
    /* ignore */
  }
  process.exit(1)
})
