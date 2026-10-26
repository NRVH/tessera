// =============================================================================
// Prueba de las constancias de parada en texto (npm run test:constancias-paradas): el motivo por
// límite y por saturación, qué se paró (carpeta y agentes, agente manual, contenedor sin agentes),
// la regla aplicada y el orden y tope de la lista.
// Decisiones: docs/decisiones/sandbox/limite-de-contenedores.md
// =============================================================================

import type { ConstanciaParada } from '../../../../shared/agent-terminal-ipc.ts'
import { MAX_PARADAS, filaDeConstancia, masRecientes, nombreDeCarpeta } from './constanciasParadas.ts'

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

const base: ConstanciaParada = {
  en: Date.UTC(2026, 0, 5, 12, 0, 0),
  motivo: 'limite',
  proyectos: [{ profileId: 'p1', projectHostPath: 'C:\\trabajo\\tienda-demo', agentes: ['claude-code', 'codex'] }],
  primero: 'ultimos',
  protegerTrabajando: true,
  limite: 4
}

function motivos(): void {
  hr('(1) motivo')
  check('límite: dice cuántos contenedores', filaDeConstancia(base, 'es-ES').motivo === 'Límite de 4 contenedores', filaDeConstancia(base, 'es-ES').motivo)
  check('límite de 1: singular', filaDeConstancia({ ...base, limite: 1 }, 'es-ES').motivo === 'Límite de 1 contenedor', '')
  const sat = filaDeConstancia({ ...base, motivo: 'saturacion', porcentaje: 93, umbralPct: 90 }, 'es-ES')
  check('saturación: porcentaje y umbral', sat.motivo === 'Docker al 93 % (umbral 90 %)', sat.motivo)
  check('NEGATIVO: saturación sin cifras no inventa números', filaDeConstancia({ ...base, motivo: 'saturacion' }, 'es-ES').motivo === 'Docker saturado', '')
  check('NEGATIVO: límite sin cifra no inventa números', filaDeConstancia({ ...base, limite: undefined }, 'es-ES').motivo === 'Límite de contenedores', '')
}

function queSeParo(): void {
  hr('(2) qué se paró')
  check('carpeta y agentes con su nombre', filaDeConstancia(base, 'es-ES').que === 'tienda-demo (Claude Code, Codex)', filaDeConstancia(base, 'es-ES').que)
  const manual = filaDeConstancia({ ...base, proyectos: [{ profileId: 'p1', projectHostPath: '/home/ana/api-demo/', agentes: ['m-abc'] }] }, 'es-ES')
  check('ruta POSIX con barra final y agente manual tal cual', manual.que === 'api-demo (m-abc)', manual.que)
  const varios = filaDeConstancia(
    { ...base, proyectos: [base.proyectos[0], { profileId: 'p2', projectHostPath: 'D:\\otro', agentes: ['codex'] }] },
    'es-ES'
  )
  check('varios proyectos separados por punto y coma', varios.que === 'tienda-demo (Claude Code, Codex); otro (Codex)', varios.que)
  check('sin proyectos: contenedor sin agentes', filaDeConstancia({ ...base, proyectos: [] }, 'es-ES').que === 'un contenedor sin agentes', '')
  check('proyecto sin agentes: solo la carpeta', filaDeConstancia({ ...base, proyectos: [{ profileId: 'p1', projectHostPath: 'C:\\a\\b', agentes: [] }] }, 'es-ES').que === 'b', '')
  check('nombre de carpeta de una ruta rara', nombreDeCarpeta('\\\\') === '\\\\' && nombreDeCarpeta('C:\\') === 'C:', `${nombreDeCarpeta('\\\\')} ${nombreDeCarpeta('C:\\')}`)
}

function regla(): void {
  hr('(3) regla y fecha')
  check(
    'primero y protección',
    filaDeConstancia(base, 'es-ES').regla === 'Los últimos que abriste, protegiendo a los que trabajan',
    filaDeConstancia(base, 'es-ES').regla
  )
  check(
    'sin protección',
    filaDeConstancia({ ...base, primero: 'inactivos', protegerTrabajando: false }, 'es-ES').regla === 'Los que llevan más tiempo sin uso, sin proteger a los que trabajan',
    ''
  )
  const f = filaDeConstancia(base, 'en-US').cuando
  check('la fecha sale en el idioma pedido', f === new Date(base.en).toLocaleString('en-US'), f)
}

function lista(): void {
  hr('(4) orden y tope')
  const muchas = Array.from({ length: 25 }, (_, i) => ({ ...base, en: base.en + i * 1000 }))
  const barajadas = [...muchas].reverse().sort((a, b) => (a.en % 3) - (b.en % 3))
  const r = masRecientes(barajadas)
  check('como mucho el tope', r.length === MAX_PARADAS, String(r.length))
  check('la más reciente primero', r[0].en === muchas[24].en && r.every((c, i) => i === 0 || r[i - 1].en > c.en), j(r.slice(0, 3).map((c) => c.en)))
  check('no toca la lista de entrada', barajadas.length === 25, '')
  check('vacía', masRecientes([]).length === 0, '')
}

motivos()
queSeParo()
regla()
lista()

const total = results.length
const ok = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${ok}/${total} PASS`)
process.exit(ok === total ? 0 : 1)
