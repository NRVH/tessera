#!/usr/bin/env node
// =============================================================================
// Prueba de concurrencia de `ensureContainer` (npm run test:sandbox:race), contra Docker:
// N llamadas simultáneas del mismo perfil dan el MISMO handle y un solo contenedor, una
// posterior sigue funcionando (el coalescing no es una caché) y `detenerContenedor` no deja
// huérfanos. Perfil desechable `racetest`.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { GestorSandbox, nombreContenedorPara } from './GestorSandbox.ts'
import type { Perfil } from '../perfiles/types.ts'

const PERFIL_CONCURRENCIA: Perfil = {
  id: 'racetest',
  nombre: 'RaceTest',
  color: '#61afef',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/racetest/claude' }],
  sandbox: { habilitado: true }
}
const CONTENEDOR = nombreContenedorPara(PERFIL_CONCURRENCIA)

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
function contarContenedores(): number {
  const r = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `name=^/${CONTENEDOR}$`, '--format', '{{.Names}}'],
    { encoding: 'utf8' }
  )
  return r.stdout.split('\n').filter((l) => l.trim() === CONTENEDOR).length
}

async function main(): Promise<void> {
  const gestor = new GestorSandbox()

  // Estado de partida limpio: si un run anterior dejó el contenedor, quítalo.
  hr('Preparación: asegurar que no hay contenedor previo del perfil desechable')
  await gestor.detenerContenedor(PERFIL_CONCURRENCIA).catch(() => {})
  check('(0) sin contenedor previo tras la limpieza', contarContenedores() === 0, `count=${contarContenedores()}`)

  // --- (a)+(b): N ensureContainer CONCURRENTES ------------------------------
  hr('(a)+(b) N ensureContainer concurrentes del MISMO perfil -> 1 contenedor, sin lanzar')
  const N = 5
  let errorLanzado: string | null = null
  let descriptores: Awaited<ReturnType<GestorSandbox['ensureContainer']>>[] = []
  try {
    descriptores = await Promise.all(Array.from({ length: N }, () => gestor.ensureContainer(PERFIL_CONCURRENCIA)))
  } catch (err) {
    errorLanzado = err instanceof Error ? err.message : String(err)
  }
  check(
    `(a) las ${N} llamadas concurrentes resuelven sin lanzar`,
    errorLanzado === null && descriptores.length === N,
    errorLanzado === null ? `handles=${descriptores.length}` : `LANZÓ: ${errorLanzado}`
  )
  check(
    '(a.2) todas devuelven el MISMO handle (mismo nombreContenedor)',
    descriptores.length === N && descriptores.every((h) => h.nombreContenedor === CONTENEDOR),
    `names=${JSON.stringify(descriptores.map((h) => h.nombreContenedor))}`
  )
  check(
    '(b) se creó EXACTAMENTE 1 contenedor (la carrera no duplicó)',
    contarContenedores() === 1,
    `count=${contarContenedores()}`
  )

  // --- (c): llamada posterior (tras settlear) sigue idempotente -------------
  hr('(c) ensureContainer posterior (mapa ya limpio) reusa el contenedor')
  const deNuevo = await gestor.ensureContainer(PERFIL_CONCURRENCIA)
  check(
    '(c) reusa el mismo contenedor sin crear otro',
    deNuevo.nombreContenedor === CONTENEDOR && contarContenedores() === 1,
    `name=${deNuevo.nombreContenedor} count=${contarContenedores()}`
  )

  // --- (d): limpieza --------------------------------------------------------
  hr('(d) detenerContenedor deja limpio')
  await gestor.detenerContenedor(PERFIL_CONCURRENCIA)
  check('(d) sin contenedor tras detenerContenedor', contarContenedores() === 0, `count=${contarContenedores()}`)

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
    await new GestorSandbox().detenerContenedor(PERFIL_CONCURRENCIA)
  } catch {
    /* ignore */
  }
  process.exit(1)
})
