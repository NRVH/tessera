// =============================================================================
// Prueba del semáforo y del cupo de contenedores (npm run test:semaforo-contenedores): los cortes
// por memoria, el color de cada límite, el límite por defecto, si hay cupo y qué contenedor se para
// para hacer sitio con cada política, con las mitades negativas (el excluido, los protegidos).
// Decisiones: docs/decisiones/sandbox/limite-de-contenedores.md
// =============================================================================

import {
  SIN_LIMITE,
  colorDe,
  cortesSemaforo,
  elegirAParar,
  hayCupo,
  limiteEfectivo,
  normalizarCupo,
  type ContenedorCandidato
} from './semaforoContenedores.ts'

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
const j = (v: unknown): string => JSON.stringify(v)
const GB = 1024 ** 3

function cortes(): void {
  hr('(1) cortes por memoria')
  const c32 = cortesSemaforo(32 * GB)
  check('32 GB: verde hasta 14, amarillo hasta 28', c32.verdeHasta === 14 && c32.amarilloHasta === 28 && c32.maximo > 28, j(c32))
  const c8 = cortesSemaforo(8 * GB)
  check('8 GB: verde hasta 3, amarillo hasta 7', c8.verdeHasta === 3 && c8.amarilloHasta === 7, j(c8))
  const c2 = cortesSemaforo(2 * GB)
  check('2 GB: al menos 2 verdes (la terminal y un agente) y el amarillo por encima', c2.verdeHasta === 2 && c2.amarilloHasta >= 3, j(c2))
  const c0 = cortesSemaforo(Number.NaN)
  check('sin memoria conocida no rompe: 2 verdes y una barra usable', c0.verdeHasta === 2 && c0.maximo >= 8, j(c0))
  const crece = [4, 8, 16, 32, 64].map((g) => cortesSemaforo(g * GB))
  check(
    'más memoria nunca da menos cupo',
    crece.every((c, i) => i === 0 || (c.verdeHasta >= crece[i - 1].verdeHasta && c.amarilloHasta >= crece[i - 1].amarilloHasta)),
    j(crece.map((c) => [c.verdeHasta, c.amarilloHasta]))
  )
}

function colores(): void {
  hr('(2) color, límite por defecto y cupo')
  const c = cortesSemaforo(8 * GB)
  check('1..3 verde, 4..7 amarillo, 8+ rojo', [1, 3].every((n) => colorDe(n, c) === 'verde') && [4, 7].every((n) => colorDe(n, c) === 'amarillo') && colorDe(8, c) === 'rojo', 'ok')
  check('«Sin límite» es rojo', colorDe(SIN_LIMITE, c) === 'rojo', 'ok')
  check('sin ajuste guardado, el recomendado (el último verde)', limiteEfectivo(undefined, c) === c.verdeHasta, `${limiteEfectivo(undefined, c)}`)
  check('NEGATIVO: un valor roto vuelve al recomendado', limiteEfectivo(-3, c) === c.verdeHasta && limiteEfectivo(2.5, c) === c.verdeHasta, 'ok')
  check('el guardado manda, también «Sin límite»', limiteEfectivo(20, c) === 20 && limiteEfectivo(SIN_LIMITE, c) === SIN_LIMITE, 'ok')
  check('cupo: 4 vivos con límite 5 sí, con 4 no; sin límite siempre', hayCupo(4, 5) && !hayCupo(4, 4) && hayCupo(999, SIN_LIMITE), 'ok')
}

const cont = (id: string, abiertoEn: number | null, ultimaActividad: number | null, trabajando = false, protegido = false): ContenedorCandidato => ({
  id,
  abiertoEn,
  ultimaActividad,
  trabajando,
  protegido
})

function eleccion(): void {
  hr('(3) qué se para para hacer sitio')
  const lista = [cont('viejo', 100, 900), cont('medio', 200, 300), cont('nuevo', 300, 800)]
  check('«los últimos abiertos»: el más nuevo', elegirAParar(lista, { primero: 'ultimos', protegerTrabajando: true }, 'x') === 'nuevo', 'ok')
  check('«los primeros»: el más viejo', elegirAParar(lista, { primero: 'primeros', protegerTrabajando: true }, 'x') === 'viejo', 'ok')
  check('«los inactivos»: el de actividad más antigua', elegirAParar(lista, { primero: 'inactivos', protegerTrabajando: true }, 'x') === 'medio', 'ok')
  const conVacio = [...lista, cont('vacio', null, null)]
  check('primero uno sin agentes, sea cual sea la política', ['ultimos', 'primeros', 'inactivos'].every((p) => elegirAParar(conVacio, { primero: p as 'ultimos', protegerTrabajando: true }, 'x') === 'vacio'), 'ok')
  check('NEGATIVO: nunca el que se está abriendo', elegirAParar(lista, { primero: 'ultimos', protegerTrabajando: true }, 'nuevo') === 'medio', 'ok')
  const trabajando = [cont('a', 100, 900, true), cont('b', 200, 300)]
  check('con protección, el que trabaja no se toca', elegirAParar(trabajando, { primero: 'primeros', protegerTrabajando: true }, 'x') === 'b', 'ok')
  check('sin protección, también puede tocarle', elegirAParar(trabajando, { primero: 'primeros', protegerTrabajando: false }, 'x') === 'a', 'ok')
  const todosTrabajando = [cont('a', 100, 900, true), cont('b', 200, 300, true)]
  check('todos trabajando y protegidos: ninguno (la apertura se rechaza)', elegirAParar(todosTrabajando, { primero: 'ultimos', protegerTrabajando: true }, 'x') === null, 'ok')
  check(
    'NEGATIVO: un protegido (agente manual) nunca, ni vacío ni sin protección',
    elegirAParar([cont('m', null, null, false, true), cont('m2', 100, 100, false, true)], { primero: 'ultimos', protegerTrabajando: false }, 'x') === null,
    'ok'
  )
  check('empate: decide el id, para que sea estable', elegirAParar([cont('b', 100, 1), cont('a', 100, 1)], { primero: 'ultimos', protegerTrabajando: true }, 'x') === 'a', 'ok')
}

function lectura(): void {
  hr('(4) lectura de los ajustes')
  const sano = normalizarCupo({ limiteContenedores: 6, primeroEnPararse: 'inactivos', protegerTrabajando: false })
  check('lo que vale se conserva', j(sano) === j({ limiteContenedores: 6, primeroEnPararse: 'inactivos', protegerTrabajando: false }), j(sano))
  const roto = normalizarCupo({ limiteContenedores: -1, primeroEnPararse: 'otra', protegerTrabajando: 'si' })
  check('NEGATIVO: lo roto vuelve al de serie y el límite desaparece (el recomendado)', roto.limiteContenedores === undefined && roto.primeroEnPararse === 'ultimos' && roto.protegerTrabajando === true, j(roto))
  check('«Sin límite» (0) se conserva', normalizarCupo({ limiteContenedores: 0 }).limiteContenedores === 0, 'ok')
}

cortes()
colores()
eleccion()
lectura()
hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
