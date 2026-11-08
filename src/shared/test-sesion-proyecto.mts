#!/usr/bin/env node
// =============================================================================
// Prueba del saneado de la sesión de cada proyecto (node src/shared/test-sesion-proyecto.mts): solo rutas
// relativas que no salen del proyecto, sin repetidas y con topes; la activa y la terminal activa dentro de su
// lista; una sesión sin nada no se guarda; y `normalizeWorkspaceState` se queda solo con las de los proyectos
// abiertos, sin tocar las pestañas ni los ajustes.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md
// =============================================================================

import {
  MAX_CARPETAS_GUARDADAS,
  MAX_PESTANAS_GUARDADAS,
  MAX_TERMINALES_GUARDADAS,
  normalizarSesion,
  normalizarSesiones,
  rutaRelativaValida
} from './sesionProyecto.ts'
import { normalizeWorkspaceState } from './workspace-state-ipc.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence = ''): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` -> ${evidence}` : ''}`)
}

function main(): void {
  hr('(1) Rutas que se pueden pedir sin salir del proyecto')
  for (const ok of ['src/app.ts', 'LEEME.md', 'a/b/c d/é.txt']) check(`válida: ${ok}`, rutaRelativaValida(ok))
  for (const mal of ['', '/etc/passwd', '../fuera.txt', 'src/../../x', 'C:/Windows/x', 'c:x', 'src\\app.ts', 'a//b', 'a/', 'nul\0l', 'x'.repeat(1025), 42, null]) {
    check(`descartada: ${JSON.stringify(typeof mal === 'string' && mal.length > 40 ? `${mal.slice(0, 10)}…` : mal)}`, !rutaRelativaValida(mal))
  }

  hr('(2) Una sesión saneada')
  const s = normalizarSesion({
    pestanas: [
      { ruta: 'a.ts', modo: 'dividida', linea: 12, columna: 4 },
      { ruta: '../fuera.ts' },
      { ruta: 'a.ts', linea: 99 },
      { ruta: 'b.md', modo: 'raro', linea: 0, columna: 3 },
      'texto'
    ],
    activa: 'b.md',
    carpetas: ['src', 'src', '/abs', 'src/lib'],
    terminales: [{ nombre: '  Servidor  ' }, {}, { nombre: 5 }, null],
    terminalActiva: 1
  })
  check('quedan las pestañas válidas, sin la repetida', JSON.stringify(s?.pestanas.map((p) => p.ruta)) === '["a.ts","b.md"]', JSON.stringify(s?.pestanas))
  check('con su modo y su cursor', s?.pestanas[0].modo === 'dividida' && s.pestanas[0].linea === 12 && s.pestanas[0].columna === 4)
  const segunda = s?.pestanas[1]
  check('un modo desconocido o una línea 0 se descartan', segunda?.ruta === 'b.md' && segunda.modo === undefined && segunda.linea === undefined && segunda.columna === undefined)
  check('la activa existe', s?.activa === 'b.md')
  check('carpetas válidas y sin repetir', JSON.stringify(s?.carpetas) === '["src","src/lib"]', JSON.stringify(s?.carpetas))
  check('terminales con el nombre recortado; las inválidas fuera', JSON.stringify(s?.terminales) === '[{"nombre":"Servidor"},{},{}]', JSON.stringify(s?.terminales))
  check('la terminal activa se conserva', s?.terminalActiva === 1)

  const fueraDeLista = normalizarSesion({ pestanas: [{ ruta: 'a.ts' }], activa: 'otro.ts', terminales: [{}], terminalActiva: 7 })
  check('una activa que no está en la lista cae a null', fueraDeLista?.activa === null)
  check('una terminal activa fuera de la lista cae a la primera', fueraDeLista?.terminalActiva === 0)
  check('sin nada que restaurar no se guarda', normalizarSesion({ pestanas: [], carpetas: [], terminales: [] }) === null && normalizarSesion('x') === null)

  const enorme = normalizarSesion({
    pestanas: Array.from({ length: 200 }, (_, i) => ({ ruta: `f${i}.ts` })),
    carpetas: Array.from({ length: 2000 }, (_, i) => `d${i}`),
    terminales: Array.from({ length: 40 }, () => ({}))
  })
  check(
    'los topes acotan lo que se restaura',
    enorme?.pestanas.length === MAX_PESTANAS_GUARDADAS && enorme.carpetas.length === MAX_CARPETAS_GUARDADAS && enorme.terminales.length === MAX_TERMINALES_GUARDADAS,
    `${enorme?.pestanas.length}/${enorme?.carpetas.length}/${enorme?.terminales.length}`
  )

  hr('(3) Solo las de los proyectos abiertos')
  const todas = { 'p|/a': { carpetas: ['x'] }, 'p|/b': { carpetas: ['y'] }, sinbarra: { carpetas: ['z'] } }
  const podadas = normalizarSesiones(todas, ['p|/a'])
  check('se queda la del proyecto abierto', JSON.stringify(Object.keys(podadas)) === '["p|/a"]', JSON.stringify(Object.keys(podadas)))
  check('sin lista de abiertos, todas las de clave válida', Object.keys(normalizarSesiones(todas, null)).length === 2)
  check('basura da un mapa vacío', JSON.stringify(normalizarSesiones([1, 2], null)) === '{}' && JSON.stringify(normalizarSesiones(null, null)) === '{}')

  const estado = normalizeWorkspaceState({
    version: 1,
    activeProfileId: 'p',
    byProfile: { p: { openProjects: [{ projectHostPath: '/a', name: 'a', estado: 'active' }], activePath: '/a' } },
    settings: { zoomLevel: 1 },
    sesiones: { 'p|/a': { pestanas: [{ ruta: 'src/x.ts' }] }, 'p|/cerrado': { pestanas: [{ ruta: 'y.ts' }] } }
  })
  check('el documento lleva las sesiones de los abiertos', JSON.stringify(Object.keys(estado?.sesiones ?? {})) === '["p|/a"]', JSON.stringify(estado?.sesiones))
  check('sin tocar las pestañas ni los ajustes', estado?.byProfile.p.openProjects.length === 1 && estado.settings?.zoomLevel === 1)
  const sinSesiones = normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {} })
  check('un archivo sin sesiones (de una versión anterior) da un mapa vacío', JSON.stringify(sinSesiones?.sesiones) === '{}')

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
