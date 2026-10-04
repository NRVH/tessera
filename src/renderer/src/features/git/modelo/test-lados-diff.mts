#!/usr/bin/env node
// =============================================================================
// Prueba de esDiffDeUnLado (npm run test:lados-diff), contra las salidas REALES de
// los dos resolvers. Fija los casos de commit (un commit raíz es de un lado aunque git
// diga `M`), de los dos ejes del working-tree y que un rename tiene siempre los dos
// lados. La aserción clave: un alta del disco es de UN lado y a la vez EDITABLE.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { FileChange, FileStatus, WorkingChange, WorkingFileStatus } from '../../../../../shared/git-ipc.ts'
import { resolveDiffTarget } from './resolveDiffTarget.ts'
import { resolveWorkingDiffTarget } from './resolveWorkingDiffTarget.ts'
import { isDiffEditable } from './diffEditability.ts'
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

function cambioCommit(status: FileStatus, oldPath?: string): FileChange {
  return { path: 'src/App.tsx', status, oldPath }
}
function cambioTrabajo(index: WorkingFileStatus, worktree: WorkingFileStatus, oldPath?: string): WorkingChange {
  return { path: 'src/App.tsx', indexStatus: index, worktreeStatus: worktree, oldPath }
}
/** Descripción corta de los dos lados, para la evidencia. */
function lados(t: { before: { source: string }; after: { source: string } }): string {
  return `${t.before.source} -> ${t.after.source}`
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Diff de un COMMIT contra su padre')
  // -------------------------------------------------------------------------
  {
    const alta = resolveDiffTarget(HIJO, PADRE, cambioCommit('A'))
    check('alta (A) es de un solo lado', esDiffDeUnLado(alta), lados(alta))
    const borrado = resolveDiffTarget(HIJO, PADRE, cambioCommit('D'))
    check('borrado (D) es de un solo lado', esDiffDeUnLado(borrado), lados(borrado))
    const mod = resolveDiffTarget(HIJO, PADRE, cambioCommit('M'))
    check('modificado (M) tiene los DOS lados', !esDiffDeUnLado(mod), lados(mod))
    const ren = resolveDiffTarget(HIJO, PADRE, cambioCommit('R', 'src/Viejo.tsx'))
    check('rename (R) tiene los DOS lados', !esDiffDeUnLado(ren), lados(ren))
  }

  // -------------------------------------------------------------------------
  hr('2) Commit RAÍZ: sin padre no hay "antes", diga lo que diga el status')
  // -------------------------------------------------------------------------
  {
    const raiz = resolveDiffTarget(HIJO, null, cambioCommit('M'))
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
    const untracked = resolveWorkingDiffTarget(cambioTrabajo('.', '?'), 'unstaged')
    check('untracked (?) es de un solo lado', esDiffDeUnLado(untracked), lados(untracked))
    const borrado = resolveWorkingDiffTarget(cambioTrabajo('.', 'D'), 'unstaged')
    check('borrado en disco es de un solo lado', esDiffDeUnLado(borrado), lados(borrado))
    const mod = resolveWorkingDiffTarget(cambioTrabajo('.', 'M'), 'unstaged')
    check('modificado tiene los DOS lados', !esDiffDeUnLado(mod), lados(mod))
    const ren = resolveWorkingDiffTarget(cambioTrabajo('.', 'R', 'src/Viejo.tsx'), 'unstaged')
    check('rename tiene los DOS lados', !esDiffDeUnLado(ren), lados(ren))
  }

  // -------------------------------------------------------------------------
  hr('4) Working-tree, eje "staged" (la sección Preparados)')
  // -------------------------------------------------------------------------
  {
    const alta = resolveWorkingDiffTarget(cambioTrabajo('A', '.'), 'staged')
    check('alta preparada es de un solo lado', esDiffDeUnLado(alta), lados(alta))
    const borrado = resolveWorkingDiffTarget(cambioTrabajo('D', '.'), 'staged')
    check('borrado preparado es de un solo lado', esDiffDeUnLado(borrado), lados(borrado))
    const mod = resolveWorkingDiffTarget(cambioTrabajo('M', '.'), 'staged')
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
    const staged = resolveWorkingDiffTarget(c, 'staged')
    const unstaged = resolveWorkingDiffTarget(c, 'unstaged')
    check('mismo cambio, eje staged: un solo lado', esDiffDeUnLado(staged), lados(staged))
    check('mismo cambio, eje unstaged: dos lados', !esDiffDeUnLado(unstaged), lados(unstaged))
  }

  // -------------------------------------------------------------------------
  hr('6) UN SOLO LADO **Y** EDITABLE conviven — la regresión a evitar')
  // -------------------------------------------------------------------------
  {
    const nuevo = resolveWorkingDiffTarget(cambioTrabajo('.', '?'), 'unstaged')
    check(
      'un archivo NUEVO sin preparar: de un solo lado Y editable',
      esDiffDeUnLado(nuevo) && isDiffEditable(nuevo),
      `unLado=${esDiffDeUnLado(nuevo)} editable=${isDiffEditable(nuevo)} (${lados(nuevo)})`
    )
    const deCommit = resolveDiffTarget(HIJO, PADRE, cambioCommit('A'))
    check(
      'un alta de un COMMIT: de un solo lado y NO editable',
      esDiffDeUnLado(deCommit) && !isDiffEditable(deCommit),
      `unLado=${esDiffDeUnLado(deCommit)} editable=${isDiffEditable(deCommit)}`
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
