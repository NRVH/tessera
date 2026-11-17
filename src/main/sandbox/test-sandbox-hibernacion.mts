#!/usr/bin/env node
// =============================================================================
// Prueba del ciclo de vida del contenedor por perfil (npm run test:sandbox:hibernate), contra
// Docker: liberar sesiones, incluida la última, NUNCA para el contenedor; solo
// `detenerContenedor` lo para, y solo el de ese perfil. Perfiles desechables `hibA`/`hibB`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { GestorSandbox, nombreContenedorPara } from './GestorSandbox.ts'
import type { Perfil } from '../perfiles/types.ts'

function crearPerfil(id: string): Perfil {
  return {
    id,
    nombre: id.toUpperCase(),
    color: '#61afef',
    agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }],
    sandbox: { habilitado: true }
  }
}
const A = crearPerfil('hiba')
const B = crearPerfil('hibb')

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
function existeContenedor(perfilId: string): boolean {
  const nombre = nombreContenedorPara({ id: perfilId } as Parameters<typeof nombreContenedorPara>[0])
  const r = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${nombre}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8'
  })
  return r.stdout.split('\n').some((l) => l.trim() === nombre)
}

async function main(): Promise<void> {
  const gestor = new GestorSandbox()

  // Limpieza previa por si un run anterior dejó algo.
  hr('Preparación: contenedores desechables limpios')
  await gestor.detenerContenedor(A).catch(() => {})
  await gestor.detenerContenedor(B).catch(() => {})

  // --- (a): dos perfiles con contenedor vivo -------------------------------
  hr('(a) A (2 sesiones) y B (1 sesión) con contenedor vivo')
  await gestor.ensureContainer(A)
  await gestor.ensureContainer(B)
  // A: dos proyectos -> dos sesiones. B: un proyecto -> una sesión.
  gestor.retainSession(A.id, 'a-s1')
  gestor.retainSession(A.id, 'a-s2')
  gestor.retainSession(B.id, 'b-s1')
  check(
    '(a) ambos contenedores arriba; refcount A=2 B=1',
    existeContenedor(A.id) && existeContenedor(B.id) && gestor.contarSesionesVivas(A.id) === 2 && gestor.contarSesionesVivas(B.id) === 1,
    `A.up=${existeContenedor(A.id)} B.up=${existeContenedor(B.id)} refA=${gestor.contarSesionesVivas(A.id)} refB=${gestor.contarSesionesVivas(B.id)}`
  )

  // --- (b): liberar 1 de 2 de A -> contador 1, contenedor SIGUE -------------
  hr('(b) liberar 1 sesión de A (queda 1): contador 1, contenedor A sigue')
  const eraUltimaPrimeraSesion = gestor.releaseSession(A, 'a-s1')
  check(
    '(b) release devuelve false (no era la última); A sigue arriba, contador 1; B intacto',
    eraUltimaPrimeraSesion === false && existeContenedor(A.id) && gestor.contarSesionesVivas(A.id) === 1 && existeContenedor(B.id),
    `eraUltima=${eraUltimaPrimeraSesion} A.up=${existeContenedor(A.id)} refA=${gestor.contarSesionesVivas(A.id)} B.up=${existeContenedor(B.id)}`
  )

  // --- (c): liberar la ÚLTIMA de A -> contador 0 pero SIGUE VIVO (sin auto-stop)
  hr('(c) liberar la ÚLTIMA sesión de A: contador 0 pero el contenedor SIGUE VIVO (no hay auto-stop)')
  const eraUltimaSegundaSesion = gestor.releaseSession(A, 'a-s2')
  check(
    '(c) release devuelve true (era la última) PERO A SIGUE ARRIBA; contador A=0 (la hibernación es manual)',
    eraUltimaSegundaSesion === true && existeContenedor(A.id) && gestor.contarSesionesVivas(A.id) === 0,
    `eraUltima=${eraUltimaSegundaSesion} A.up=${existeContenedor(A.id)} refA=${gestor.contarSesionesVivas(A.id)}`
  )

  // --- (d): detenerContenedor explícito SÍ mata A; B intacto (AISLAMIENTO) --
  hr('(d) detenerContenedor(A) explícito mata A (RAM liberada); B sigue VIVO')
  await gestor.detenerContenedor(A)
  check(
    '(d) A ya NO está (RAM liberada); B sigue VIVO y con su contador intacto (aislado)',
    !existeContenedor(A.id) && existeContenedor(B.id) && gestor.contarSesionesVivas(B.id) === 1,
    `A.up=${existeContenedor(A.id)} B.up=${existeContenedor(B.id)} refB=${gestor.contarSesionesVivas(B.id)}`
  )

  // --- (e): detenerContenedor(B); idempotencia del contador ----------------
  hr('(e) detenerContenedor(B) mata B; el contador es idempotente')
  const deNuevo = gestor.releaseSession(B, 'b-s1') // baja informativa
  const bajaDuplicada = gestor.releaseSession(B, 'b-s1') // ya liberada -> false, sin lanzar
  await gestor.detenerContenedor(B)
  check(
    '(e) B detenido; re-liberar el contador es idempotente (true luego false); B ya no está',
    deNuevo === true && bajaDuplicada === false && !existeContenedor(B.id),
    `again=${deNuevo} dup=${bajaDuplicada} B.up=${existeContenedor(B.id)}`
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
  const gestor = new GestorSandbox()
  try {
    await gestor.detenerContenedor(A)
    await gestor.detenerContenedor(B)
  } catch {
    /* best-effort */
  }
  process.exit(1)
})
