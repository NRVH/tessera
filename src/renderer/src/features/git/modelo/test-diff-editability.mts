#!/usr/bin/env node
// =============================================================================
// Prueba de isDiffEditable (npm run test:diff-editability). Un falso positivo
// escribiría un archivo que el usuario no mira, así que se prueba contra las salidas
// REALES de los dos resolvers. Matriz: eje `unstaged` editable salvo borrados; eje
// `staged` y commit contra su padre, nunca. Corre bajo `node` sin DOM porque los
// imports de `.tsx` son `import type`.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { WorkingChange, WorkingFileStatus, FileStatus } from '../../../../../shared/git-ipc.ts'
import { etiquetaRevisiones, resolveWorkingDiffTarget } from './resolveWorkingDiffTarget.ts'
import { resolveDiffTarget } from './resolveDiffTarget.ts'
import { isDiffEditable } from './diffEditability.ts'

// =============================================================================
// Reporte PASS/FAIL
// =============================================================================
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

function change(
  index: WorkingFileStatus,
  worktree: WorkingFileStatus,
  oldPath?: string,
  path = 'src/App.tsx'
): WorkingChange {
  return {
    path,
    indexStatus: index,
    worktreeStatus: worktree,
    ...(oldPath === undefined ? {} : { oldPath })
  } as WorkingChange
}

const EJES: WorkingFileStatus[] = ['A', 'M', 'D', 'R', '?', 'C', 'T', 'U']

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) Sección "Changes" (eje unstaged): EDITABLE salvo borrados')
  // ---------------------------------------------------------------------------
  for (const st of EJES) {
    const target = resolveWorkingDiffTarget(change('.', st), 'unstaged')
    const esperado = st !== 'D'
    check(
      `(1) unstaged worktreeStatus='${st}' -> editable=${esperado}`,
      isDiffEditable(target) === esperado,
      `after.source=${target.after.source} status=${target.status} editable=${isDiffEditable(target)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(2) Sección "Staged Changes" (eje staged): NUNCA editable')
  // ---------------------------------------------------------------------------
  for (const st of EJES) {
    if (st === '?') continue // untracked no existe en el índice
    const target = resolveWorkingDiffTarget(change(st, '.'), 'staged')
    check(
      `(2) staged indexStatus='${st}' -> NO editable (el lado derecho es el índice)`,
      !isDiffEditable(target),
      `after.source=${target.after.source} status=${target.status}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) Historial de commits: NUNCA editable')
  // ---------------------------------------------------------------------------
  {
    const estados: FileStatus[] = ['A', 'M', 'D', 'R']
    for (const st of estados) {
      const target = resolveDiffTarget('abc1234', 'def5678', {
        path: 'src/App.tsx',
        status: st,
        ...(st === 'R' ? { oldPath: 'src/Viejo.tsx' } : {})
      } as never)
      check(
        `(3) commit-vs-padre status='${st}' -> NO editable (es historia)`,
        !isDiffEditable(target),
        `after.source=${target.after.source}`
      )
    }
    const primerCommit = resolveDiffTarget('abc1234', null, {
      path: 'src/App.tsx',
      status: 'A'
    } as never)
    check(
      '(3) commit SIN padre (primer commit) -> NO editable',
      !isDiffEditable(primerCommit),
      `before.source=${primerCommit.before.source} after.source=${primerCommit.after.source}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(4) La invariante de la que depende el guardado: after.path === target.path')
  // ---------------------------------------------------------------------------
  {
    // Un archivo que se guarda desde el diff se escribe en `after.path`. Si algún día
    // dejara de coincidir con la ruta que el usuario ve en la pestaña, el predicado
    // tiene que apagar la edición ANTES de que se escriba el archivo equivocado.
    let todos = true
    const detalles: string[] = []
    for (const st of EJES) {
      const target = resolveWorkingDiffTarget(change('.', st, 'src/Viejo.tsx'), 'unstaged')
      if (isDiffEditable(target) && target.after.path !== target.path) {
        todos = false
        detalles.push(`${st}: after=${target.after.path} target=${target.path}`)
      }
    }
    check(
      '(4a) todo diff declarado editable escribe en la MISMA ruta que muestra',
      todos,
      todos ? 'todas las combinaciones coinciden' : detalles.join(' | ')
    )

    // Y el predicado se apaga si esa invariante se rompiera.
    const manipulado = resolveWorkingDiffTarget(change('.', 'M'), 'unstaged')
    const roto = { ...manipulado, after: { ...manipulado.after, path: 'src/OtroArchivo.tsx' } }
    check(
      '(4b) si el lado derecho apuntara a otra ruta, deja de ser editable',
      !isDiffEditable(roto),
      `after.path=${roto.after.path} target.path=${roto.path}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(5) Caso mixto MM: el mismo archivo en las DOS secciones')
  // ---------------------------------------------------------------------------
  {
    const mm = change('M', 'M')
    const staged = resolveWorkingDiffTarget(mm, 'staged')
    const unstaged = resolveWorkingDiffTarget(mm, 'unstaged')
    check(
      '(5a) un archivo staged Y modificado sale editable solo desde "Changes"',
      !isDiffEditable(staged) && isDiffEditable(unstaged),
      `staged=${isDiffEditable(staged)} unstaged=${isDiffEditable(unstaged)}`
    )
    check(
      '(5b) sus pestañas son distintas (no colisionan): STAGED vs WORKTREE',
      staged.commitHash === 'STAGED' && unstaged.commitHash === 'WORKTREE',
      `${staged.commitHash} / ${unstaged.commitHash}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(6) La etiqueta de revisiones de la cabecera')
  // ---------------------------------------------------------------------------
  {
    // EL FALLO QUE ESTO FIJA: la cabecera pintaba `commitHash.slice(0, 7)` a
    // secas, y en un diff del working-tree ese "hash" es un CENTINELA, así que en
    // pantalla salía `WORKTRE` — un identificador interno, truncado a la mitad,
    // en el sitio donde el usuario busca contexto.
    const mm = change('M', 'M')
    const staged = resolveWorkingDiffTarget(mm, 'staged')
    const unstaged = resolveWorkingDiffTarget(mm, 'unstaged')
    check(
      '(6a) ningún centinela llega crudo a la pantalla',
      !etiquetaRevisiones(staged.commitHash).startsWith('STAGED') &&
        !etiquetaRevisiones(unstaged.commitHash).startsWith('WORKTRE'),
      `staged="${etiquetaRevisiones(staged.commitHash)}" unstaged="${etiquetaRevisiones(unstaged.commitHash)}"`
    )
    check(
      '(6b) y los dos ejes se distinguen (que es para lo que está la etiqueta)',
      etiquetaRevisiones(staged.commitHash) !== etiquetaRevisiones(unstaged.commitHash),
      `${etiquetaRevisiones(staged.commitHash)} vs ${etiquetaRevisiones(unstaged.commitHash)}`
    )
    // Un commit real SÍ se abrevia: ahí el hash corto es la etiqueta correcta.
    const hash = '7238505b1c0ffee0000000000000000000000000'
    check(
      '(6c) un commit de verdad sigue saliendo como hash corto',
      etiquetaRevisiones(hash) === '7238505',
      etiquetaRevisiones(hash)
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) CONTENIDO EN MEMORIA: nunca editable, y es el caso que puede hacer daño')
  // -------------------------------------------------------------------------
  {
    // Un .jar MODIFICADO en la vista de Cambios: su lado derecho es el disco, así
    // que sin la guarda `isDiffEditable` diría true, el pane pediría el buffer
    // compartido del .jar y Ctrl+S escribiría texto de Monaco encima del binario.
    const jar = resolveWorkingDiffTarget(change('.', 'M', undefined, 'codigo/lib/cliente.jar'), 'unstaged')
    check(
      '(7a) el .jar del working-tree SÍ sería editable sin la guarda',
      isDiffEditable(jar) === true,
      `after.source=${jar.after.source}`
    )
    const enMemoria = {
      original: 'Manifest-Version: 1.0\n',
      modificado: 'Manifest-Version: 1.0\nBuild: 2\n',
      lenguaje: 'plaintext',
      unLado: false,
      clave: 'META-INF/MANIFEST.MF|a|b'
    }
    check(
      '(7b) CON contenido en memoria deja de serlo (el arreglo)',
      isDiffEditable(jar, enMemoria) === false,
      'false'
    )
    check(
      '(7c) y el contenido en memoria manda también sobre un diff de commit',
      isDiffEditable(
        resolveDiffTarget('abc123', 'def456', { path: 'x.jar', status: 'M' } as never),
        enMemoria
      ) ===
        false,
      'false'
    )
    check(
      '(7d) sin contenido en memoria (undefined) todo sigue exactamente igual',
      isDiffEditable(jar, undefined) === true && isDiffEditable(jar) === true,
      'true'
    )
  }

  // -------------------------------------------------------------------------
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
