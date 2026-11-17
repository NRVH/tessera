#!/usr/bin/env node
// =============================================================================
// Prueba de la validación de perfiles (npm run test:profiles): la semilla `config/profiles.json` es
// válida y sus perfiles traen sus agentes con `configDir` distintos; un perfil sin agentes y uno
// con el mismo agente dos veces se rechazan. Ejercita `validarFormaDePerfil` directamente y no
// `cargarPerfiles`, cuyo módulo arrastra `electron` y solo expone la API real dentro de Electron.
// =============================================================================

import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MAX_REGLAS_PERFIL } from '../../shared/reglasPerfil.ts'
import { validarFormaDePerfil } from './validar.ts'
import type { Perfil } from './types.ts'

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')
const CONFIG_REAL = path.join(RAIZ_REPO, 'config', 'profiles.json')

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

interface ResultadoComprobacion {
  name: string
  pass: boolean
  evidence: string
}
const results: ResultadoComprobacion[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}

function main(): void {
  // --- CASO (a): la semilla config/profiles.json, un perfil neutro con dos agentes ---
  hr('CASO (a) - semilla config/profiles.json: perfiles válidos, «personal» trae 2 agentes')
  const crudo = readFileSync(CONFIG_REAL, 'utf-8')
  const analizado: unknown = JSON.parse(crudo)
  const elementos = Array.isArray(analizado) ? analizado : []
  const erroresPorPerfil = elementos.map((elemento) => validarFormaDePerfil(elemento))
  const todosValidos = erroresPorPerfil.every((errs) => errs.length === 0)
  check(
    '(a.1) todos los perfiles de profiles.json son válidos según validarFormaDePerfil',
    Array.isArray(analizado) && elementos.length > 0 && todosValidos,
    `perfiles=${elementos.length} ; errores=${JSON.stringify(erroresPorPerfil.filter((e) => e.length > 0))}`
  )

  const personal = elementos.find((elemento) => (elemento as Perfil).id === 'personal') as Perfil | undefined
  const tiposPersonal = personal?.agentes.map((a) => a.tipo).sort() ?? []
  const dirsConfigUnicos = new Set(personal?.agentes.map((a) => a.configDir)).size === personal?.agentes.length
  check(
    '(a.2) «personal» tiene agentes claude-code + codex con configDir distintos',
    personal !== undefined &&
      tiposPersonal.length === 2 &&
      tiposPersonal[0] === 'claude-code' &&
      tiposPersonal[1] === 'codex' &&
      dirsConfigUnicos,
    `personal.agentes=${JSON.stringify(personal?.agentes)}`
  )

  // La semilla se publica con la app: un único perfil, sin rutas de ningún equipo.
  const sinRutasDeEquipo = elementos.every((elemento) => (elemento as Perfil).sshDir === undefined)
  check(
    '(a.3) la semilla trae un único perfil y ninguno declara sshDir',
    elementos.length === 1 && sinRutasDeEquipo,
    `ids=${JSON.stringify(elementos.map((elemento) => (elemento as Perfil).id))}`
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
  const erroresSinAgentes = validarFormaDePerfil(sinAgentes)
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
  const erroresDuplicado = validarFormaDePerfil(duplicado)
  check(
    "(c) perfil con dos agentes 'claude-code' es rechazado con un error claro",
    erroresDuplicado.some((e) => e.includes('duplicado')),
    `errores=${JSON.stringify(erroresDuplicado)}`
  )

  // --- CASO (d): reglas del perfil: opcionales, con tope -------------------------
  hr('CASO (d) - "reglas" opcional: válida, vacía, en el tope, demasiado larga o de otro tipo')
  const conReglas = (reglas: unknown): unknown => ({ ...duplicado, agentes: [{ tipo: 'claude-code', configDir: './a' }], reglas })
  check('(d.1) un texto de reglas es válido', validarFormaDePerfil(conReglas('Sube siempre a la rama de trabajo.')).length === 0, '')
  check('(d.2) en el tope exacto es válido', validarFormaDePerfil(conReglas('x'.repeat(MAX_REGLAS_PERFIL))).length === 0, '')
  const largas = validarFormaDePerfil(conReglas('x'.repeat(MAX_REGLAS_PERFIL + 1)))
  check('(d.3) pasado el tope se rechaza con un error claro', largas.some((e) => e.includes('reglas')), `errores=${JSON.stringify(largas)}`)
  const noTexto = validarFormaDePerfil(conReglas(42))
  check('(d.4) que no sea texto se rechaza', noTexto.some((e) => e.includes('reglas')), `errores=${JSON.stringify(noTexto)}`)

  // --- CASO (e): el id no se sale de las carpetas del perfil ----------------------
  hr('CASO (e) - "id": nombra carpetas, así que no puede cambiar la ruta')
  const conId = (id: string): unknown => ({ ...(conReglas(undefined) as object), id })
  const malos = ['../fuera', 'a/b', 'a\\b', 'C:x', '..', '.', 'a\u0000b']
  const rechazados = malos.filter((id) => validarFormaDePerfil(conId(id)).some((e) => e.includes('"id"')))
  check('(e.1) los ids que cambian la ruta se rechazan', rechazados.length === malos.length, `rechazados=${JSON.stringify(rechazados)}`)
  const buenos = ['personal', 'trabajo-2', 'Equipo_A', 'v1.2']
  check('(e.2) los ids normales siguen valiendo', buenos.every((id) => validarFormaDePerfil(conId(id)).length === 0), '')

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
