// =============================================================================
// Prueba de la constancia de las paradas (npm run test:registro-paradas): sobrevive al reinicio, la
// más reciente primero, el tope, las líneas rotas y un archivo que no se puede escribir.
// Decisiones: docs/decisiones/sandbox/saturacion-de-docker.md
// =============================================================================

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConstanciaParada } from '../../../shared/agent-terminal-ipc.ts'
import { MAX_CONSTANCIAS, RegistroParadas } from './registroParadas.ts'

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

const constancia = (en: number, motivo: ConstanciaParada['motivo'] = 'saturacion'): ConstanciaParada => ({
  en,
  motivo,
  proyectos: [{ profileId: 'p', projectHostPath: '/proyectos/demo', agentes: ['codex'] }],
  primero: 'ultimos',
  protegerTrabajando: true,
  ...(motivo === 'saturacion' ? { porcentaje: 94, umbralPct: 90 } : { limite: 4 })
})

const dir = mkdtempSync(join(tmpdir(), 'tessera-registro-paradas-'))
try {
  hr('(1) persistencia y orden')
  const ruta = join(dir, 'logs', 'paradas.jsonl')
  const r = new RegistroParadas(ruta)
  check('sin archivo aún, vacío', r.leer().length === 0, 'ok')
  r.anotar(constancia(1, 'limite'))
  r.anotar(constancia(2))
  check('la más reciente primero', r.leer().map((c) => c.en).join() === '2,1', r.leer().map((c) => c.en).join())
  const otro = new RegistroParadas(ruta)
  check('otro proceso (el reinicio) lee lo mismo, con sus campos', otro.leer().map((c) => c.en).join() === '2,1' && otro.leer()[1].limite === 4 && otro.leer()[0].porcentaje === 94, JSON.stringify(otro.leer()[0]))

  hr('(2) líneas rotas')
  writeFileSync(ruta, readFileSync(ruta, 'utf8') + 'esto no es json\n{"en":"x"}\n{"en":5,"motivo":"otro","proyectos":[]}\n')
  const tolerante = new RegistroParadas(ruta)
  check('NEGATIVO: una línea rota o con forma ajena se salta sin perder las buenas', tolerante.leer().map((c) => c.en).join() === '2,1', tolerante.leer().map((c) => c.en).join())

  hr('(3) tope')
  const lleno = new RegistroParadas(join(dir, 'lleno.jsonl'))
  for (let i = 0; i < MAX_CONSTANCIAS + 15; i++) lleno.anotar(constancia(i))
  const releido = new RegistroParadas(join(dir, 'lleno.jsonl')).leer()
  check(
    `se quedan las ${MAX_CONSTANCIAS} últimas, también en el archivo`,
    lleno.leer().length === MAX_CONSTANCIAS && releido.length === MAX_CONSTANCIAS && releido[0].en === MAX_CONSTANCIAS + 14 && releido[MAX_CONSTANCIAS - 1].en === 15,
    `${releido.length} ${releido[0]?.en} ${releido.at(-1)?.en}`
  )

  hr('(4) sin poder escribir')
  const avisos: string[] = []
  // Una carpeta donde va el archivo: escribir falla.
  const bloqueado = new RegistroParadas(dir, (m) => avisos.push(m))
  bloqueado.anotar(constancia(7))
  check('NEGATIVO: un fallo al escribir no lanza, se queda en memoria y se dice en el log', bloqueado.leer()[0]?.en === 7 && avisos.length === 1, avisos.join(' | '))
  const memoria = new RegistroParadas(null)
  memoria.anotar(constancia(9))
  check('sin ruta, solo en memoria', memoria.leer()[0]?.en === 9, 'ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
