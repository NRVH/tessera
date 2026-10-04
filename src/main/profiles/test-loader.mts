#!/usr/bin/env node
// =============================================================================
// Prueba de la validación de perfiles (npm run test:profiles): la semilla `config/profiles.json` es
// válida y sus perfiles traen sus agentes con `configDir` distintos; un perfil sin agentes y uno
// con el mismo agente dos veces se rechazan. Ejercita `validateProfileShape` directamente y no
// `loadProfiles`, cuyo módulo arrastra `electron` y solo expone la API real dentro de Electron.
// =============================================================================

import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateProfileShape } from './validate.ts'
import type { Profile } from './types.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')
const REAL_CONFIG = path.join(REPO_ROOT, 'config', 'profiles.json')

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

function main(): void {
  // --- CASO (a): la semilla config/profiles.json, un perfil neutro con dos agentes ---
  hr('CASO (a) - semilla config/profiles.json: perfiles válidos, «personal» trae 2 agentes')
  const raw = readFileSync(REAL_CONFIG, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  const items = Array.isArray(parsed) ? parsed : []
  const perProfileErrors = items.map((item) => validateProfileShape(item))
  const allValid = perProfileErrors.every((errs) => errs.length === 0)
  check(
    '(a.1) todos los perfiles de profiles.json son válidos según validateProfileShape',
    Array.isArray(parsed) && items.length > 0 && allValid,
    `perfiles=${items.length} ; errores=${JSON.stringify(perProfileErrors.filter((e) => e.length > 0))}`
  )

  const personal = items.find((it) => (it as Profile).id === 'personal') as Profile | undefined
  const tiposPersonal = personal?.agentes.map((a) => a.tipo).sort() ?? []
  const configDirsUnicos = new Set(personal?.agentes.map((a) => a.configDir)).size === personal?.agentes.length
  check(
    '(a.2) «personal» tiene agentes claude-code + codex con configDir distintos',
    personal !== undefined &&
      tiposPersonal.length === 2 &&
      tiposPersonal[0] === 'claude-code' &&
      tiposPersonal[1] === 'codex' &&
      configDirsUnicos,
    `personal.agentes=${JSON.stringify(personal?.agentes)}`
  )

  // La semilla se publica con la app: un único perfil, sin rutas de ningún equipo.
  const sinRutasDeEquipo = items.every((it) => (it as Profile).sshDir === undefined)
  check(
    '(a.3) la semilla trae un único perfil y ninguno declara sshDir',
    items.length === 1 && sinRutasDeEquipo,
    `ids=${JSON.stringify(items.map((it) => (it as Profile).id))}`
  )

  // --- CASO (b): perfil sin agentes (arreglo vacío) es rechazado --------------
  hr('CASO (b) - perfil sin agentes (arreglo vacío) es rechazado')
  const sinAgentes = {
    id: 'sin-agentes',
    nombre: 'Sin Agentes',
    color: '#112233',
    agentes: [],
    sandbox: { habilitado: false }
  }
  const erroresSinAgentes = validateProfileShape(sinAgentes)
  check(
    '(b) perfil sin agentes es rechazado con un error claro',
    erroresSinAgentes.some((e) => e.includes('agentes')),
    `errores=${JSON.stringify(erroresSinAgentes)}`
  )

  // --- CASO (c): perfil con dos agentes 'claude-code' es rechazado ------------
  hr("CASO (c) - perfil con dos agentes 'claude-code' (tipo duplicado) es rechazado")
  const duplicado = {
    id: 'duplicado',
    nombre: 'Duplicado',
    color: '#112233',
    agentes: [
      { tipo: 'claude-code', configDir: './a' },
      { tipo: 'claude-code', configDir: './b' }
    ],
    sandbox: { habilitado: false }
  }
  const erroresDuplicado = validateProfileShape(duplicado)
  check(
    "(c) perfil con dos agentes 'claude-code' es rechazado con un error claro",
    erroresDuplicado.some((e) => e.includes('duplicado')),
    `errores=${JSON.stringify(erroresDuplicado)}`
  )

  // --- Reporte final -----------------------------------------------------------
  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
