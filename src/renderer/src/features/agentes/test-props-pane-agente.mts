#!/usr/bin/env node
// =============================================================================
// Prueba de mismasPropsPane (node src/renderer/src/features/agentes/test-props-pane-agente.mts):
// el comparador con el que el pane del agente se salta el render. Fija que solo perdona
// lo que la columna rehace sin cambiar (`target` y `versionesAgente`) y que cualquier
// otra prop distinta, también una que se añada mañana, vuelve a pintar el pane.
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import { mismasPropsPane, type AgentTerminalPaneProps } from './agentPaneTipos.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const onSelectAccount = (): void => {}
const onToggleExpand = (): void => {}
const onStatusChange = (): void => {}
const agentes: AgentTerminalPaneProps['agentsInProfile'] = ['claude-code', 'codex']
const montadas: string[] = []

const target = (key = 'alfa|C:\\p\\alfa|claude-code'): AgentTerminalPaneProps['target'] => ({
  profileId: 'alfa',
  projectHostPath: 'C:\\p\\alfa',
  agente: 'claude-code',
  key
})

/** Las props de un pane oculto, como las da la columna fuera del mosaico. */
function props(cambios: Partial<AgentTerminalPaneProps> = {}): AgentTerminalPaneProps {
  return {
    target: target(),
    hostMode: true,
    visible: false,
    enPantalla: false,
    mostrado: undefined,
    robaFoco: true,
    tokenFoco: 0,
    enMosaico: false,
    celda: null,
    mosaico: null,
    hibernated: false,
    profileName: 'Alfa',
    accentColor: '#61afef',
    agentsInProfile: agentes,
    dbMounted: montadas,
    dbReady: true,
    esEspacioDeDatos: false,
    selectedAccountId: null,
    onSelectAccount,
    canExpand: false,
    expanded: false,
    onToggleExpand,
    onStatusChange,
    versionesAgente: { lanzada: '2.1.0', instalada: '2.1.0' },
    ...cambios
  }
}
const igual = (a: AgentTerminalPaneProps, b: AgentTerminalPaneProps): boolean => mismasPropsPane(a, b)

hr('(1) Lo que la columna rehace sin que cambie NO repinta')
{
  check('las mismas props (otro objeto): iguales', igual(props(), props()), 'true')
  check('`target` nuevo con la misma clave: iguales', igual(props(), props({ target: target() })), 'true')
  check(
    '`versionesAgente` nuevo con las mismas versiones: iguales',
    igual(props(), props({ versionesAgente: { lanzada: '2.1.0', instalada: '2.1.0' } })),
    'true'
  )
  check('versiones null y null: iguales', igual(props({ versionesAgente: null }), props({ versionesAgente: null })), 'true')
  check('versiones null y ausente: iguales', igual(props({ versionesAgente: null }), props({ versionesAgente: undefined })), 'true')
}

hr('(2) Lo que SÍ cambia repinta')
{
  check('otra clave de target: distintas', !igual(props(), props({ target: target('alfa|C:\\p\\beta|claude-code') })), 'false')
  check('pasa a visible (el cambio de perfil): distintas', !igual(props(), props({ visible: true })), 'false')
  check('otra versión instalada: distintas', !igual(props(), props({ versionesAgente: { lanzada: '2.1.0', instalada: '2.2.0' } })), 'false')
  check('de sin versiones a con versiones: distintas', !igual(props({ versionesAgente: null }), props()), 'false')
  check('otro handler: distintas', !igual(props(), props({ onStatusChange: () => {} })), 'false')
  check('otra lista de bases con el mismo contenido: distintas', !igual(props(), props({ dbMounted: [] })), 'false')
  check('otra lista de agentes con el mismo contenido: distintas', !igual(props(), props({ agentsInProfile: ['claude-code', 'codex'] })), 'false')
  check('se hiberna: distintas', !igual(props(), props({ hibernated: true })), 'false')
  check('entra al mosaico (objeto `mosaico` nuevo): distintas', !igual(props(), props({ mosaico: {} as AgentTerminalPaneProps['mosaico'] })), 'false')
  check('otro token de foco: distintas', !igual(props(), props({ tokenFoco: 1 })), 'false')
}

hr('(3) Recorre la UNIÓN de claves: una prop nueva no queda rancia')
{
  const conNueva = { ...props(), propDeManana: 1 } as AgentTerminalPaneProps
  const conNuevaDistinta = { ...props(), propDeManana: 2 } as AgentTerminalPaneProps
  check('prop desconocida con el mismo valor: iguales', igual(conNueva, { ...conNueva }), 'true')
  check('prop desconocida distinta: distintas', !igual(conNueva, conNuevaDistinta), 'false')
  check('prop que solo está en las nuevas: distintas', !igual(props(), conNueva), 'false')
  check('prop que solo estaba en las viejas: distintas', !igual(conNueva, props()), 'false')
  const sinOpcional = props()
  delete sinOpcional.mostrado
  check('opcional ausente frente a `undefined` explícito: iguales', igual(sinOpcional, props()) && igual(props(), sinOpcional), 'true')
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
