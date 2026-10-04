#!/usr/bin/env node
// =============================================================================
// Prueba de atajos (node src/renderer/src/util/test-atajos.mts): qué tecla cuenta en cada sistema.
// Puro, sin DOM ni React: la plataforma se pasa siempre explícita, así que el valor por defecto
// (`window.tessera`) nunca se evalúa. Depende de `atajos.ts`, cuyo único import es de tipo.
// Fija el modificador exclusivo de cada plataforma, los gestos con tecla propia (borrar, detener,
// abrir nodo), los acordes de la consola y de bases de datos, y que las etiquetas que se enseñan
// coinciden con los predicados. Cada caso lleva sus mitades negativas: lo que NO debe hacerlo.
// Decisiones: docs/decisiones/renderer/atajos-por-plataforma.md
// =============================================================================

import {
  ACORDES,
  accionMosaico,
  esAbrirNodo,
  esAlternarAgente,
  esAtajoBorrado,
  esBorrarPestanaEnfocada,
  esCerrarPestana,
  esCtrlLiteral,
  esDetener,
  esExplicar,
  esFormatear,
  esHistorial,
  esModPrincipal,
  etiquetaAbrirNodo,
  etiquetaAcorde,
  etiquetaModPrincipal,
  etiquetasAcorde,
  type Acorde,
  type AcordePorPlataforma,
  type IdAcorde,
  type ModificadoresEvento,
  type Modificador,
  type TeclaAcorde
} from './atajos.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'

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

/** Atajos para escribir los cuatro estados de modificadores sin ruido. */
const nada = { ctrlKey: false, metaKey: false }
const ctrl = { ctrlKey: true, metaKey: false }
const cmd = { ctrlKey: false, metaKey: true }
const ambos = { ctrlKey: true, metaKey: true }

/**
 * La forma del `IKeyboardEvent` de Monaco en lo que aquí importa: campos
 * `readonly`, `keyCode` numérico y `code`, sin `key`. Si `ModificadoresEvento`
 * exigiera algo que Monaco no da, esta asignación no compilaría.
 */
interface EventoMonaco {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly keyCode: number
  readonly code: string
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Windows: manda Ctrl')
  // -------------------------------------------------------------------------
  check('(1a) Ctrl sí', esModPrincipal(ctrl, 'windows'), 'true')
  check('(1b) sin modificador, no', !esModPrincipal(nada, 'windows'), 'false')
  // El bug del `||`: la tecla Windows dispararía los atajos de la app.
  check('(1c) la tecla ⊞ (Meta) NO cuenta como Ctrl', !esModPrincipal(cmd, 'windows'), 'false')
  check('(1d) Ctrl+⊞ es otro acorde, no cuenta', !esModPrincipal(ambos, 'windows'), 'false')

  // -------------------------------------------------------------------------
  hr('(2) macOS: manda Cmd')
  // -------------------------------------------------------------------------
  check('(2a) Cmd sí', esModPrincipal(cmd, 'mac'), 'true')
  check('(2b) sin modificador, no', !esModPrincipal(nada, 'mac'), 'false')
  // El bug del `||` en la otra dirección: robarle a macOS Ctrl+A / Ctrl+E / Ctrl+K,
  // que son edición de línea del sistema y funcionan en cualquier campo de texto; y
  // en las terminales, robarle al pty Ctrl+C (SIGINT), Ctrl+F y Ctrl+V.
  check('(2c) Ctrl NO cuenta como Cmd', !esModPrincipal(ctrl, 'mac'), 'false')
  check('(2d) Ctrl+Cmd es otro acorde, no cuenta', !esModPrincipal(ambos, 'mac'), 'false')

  // -------------------------------------------------------------------------
  hr('(3) Linux / otras: se comportan como Windows (Ctrl)')
  // -------------------------------------------------------------------------
  check('(3a) Ctrl sí', esModPrincipal(ctrl, 'otra'), 'true')
  check('(3b) Meta no', !esModPrincipal(cmd, 'otra'), 'false')

  // -------------------------------------------------------------------------
  hr('(4) esCtrlLiteral: la excepción Ctrl+` (terminal), Control en LAS DOS')
  // -------------------------------------------------------------------------
  // Ctrl+` es Control también en macOS: Cmd+` se lo queda el gestor de ventanas del sistema.
  check('(4a) Ctrl sí', esCtrlLiteral(ctrl), 'true')
  check('(4b) Cmd no', !esCtrlLiteral(cmd), 'false')
  check('(4c) Ctrl+Cmd no', !esCtrlLiteral(ambos), 'false')
  check('(4d) sin modificador, no', !esCtrlLiteral(nada), 'false')

  // -------------------------------------------------------------------------
  hr('(5) Las dos plataformas NUNCA aceptan el mismo evento')
  // -------------------------------------------------------------------------
  // Es la propiedad que garantiza que un atajo no se dispare dos veces ni se cuele
  // por la rama ajena. Si algún día alguien "simplifica" a `ctrl || meta`, este caso
  // es el que se pone rojo.
  for (const [nombre, ev] of [
    ['Ctrl', ctrl],
    ['Cmd', cmd]
  ] as const) {
    check(
      `(5) ${nombre} lo acepta exactamente UNA de las dos plataformas`,
      esModPrincipal(ev, 'windows') !== esModPrincipal(ev, 'mac'),
      `win=${esModPrincipal(ev, 'windows')} mac=${esModPrincipal(ev, 'mac')}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(6) Los eventos reales encajan en ModificadoresEvento sin adaptador')
  // -------------------------------------------------------------------------
  // Monaco (`useMonacoDelPane.ts`): `readonly`, `keyCode` y sin `key`. 36 es KeyCode.KeyF.
  const cmdFMonaco: EventoMonaco = {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: true,
    keyCode: 36,
    code: 'KeyF'
  }
  check(
    '(6a) IKeyboardEvent de Monaco (readonly + keyCode): Cmd+F en Mac',
    esModPrincipal(cmdFMonaco, 'mac') && !esModPrincipal(cmdFMonaco, 'windows'),
    `mac=${esModPrincipal(cmdFMonaco, 'mac')} win=${esModPrincipal(cmdFMonaco, 'windows')}`
  )
  // Un objeto congelado: `readonly` de verdad en tiempo de ejecución, no sólo en el tipo.
  const congelado: Readonly<ModificadoresEvento> = Object.freeze({ ctrlKey: true, metaKey: false })
  check(
    '(6b) un evento congelado (Object.freeze) se lee sin problema',
    esModPrincipal(congelado, 'windows') && esCtrlLiteral(congelado),
    'win=true, ctrlLiteral=true'
  )
  // La forma de `TeclaAtajo` (features/git/modelo/atajoCopiarHash.ts) y del sintético de React: más
  // campos de los que hacen falta. TS lo admite por tipado estructural.
  const reactLike = { key: 'c', code: 'KeyC', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false }
  check(
    '(6c) un evento con más campos (React / TeclaAtajo) encaja tal cual',
    esModPrincipal(reactLike, 'windows') && !esModPrincipal(reactLike, 'mac'),
    `win=${esModPrincipal(reactLike, 'windows')} mac=${esModPrincipal(reactLike, 'mac')}`
  )

  // -------------------------------------------------------------------------
  hr('(7) Bajo node no hay `window`: el valor por defecto no se evalúa si se pasa la plataforma')
  // -------------------------------------------------------------------------
  const sinWindow = typeof window === 'undefined'
  let respondio = false
  let error = ''
  try {
    respondio = esModPrincipal(ctrl, 'windows')
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  check(
    '(7) sin `window` global y con plataforma explícita, responde sin tocar el default',
    sinWindow && respondio && error === '',
    `typeof window=${typeof window}, respuesta=${respondio}${error ? `, error=${error}` : ''}`
  )

  // -------------------------------------------------------------------------
  hr('(8) etiquetaModPrincipal: lo que se enseña es lo que se pulsa')
  // -------------------------------------------------------------------------
  check('(8a) macOS → ⌘', etiquetaModPrincipal('mac') === '⌘', etiquetaModPrincipal('mac'))
  check('(8b) Windows → Ctrl', etiquetaModPrincipal('windows') === 'Ctrl', etiquetaModPrincipal('windows'))
  check("(8c) 'otra' (Linux) → Ctrl, como Windows", etiquetaModPrincipal('otra') === 'Ctrl', etiquetaModPrincipal('otra'))
  // La propiedad que importa: la etiqueta nombra la tecla que `esModPrincipal` acepta
  // en ESA plataforma. Si alguien cambia una sin la otra, esto se pone rojo.
  for (const p of ['windows', 'mac', 'otra'] as const) {
    const etiqueta = etiquetaModPrincipal(p)
    const teclaAceptada = esModPrincipal(cmd, p) ? '⌘' : esModPrincipal(ctrl, p) ? 'Ctrl' : '(ninguna)'
    check(
      `(8d) [${p}] la etiqueta (${etiqueta}) es la tecla que esModPrincipal acepta (${teclaAceptada})`,
      etiqueta === teclaAceptada,
      `etiqueta=${etiqueta} aceptada=${teclaAceptada}`
    )
  }
  check(
    '(8e) bajo `node`, con plataforma explícita, no toca `window`',
    typeof window === 'undefined' && etiquetaModPrincipal('mac') === '⌘',
    `typeof window=${typeof window}`
  )

  hr('9. esAtajoBorrado: LAS DOS PLATAFORMAS NO COMPARTEN LA TECLA')

  // Windows borra con `Supr`; macOS con `⌘⌫`, que es el gesto del Finder y el de VS
  // Code (un ⌫ a secas no borra nada en el Finder). Por eso esto es una función con
  // la plataforma como parámetro y no un `key === 'Delete'` en el sitio de uso.
  const tecla = (
    key: string,
    mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}
  ): Parameters<typeof esAtajoBorrado>[0] => ({
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false
  })

  check(
    '(9a) [windows] Supr a secas borra',
    esAtajoBorrado(tecla('Delete'), 'windows'),
    'es la tecla del Explorador de Windows'
  )
  check(
    '(9b) [mac] ⌘⌫ borra — el gesto del Finder',
    esAtajoBorrado(tecla('Backspace', { metaKey: true }), 'mac'),
    'sin el ⌘ el Finder no borra: el modificador ES el gesto'
  )
  check(
    '(9c) [mac] ⌫ a secas también borra',
    esAtajoBorrado(tecla('Backspace'), 'mac'),
    'es el borrado habitual en los árboles de proyecto; no obligamos a recordar dos'
  )
  check(
    '(9d) [windows] Ctrl+Supr NO borra',
    !esAtajoBorrado(tecla('Delete', { ctrlKey: true }), 'windows'),
    'ese acorde no significa borrar en Windows: inventarlo sería un gesto destructivo de más'
  )
  check(
    '(9e) [mac] Ctrl+⌫ NO borra (el modificador de Mac es ⌘, no Ctrl)',
    !esAtajoBorrado(tecla('Backspace', { ctrlKey: true }), 'mac'),
    'misma regla que esModPrincipal: en Mac Ctrl no es el modificador principal'
  )
  for (const p of ['windows', 'mac'] as const) {
    check(
      `(9f) [${p}] Shift+Supr NO borra`,
      !esAtajoBorrado(tecla('Delete', { shiftKey: true }), p),
      'en el Explorador es «borrar sin papelera», que aquí no existe: mejor que no pase nada'
    )
    check(
      `(9g) [${p}] una tecla cualquiera no borra`,
      !esAtajoBorrado(tecla('a'), p) && !esAtajoBorrado(tecla('Enter'), p),
      'sólo Delete/Backspace'
    )
  }
  check(
    '(9h) bajo `node`, con plataforma explícita, no toca `window`',
    typeof window === 'undefined' && esAtajoBorrado(tecla('Backspace', { metaKey: true }), 'mac'),
    `typeof window=${typeof window}`
  )

  hr('9 bis. esBorrarPestanaEnfocada: cerrar la pestaña de resultado con el foco')

  check(
    '(9i) [windows] Supr a secas cierra',
    esBorrarPestanaEnfocada(tecla('Delete'), 'windows'),
    'el gesto de borrar de Windows'
  )
  check(
    '(9j) [mac] ⌘⌫ cierra',
    esBorrarPestanaEnfocada(tecla('Backspace', { metaKey: true }), 'mac'),
    'el gesto nativo de Mac; con un `key === Delete` en el sitio de uso no llegaba'
  )
  check(
    '(9k) [mac] Supr (fn+⌫) también cierra',
    esBorrarPestanaEnfocada(tecla('Delete'), 'mac'),
    'el ⌦ de un teclado completo de Mac llega como Delete'
  )
  for (const p of ['windows', 'mac'] as const) {
    check(
      `(9l) [${p}] ⌫ a secas NO cierra`,
      !esBorrarPestanaEnfocada(tecla('Backspace'), p),
      'un retroceso de más con el foco en la tira no debe llevarse un resultado'
    )
    check(
      `(9m) [${p}] Shift+Supr y Alt+Supr NO cierran`,
      !esBorrarPestanaEnfocada(tecla('Delete', { shiftKey: true }), p) &&
        !esBorrarPestanaEnfocada(tecla('Delete', { altKey: true }), p),
      'Shift y Alt anulan, como en esAtajoBorrado'
    )
  }
  check(
    '(9n) [windows] Ctrl+Supr y el ⊞+⌫ de Mac NO cierran',
    !esBorrarPestanaEnfocada(tecla('Delete', { ctrlKey: true }), 'windows') &&
      !esBorrarPestanaEnfocada(tecla('Backspace', { metaKey: true }), 'windows'),
    'en Windows el modificador no forma parte del gesto'
  )
  check(
    '(9o) [mac] Ctrl+⌫ NO cierra',
    !esBorrarPestanaEnfocada(tecla('Backspace', { ctrlKey: true }), 'mac'),
    'en Mac el modificador es ⌘'
  )

  hr('10. accionMosaico: los atajos del mosaico, con sus MITADES NEGATIVAS')

  // Estos acordes se escuchan en CAPTURA porque xterm se come varios (Ctrl+Shift+↩ sale
  // como CR y MANDA el prompt; Ctrl+3 sale como ESC e INTERRUMPE a Claude Code). Lo que
  // se fija aquí es qué acorde es cuál en cada plataforma y cuáles NO lo son.
  const ev = (
    key: string,
    code: string,
    mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {}
  ): Parameters<typeof accionMosaico>[0] => ({
    key,
    code,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    repeat: mods.repeat ?? false
  })
  const txt = (a: ReturnType<typeof accionMosaico>): string =>
    a === null ? 'null' : a.tipo === 'ir' ? `ir(${a.indice})` : a.tipo
  // (La autorrepetición devuelve `ignorar`: se prueba en 10g–10g3.)

  // Entrar/salir: vale DENTRO y FUERA del mosaico.
  for (const dentro of [false, true]) {
    const r = accionMosaico(ev('M', 'KeyM', { ctrlKey: true, shiftKey: true }), dentro, 'windows')
    check(`(10a) [windows] Ctrl+Shift+M alterna (dentro=${dentro})`, txt(r) === 'alternar', txt(r))
    const m = accionMosaico(ev('m', 'KeyM', { metaKey: true, shiftKey: true }), dentro, 'mac')
    check(`(10b) [mac] ⌘⇧M alterna (dentro=${dentro})`, txt(m) === 'alternar', txt(m))
  }
  check(
    '(10c) [windows] ⊞+Shift+M NO alterna (la tecla Windows no es Ctrl)',
    accionMosaico(ev('M', 'KeyM', { metaKey: true, shiftKey: true }), false, 'windows') === null,
    'mitad negativa'
  )
  check(
    '(10d) [mac] Ctrl+Shift+M NO alterna (en Mac Ctrl baja al pty)',
    accionMosaico(ev('M', 'KeyM', { ctrlKey: true, shiftKey: true }), false, 'mac') === null,
    'mitad negativa'
  )
  check(
    '(10e) Ctrl+M sin Shift NO alterna (es un CR en la terminal)',
    accionMosaico(ev('m', 'KeyM', { ctrlKey: true }), true, 'windows') === null,
    'null'
  )
  check(
    '(10f) con Alt (AltGr en Windows) no es el atajo',
    accionMosaico(ev('M', 'KeyM', { ctrlKey: true, shiftKey: true, altKey: true }), false, 'windows') === null,
    'null'
  )
  // La autorrepetición es del mosaico y se TRAGA (`ignorar`), no se deja pasar (`null`):
  // si pasara, el Ctrl+Shift+↩ mantenido llegaría a xterm, que lo convierte en CR y
  // MANDARÍA el prompt a medio escribir una vez por repetición.
  check(
    '(10g) la autorrepetición de Mod+Shift+M se traga sin alternar (haría parpadear la vista)',
    txt(accionMosaico(ev('M', 'KeyM', { ctrlKey: true, shiftKey: true, repeat: true }), false, 'windows')) === 'ignorar',
    txt(accionMosaico(ev('M', 'KeyM', { ctrlKey: true, shiftKey: true, repeat: true }), false, 'windows'))
  )
  for (const [p, mods] of [
    ['windows', { ctrlKey: true }],
    ['mac', { metaKey: true }]
  ] as const) {
    const r = accionMosaico(ev('Enter', 'Enter', { ...mods, shiftKey: true, repeat: true }), true, p)
    check(
      `(10g2) [${p}] Mod+Shift+Enter MANTENIDO dentro del mosaico se traga (ni amplía otra vez ni llega como CR al agente)`,
      txt(r) === 'ignorar',
      txt(r)
    )
  }
  check(
    '(10g3) FUERA del mosaico, Ctrl+Shift+Enter repetido no es nuestro (sigue su camino, como hoy)',
    accionMosaico(ev('Enter', 'Enter', { ctrlKey: true, shiftKey: true, repeat: true }), false, 'windows') === null,
    'null'
  )
  check(
    '(10h) en AZERTY la M se reconoce por su nombre, no por la tecla física KeyM (que allí es la coma)',
    txt(accionMosaico(ev('M', 'Semicolon', { ctrlKey: true, shiftKey: true }), false, 'windows')) === 'alternar' &&
      accionMosaico(ev('?', 'KeyM', { ctrlKey: true, shiftKey: true }), false, 'windows') === null,
    'key manda para las letras'
  )

  // Saltar a una casilla: SÓLO dentro del mosaico; fuera, Ctrl+3 sigue siendo lo que era.
  for (let i = 1; i <= 6; i++) {
    const w = accionMosaico(ev(String(i), `Digit${i}`, { ctrlKey: true }), true, 'windows')
    const m = accionMosaico(ev(String(i), `Digit${i}`, { metaKey: true }), true, 'mac')
    check(`(10i) Mod+${i} → casilla ${i - 1} en las dos`, txt(w) === `ir(${i - 1})` && txt(m) === `ir(${i - 1})`, `${txt(w)} / ${txt(m)}`)
  }
  check(
    '(10j) Ctrl+7 no es una casilla (el tope es 6)',
    accionMosaico(ev('7', 'Digit7', { ctrlKey: true }), true, 'windows') === null,
    'null'
  )
  check(
    '(10k) FUERA del mosaico Ctrl+3 no es nuestro: sigue bajando a la terminal como hoy',
    accionMosaico(ev('3', 'Digit3', { ctrlKey: true }), false, 'windows') === null,
    'null'
  )
  check(
    '(10l) [mac] Ctrl+3 NO salta (el modificador de Mac es ⌘)',
    accionMosaico(ev('3', 'Digit3', { ctrlKey: true }), true, 'mac') === null,
    'mitad negativa'
  )
  check(
    '(10m) en AZERTY la cifra se lee por `code`: Ctrl+& (Digit1) → casilla 0',
    txt(accionMosaico(ev('&', 'Digit1', { ctrlKey: true }), true, 'windows')) === 'ir(0)',
    'los dedos mandan en las cifras, no la distribución del teclado'
  )
  check(
    '(10n) Ctrl+Shift+1 no salta (es otro acorde)',
    accionMosaico(ev('!', 'Digit1', { ctrlKey: true, shiftKey: true }), true, 'windows') === null,
    'null'
  )

  // Ampliar: SÓLO dentro del mosaico.
  check(
    '(10o) [windows] Ctrl+Shift+Enter amplía dentro del mosaico',
    txt(accionMosaico(ev('Enter', 'Enter', { ctrlKey: true, shiftKey: true }), true, 'windows')) === 'ampliar',
    'ampliar'
  )
  check(
    '(10p) [mac] ⌘⇧↩ amplía dentro del mosaico',
    txt(accionMosaico(ev('Enter', 'Enter', { metaKey: true, shiftKey: true }), true, 'mac')) === 'ampliar',
    'ampliar'
  )
  check(
    '(10q) fuera del mosaico Ctrl+Shift+Enter no es nuestro',
    accionMosaico(ev('Enter', 'Enter', { ctrlKey: true, shiftKey: true }), false, 'windows') === null,
    'null'
  )
  check(
    '(10r) [mac] Ctrl+Shift+Enter NO amplía',
    accionMosaico(ev('Enter', 'Enter', { ctrlKey: true, shiftKey: true }), true, 'mac') === null,
    'mitad negativa'
  )
  // La propiedad de la sección 5, para los acordes del mosaico: ningún evento lo
  // aceptan las dos plataformas a la vez.
  for (const [nombre, e] of [
    ['Ctrl+Shift+M', ev('M', 'KeyM', { ctrlKey: true, shiftKey: true })],
    ['⌘⇧M', ev('M', 'KeyM', { metaKey: true, shiftKey: true })],
    ['Ctrl+2', ev('2', 'Digit2', { ctrlKey: true })],
    ['⌘2', ev('2', 'Digit2', { metaKey: true })],
    ['Ctrl+Shift+Enter', ev('Enter', 'Enter', { ctrlKey: true, shiftKey: true })],
    ['⌘⇧↩', ev('Enter', 'Enter', { metaKey: true, shiftKey: true })]
  ] as const) {
    const w = accionMosaico(e, true, 'windows')
    const m = accionMosaico(e, true, 'mac')
    check(`(10s) ${nombre} lo acepta exactamente UNA plataforma`, (w === null) !== (m === null), `win=${txt(w)} mac=${txt(m)}`)
  }

  // Un evento de teclado completo para los atajos del área de bases de datos.
  type ModsAcorde = Partial<{
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
    altGraph: boolean
  }>
  const tk = (key: string, code: string, mods: ModsAcorde = {}): TeclaAcorde => ({
    key,
    code,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altGraph: mods.altGraph ?? false
  })
  const PLATAFORMAS: readonly Plataforma[] = ['windows', 'mac', 'otra']

  hr('11. esCerrarPestana: Ctrl+W / ⌘W, con sus MITADES NEGATIVAS')

  check('(11a) [windows] Ctrl+W cierra', esCerrarPestana(tk('w', 'KeyW', { ctrlKey: true }), 'windows'), 'true')
  check("(11b) [otra] Ctrl+W cierra, como Windows", esCerrarPestana(tk('w', 'KeyW', { ctrlKey: true }), 'otra'), 'true')
  check('(11c) [mac] ⌘W cierra', esCerrarPestana(tk('w', 'KeyW', { metaKey: true }), 'mac'), 'true')
  check(
    '(11d) [mac] ⌃W NO cierra (es de readline: borrar la palabra anterior en el pty)',
    !esCerrarPestana(tk('w', 'KeyW', { ctrlKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(11e) [windows] ⊞+W NO cierra (abre los widgets del sistema)',
    !esCerrarPestana(tk('w', 'KeyW', { metaKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(11f) [windows] Ctrl+Shift+W NO cierra (es «cerrar la ventana» en navegadores y editores)',
    !esCerrarPestana(tk('W', 'KeyW', { ctrlKey: true, shiftKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(11g) [mac] ⌘⇧W NO cierra',
    !esCerrarPestana(tk('W', 'KeyW', { metaKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(11h) [windows] AltGr+W (llega como Ctrl+Alt) NO cierra',
    !esCerrarPestana(tk('w', 'KeyW', { ctrlKey: true, altKey: true, altGraph: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(11i) [mac] ⌥⌘W NO cierra (en el Finder cierra TODAS las ventanas)',
    !esCerrarPestana(tk('∑', 'KeyW', { metaKey: true, altKey: true }), 'mac'),
    'mitad negativa'
  )
  check('(11j) W sola no cierra', !esCerrarPestana(tk('w', 'KeyW'), 'windows') && !esCerrarPestana(tk('w', 'KeyW'), 'mac'), 'false')
  check(
    '(11k) con Bloq Mayús (key «W» sin Shift) sigue cerrando',
    esCerrarPestana(tk('W', 'KeyW', { ctrlKey: true }), 'windows'),
    'la letra se compara sin caja'
  )
  check(
    '(11l) en cirílico (key «ц», tecla física KeyW) cierra en las dos: cae a la tecla física',
    esCerrarPestana(tk('ц', 'KeyW', { ctrlKey: true }), 'windows') && esCerrarPestana(tk('ц', 'KeyW', { metaKey: true }), 'mac'),
    'una letra de otro alfabeto no puede nombrar nunca la W'
  )
  check(
    '(11m) en Dvorak la tecla física KeyW escribe «,»: Ctrl+, NO cierra (es Configuración)',
    !esCerrarPestana(tk(',', 'KeyW', { ctrlKey: true }), 'windows'),
    'por eso se descartó el `key || code` del copiar-hash: el mismo acorde haría dos cosas'
  )
  check(
    '(11n) en AZERTY manda la tecla rotulada: key «w» (física KeyZ) cierra; key «z» (física KeyW) no',
    esCerrarPestana(tk('w', 'KeyZ', { ctrlKey: true }), 'windows') && !esCerrarPestana(tk('z', 'KeyW', { ctrlKey: true }), 'windows'),
    'letras por su nombre'
  )
  check(
    '(11o) una letra no latina sobre una tecla física que no es letra no cae a nada',
    !esCerrarPestana(tk('ñ', 'Semicolon', { ctrlKey: true }), 'windows'),
    'false'
  )

  hr('12. esAlternarAgente: Ctrl+Alt+B / ⌥⌘B, LEÍDO POR `code`')

  check('(12a) [windows] Ctrl+Alt+B alterna', esAlternarAgente(tk('b', 'KeyB', { ctrlKey: true, altKey: true }), 'windows'), 'true')
  check('(12b) [otra] Ctrl+Alt+B alterna', esAlternarAgente(tk('b', 'KeyB', { ctrlKey: true, altKey: true }), 'otra'), 'true')
  check(
    '(12c) [mac] ⌥⌘B alterna AUNQUE llegue con key «∫» (⌥ compone): por eso se lee `code`',
    esAlternarAgente(tk('∫', 'KeyB', { metaKey: true, altKey: true }), 'mac'),
    'un `key === "b"` no lo vería nunca'
  )
  check(
    '(12d) [mac] y si llega con key «b», también',
    esAlternarAgente(tk('b', 'KeyB', { metaKey: true, altKey: true }), 'mac'),
    'true'
  )
  check(
    '(12e) la tecla física manda: key «b» sobre KeyN (la B rotulada de Dvorak) NO alterna',
    !esAlternarAgente(tk('b', 'KeyN', { ctrlKey: true, altKey: true }), 'windows') &&
      !esAlternarAgente(tk('b', 'KeyN', { metaKey: true, altKey: true }), 'mac'),
    'el precio aceptado de leer por `code`, escrito en el JSDoc'
  )
  check('(12f) [mac] ⌃⌥B NO alterna', !esAlternarAgente(tk('∫', 'KeyB', { ctrlKey: true, altKey: true }), 'mac'), 'mitad negativa')
  check('(12g) [mac] ⌘B NO alterna (sin ⌥)', !esAlternarAgente(tk('b', 'KeyB', { metaKey: true }), 'mac'), 'mitad negativa')
  check('(12h) [mac] ⌥B NO alterna (sin ⌘)', !esAlternarAgente(tk('∫', 'KeyB', { altKey: true }), 'mac'), 'mitad negativa')
  check(
    '(12i) [mac] ⌥⇧⌘B y ⌃⌥⌘B NO alternan',
    !esAlternarAgente(tk('ı', 'KeyB', { metaKey: true, altKey: true, shiftKey: true }), 'mac') &&
      !esAlternarAgente(tk('∫', 'KeyB', { metaKey: true, altKey: true, ctrlKey: true }), 'mac'),
    'mitad negativa'
  )
  check('(12j) [windows] Ctrl+B NO alterna', !esAlternarAgente(tk('b', 'KeyB', { ctrlKey: true }), 'windows'), 'mitad negativa')
  check('(12k) [windows] Alt+B NO alterna', !esAlternarAgente(tk('b', 'KeyB', { altKey: true }), 'windows'), 'mitad negativa')
  check(
    '(12l) [windows] AltGr+B NO alterna (llega como Ctrl+Alt, con AltGraph marcado)',
    !esAlternarAgente(tk('b', 'KeyB', { ctrlKey: true, altKey: true, altGraph: true }), 'windows'),
    'mitad negativa: AltGr escribe, no alterna'
  )
  check(
    '(12m) [windows] Ctrl+Alt+Shift+B NO alterna',
    !esAlternarAgente(tk('B', 'KeyB', { ctrlKey: true, altKey: true, shiftKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(12n) [windows] ⊞ con Ctrl+Alt+B, o el acorde de Mac (⊞+Alt+B), NO alternan',
    !esAlternarAgente(tk('b', 'KeyB', { ctrlKey: true, altKey: true, metaKey: true }), 'windows') &&
      !esAlternarAgente(tk('b', 'KeyB', { metaKey: true, altKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(12o) [otra] AltGr de Linux (sin Ctrl ni Alt, sólo AltGraph) NO alterna',
    !esAlternarAgente(tk('”', 'KeyB', { altGraph: true }), 'otra'),
    'mitad negativa'
  )
  check(
    '(12p) [mac] AltGraph NO se mira: si el navegador marcara ⌥ como AltGraph, ⌥⌘B sigue vivo',
    esAlternarAgente(tk('∫', 'KeyB', { metaKey: true, altKey: true, altGraph: true }), 'mac'),
    'en Mac ⌥ no es AltGr'
  )

  hr('13. esAbrirNodo: Enter/F4 en las dos, ⌘↓ además en Mac')

  for (const p of PLATAFORMAS) {
    check(
      `(13a) [${p}] Enter y F4 sin modificadores abren`,
      esAbrirNodo(tk('Enter', 'Enter'), p) && esAbrirNodo(tk('F4', 'F4'), p),
      'true'
    )
    check(
      `(13b) [${p}] ni Alt+F4 (cierra la ventana) ni Ctrl/⌘+F4 abren`,
      !esAbrirNodo(tk('F4', 'F4', { altKey: true }), p) &&
        !esAbrirNodo(tk('F4', 'F4', { ctrlKey: true }), p) &&
        !esAbrirNodo(tk('F4', 'F4', { metaKey: true }), p),
      'con modificador no es «abrir»: haría dos cosas a la vez'
    )
    check(
      `(13c) [${p}] ni Shift+Enter ni Mod+Enter (Ejecutar en la consola) abren`,
      !esAbrirNodo(tk('Enter', 'Enter', { shiftKey: true }), p) &&
        !esAbrirNodo(tk('Enter', 'Enter', { ctrlKey: true }), p) &&
        !esAbrirNodo(tk('Enter', 'Enter', { metaKey: true }), p),
      'false'
    )
    check(`(13d) [${p}] ↓ a secas no abre (mueve la selección)`, !esAbrirNodo(tk('ArrowDown', 'ArrowDown'), p), 'false')
  }
  check('(13e) [mac] ⌘↓ abre (el «Abrir» del Finder)', esAbrirNodo(tk('ArrowDown', 'ArrowDown', { metaKey: true }), 'mac'), 'true')
  check(
    '(13f) [windows] Ctrl+↓ NO abre (en las listas mueve el foco sin mover la selección)',
    !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { ctrlKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(13g) [windows] ⊞+↓ NO abre (minimiza la ventana)',
    !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { metaKey: true }), 'windows'),
    'mitad negativa: el ⌘↓ de Mac no se cuela en Windows'
  )
  check(
    "(13h) [otra] ni Ctrl+↓ ni Meta+↓ abren, como en Windows",
    !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { ctrlKey: true }), 'otra') &&
      !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { metaKey: true }), 'otra'),
    'mitad negativa'
  )
  check('(13i) [mac] ⌃↓ NO abre (es Mission Control)', !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { ctrlKey: true }), 'mac'), 'mitad negativa')
  check(
    '(13j) [mac] ⌥↓ y ⌘⇧↓ NO abren',
    !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { altKey: true }), 'mac') &&
      !esAbrirNodo(tk('ArrowDown', 'ArrowDown', { metaKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )

  hr('14. esDetener: Ctrl+F2 / ⌘. — LA TECLA ES OTRA, no sólo el modificador')

  check('(14a) [windows] Ctrl+F2 detiene', esDetener(tk('F2', 'F2', { ctrlKey: true }), 'windows'), 'true')
  check("(14b) [otra] Ctrl+F2 detiene", esDetener(tk('F2', 'F2', { ctrlKey: true }), 'otra'), 'true')
  check('(14c) [mac] ⌘. detiene (el cancelar nativo)', esDetener(tk('.', 'Period', { metaKey: true }), 'mac'), 'true')
  check('(14d) [mac] ⌃. NO detiene', !esDetener(tk('.', 'Period', { ctrlKey: true }), 'mac'), 'mitad negativa')
  check(
    '(14e) [mac] ⌘F2 NO detiene: lo que se enseña es ⌘. (F2 exige fn en Mac)',
    !esDetener(tk('F2', 'F2', { metaKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(14f) [mac] en AZERTY el punto es ⇧; — ⌘⇧; con key «.» detiene',
    esDetener(tk('.', 'Comma', { metaKey: true, shiftKey: true }), 'mac'),
    'se tolera Shift porque se lee el carácter'
  )
  check(
    '(14g) [mac] en US ⌘⇧. da key «>» y NO detiene: tolerar Shift no abre acordes de más',
    !esDetener(tk('>', 'Period', { metaKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )
  check('(14h) [mac] ⌥⌘. NO detiene', !esDetener(tk('≥', 'Period', { metaKey: true, altKey: true }), 'mac'), 'mitad negativa')
  check('(14i) [windows] F2 a secas NO detiene (es renombrar)', !esDetener(tk('F2', 'F2'), 'windows'), 'mitad negativa')
  check(
    '(14j) [windows] Ctrl+Shift+F2, Ctrl+Alt+F2 y ⊞+F2 NO detienen',
    !esDetener(tk('F2', 'F2', { ctrlKey: true, shiftKey: true }), 'windows') &&
      !esDetener(tk('F2', 'F2', { ctrlKey: true, altKey: true }), 'windows') &&
      !esDetener(tk('F2', 'F2', { metaKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(14k) [windows] Ctrl+. NO detiene: el acorde de Mac no se cuela',
    !esDetener(tk('.', 'Period', { ctrlKey: true }), 'windows'),
    'mitad negativa'
  )

  hr('15. etiquetaAcorde: lo que se ENSEÑA, en el orden de cada sistema')

  // `Record<IdAcorde, …>`: si se añade un gesto a la tabla sin fijar aquí su texto,
  // el typecheck falla antes que el test.
  const ESPERADO: Record<IdAcorde, readonly [pc: string, mac: string]> = {
    cerrarPestana: ['Ctrl+W', '⌘W'],
    alternarAgente: ['Ctrl+Alt+B', '⌥⌘B'],
    abrirNodo: ['F4', 'F4'],
    detener: ['Ctrl+F2', '⌘.'],
    nuevaConsola: ['Ctrl+N', '⌘N'],
    copiar: ['Ctrl+C', '⌘C'],
    ejecutar: ['Ctrl+Enter', '⌘↩'],
    ejecutarTodo: ['Alt+X', '⌥X'],
    commit: ['Ctrl+Alt+Shift+K', '⌥⇧⌘K'],
    rollback: ['Ctrl+Alt+Shift+R', '⌥⇧⌘R'],
    explicar: ['Ctrl+Shift+E', '⇧⌘E'],
    historial: ['Ctrl+Shift+H', '⇧⌘H'],
    formatear: ['Ctrl+Alt+L', '⌥⌘L']
  }
  for (const id of Object.keys(ESPERADO) as IdAcorde[]) {
    const [pc, mac] = ESPERADO[id]
    const w = etiquetaAcorde(id, 'windows')
    const o = etiquetaAcorde(id, 'otra')
    const m = etiquetaAcorde(id, 'mac')
    check(`(15a) ${id}: «${pc}» / «${mac}» (y 'otra' como Windows)`, w === pc && o === pc && m === mac, `win=${w} otra=${o} mac=${m}`)
  }
  const todoW = etiquetasAcorde('ejecutarTodo', 'windows').join(' | ')
  const todoM = etiquetasAcorde('ejecutarTodo', 'mac').join(' | ')
  check(
    '(15b) etiquetasAcorde da también las alternativas, con la que se enseña primero',
    // ⇧⌘↩ y no ⌘⇧↩: el orden de Apple pone ⇧ antes que ⌘ (ver 15c).
    todoW === 'Alt+X | Ctrl+Shift+Enter' && todoM === '⌥X | ⇧⌘↩',
    `win=${todoW} mac=${todoM}`
  )
  // El orden no depende de cómo se escribió la fila: Windows = Ctrl, Alt, Shift;
  // Mac = ⌃ ⌥ ⇧ ⌘.
  const desordenado: AcordePorPlataforma = {
    pc: [{ mods: ['shift', 'alt', 'ctrl'], tecla: 'k' }],
    mac: [{ mods: ['meta', 'shift', 'ctrl', 'alt'], tecla: 'k' }]
  }
  const dW = etiquetaAcorde(desordenado, 'windows')
  const dM = etiquetaAcorde(desordenado, 'mac')
  check(
    '(15c) el orden de los modificadores es el del sistema, no el de la fila',
    dW === 'Ctrl+Alt+Shift+K' && dM === '⌃⌥⇧⌘K',
    `win=${dW} mac=${dM}`
  )
  for (const p of PLATAFORMAS) {
    const esperado = `${etiquetaModPrincipal(p)}${p === 'mac' ? '' : '+'}W`
    check(
      `(15d) [${p}] cerrar pestaña se enseña con el MISMO modificador que etiquetaModPrincipal`,
      etiquetaAcorde('cerrarPestana', p) === esperado,
      `${etiquetaAcorde('cerrarPestana', p)} vs ${esperado}`
    )
  }
  check(
    '(15e) etiquetaAbrirNodo: «doble clic o F4» en Windows y Linux',
    etiquetaAbrirNodo('windows') === 'doble clic o F4' && etiquetaAbrirNodo('otra') === 'doble clic o F4',
    `win=${etiquetaAbrirNodo('windows')} otra=${etiquetaAbrirNodo('otra')}`
  )
  check(
    '(15f) etiquetaAbrirNodo: «doble clic, F4 o ⌘↓» en Mac (la que se pulsa sin fn)',
    etiquetaAbrirNodo('mac') === 'doble clic, F4 o ⌘↓',
    etiquetaAbrirNodo('mac')
  )
  check(
    '(15g) bajo `node`, con plataforma explícita, las etiquetas no tocan `window`',
    typeof window === 'undefined' && etiquetaAcorde('detener', 'mac') === '⌘.',
    `typeof window=${typeof window}`
  )

  hr('16. LA TABLA Y LOS PREDICADOS SE CRUZAN: lo que se enseña es lo que se pulsa')

  // Un evento como el que produce pulsar ese acorde en un teclado US.
  const eventoDeAcorde = (a: Acorde): TeclaAcorde => {
    const tiene = (m: Modificador): boolean => a.mods.includes(m)
    const letra = /^[A-Z]$/.test(a.tecla)
    return tk(
      letra && !tiene('shift') ? a.tecla.toLowerCase() : a.tecla,
      letra ? `Key${a.tecla}` : a.tecla === '.' ? 'Period' : a.tecla,
      { ctrlKey: tiene('ctrl'), metaKey: tiene('meta'), altKey: tiene('alt'), shiftKey: tiene('shift') }
    )
  }
  const mismoAcorde = (a: Acorde, b: Acorde): boolean =>
    a.tecla === b.tecla && a.mods.length === b.mods.length && a.mods.every((m) => b.mods.includes(m))
  const describir = (a: Acorde): string => [...a.mods, a.tecla].join('+')
  const PREDICADOS: ReadonlyArray<readonly [IdAcorde, (e: TeclaAcorde, p: Plataforma) => boolean]> = [
    ['cerrarPestana', esCerrarPestana],
    ['alternarAgente', esAlternarAgente],
    ['abrirNodo', esAbrirNodo],
    ['detener', esDetener],
    ['explicar', esExplicar],
    ['historial', esHistorial],
    ['formatear', esFormatear]
  ]
  for (const [id, predicado] of PREDICADOS) {
    for (const p of PLATAFORMAS) {
      const propia = p === 'mac' ? ACORDES[id].mac : ACORDES[id].pc
      const ajena = p === 'mac' ? ACORDES[id].pc : ACORDES[id].mac
      for (const a of propia) {
        check(
          `(16a) [${p}] ${id}: lo que se enseña (${describir(a)}) lo acepta su predicado`,
          predicado(eventoDeAcorde(a), p),
          'true'
        )
      }
      for (const a of ajena) {
        if (propia.some((b) => mismoAcorde(a, b))) continue
        check(
          `(16b) [${p}] ${id}: el de la otra familia (${describir(a)}) NO se cuela`,
          !predicado(eventoDeAcorde(a), p),
          'mitad negativa'
        )
      }
    }
  }

  hr('17. Los eventos reales encajan en TeclaAcorde; AltGr se lee sin perder el `this`')

  // Como el `KeyboardEvent` del DOM: `getModifierState` es un MÉTODO que lee `this`. Si
  // el predicado lo llamara suelto, reventaría aquí.
  class EventoDom {
    key: string
    code: string
    ctrlKey = true
    metaKey = false
    altKey = true
    shiftKey = false
    estados: ReadonlySet<string>
    constructor(key: string, code: string, estados: readonly string[]) {
      this.key = key
      this.code = code
      this.estados = new Set(estados)
    }
    getModifierState(tecla: string): boolean {
      return this.estados.has(tecla)
    }
  }
  let conAltGr = true
  let sinAltGr = false
  let fallo = ''
  try {
    conAltGr = esAlternarAgente(new EventoDom('b', 'KeyB', ['Control', 'Alt', 'AltGraph']), 'windows')
    sinAltGr = esAlternarAgente(new EventoDom('b', 'KeyB', ['Control', 'Alt']), 'windows')
  } catch (e) {
    fallo = e instanceof Error ? e.message : String(e)
  }
  check(
    '(17a) un evento con getModifierState de verdad (método con `this`): AltGr anula, Ctrl+Alt no',
    fallo === '' && !conAltGr && sinAltGr,
    fallo ? `error=${fallo}` : `altGr=${conAltGr} ctrl+alt=${sinAltGr}`
  )
  // Como el sintético de React: `getModifierState` con una UNIÓN de literales por
  // parámetro, no `string`. Encaja porque `TeclaAcorde` lo declara como método.
  interface EventoReact {
    readonly key: string
    readonly code: string
    readonly ctrlKey: boolean
    readonly metaKey: boolean
    readonly altKey: boolean
    readonly shiftKey: boolean
    readonly repeat: boolean
    getModifierState(tecla: 'Alt' | 'AltGraph' | 'CapsLock' | 'Control' | 'Meta' | 'Shift'): boolean
  }
  const reactCmdW: EventoReact = {
    key: 'w',
    code: 'KeyW',
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    repeat: false,
    getModifierState: (t) => t === 'Meta'
  }
  check(
    '(17b) el sintético de React (getModifierState con unión de literales) encaja tal cual',
    esCerrarPestana(reactCmdW, 'mac') && !esCerrarPestana(reactCmdW, 'windows'),
    `mac=${esCerrarPestana(reactCmdW, 'mac')} win=${esCerrarPestana(reactCmdW, 'windows')}`
  )
  const repetido = { ...tk('b', 'KeyB', { ctrlKey: true, altKey: true }), repeat: true }
  check(
    '(17c) la autorrepetición NO la decide el predicado (la consume el llamador)',
    esAlternarAgente(repetido, 'windows'),
    'devolver false dejaría el acorde seguir hasta xterm, que lo haría bytes'
  )

  hr('18. esExplicar: Ctrl+Shift+E / ⌘⇧E, con sus MITADES NEGATIVAS')

  check('(18a) [windows] Ctrl+Shift+E explica', esExplicar(tk('E', 'KeyE', { ctrlKey: true, shiftKey: true }), 'windows'), 'true')
  check('(18b) [otra] Ctrl+Shift+E explica, como Windows', esExplicar(tk('E', 'KeyE', { ctrlKey: true, shiftKey: true }), 'otra'), 'true')
  check('(18c) [mac] ⌘⇧E explica (key en minúscula, como la da Chromium con ⌘)', esExplicar(tk('e', 'KeyE', { metaKey: true, shiftKey: true }), 'mac'), 'true')
  check(
    '(18d) [mac] ⌘E sin Shift NO explica: es «Find With Selection» de Monaco',
    !esExplicar(tk('e', 'KeyE', { metaKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(18e) [mac] ⌃⇧E NO explica: seleccionar hasta el final de línea (Emacs de macOS)',
    !esExplicar(tk('E', 'KeyE', { ctrlKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(18f) [windows] Ctrl+E, ⊞+Shift+E y Ctrl+Alt+Shift+E NO explican',
    !esExplicar(tk('e', 'KeyE', { ctrlKey: true }), 'windows') &&
      !esExplicar(tk('E', 'KeyE', { metaKey: true, shiftKey: true }), 'windows') &&
      !esExplicar(tk('E', 'KeyE', { ctrlKey: true, altKey: true, shiftKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(18g) [mac] ⌥⌘⇧E NO explica (⌥ compone)',
    !esExplicar(tk('´', 'KeyE', { metaKey: true, altKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(18h) la letra por su NOMBRE: en AZERTY/QWERTZ la E está donde dice la tecla',
    esExplicar(tk('E', 'KeyE', { ctrlKey: true, shiftKey: true }), 'windows') &&
      !esExplicar(tk('>', 'KeyE', { ctrlKey: true, shiftKey: true }), 'windows'),
    'Dvorak: la física KeyE escribe «.» (con Shift «>»), no explica'
  )

  hr('19. esHistorial: Ctrl+Shift+H / ⌘⇧H, con sus MITADES NEGATIVAS')

  check('(19a) [windows] Ctrl+Shift+H abre el historial', esHistorial(tk('H', 'KeyH', { ctrlKey: true, shiftKey: true }), 'windows'), 'true')
  check('(19b) [mac] ⌘⇧H abre el historial', esHistorial(tk('h', 'KeyH', { metaKey: true, shiftKey: true }), 'mac'), 'true')
  check(
    '(19c) [windows] Ctrl+H NO: es «Reemplazar» de Monaco',
    !esHistorial(tk('h', 'KeyH', { ctrlKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(19d) [mac] ⌥⌘H NO: es «Ocultar otros» del menú de aplicación',
    !esHistorial(tk('˙', 'KeyH', { metaKey: true, altKey: true }), 'mac') &&
      !esHistorial(tk('Ó', 'KeyH', { metaKey: true, altKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(19e) [mac] ⌃⇧H NO (Ctrl no cuenta en Mac)',
    !esHistorial(tk('H', 'KeyH', { ctrlKey: true, shiftKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(19f) [windows] Ctrl+Alt+E NO abre el historial: AltGr+E escribe €',
    !esHistorial(tk('€', 'KeyE', { ctrlKey: true, altKey: true, altGraph: true }), 'windows') &&
      !esHistorial(tk('e', 'KeyE', { ctrlKey: true, altKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(19g) [windows] ⊞+Shift+H NO',
    !esHistorial(tk('H', 'KeyH', { metaKey: true, shiftKey: true }), 'windows'),
    'mitad negativa'
  )

  hr('20. esFormatear: Ctrl+Alt+L / ⌥⌘L, LEÍDO POR `code`')

  check('(20a) [windows] Ctrl+Alt+L formatea', esFormatear(tk('l', 'KeyL', { ctrlKey: true, altKey: true }), 'windows'), 'true')
  check('(20b) [otra] Ctrl+Alt+L formatea, como Windows', esFormatear(tk('l', 'KeyL', { ctrlKey: true, altKey: true }), 'otra'), 'true')
  check(
    "(20c) [mac] ⌥⌘L formatea aunque llegue con key '¬' (⌥ compone)",
    esFormatear(tk('¬', 'KeyL', { metaKey: true, altKey: true }), 'mac'),
    'se lee por code'
  )
  check(
    '(20d) [windows] AltGr+L NO formatea: en la polaca escribe «ł»',
    !esFormatear(tk('ł', 'KeyL', { ctrlKey: true, altKey: true, altGraph: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(20e) [windows] Ctrl+L, Alt+L (buscar en selección de Monaco) y Ctrl+Alt+Shift+L NO',
    !esFormatear(tk('l', 'KeyL', { ctrlKey: true }), 'windows') &&
      !esFormatear(tk('l', 'KeyL', { altKey: true }), 'windows') &&
      !esFormatear(tk('L', 'KeyL', { ctrlKey: true, altKey: true, shiftKey: true }), 'windows'),
    'mitad negativa'
  )
  check(
    '(20f) [mac] ⌃⌥L y ⌘L (seleccionar línea de Monaco) NO formatean',
    !esFormatear(tk('¬', 'KeyL', { ctrlKey: true, altKey: true }), 'mac') &&
      !esFormatear(tk('l', 'KeyL', { metaKey: true }), 'mac'),
    'mitad negativa'
  )
  check(
    '(20g) [windows] el acorde de Mac (⊞+Alt+L) NO se cuela',
    !esFormatear(tk('l', 'KeyL', { metaKey: true, altKey: true }), 'windows'),
    'mitad negativa'
  )

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
