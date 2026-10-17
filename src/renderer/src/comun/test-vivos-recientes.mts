#!/usr/bin/env node
// =============================================================================
// Prueba de las piezas que se mantienen montadas (npm run test:vivos-recientes): van en orden de
// entrada y volver a una no la mueve (el navegador no pierde su desplazamiento), el tope expulsa la
// menos reciente, lo que deja de existir sale, un cambio de lo que se pinta sí rehace la lista, y sin
// cambios se devuelve la MISMA (el render no se repite).
// =============================================================================
import { conVisto, soloExistentes, type ConUso, type Vivo } from './vivosRecientes.ts'

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

interface Arbol extends Vivo {
  name: string
}
const arbol = (n: string, name = n): Arbol => ({ clave: `p|/proy/${n}`, name })
const mismoArbol = (a: Arbol, b: Arbol): boolean => a.clave === b.clave && a.name === b.name
const nombres = (l: readonly ConUso<Arbol>[]): string => l.map((a) => a.pieza.name).join(',')

hr('(1) Orden de entrada, sin repetir, con tope')
let lista: readonly ConUso<Arbol>[] = []
for (const n of ['a', 'b', 'c']) lista = conVisto(lista, arbol(n), 3, mismoArbol)
check('1a', nombres(lista) === 'a,b,c', nombres(lista))
lista = conVisto(lista, arbol('a'), 3, mismoArbol)
check('1b', nombres(lista) === 'a,b,c', `volver a «a» no la mueve ni la repite: ${nombres(lista)}`)
lista = conVisto(lista, arbol('d'), 3, mismoArbol)
check('1c', nombres(lista) === 'a,c,d', `el tope expulsa la menos reciente («b»), no la primera: ${nombres(lista)}`)
check('1d', conVisto(lista, arbol('d'), 3, mismoArbol) === lista, 'la que ya es la última vista: misma lista')
const renombrado = conVisto(lista, arbol('d', 'delta'), 3, mismoArbol)
check('1e', renombrado !== lista && nombres(renombrado) === 'a,c,delta', `renombrado: se rehace en su sitio (${nombres(renombrado)})`)
const otraVez = conVisto(lista, arbol('c'), 3, mismoArbol)
check('1f', otraVez !== lista && nombres(otraVez) === 'a,c,d', 'volver a una anterior cambia su uso, no el orden')
check('1g', nombres(conVisto(otraVez, arbol('e'), 3, mismoArbol)) === 'c,d,e', 'y la expulsada es entonces la de uso más viejo («a»)')

hr('(2) Lo que deja de existir sale')
const existen = new Set(['p|/proy/d', 'p|/proy/c'])
const sinA = soloExistentes(lista, existen)
check('2a', nombres(sinA) === 'c,d', nombres(sinA))
check('2b', soloExistentes(sinA, existen) === sinA, 'sin nada que quitar: misma lista')

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed > 0 ? 1 : 0)
