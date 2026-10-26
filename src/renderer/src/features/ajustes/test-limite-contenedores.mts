// =============================================================================
// Prueba del deslizador del límite de contenedores (npm run test:limite-contenedores): de la posición
// de la barra al límite y al revés con «Sin límite» como último paso, las paradas del degradado y el
// cupo que viaja con la apertura, incluido el caso sin memoria y sin límite guardado.
// Decisiones: docs/decisiones/sandbox/limite-de-contenedores.md
// =============================================================================

import { SIN_LIMITE, cortesSemaforo } from '../../../../shared/semaforoContenedores.ts'
import {
  PASO_MINIMO,
  cupoDeApertura,
  degradadoPista,
  limiteDePaso,
  paradasDegradado,
  pasoDeLimite,
  pasoMaximo
} from './limiteContenedores.ts'

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
const c = cortesSemaforo(16 * GB)

function pasos(): void {
  hr('(1) posición de la barra y límite')
  check('el último paso es «Sin límite»', limiteDePaso(pasoMaximo(c), c) === SIN_LIMITE, `max=${pasoMaximo(c)} maximo=${c.maximo}`)
  check('el paso anterior al último es el máximo', limiteDePaso(c.maximo, c) === c.maximo, j(c))
  check('el primero es un contenedor', limiteDePaso(PASO_MINIMO, c) === 1, '')
  check('ida y vuelta de todos los pasos', Array.from({ length: pasoMaximo(c) }, (_, i) => i + 1).every((p) => pasoDeLimite(limiteDePaso(p, c), c) === p), '')
  check('SIN_LIMITE guardado cae en el último paso', pasoDeLimite(SIN_LIMITE, c) === pasoMaximo(c), '')
  check('un límite guardado por encima del máximo se recorta a él', pasoDeLimite(c.maximo + 40, c) === c.maximo, '')
  check('fuera de rango: se acota a ambos lados', limiteDePaso(-5, c) === 1 && limiteDePaso(999, c) === SIN_LIMITE, '')
}

function degradado(): void {
  hr('(2) degradado de la pista')
  const p = paradasDegradado(c)
  check('verde antes que amarillo y amarillo antes del final', p.verdeHasta > 0 && p.verdeHasta < p.amarilloHasta && p.amarilloHasta < 100, j(p))
  const css = degradadoPista(c)
  check('el degradado nombra los tres colores en orden', css.indexOf('--green') < css.indexOf('--yellow') && css.indexOf('--yellow') < css.indexOf('--red'), css)
  const mem = cortesSemaforo(0)
  check('sin memoria no se rompe: cortes de serie', mem.verdeHasta >= 1 && mem.maximo >= 8 && Number.isFinite(paradasDegradado(mem).verdeHasta), j(mem))
}

function cupo(): void {
  hr('(3) cupo de la apertura')
  const memoria = 16 * GB
  check('con límite guardado y memoria: el guardado', cupoDeApertura(3, memoria, 'primeros', false)?.limite === 3, '')
  check('con límite guardado y sin memoria: se manda igual', cupoDeApertura(3, null, 'ultimos', true)?.limite === 3, '')
  check('«Sin límite» guardado viaja como 0', cupoDeApertura(SIN_LIMITE, memoria, 'ultimos', true)?.limite === 0, '')
  check('sin guardado y con memoria: el recomendado', cupoDeApertura(undefined, memoria, 'ultimos', true)?.limite === c.verdeHasta, j(c))
  check('sin guardado y sin memoria: ningún cupo', cupoDeApertura(undefined, null, 'ultimos', true) === undefined, '')
  const v = cupoDeApertura(2, memoria, 'inactivos', false)
  check('lleva la política tal cual', v?.primero === 'inactivos' && v.protegerTrabajando === false, j(v))
}

pasos()
degradado()
cupo()

const total = results.length
const ok = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${ok}/${total} PASS`)
process.exit(ok === total ? 0 : 1)
