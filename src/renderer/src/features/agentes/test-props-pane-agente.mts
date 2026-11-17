#!/usr/bin/env node
// =============================================================================
// Prueba de mismasPropsPane (node src/renderer/src/features/agentes/test-props-pane-agente.mts):
// el comparador con el que el pane del agente se salta el render. Fija que solo perdona
// lo que la columna rehace sin cambiar (`target` y `versionesAgente`) y que cualquier
// otra prop distinta, también una que se añada mañana, vuelve a pintar el pane. Y qué estado
// reporta el pane al punto del perfil (`estadoParaElPunto`).
// Decisiones: docs/decisiones/agentes/pane-del-agente-sin-re-render.md
// =============================================================================

import { estadoParaElPunto, mismasPropsPane, type PropsPaneTerminalAgente } from './tiposPaneAgente.ts'

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

const onSeleccionarCuenta = (): void => {}
const onAlternarExpandir = (): void => {}
const onCambioEstado = (): void => {}
const agentes: PropsPaneTerminalAgente['pestanasAgente'] = [
  { id: 'claude-code', nombre: 'Claude Code', corta: 'CC', manual: null },
  { id: 'codex', nombre: 'Codex', corta: 'Cdx', manual: null }
]
const montadas: string[] = []

const destino = (clave = 'alfa|C:\\p\\alfa|claude-code'): PropsPaneTerminalAgente['target'] => ({
  profileId: 'alfa',
  projectHostPath: 'C:\\p\\alfa',
  agente: 'claude-code',
  key: clave
})

/** Las props de un pane oculto, como las da la columna fuera del mosaico. */
function props(cambios: Partial<PropsPaneTerminalAgente> = {}): PropsPaneTerminalAgente {
  return {
    target: destino(),
    modoNativo: true,
    visible: false,
    enPantalla: false,
    mostrado: undefined,
    robaFoco: true,
    tokenFoco: 0,
    enMosaico: false,
    celda: null,
    mosaico: null,
    hibernado: false,
    nombrePerfil: 'Alfa',
    colorAcento: '#61afef',
    pestanasAgente: agentes,
    basesMontadas: montadas,
    basesListas: true,
    lugar: 'proyecto',
    cuentaSeleccionadaId: null,
    onSeleccionarCuenta,
    puedeExpandir: false,
    expandido: false,
    onAlternarExpandir,
    onCambioEstado,
    versionesAgente: { lanzada: '2.1.0', instalada: '2.1.0' },
    ...cambios
  }
}
const igual = (a: PropsPaneTerminalAgente, b: PropsPaneTerminalAgente): boolean => mismasPropsPane(a, b)

hr('(1) Lo que la columna rehace sin que cambie NO repinta')
{
  check('las mismas props (otro objeto): iguales', igual(props(), props()), 'true')
  check('`target` nuevo con la misma clave: iguales', igual(props(), props({ target: destino() })), 'true')
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
  check('otra clave de target: distintas', !igual(props(), props({ target: destino('alfa|C:\\p\\beta|claude-code') })), 'false')
  check('pasa a visible (el cambio de perfil): distintas', !igual(props(), props({ visible: true })), 'false')
  check('otra versión instalada: distintas', !igual(props(), props({ versionesAgente: { lanzada: '2.1.0', instalada: '2.2.0' } })), 'false')
  check('de sin versiones a con versiones: distintas', !igual(props({ versionesAgente: null }), props()), 'false')
  check('otro handler: distintas', !igual(props(), props({ onCambioEstado: () => {} })), 'false')
  check('otra lista de bases con el mismo contenido: distintas', !igual(props(), props({ basesMontadas: [] })), 'false')
  check('otra lista de agentes con el mismo contenido: distintas', !igual(props(), props({ pestanasAgente: agentes?.map((x) => ({ ...x })) })), 'false')
  check('se hiberna: distintas', !igual(props(), props({ hibernado: true })), 'false')
  check('entra al mosaico (objeto `mosaico` nuevo): distintas', !igual(props(), props({ mosaico: {} as PropsPaneTerminalAgente['mosaico'] })), 'false')
  check('otro token de foco: distintas', !igual(props(), props({ tokenFoco: 1 })), 'false')
}

hr('(3) Recorre la UNIÓN de claves: una prop nueva no queda rancia')
{
  const conNueva = { ...props(), propDeManana: 1 } as PropsPaneTerminalAgente
  const conNuevaDistinta = { ...props(), propDeManana: 2 } as PropsPaneTerminalAgente
  check('prop desconocida con el mismo valor: iguales', igual(conNueva, { ...conNueva }), 'true')
  check('prop desconocida distinta: distintas', !igual(conNueva, conNuevaDistinta), 'false')
  check('prop que solo está en las nuevas: distintas', !igual(props(), conNueva), 'false')
  check('prop que solo estaba en las viejas: distintas', !igual(conNueva, props()), 'false')
  const sinOpcional = props()
  delete sinOpcional.mostrado
  check('opcional ausente frente a `undefined` explícito: iguales', igual(sinOpcional, props()) && igual(props(), sinOpcional), 'true')
}

hr('(4) Lo que el pane reporta al punto del perfil')
{
  const mirado = { sinCuenta: false, seEstaMirando: true, abriendo: false, recuperando: false }
  const oculto = { ...mirado, seEstaMirando: false }
  check("arrancando y mirado: 'booting' (el punto gira)", estadoParaElPunto('booting', mirado) === 'booting', estadoParaElPunto('booting', mirado))
  check(
    "'booting' de un pane que no se mira y sin apertura: no gira (nadie lo abrirá hasta volver a él)",
    estadoParaElPunto('booting', oculto) === 'exited',
    estadoParaElPunto('booting', oculto)
  )
  check(
    'una apertura en vuelo sigue girando aunque se deje de mirar (despertar y cambiar de perfil)',
    estadoParaElPunto('booting', { ...oculto, abriendo: true }) === 'booting',
    estadoParaElPunto('booting', { ...oculto, abriendo: true })
  )
  check(
    'recuperando el contenedor sin mirarse: sigue girando',
    estadoParaElPunto('booting', { ...oculto, recuperando: true }) === 'booting',
    estadoParaElPunto('booting', { ...oculto, recuperando: true })
  )
  check('sin cuenta: nada arranca', estadoParaElPunto('booting', { ...mirado, sinCuenta: true }) === 'exited', 'exited')
  check("viva y oculta: sigue 'live'", estadoParaElPunto('live', oculto) === 'live', estadoParaElPunto('live', oculto))
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
