#!/usr/bin/env node
// =============================================================================
// Prueba del ciclo de vida del contenedor por perfil (npm run test:sandbox:hibernate), contra
// Docker: liberar sesiones, incluida la última, NUNCA para el contenedor; solo
// `stopContainer` lo para, y solo el de ese perfil. Perfiles desechables `hibA`/`hibB`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { SandboxManager } from './SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'

function mkProfile(id: string): Profile {
  return {
    id,
    nombre: id.toUpperCase(),
    color: '#61afef',
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: true }
  }
}
const A = mkProfile('hiba')
const B = mkProfile('hibb')

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

/** ¿Existe (corriendo o no) el contenedor tessera-<id>? Prueba de RAM liberada:
 *  tras stop+rm el contenedor DESAPARECE de `docker ps -a`. */
function containerUp(profileId: string): boolean {
  const name = `tessera-${profileId}`
  const r = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8'
  })
  return r.stdout.split('\n').some((l) => l.trim() === name)
}

async function main(): Promise<void> {
  const mgr = new SandboxManager()

  // Limpieza previa por si un run anterior dejó algo.
  hr('Preparación: contenedores desechables limpios')
  await mgr.stopContainer(A).catch(() => {})
  await mgr.stopContainer(B).catch(() => {})

  // --- (a): dos perfiles con contenedor vivo -------------------------------
  hr('(a) A (2 sesiones) y B (1 sesión) con contenedor vivo')
  await mgr.ensureContainer(A)
  await mgr.ensureContainer(B)
  // A: dos proyectos -> dos sesiones. B: un proyecto -> una sesión.
  mgr.retainSession(A.id, 'a-s1')
  mgr.retainSession(A.id, 'a-s2')
  mgr.retainSession(B.id, 'b-s1')
  check(
    '(a) ambos contenedores arriba; refcount A=2 B=1',
    containerUp(A.id) && containerUp(B.id) && mgr.liveSessionCount(A.id) === 2 && mgr.liveSessionCount(B.id) === 1,
    `A.up=${containerUp(A.id)} B.up=${containerUp(B.id)} refA=${mgr.liveSessionCount(A.id)} refB=${mgr.liveSessionCount(B.id)}`
  )

  // --- (b): liberar 1 de 2 de A -> contador 1, contenedor SIGUE -------------
  hr('(b) liberar 1 sesión de A (queda 1): contador 1, contenedor A sigue')
  const wasLast1 = mgr.releaseSession(A, 'a-s1')
  check(
    '(b) release devuelve false (no era la última); A sigue arriba, contador 1; B intacto',
    wasLast1 === false && containerUp(A.id) && mgr.liveSessionCount(A.id) === 1 && containerUp(B.id),
    `wasLast=${wasLast1} A.up=${containerUp(A.id)} refA=${mgr.liveSessionCount(A.id)} B.up=${containerUp(B.id)}`
  )

  // --- (c): liberar la ÚLTIMA de A -> contador 0 pero SIGUE VIVO (sin auto-stop)
  hr('(c) liberar la ÚLTIMA sesión de A: contador 0 pero el contenedor SIGUE VIVO (no hay auto-stop)')
  const wasLast2 = mgr.releaseSession(A, 'a-s2')
  check(
    '(c) release devuelve true (era la última) PERO A SIGUE ARRIBA; contador A=0 (la hibernación es manual)',
    wasLast2 === true && containerUp(A.id) && mgr.liveSessionCount(A.id) === 0,
    `wasLast=${wasLast2} A.up=${containerUp(A.id)} refA=${mgr.liveSessionCount(A.id)}`
  )

  // --- (d): stopContainer explícito SÍ mata A; B intacto (AISLAMIENTO) ------
  hr('(d) stopContainer(A) explícito mata A (RAM liberada); B sigue VIVO')
  await mgr.stopContainer(A)
  check(
    '(d) A ya NO está (RAM liberada); B sigue VIVO y con su contador intacto (aislado)',
    !containerUp(A.id) && containerUp(B.id) && mgr.liveSessionCount(B.id) === 1,
    `A.up=${containerUp(A.id)} B.up=${containerUp(B.id)} refB=${mgr.liveSessionCount(B.id)}`
  )

  // --- (e): stopContainer(B); idempotencia del contador --------------------
  hr('(e) stopContainer(B) mata B; el contador es idempotente')
  const again = mgr.releaseSession(B, 'b-s1') // baja informativa
  const againDup = mgr.releaseSession(B, 'b-s1') // ya liberada -> false, sin lanzar
  await mgr.stopContainer(B)
  check(
    '(e) B detenido; re-liberar el contador es idempotente (true luego false); B ya no está',
    again === true && againDup === false && !containerUp(B.id),
    `again=${again} dup=${againDup} B.up=${containerUp(B.id)}`
  )

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
  console.error('[test:sandbox:hibernate] error inesperado:', err)
  const mgr = new SandboxManager()
  try {
    await mgr.stopContainer(A)
    await mgr.stopContainer(B)
  } catch {
    /* best-effort */
  }
  process.exit(1)
})
