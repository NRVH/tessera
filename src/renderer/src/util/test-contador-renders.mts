#!/usr/bin/env node
// =============================================================================
// Prueba de contadorRenders (node src/renderer/src/util/test-contador-renders.mts): el
// núcleo puro del diagnóstico de rendimiento. Fija que APAGADO no cuenta nada (es lo
// que lo hace gratis en producción) y que encendido cuenta por componente y clave.
// Decisiones: docs/decisiones/calidad/presupuesto-del-cambio-de-perfil.md
// =============================================================================

import {
  activarContador,
  anotarDuracion,
  contadorActivo,
  contarEvento,
  contarRender,
  fotoContador,
  MAX_MUESTRAS,
  reiniciarContador
} from './contadorRenders.ts'

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
const ver = (x: unknown): string => JSON.stringify(x)

hr('(1) Apagado (por defecto) no cuenta nada')
{
  check('nace apagado', !contadorActivo(), String(contadorActivo()))
  contarRender('App')
  contarRender('Pane', 'a')
  contarEvento('pty:resize')
  anotarDuracion('webgl:crear', 12)
  const foto = fotoContador()
  check(
    'renders, eventos y duraciones vacíos',
    ver(foto) === ver({ renders: {}, eventos: {}, duraciones: {} }),
    ver(foto)
  )
}

hr('(2) Encendido: por componente y por clave')
{
  activarContador(true)
  contarRender('App')
  contarRender('App')
  contarRender('Pane', 'a')
  contarRender('Pane', 'a')
  contarRender('Pane', 'b')
  const { renders } = fotoContador()
  check('componente sin clave: solo el total', ver(renders.App) === ver({ total: 2, porClave: {} }), ver(renders.App))
  check(
    'componente con clave: total y reparto por instancia',
    ver(renders.Pane) === ver({ total: 3, porClave: { a: 2, b: 1 } }),
    ver(renders.Pane)
  )
}

hr('(3) Eventos y duraciones (mediana y máximo)')
{
  contarEvento('pty:resize')
  contarEvento('pty:resize')
  for (const ms of [9, 1, 5]) anotarDuracion('impar', ms)
  for (const ms of [8, 2, 4, 6]) anotarDuracion('par', ms)
  const foto = fotoContador()
  check('eventos', foto.eventos['pty:resize'] === 2, ver(foto.eventos))
  check('mediana impar = el del medio', ver(foto.duraciones.impar) === ver({ n: 3, mediana: 5, max: 9 }), ver(foto.duraciones.impar))
  check('mediana par = media de los dos del medio', ver(foto.duraciones.par) === ver({ n: 4, mediana: 5, max: 8 }), ver(foto.duraciones.par))
}

hr('(4) Reiniciar borra sin apagar; apagar no borra')
{
  reiniciarContador()
  check('tras reiniciar: vacío', ver(fotoContador()) === ver({ renders: {}, eventos: {}, duraciones: {} }), ver(fotoContador()))
  check('y sigue encendido', contadorActivo(), String(contadorActivo()))
  contarRender('App')
  activarContador(false)
  contarRender('App')
  check('apagar conserva lo contado y deja de contar', fotoContador().renders.App?.total === 1, ver(fotoContador().renders))
  const a = fotoContador()
  const b = fotoContador()
  check('la foto es una copia: no comparte objetos', a !== b && a.renders !== b.renders, 'copias distintas')
}

hr('(5) Las duraciones tienen tope: encendido y olvidado no crece sin fin')
{
  reiniciarContador()
  activarContador(true)
  for (let i = 0; i < MAX_MUESTRAS + 10; i++) anotarDuracion('tope', i)
  const { duraciones } = fotoContador()
  check('se guardan como mucho MAX_MUESTRAS', duraciones.tope.n === MAX_MUESTRAS, `n=${duraciones.tope.n}`)
  check('y son las primeras', duraciones.tope.max === MAX_MUESTRAS - 1, `max=${duraciones.tope.max}`)
  activarContador(false)
  reiniciarContador()
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
