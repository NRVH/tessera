// =============================================================================
// Prueba del registro de panes con cuenta (npm run test:retiro-de-cuentas): cuántos otros panes
// usan una cuenta, los avisos de retiro y renombre a todos menos al que los da, y el borrado al desmontar.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { avisarRenombre, avisarRetiro, otrosQueUsan, registrarPaneConCuenta, type PaneConCuenta, type RetiroCuenta } from './retiroDeCuentas.ts'

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

/** Un pane falso con la cuenta que tiene abierta y lo que le avisaron. */
function pane(abierta: string | null): PaneConCuenta & { avisos: string[] } {
  const avisos: string[] = []
  return {
    avisos,
    usa: (id) => id === abierta,
    alRetirar: (id: string, motivo: RetiroCuenta) => avisos.push(`${id}:${motivo}`),
    alRenombrar: (id: string) => avisos.push(`${id}:renombrada`)
  }
}

const a = pane('trabajo')
const b = pane('trabajo')
const c = pane('personal')
const quitarA = registrarPaneConCuenta(a)
const quitarB = registrarPaneConCuenta(b)
const quitarC = registrarPaneConCuenta(c)

hr('(1) quién más usa la cuenta')
check('desde a, otro pane usa «trabajo»', otrosQueUsan('trabajo', a) === 1, String(otrosQueUsan('trabajo', a)))
check('NEGATIVO: el propio pane no cuenta', otrosQueUsan('personal', c) === 0, String(otrosQueUsan('personal', c)))
check('desde un pane ajeno, «personal» la usa uno', otrosQueUsan('personal', a) === 1, String(otrosQueUsan('personal', a)))

hr('(2) aviso de retiro')
avisarRetiro('trabajo', 'eliminada', a)
check('los demás reciben el aviso', b.avisos.join() === 'trabajo:eliminada' && c.avisos.join() === 'trabajo:eliminada', `${b.avisos} / ${c.avisos}`)
check('NEGATIVO: el que la retira no se avisa a sí mismo', a.avisos.length === 0, a.avisos.join())

hr('(3) renombrar')
avisarRenombre('trabajo', b)
check('el renombre llega a los demás, no al que renombra', a.avisos.join() === 'trabajo:renombrada' && b.avisos.length === 1, `${a.avisos} / ${b.avisos}`)

hr('(4) desmontar')
quitarB()
avisarRetiro('trabajo', 'logout', a)
check('NEGATIVO: un pane desmontado ya no recibe avisos ni cuenta', b.avisos.length === 1 && otrosQueUsan('trabajo', a) === 0, `${b.avisos.length}`)
quitarA()
quitarC()

hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
