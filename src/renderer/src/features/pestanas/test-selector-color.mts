#!/usr/bin/env node
// =============================================================================
// Prueba de lo puro del selector de color de un perfil (npm run test:selector-color): el
// color de un tono y una luz cae en la banda cenizo y vuelve a dar el mismo tono, el hex
// escrito a mano se lee con tolerancia, y la lista de fijados no repite y respeta el tope.
// =============================================================================

import { hexARgb, LUM_MAX, LUM_MIN, rgbAHsl, SAT_MAX, tintaPerfil } from './colorPerfil.ts'
import { colorDeTonoYLuz, fijarColor, leerHex, quitarFijado, tonoYLuzDe } from './colorPersonalizado.ts'

// ---------------------------------------------------------------------------
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
const json = (x: unknown): string => JSON.stringify(x)

hr('Tono y luz')
{
  const colores = [0, 60, 140, 210, 300].flatMap((tono) => [0, 0.5, 1].map((luz) => colorDeTonoYLuz({ tono, luz })))
  const enBanda = colores.every((c) => {
    const [, s, l] = rgbAHsl(...(hexARgb(c) ?? [0, 0, 0]))
    return s <= SAT_MAX + 1 && l >= LUM_MIN - 1 && l <= LUM_MAX + 1
  })
  check('todo color de tono y luz cae en la banda cenizo', enBanda, colores.slice(0, 4).join(' '))
  check('y se pinta tal cual (la tinta no lo cambia)', colores.every((c) => tintaPerfil(c) === c), colores.slice(0, 3).join(' '))
  const ida = { tono: 210, luz: 0.5 }
  const vuelta = tonoYLuzDe(colorDeTonoYLuz(ida))
  check('el tono y la luz vuelven del color', Math.abs(vuelta.tono - 210) <= 2 && Math.abs(vuelta.luz - 0.5) < 0.1, json(vuelta))
  check('un hex inválido coloca los deslizadores en el centro', json(tonoYLuzDe('nada')) === json({ tono: 0, luz: 0.5 }), json(tonoYLuzDe('nada')))
}

hr('Hex escrito a mano')
check('#rrggbb', leerHex('#7C9E8A') === '#7c9e8a', String(leerHex('#7C9E8A')))
check('sin almohadilla y corto', leerHex(' abc ') === '#aabbcc', String(leerHex(' abc ')))
check('lo que no es hex, null', leerHex('#12345') === null && leerHex('zzz') === null, 'null')

hr('Colores fijados')
{
  const l1 = fijarColor(['#111111', '#222222'], '#333333', 8)
  check('fijar pone el nuevo primero', json(l1) === json(['#333333', '#111111', '#222222']), json(l1))
  const l2 = fijarColor(l1, '#222222', 8)
  check('fijar uno que ya está lo sube sin repetirlo', json(l2) === json(['#222222', '#333333', '#111111']), json(l2))
  const l3 = fijarColor(['#1', '#2', '#3'], '#4', 3)
  check('con el tope, sale el más antiguo', json(l3) === json(['#4', '#1', '#2']), json(l3))
  check('quitar', json(quitarFijado(l2, '#333333')) === json(['#222222', '#111111']), json(quitarFijado(l2, '#333333')))
}

const pasan = results.filter((r) => r.pass).length
const allPass = pasan === results.length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
