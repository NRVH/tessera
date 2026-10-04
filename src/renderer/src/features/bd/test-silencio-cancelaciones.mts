#!/usr/bin/env node
// =============================================================================
// Prueba del filtro de la cancelación de Monaco (node src/renderer/src/features/bd/test-silencio-cancelaciones.mts).
// Reproduce con el `Delayer` REAL de Monaco el rechazo que deja al desecharse, y fija que el
// filtro lo calla mientras vive un editor, que NO calla otros rechazos y que se retira al soltarlo.
// =============================================================================

import { esCancelacionMonaco, retenerSilencioCancelaciones } from './silencioCancelacionesMonaco.ts'

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
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Lo que haría el navegador con un rechazo sin capturar: ¿alguien lo calló? */
function rechazoCallado(objetivo: EventTarget, razon: unknown): boolean {
  const e = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: razon })
  objetivo.dispatchEvent(e)
  return e.defaultPrevented
}

hr('(1) El rechazo que deja Monaco al desechar un Delayer con un retardo pendiente')
// Ruta en variable: el módulo interno de Monaco no trae tipos y no debe entrar en el typecheck.
const rutaAsync = 'monaco-editor/esm/vs/base/common/async.js'
const { Delayer } = (await import(rutaAsync)) as {
  Delayer: new (ms: number) => { trigger(f: () => void): Promise<unknown>; dispose(): void }
}
let razonReal: unknown = null
const capturar = (r: unknown): void => {
  razonReal = r
}
process.on('unhandledRejection', capturar)
{
  const d = new Delayer(50)
  // Igual que el resaltado de apariciones: el resultado de `trigger` no se espera.
  void d.trigger(() => undefined)
  d.dispose()
  await esperar(10)
}
process.off('unhandledRejection', capturar)
check('desechar con un retardo pendiente deja un rechazo sin capturar', razonReal !== null, String(razonReal))
check('ese rechazo es el que reconoce el filtro', esCancelacionMonaco(razonReal), String(razonReal))

hr('(2) Mitades negativas: no se calla nada más')
{
  const otros: [string, unknown][] = [
    ['Error("Canceled: fallo real")', new Error('Canceled: fallo real')],
    ['Error("Canceled") con name Error', new Error('Canceled')],
    ['la cadena "Canceled"', 'Canceled'],
    ['un AbortError', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })],
    ['un objeto con name y message Canceled que no es Error', { name: 'Canceled', message: 'Canceled' }],
    ['undefined', undefined]
  ]
  for (const [nombre, razon] of otros) check(`no es la cancelación: ${nombre}`, !esCancelacionMonaco(razon), 'false')
}

hr('(3) El filtro vive lo que el editor, más la gracia')
{
  const ventana = new EventTarget()
  check('sin editor, el rechazo de Monaco NO se calla', !rechazoCallado(ventana, razonReal), 'false')
  const soltarA = retenerSilencioCancelaciones(ventana, 0)
  const soltarB = retenerSilencioCancelaciones(ventana, 0)
  check('con un editor vivo, se calla', rechazoCallado(ventana, razonReal), 'true')
  check('con un editor vivo, otro rechazo NO se calla', !rechazoCallado(ventana, new Error('boom')), 'false')
  soltarA()
  soltarA()
  await esperar(10)
  check('soltar uno (aunque sea dos veces) deja el del otro editor', rechazoCallado(ventana, razonReal), 'true')
  soltarB()
  check('justo tras soltar el último, la gracia lo sigue callando', rechazoCallado(ventana, razonReal), 'true')
  await esperar(10)
  check('pasada la gracia, se retira', !rechazoCallado(ventana, razonReal), 'false')
}

console.log('\n' + '='.repeat(78))
const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log(`VEREDICTO: ${passed}/${results.length} PASS`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
