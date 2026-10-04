#!/usr/bin/env node
// =============================================================================
// Prueba del scroll sincronizado de la vista dividida (npm run test:scroll-sincronizado): la
// fracción de recorrido, el destino acotado, que el movimiento provocado en el otro lado (el
// eco) no rebota y que un repintado no cuenta como gesto, con un aplicador falso.
// Decisiones: docs/decisiones/editor/scroll-sincronizado-vista-dividida.md
// =============================================================================

import { crearSincronizador, fraccionDe, topDestino, type Lado, type MedidaScroll } from './scrollSincronizado.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

hr('1. La fracción del recorrido')
{
  check('(1a) arriba del todo: 0', fraccionDe({ top: 0, alto: 1000, visible: 200 }) === 0, '0')
  check('(1b) abajo del todo: 1', fraccionDe({ top: 800, alto: 1000, visible: 200 }) === 1, '1')
  check('(1c) a mitad del recorrido (no del documento): 0,5', fraccionDe({ top: 400, alto: 1000, visible: 200 }) === 0.5, '0.5')
  check('(1d) sin recorrido (cabe entero): 0', fraccionDe({ top: 0, alto: 100, visible: 200 }) === 0 && fraccionDe({ top: 0, alto: 200, visible: 200 }) === 0, '0')
  check('(1e) un top pasado de rosca o raro se acota', fraccionDe({ top: 5000, alto: 1000, visible: 200 }) === 1 && fraccionDe({ top: NaN, alto: 1000, visible: 200 }) === 0, '1 y 0')
}

hr('2. El destino')
{
  check('(2a) la misma fracción en un recorrido distinto', topDestino(0.5, { alto: 3000, visible: 500 }) === 1250, String(topDestino(0.5, { alto: 3000, visible: 500 })))
  check('(2b) sin recorrido en el destino: 0', topDestino(0.7, { alto: 100, visible: 300 }) === 0, '0')
  check('(2c) se acota y se redondea', topDestino(1.5, { alto: 1000, visible: 100 }) === 900 && topDestino(1 / 3, { alto: 1000, visible: 100 }) === 300, 'acotado')
}

hr('3. El sincronizador y el eco')
{
  const medidas: Record<Lado, MedidaScroll> = {
    codigo: { top: 0, alto: 2200, visible: 200 },
    vista: { top: 0, alto: 4200, visible: 200 }
  }
  const movimientos: string[] = []
  const sinc = crearSincronizador({
    medir: (lado) => ({ ...medidas[lado] }),
    mover: (lado, top) => {
      medidas[lado].top = top
      movimientos.push(`${lado}:${top}`)
    }
  })
  medidas.codigo.top = 1000 // el usuario baja la mitad del código
  check('(3a) mover el código lleva la vista a la misma fracción', sinc.alMoverse('codigo') && medidas.vista.top === 2000, movimientos.join(' '))
  // El DOM avisa del movimiento que acabamos de provocar en la vista: es el eco, no vuelve al código.
  check('(3b) el eco de la vista (su valor es el que le pusimos) se ignora', !sinc.alMoverse('vista') && medidas.codigo.top === 1000, movimientos.join(' '))
  // Después, un movimiento de la vista con OTRO valor sí cuenta: es del usuario.
  medidas.vista.top = 4000
  check('(3c) un movimiento distinto de la vista manda y lleva al código', sinc.alMoverse('vista') && medidas.codigo.top === 2000, movimientos.join(' '))
  check('(3d) y su eco en el código se ignora', !sinc.alMoverse('codigo') && movimientos.length === 2, movimientos.join(' '))
  check('(3e) un movimiento que no cambia nada no se aplica ni rebota', !sinc.alMoverse('codigo') && movimientos.length === 2, movimientos.join(' '))
  // Si el código avisara con fotogramas intermedios antes del valor pedido (una animación),
  // el primero consume el eco pendiente y la vista los sigue; el final la deja donde la
  // puso el usuario. (`setScrollTop` es inmediato: en la práctica solo llega el eco.)
  medidas.vista.top = 0
  sinc.alMoverse('vista') // pide código → 0
  medidas.codigo.top = 1200 // fotograma intermedio de la animación hacia 0
  const intermedio = sinc.alMoverse('codigo')
  const aMedias = medidas.vista.top
  medidas.codigo.top = 0 // el fotograma final: el valor pedido
  const final = sinc.alMoverse('codigo')
  check(
    '(3f) unos fotogramas intermedios mueven la vista y el final la devuelve a su sitio',
    intermedio && aMedias === 2400 && final && medidas.vista.top === 0,
    movimientos.join(' ')
  )
  // Mover el mismo lado dos veces seguidas: ninguna se confunde con un eco.
  medidas.codigo.top = 100
  const dos = sinc.alMoverse('codigo')
  medidas.codigo.top = 200
  const tres = sinc.alMoverse('codigo')
  check('(3g) el lado que mueve el usuario nunca se confunde con un eco', dos && tres && medidas.vista.top === 400, movimientos.join(' '))
  // El eco que no llega: pedimos vista → 400, pero un refresco la deja en 380 antes de que avise.
  medidas.vista.top = 380
  sinc.alMoverse('vista') // no es el eco: lleva al código y OLVIDA el 400 pendiente
  medidas.vista.top = 400 // el usuario para JUSTO en el píxel que esperábamos hace rato
  check('(3h) un eco que nunca llegó no convierte en eco un gesto real que caiga en su píxel', sinc.alMoverse('vista') && medidas.codigo.top === 200, movimientos.join(' '))
}

hr('4. Un repintado no es un gesto')
{
  const medidas: Record<Lado, MedidaScroll> = {
    codigo: { top: 1000, alto: 2200, visible: 200 },
    vista: { top: 2000, alto: 4200, visible: 200 }
  }
  const movimientos: string[] = []
  const sinc = crearSincronizador({
    medir: (lado) => ({ ...medidas[lado] }),
    mover: (lado, top) => {
      medidas[lado].top = top
      movimientos.push(`${lado}:${top}`)
    }
  })
  sinc.alMoverse('vista') // primera medida: ya en su sitio, no mueve nada
  // Se escribe en el código: la vista se refresca, mide menos y el navegador acota su scroll.
  medidas.vista = { top: 1300, alto: 1500, visible: 200 }
  check('(4a) la vista acotada por un refresco (cambió su alto) no arrastra al código', !sinc.alMoverse('vista') && medidas.codigo.top === 1000, movimientos.join(' '))
  // Los diagramas terminan de dibujarse: vuelve a medir lo de antes y se repone el scroll.
  medidas.vista = { top: 2000, alto: 4200, visible: 200 }
  check('(4b) ni la repone cuando el documento recupera su alto', !sinc.alMoverse('vista') && movimientos.length === 0, movimientos.join(' '))
  check('(4c) un scroll que no cambia la posición no hace nada', !sinc.alMoverse('vista') && movimientos.length === 0, movimientos.join(' '))
  medidas.vista.top = 4000
  check('(4d) y el siguiente gesto real vuelve a casar los lados', sinc.alMoverse('vista') && medidas.codigo.top === 2000, movimientos.join(' '))
  sinc.alMoverse('codigo') // el eco del código
  // La ventana cambia de tamaño: cambia lo visible del código, no dónde está.
  medidas.codigo = { top: 2000, alto: 2200, visible: 150 }
  check('(4e) cambiar lo visible (la ventana) tampoco propaga', !sinc.alMoverse('codigo') && medidas.vista.top === 4000, movimientos.join(' '))
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
