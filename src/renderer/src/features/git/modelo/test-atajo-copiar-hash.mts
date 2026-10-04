#!/usr/bin/env node
// =============================================================================
// Prueba de esAtajoCopiarHash (la tecla que copia el hash en el historial). Pura: corre con
// `node` a secas; importa `util/atajos` sin extensión, de ahí el hook de resolución.
// La plataforma se pasa SIEMPRE explícita y se fijan las dos desde una máquina. Cubre: Ctrl+C
// en Windows y Cmd+C en Mac, `C` mayúscula, `code` en distribuciones no latinas y Dvorak, el
// modificador ajeno que NO copia, Shift y Alt que lo desactivan, otras teclas y `repeat`.
// (node src/renderer/src/features/git/modelo/test-atajo-copiar-hash.mts)
// =============================================================================

import { register } from 'node:module'
import type { TeclaAtajo } from './atajoCopiarHash.ts'
import type { Plataforma } from '../../../../../shared/plataforma.ts'

// Resolver-hook: los módulos de producción importan sin extensión ('../util/atajos').
// Node ejecutando .ts por type-stripping no resuelve extensionless: se reintenta con .ts.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))

const { esAtajoCopiarHash } = await import('./atajoCopiarHash.ts')

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
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

// ---------------------------------------------------------------------------
// Fixtures: una pulsación sin ningún modificador, el modificador principal de
// cada sistema, y ayudantes para variarla.
// ---------------------------------------------------------------------------
const NADA: TeclaAtajo = {
  key: 'c',
  code: 'KeyC',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false
}

/** Las dos que Tessera soporta; 'otra' (Linux) se prueba aparte porque va como Windows. */
const PLATAFORMAS: readonly Plataforma[] = ['windows', 'mac']

/** El modificador principal de cada sistema, tal como llega en el evento. */
const MOD: Record<Plataforma, Partial<TeclaAtajo>> = {
  windows: { ctrlKey: true },
  mac: { metaKey: true },
  otra: { ctrlKey: true }
}

function tecla(parcial: Partial<TeclaAtajo>): TeclaAtajo {
  return { ...NADA, ...parcial }
}

/** La pulsación con el modificador principal de `plataforma` más lo que se varíe. */
function conMod(plataforma: Plataforma, parcial: Partial<TeclaAtajo> = {}): TeclaAtajo {
  return { ...NADA, ...MOD[plataforma], ...parcial }
}

/** Describe la combinación tal como se pulsa en ESE sistema, para que la evidencia se lea sola. */
function nombrar(t: TeclaAtajo, plataforma: Plataforma): string {
  const partes: string[] = []
  if (t.ctrlKey) partes.push('Ctrl')
  if (t.metaKey) partes.push(plataforma === 'mac' ? 'Cmd' : '⊞')
  if (t.shiftKey) partes.push('Shift')
  if (t.altKey) partes.push('Alt')
  partes.push(`'${t.key}'`)
  if (t.code !== 'KeyC') partes.push(`[${t.code}]`)
  if (t.repeat) partes.push('(repetida)')
  return partes.join('+')
}

function esperar(plataforma: Plataforma, t: TeclaAtajo, esperado: boolean, porque: string): void {
  const real = esAtajoCopiarHash(t, plataforma)
  check(
    `[${plataforma}] ${nombrar(t, plataforma)} ${esperado ? 'SÍ' : 'NO'} copia`,
    real === esperado,
    `esAtajoCopiarHash=${real}, esperado=${esperado} — ${porque}`
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  hr('(0) BAJO NODE NO HAY `window`: la plataforma explícita basta')
  check(
    'typeof window es undefined y el módulo cargó y responde',
    typeof window === 'undefined' && esAtajoCopiarHash(conMod('windows'), 'windows'),
    `typeof window=${typeof window}; el default window.tessera.plataforma no se evaluó`
  )

  hr('(1-4) LAS QUE SÍ COPIAN, con el modificador principal de cada sistema')
  for (const p of PLATAFORMAS) {
    esperar(p, conMod(p), true, p === 'mac' ? 'el gesto de macOS (Cmd+C)' : 'el atajo de Windows (Ctrl+C)')
    esperar(p, conMod(p, { key: 'C' }), true, 'con Bloq Mayús, `key` llega en mayúscula')
    esperar(
      p,
      conMod(p, { key: 'с' }),
      true,
      'distribución cirílica: `key` no es la c latina, pero `code` sigue siendo KeyC'
    )
    esperar(
      p,
      conMod(p, { key: 'c', code: 'KeyI' }),
      true,
      'Dvorak: la tecla rotulada C es otra posición física, pero `key` sí es c'
    )
  }
  esperar('otra', conMod('otra'), true, "Linux ('otra') va como Windows: Ctrl")

  hr('(5) EL MODIFICADOR AJENO NO CUENTA (lo que `ctrlKey || metaKey` rompía)')
  esperar(
    'mac',
    tecla({ ctrlKey: true }),
    false,
    'en Mac el modificador es Cmd; Ctrl+C no es de Tessera y no debe copiar'
  )
  esperar(
    'windows',
    tecla({ metaKey: true }),
    false,
    'en Windows ⊞+C no es de Tessera: con el `||` copiaba un hash a escondidas'
  )
  esperar('otra', tecla({ metaKey: true }), false, "en 'otra' Meta tampoco cuenta")
  for (const p of PLATAFORMAS) {
    esperar(p, tecla({ ctrlKey: true, metaKey: true }), false, 'Ctrl y Cmd a la vez es otro acorde')
  }

  hr('(6-7) LOS MODIFICADORES QUE LO DESACTIVAN, en las dos plataformas')
  for (const p of PLATAFORMAS) {
    esperar(
      p,
      conMod(p, { shiftKey: true }),
      false,
      'Mod+Shift+C ya es "copiar" dentro de las dos terminales'
    )
    esperar(
      p,
      conMod(p, { altKey: true }),
      false,
      p === 'mac'
        ? 'la misma guarda de AltGr, con Cmd'
        : 'así llega AltGr+C en un teclado europeo: copiaría a escondidas'
    )
    esperar(p, tecla({ altKey: true }), false, 'Alt+C no es el atajo de nadie')
    esperar(
      p,
      conMod(p, { shiftKey: true, altKey: true }),
      false,
      'los dos modificadores prohibidos a la vez tampoco pasan'
    )
  }

  hr('(8-9) OTRAS TECLAS, en las dos plataformas')
  for (const p of PLATAFORMAS) {
    esperar(p, conMod(p, { key: 'v', code: 'KeyV' }), false, 'pegar no es copiar')
    esperar(p, conMod(p, { key: 'a', code: 'KeyA' }), false, 'cualquier otra letra con el modificador')
    esperar(
      p,
      conMod(p, { key: 'ArrowDown', code: 'ArrowDown' }),
      false,
      'una tecla no imprimible con el modificador'
    )
    esperar(p, tecla({}), false, 'una "c" pelada tiene que poder escribirse')
    esperar(p, tecla({ shiftKey: true, key: 'C' }), false, 'Shift+C es escribir una C mayúscula')
  }

  hr('(10) LA AUTORREPETICIÓN NO COPIA, en las dos plataformas')
  for (const p of PLATAFORMAS) {
    esperar(
      p,
      conMod(p, { repeat: true }),
      false,
      'mantener la tecla serían ~30 idas y vueltas de IPC y el acuse no se asentaría'
    )
    esperar(
      p,
      conMod(p, { key: 'с', repeat: true }),
      false,
      'la guarda de repetición manda también sobre el camino de `code`'
    )
    // Sin el campo (un evento que no lo traiga) se comporta como una pulsación nueva.
    check(
      `[${p}] sin campo \`repeat\` se trata como pulsación nueva`,
      esAtajoCopiarHash(
        { key: 'c', ctrlKey: p !== 'mac', metaKey: p === 'mac', shiftKey: false, altKey: false },
        p
      ),
      'esAtajoCopiarHash=true con repeat ausente'
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
