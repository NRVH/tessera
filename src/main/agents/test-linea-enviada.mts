#!/usr/bin/env node
// =============================================================================
// Prueba del detector de envío (`lineaEnviada.ts`), en concreto de la bandera
// `puedeTenerTextoSinEnviar`.
// (node src/main/agents/test-linea-enviada.mts)
// `alEscribir` ya lo cubre `test-ancla.mts`; aquí se fijan las dos mitades de la bandera: qué la
// enciende y qué la apaga, qué no hace ni lo uno ni lo otro, y que las respuestas de xterm no la
// ensucian. De la línea, que un Esc suelto o una secuencia no se coman ni metan letras.
// Puro: sin pty, sin Electron, sin red.
// =============================================================================

import { crearDetectorEnvio, type DetectorEnvio } from './lineaEnviada.ts'

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

const PEGADO_INI = '\x1b[200~'
const PEGADO_FIN = '\x1b[201~'

/** Alimenta los trozos en orden y devuelve el detector (para encadenar comprobaciones). */
function tras(...trozos: string[]): DetectorEnvio {
  const d = crearDetectorEnvio()
  for (const t of trozos) d.alEscribir(t)
  return d
}

function bandera(d: DetectorEnvio): string {
  return `puedeTenerTextoSinEnviar=${d.puedeTenerTextoSinEnviar()}`
}

function main(): void {
  hr('Estado inicial')
  const vacio = crearDetectorEnvio()
  check(
    '(0) un detector recién creado no tiene texto sin enviar',
    !vacio.puedeTenerTextoSinEnviar(),
    bandera(vacio)
  )

  hr('Tecleado')
  const t1 = tras('h')
  check('(t1) una sola letra la enciende', t1.puedeTenerTextoSinEnviar(), bandera(t1))
  const t2 = tras('h', 'o', 'l', 'a')
  check('(t2) tecla a tecla sigue encendida', t2.puedeTenerTextoSinEnviar(), bandera(t2))
  const t3 = tras('ñandú 🚀')
  check('(t3) no-ASCII (acentos, emoji) cuenta como texto', t3.puedeTenerTextoSinEnviar(), bandera(t3))
  const t4 = tras('\t')
  check('(t4) un tabulador solo NO es texto', !t4.puedeTenerTextoSinEnviar(), bandera(t4))

  hr('Enter')
  const e1 = tras('arregla el bug', '\r')
  check('(e1) Enter tras escribir la apaga', !e1.puedeTenerTextoSinEnviar(), bandera(e1))
  const e2 = tras('arregla el bug\r')
  check('(e2) texto + Enter en el MISMO trozo la deja apagada', !e2.puedeTenerTextoSinEnviar(), bandera(e2))
  const e3 = tras('uno\rdos')
  check('(e3) lo escrito DESPUÉS del Enter la vuelve a encender', e3.puedeTenerTextoSinEnviar(), bandera(e3))
  const e4 = tras('linea uno', '\n')
  check(
    '(e4) Ctrl+J (`\\n`) NO la apaga: puede ser un salto dentro del borrador',
    e4.puedeTenerTextoSinEnviar(),
    bandera(e4)
  )
  const e5 = tras('\r')
  check('(e5) Enter con el prompt vacío la deja apagada', !e5.puedeTenerTextoSinEnviar(), bandera(e5))

  hr('Pegado (bracketed paste)')
  const p1 = tras(`${PEGADO_INI}texto pegado${PEGADO_FIN}`)
  check('(p1) un pegado la enciende', p1.puedeTenerTextoSinEnviar(), bandera(p1))
  const p2 = tras(`${PEGADO_INI}linea 1\rlinea 2\r${PEGADO_FIN}`)
  check('(p2) los Enter DENTRO del pegado no la apagan', p2.puedeTenerTextoSinEnviar(), bandera(p2))
  const p3 = tras(`${PEGADO_INI}primera mitad\r`, `segunda mitad\r${PEGADO_FIN}`)
  check(
    '(p3) pegado PARTIDO entre dos trozos: el Enter del segundo trozo sigue siendo pegado',
    p3.puedeTenerTextoSinEnviar(),
    bandera(p3)
  )
  const p4 = tras(`${PEGADO_INI}algo${PEGADO_FIN}`, '\r')
  check('(p4) Enter DESPUÉS de cerrar el pegado sí la apaga', !p4.puedeTenerTextoSinEnviar(), bandera(p4))
  const p5 = tras(`${PEGADO_INI}\r\r${PEGADO_FIN}`)
  check(
    '(p5) un pegado de sólo saltos también cuenta (hay algo en el prompt)',
    p5.puedeTenerTextoSinEnviar(),
    bandera(p5)
  )
  const p6 = tras(`${PEGADO_INI}a`, '\x03', `b${PEGADO_FIN}`)
  check(
    '(p6) dentro del pegado, ni un ^C la apaga (es contenido pegado)',
    p6.puedeTenerTextoSinEnviar(),
    bandera(p6)
  )

  hr('Ctrl+U y Ctrl+C')
  const u1 = tras('borrador', '\x15')
  check('(u1) Ctrl+U la apaga', !u1.puedeTenerTextoSinEnviar(), bandera(u1))
  const u2 = tras('borrador', '\x15', 'x')
  check('(u2) lo tecleado tras Ctrl+U la vuelve a encender', u2.puedeTenerTextoSinEnviar(), bandera(u2))
  const c1 = tras('borrador', '\x03')
  check('(c1) Ctrl+C la apaga', !c1.puedeTenerTextoSinEnviar(), bandera(c1))
  const c2 = tras(`${PEGADO_INI}pegado${PEGADO_FIN}`, '\x03')
  check('(c2) Ctrl+C tras un pegado la apaga', !c2.puedeTenerTextoSinEnviar(), bandera(c2))

  hr('Flechas y demás secuencias: no son texto')
  const f1 = tras('\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D')
  check('(f1) flechas CSI no la encienden', !f1.puedeTenerTextoSinEnviar(), bandera(f1))
  const f2 = tras('\x1bOA', '\x1bOB')
  check('(f2) flechas SS3 (modo aplicación) no la encienden', !f2.puedeTenerTextoSinEnviar(), bandera(f2))
  const f3 = tras('\x1b[1;5C', '\x1b[3~', '\x1b[15~')
  check(
    '(f3) Ctrl+flecha, Supr y F5 (CSI con parámetros) no la encienden',
    !f3.puedeTenerTextoSinEnviar(),
    bandera(f3)
  )
  const f4 = tras('\x1b[I', '\x1b[O')
  check('(f4) los eventos de foco no la encienden', !f4.puedeTenerTextoSinEnviar(), bandera(f4))
  const f5 = tras('\x1bb', '\x1bf', '\x1b\r')
  check('(f5) Alt+tecla (y Alt+Enter) no la encienden', !f5.puedeTenerTextoSinEnviar(), bandera(f5))
  const f6 = tras('\x1b[M !!', '\x1b[<0;10;5M', '\x1b[<0;10;5m')
  check('(f6) informes de ratón (X10 y SGR) no la encienden', !f6.puedeTenerTextoSinEnviar(), bandera(f6))
  const f7 = tras('texto', '\x1b[D', '\x1b[D')
  check('(f7) las flechas NO la apagan', f7.puedeTenerTextoSinEnviar(), bandera(f7))
  const f8 = tras('\x1b', 'a')
  check(
    '(f8) Esc suelto (tecla) no se come la letra del trozo siguiente',
    f8.puedeTenerTextoSinEnviar(),
    bandera(f8)
  )
  const f9 = tras('\x1b\x1b')
  check('(f9) Esc Esc no la enciende', !f9.puedeTenerTextoSinEnviar(), bandera(f9))
  const f10 = tras('\x1b[\x1b[A')
  check(
    '(f10) una CSI cortada por otro ESC no convierte la siguiente en texto',
    !f10.puedeTenerTextoSinEnviar(),
    bandera(f10)
  )

  hr('Retroceso: posibilidad, no hecho')
  const b1 = tras('a', '\x7f')
  check(
    '(b1) escribir y borrar con retroceso NO la apaga (aviso de más antes que borrador perdido)',
    b1.puedeTenerTextoSinEnviar(),
    bandera(b1)
  )

  hr('La línea enviada no cambia (regresión de `alEscribir`)')
  const r1 = crearDetectorEnvio()
  const l1 = r1.alEscribir('/clear\r')
  check('(r1) `/clear` + Enter sigue devolviéndose igual', l1 === '/clear', `linea=${JSON.stringify(l1)}`)
  const r2 = crearDetectorEnvio()
  const l2 = r2.alEscribir(`${PEGADO_INI}/clear\nsegunda\n${PEGADO_FIN}`)
  check('(r2) un pegado sigue sin contar como envío', l2 === null, `linea=${JSON.stringify(l2)}`)
  const r3 = crearDetectorEnvio()
  for (const ch of '/resumee') r3.alEscribir(ch)
  r3.alEscribir('\x7f')
  r3.alEscribir('\x1b[D')
  const l3 = r3.alEscribir('\r')
  check('(r3) retroceso y flechas siguen igual en la línea', l3 === '/resume', `linea=${JSON.stringify(l3)}`)
  // Esc (cerrar un menú del CLI) y después `/clear`: el ESC suelto no se come el principio de
  // lo que se teclea luego. Se comía `/c` y la línea salía `lear`: el cambio de chat no se veía.
  const r4 = crearDetectorEnvio()
  r4.alEscribir('\x1b')
  const l6 = r4.alEscribir('/clear\r')
  const r5 = crearDetectorEnvio()
  r5.alEscribir('\x1b')
  let l7: string | null = null
  for (const ch of '/clear\r') l7 = r5.alEscribir(ch) ?? l7
  check(
    '(r4) Esc y después `/clear` (de golpe o tecla a tecla) sale `/clear`, no `lear`',
    l6 === '/clear' && l7 === '/clear',
    `de golpe=${JSON.stringify(l6)} tecla a tecla=${JSON.stringify(l7)}`
  )
  const r6 = crearDetectorEnvio()
  const l8 = r6.alEscribir('/cl\x1bOD\x1bOC\x1bbear\r')
  check(
    '(r5) flechas SS3 y Alt+tecla no meten letras en la línea',
    l8 === '/clear',
    `linea=${JSON.stringify(l8)}`
  )
  // Alt+Shift+O: xterm.js manda `ESC O` entero en un trozo. Arrastrado como SS3 a medias, se
  // comía la `/` del trozo siguiente y la línea salía `clear`: el cambio de chat no se veía.
  const r7 = crearDetectorEnvio()
  r7.alEscribir('\x1bO')
  const l9 = r7.alEscribir('/clear\r')
  const r8 = crearDetectorEnvio()
  r8.alEscribir('\x1bO')
  let l10: string | null = null
  for (const ch of '/clear\r') l10 = r8.alEscribir(ch) ?? l10
  check(
    '(r6) un `ESC O` suelto al final del trozo no se come la primera letra del siguiente',
    l9 === '/clear' && l10 === '/clear',
    `de golpe=${JSON.stringify(l9)} tecla a tecla=${JSON.stringify(l10)}`
  )
  const f11 = tras('\x1bO', 'a')
  check('(f11) tras un `ESC O` suelto, la letra siguiente sí enciende la bandera', f11.puedeTenerTextoSinEnviar(), bandera(f11))
  // Alt+[ manda `ESC [` entero: arrastrado como CSI a medias, `/` (0x2F) contaba como
  // parámetro y `c` como byte final, y la línea salía `lear`.
  const r9 = crearDetectorEnvio()
  r9.alEscribir('\x1b[')
  const l11 = r9.alEscribir('/clear\r')
  check('(r7) un `ESC [` suelto al final del trozo no se come lo que se teclea después', l11 === '/clear', `linea=${JSON.stringify(l11)}`)
  const f12 = tras('\x1b[', 'a')
  check('(f12) tras un `ESC [` suelto, la letra siguiente sí enciende la bandera', f12.puedeTenerTextoSinEnviar(), bandera(f12))

  hr('Respuestas del terminal (OSC, DCS): no son teclas')
  // Lo que xterm contesta por el mismo stdin cuando el CLI le pregunta al arrancar. Antes
  // se leían como Alt+] seguido de TEXTO: la bandera nacía encendida tras cada
  // relanzamiento y la línea siguiente salía como `11;rgb:…/clear`.
  const OSC11 = '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\'
  const o1 = tras(OSC11)
  const banderaO1 = o1.puedeTenerTextoSinEnviar()
  const l4 = o1.alEscribir('/clear\r')
  check(
    '(o1) respuesta OSC 11 (con ST): no enciende, y el `/clear` siguiente sale limpio',
    !banderaO1 && l4 === '/clear',
    `bandera=${banderaO1} linea=${JSON.stringify(l4)}`
  )
  const o2 = tras('\x1b]10;rgb:d4d4/d4d4/d4d4\x07')
  check('(o2) OSC 10 terminada en BEL no la enciende', !o2.puedeTenerTextoSinEnviar(), bandera(o2))
  const o3 = tras('\x1bP1$r0m\x1b\\')
  check('(o3) respuesta DECRQSS (DCS) no la enciende', !o3.puedeTenerTextoSinEnviar(), bandera(o3))
  const o4 = crearDetectorEnvio()
  o4.alEscribir('\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\')
  const banderaO4 = o4.puedeTenerTextoSinEnviar()
  const l5 = o4.alEscribir('\r')
  check('(o4) OSC 10 + 11 en el MISMO trozo: nada encendido y la línea sale vacía', !banderaO4 && l5 === '', `bandera=${banderaO4} linea=${JSON.stringify(l5)}`)
  const o5 = tras(`${OSC11}a`)
  check('(o5) lo tecleado DESPUÉS de la respuesta, en el mismo trozo, sí cuenta', o5.puedeTenerTextoSinEnviar(), bandera(o5))
  const o6 = tras('\x1b]', 'a')
  check('(o6) un Alt+] suelto no se traga lo que se teclee después', o6.puedeTenerTextoSinEnviar(), bandera(o6))
  const o7 = tras(`${PEGADO_INI}algo`, `\x1b]11;rgb:1e1e/1e1e/1e1e${PEGADO_FIN}`, '\r')
  check(
    '(o7) una respuesta SIN terminar no se come el cierre del pegado (el Enter de después apaga)',
    !o7.puedeTenerTextoSinEnviar(),
    bandera(o7)
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
