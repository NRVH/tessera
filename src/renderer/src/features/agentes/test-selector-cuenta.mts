// =============================================================================
// Prueba del selector de cuenta del agente (npm run test:selector-cuenta): la cuenta del sistema
// cuando el agente puede correr nativo, las de Docker con la actual marcada (una sola), la actual
// aunque la lista vaya por detrás, y qué acciones admite cada una.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import type { AgentAccount } from '../../../../shared/agent-accounts-ipc.ts'
import { nombreVisible, vistaSelectorCuenta, type VistaSelectorCuenta } from './selectorCuenta.ts'

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

const cuenta = (id: string, nombre: string, isDefault = false): AgentAccount => ({ id, nombre, agente: 'codex', profileId: 'p', ...(isDefault ? { isDefault } : {}) })
/** `nativa*` si es la actual; cada cuenta con `*` si es la actual y sus acciones (`s` cerrar sesión, `e` eliminar). */
const forma = (v: VistaSelectorCuenta): string =>
  [
    ...(v.nativa ? [`nativa${v.nativa.actual ? '*' : ''}`] : []),
    ...v.docker.map((f) => `${f.cuenta.nombre}${f.actual ? '*' : ''}[${f.puedeCerrarSesion ? 's' : ''}${f.puedeEliminar ? 'e' : ''}]`)
  ].join(' | ')

const pre = cuenta('d', 'Predeterminada', true)
const tr = cuenta('t', 'Trabajo')
const pe = cuenta('x', 'Personal')

hr('(1) cuentas de Docker')
const varias = forma(vistaSelectorCuenta([pre, tr, pe], tr))
check('todas, la actual marcada y cualquiera administrable; la predeterminada no se elimina', varias === 'Predeterminada[s] | Trabajo*[se] | Personal[se]', varias)
const atrasada = forma(vistaSelectorCuenta([pre], pe))
check('la actual sale aunque la lista aún no la traiga (recién creada)', atrasada === 'Predeterminada[s] | Personal*[se]', atrasada)
const renombrables = vistaSelectorCuenta([pre, tr, pe], tr).docker.filter((f) => f.puedeRenombrar).map((f) => f.cuenta.nombre).join()
check('NEGATIVO: se renombran las creadas, no la predeterminada', renombrables === 'Trabajo,Personal', renombrables)
check('NEGATIVO: solo una marcada', vistaSelectorCuenta([pre, tr, pe], tr).docker.filter((f) => f.actual).length === 1, 'ok')

hr('(2) agente manual')
const preM: AgentAccount = { id: 'manual', nombre: 'Predeterminada', agente: 'm-mio', profileId: 'p', isDefault: true }
const otraM: AgentAccount = { id: 'u1', nombre: 'Segunda', agente: 'm-mio', profileId: 'p' }
const manual = forma(vistaSelectorCuenta([preM, otraM], otraM))
check('NEGATIVO: un manual no ofrece cerrar sesión en ninguna; sí eliminar la creada', manual === 'Predeterminada[] | Segunda*[e]', manual)

hr('(3) la cuenta del sistema, en un agente que puede correr nativo')
const enDocker = forma(vistaSelectorCuenta([pre, tr], tr, 'disponible'))
check('en Docker: la del sistema sin marcar y la de Docker en uso marcada', enDocker === 'nativa | Predeterminada[s] | Trabajo*[se]', enDocker)
const enNativo = forma(vistaSelectorCuenta([pre, tr], null, 'actual'))
check('corriendo nativo: la marcada es la del sistema, ninguna de Docker, y todas se administran', enNativo === 'nativa* | Predeterminada[s] | Trabajo[se]', enNativo)
check('nativo y sin cuentas de Docker: solo la del sistema', forma(vistaSelectorCuenta([], null, 'actual')) === 'nativa*', 'ok')
check('sin ofrecerla (manuales, terminal), no sale', vistaSelectorCuenta([pre, tr], tr).nativa === null, 'ok')

hr('(4) nombre visible')
check('la predeterminada se enseña con el texto de la interfaz, no con el guardado', nombreVisible(pre, 'Default') === 'Default', nombreVisible(pre, 'Default'))
check('las creadas, con el nombre que les puso el usuario', nombreVisible(tr, 'Default') === 'Trabajo', 'ok')

hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
