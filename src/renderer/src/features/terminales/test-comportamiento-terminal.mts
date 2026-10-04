#!/usr/bin/env node
// =============================================================================
// Prueba de las decisiones compartidas de las terminales:
// (node src/renderer/src/features/terminales/test-comportamiento-terminal.mts)
// `laAppUsaElRaton` (todos los modos de xterm), `debeAbrirMenuContextual` (incluida la
// puerta de Mayús, sin la cual quedaba un clic muerto) y `estaAlFondo` (caso normal,
// vista subida, buffer alterno y desfase de un reflow).
// =============================================================================

import {
  debeAbrirMenuContextual,
  estaAlFondo,
  laAppUsaElRaton,
  type ModoRaton
} from './comportamientoTerminal.ts'

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

hr('(1) Quién manda en el ratón')
{
  check('sin modo (terminal recién creada) -> nuestro', !laAppUsaElRaton(undefined), 'false')
  check("'none' -> nuestro", !laAppUsaElRaton('none'), 'false')
  // Los cuatro modos de seguimiento cuentan igual: en todos, xterm reenvía el clic.
  const conRaton: ModoRaton[] = ['x10', 'vt200', 'drag', 'any']
  check(
    'x10 / vt200 / drag / any -> de la aplicación',
    conRaton.every((m) => laAppUsaElRaton(m)),
    conRaton.join(', ')
  )
}

hr('(2) El menú contextual')
{
  check('Codex (sin seguimiento): SÍ sale el menú', debeAbrirMenuContextual('none'), 'true')
  check(
    'shell de abajo con una app que usa el ratón: NO sale, el clic es suyo',
    !debeAbrirMenuContextual('vt200'),
    'false'
  )
  // Antes de que la sesión abra no hay app que reclame nada: el menú es nuestro.
  check('terminal aún sin sesión: SÍ sale', debeAbrirMenuContextual(undefined), 'true')

  // SHIFT MANDA, y esto NO es un adorno: xterm no reenvía el clic cuando hay Shift
  // (`shouldForceSelection` = `e.shiftKey`), así que sin esta puerta un Shift+clic
  // derecho no llegaba ni al CLI ni a nosotros — un clic muerto, y el pane del
  // agente sin ninguna vía de ratón para copiar o pegar.
  check(
    'Shift+clic derecho abre el menú aunque la app use el ratón',
    debeAbrirMenuContextual('any', true),
    'true'
  )
  check(
    'y sigue abriéndolo cuando el ratón ya era nuestro',
    debeAbrirMenuContextual('none', true),
    'true'
  )
  check(
    'sin Shift, con seguimiento, sigue sin salir',
    !debeAbrirMenuContextual('any', false),
    'false'
  )

}

hr('(2b) Quién pega en un clic derecho del pane del agente')
{
  // ES `laAppUsaElRaton` QUIEN LO DECIDE, no `debeAbrirMenuContextual`, y por eso se
  // comprueba aquí directamente: el pane consulta esa función. Aserciones sobre la
  // otra pasarían igual el día que alguien la cambiara, mientras la decisión del
  // pegado se iría por su lado sin que nadie se enterase.
  //
  // Con seguimiento encendido, el clic le llega al CLI y PEGA ÉL. Medido en la app:
  // pegando también el pane, un solo clic dejaba el texto DOS VECES en el cuadro de
  // entrada de Claude Code, con un único evento `contextmenu` de por medio.
  check(
    'Claude Code (seguimiento ON): pega el CLI, el pane se aparta',
    laAppUsaElRaton('any') && laAppUsaElRaton('vt200'),
    'true en x10/vt200/drag/any'
  )
  // Codex no lo enciende: el clic no llega a nadie y el que tiene que pegar es el pane.
  check('Codex (sin seguimiento): pega el pane', !laAppUsaElRaton('none'), 'false')
  // Antes de que abra la sesión no hay app que reclame el ratón: pega el pane.
  check('sin sesión todavía: pega el pane', !laAppUsaElRaton(undefined), 'false')
}

hr('(3) Anclaje al fondo')
{
  check(
    'escribiendo al final: está al fondo',
    estaAlFondo({ viewportY: 1200, baseY: 1200 }),
    '1200 >= 1200'
  )
  check(
    'subido a leer: NO está al fondo (no se le mueve la vista)',
    !estaAlFondo({ viewportY: 40, baseY: 1200 }),
    '40 < 1200'
  )
  check(
    'buffer alterno (Claude Code, sin scrollback): siempre al fondo',
    estaAlFondo({ viewportY: 0, baseY: 0 }),
    '0 >= 0'
  )
  // El caso que obliga al `>=`: durante un reflow el viewport puede adelantarse.
  check(
    'desfase transitorio de un reflow: sigue contando como fondo',
    estaAlFondo({ viewportY: 1201, baseY: 1200 }),
    '1201 >= 1200'
  )
}

hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const allPass = results.every((r) => r.pass)
hr(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
