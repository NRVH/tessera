#!/usr/bin/env node
// =============================================================================
// Prueba de esDiffDeUnLado (npm run test:lados-diff), contra las salidas REALES de
// los dos resolvers. Fija los casos de commit (un commit raíz es de un lado aunque git
// diga `M`), de los dos ejes del working-tree y que un rename tiene siempre los dos
// lados. La aserción clave: un alta del disco es de UN lado y a la vez EDITABLE.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { CambioArchivo, EstadoArchivo, CambioWorktree, EstadoArchivoWorktree } from '../../../../../shared/git-ipc.ts'
import { resolverDestinoDiff } from './resolverDestinoDiff.ts'
import { resolverDestinoDiffWorktree } from './resolverDestinoDiffWorktree.ts'
import { esDiffEditable } from './editabilidadDiff.ts'
import { esDiffDeUnLado } from './ladosDelDiff.ts'

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

const HIJO = 'aaaaaaa1111111111111111111111111111111'
const PADRE = 'bbbbbbb2222222222222222222222222222222'

function cambioCommit(estado: EstadoArchivo, rutaAnterior?: string): CambioArchivo {
  return { ruta: 'src/App.tsx', estado, rutaAnterior }
}
function cambioTrabajo(indice: EstadoArchivoWorktree, worktree: EstadoArchivoWorktree, rutaAnterior?: string): CambioWorktree {
  return { ruta: 'src/App.tsx', estadoIndice: indice, estadoWorktree: worktree, rutaAnterior }
}
/** Descripción corta de los dos lados, para la evidencia. */
function lados(t: { antes: { origen: string }; despues: { origen: string } }): string {
  return `${t.antes.origen} -> ${t.despues.origen}`
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Diff de un COMMIT contra su padre')
  // -------------------------------------------------------------------------
  {
    const alta = resolverDestinoDiff(HIJO, PADRE, cambioCommit('A'))
    check('alta (A) es de un solo lado', esDiffDeUnLado(alta), lados(alta))
    const borrado = resolverDestinoDiff(HIJO, PADRE, cambioCommit('D'))
    check('borrado (D) es de un solo lado', esDiffDeUnLado(borrado), lados(borrado))
    const mod = resolverDestinoDiff(HIJO, PADRE, cambioCommit('M'))
    check('modificado (M) tiene los DOS lados', !esDiffDeUnLado(mod), lados(mod))
    const ren = resolverDestinoDiff(HIJO, PADRE, cambioCommit('R', 'src/Viejo.tsx'))
    check('rename (R) tiene los DOS lados', !esDiffDeUnLado(ren), lados(ren))
  }

  // -------------------------------------------------------------------------
  hr('2) Commit RAÍZ: sin padre no hay "antes", diga lo que diga el status')
  // -------------------------------------------------------------------------
  {
    const raiz = resolverDestinoDiff(HIJO, null, cambioCommit('M'))
    check(
      'un M en un commit raíz es de un solo lado (es lo que el status NO dice)',
      esDiffDeUnLado(raiz),
      lados(raiz)
    )
  }

  // -------------------------------------------------------------------------
  hr('3) Working-tree, eje "unstaged" (la sección Cambios)')
  // -------------------------------------------------------------------------
  {
    const sinSeguimiento = resolverDestinoDiffWorktree(cambioTrabajo('.', '?'), 'unstaged')
    check('untracked (?) es de un solo lado', esDiffDeUnLado(sinSeguimiento), lados(sinSeguimiento))
    const borrado = resolverDestinoDiffWorktree(cambioTrabajo('.', 'D'), 'unstaged')
    check('borrado en disco es de un solo lado', esDiffDeUnLado(borrado), lados(borrado))
    const mod = resolverDestinoDiffWorktree(cambioTrabajo('.', 'M'), 'unstaged')
    check('modificado tiene los DOS lados', !esDiffDeUnLado(mod), lados(mod))
    const ren = resolverDestinoDiffWorktree(cambioTrabajo('.', 'R', 'src/Viejo.tsx'), 'unstaged')
    check('rename tiene los DOS lados', !esDiffDeUnLado(ren), lados(ren))
  }

  // -------------------------------------------------------------------------
  hr('4) Working-tree, eje "staged" (la sección Preparados)')
  // -------------------------------------------------------------------------
  {
    const alta = resolverDestinoDiffWorktree(cambioTrabajo('A', '.'), 'staged')
    check('alta preparada es de un solo lado', esDiffDeUnLado(alta), lados(alta))
    const borrado = resolverDestinoDiffWorktree(cambioTrabajo('D', '.'), 'staged')
    check('borrado preparado es de un solo lado', esDiffDeUnLado(borrado), lados(borrado))
    const mod = resolverDestinoDiffWorktree(cambioTrabajo('M', '.'), 'staged')
    check('modificado preparado tiene los DOS lados', !esDiffDeUnLado(mod), lados(mod))
  }

  // -------------------------------------------------------------------------
  hr('5) El MISMO archivo, misma letra, distinto eje')
  // -------------------------------------------------------------------------
  {
    // Un archivo nuevo YA PREPARADO y luego tocado en disco: 'A' en el índice y 'M'
    // en el working-tree. Por el eje staged es un alta (un lado); por el unstaged
    // compara índice con disco (dos lados). La letra sola no habría podido decirlo.
    const c = cambioTrabajo('A', 'M')
    const preparado = resolverDestinoDiffWorktree(c, 'staged')
    const sinPreparar = resolverDestinoDiffWorktree(c, 'unstaged')
    check('mismo cambio, eje staged: un solo lado', esDiffDeUnLado(preparado), lados(preparado))
    check('mismo cambio, eje unstaged: dos lados', !esDiffDeUnLado(sinPreparar), lados(sinPreparar))
  }

  // -------------------------------------------------------------------------
  hr('6) UN SOLO LADO **Y** EDITABLE conviven — la regresión a evitar')
  // -------------------------------------------------------------------------
  {
    const nuevo = resolverDestinoDiffWorktree(cambioTrabajo('.', '?'), 'unstaged')
    check(
      'un archivo NUEVO sin preparar: de un solo lado Y editable',
      esDiffDeUnLado(nuevo) && esDiffEditable(nuevo),
      `unLado=${esDiffDeUnLado(nuevo)} editable=${esDiffEditable(nuevo)} (${lados(nuevo)})`
    )
    const deCommit = resolverDestinoDiff(HIJO, PADRE, cambioCommit('A'))
    check(
      'un alta de un COMMIT: de un solo lado y NO editable',
      esDiffDeUnLado(deCommit) && !esDiffEditable(deCommit),
      `unLado=${esDiffDeUnLado(deCommit)} editable=${esDiffEditable(deCommit)}`
    )
  }

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
