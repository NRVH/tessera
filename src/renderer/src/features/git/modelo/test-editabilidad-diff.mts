#!/usr/bin/env node
// =============================================================================
// Prueba de esDiffEditable (npm run test:editabilidad-diff). Un falso positivo
// escribiría un archivo que el usuario no mira, así que se prueba contra las salidas
// REALES de los dos resolvers. Matriz: eje `unstaged` editable salvo borrados; eje
// `staged` y commit contra su padre, nunca. Corre bajo `node` sin DOM porque los
// imports de `.tsx` son `import type`.
// Decisiones: docs/decisiones/git/cambios-blobs-y-diff.md
// =============================================================================

import type { CambioWorktree, EstadoArchivoWorktree, EstadoArchivo } from '../../../../../shared/git-ipc.ts'
import { etiquetaRevisiones, resolverDestinoDiffWorktree } from './resolverDestinoDiffWorktree.ts'
import { resolverDestinoDiff } from './resolverDestinoDiff.ts'
import { esDiffEditable } from './editabilidadDiff.ts'

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

function cambio(
  indice: EstadoArchivoWorktree,
  worktree: EstadoArchivoWorktree,
  rutaAnterior?: string,
  ruta = 'src/App.tsx'
): CambioWorktree {
  return {
    ruta,
    estadoIndice: indice,
    estadoWorktree: worktree,
    ...(rutaAnterior === undefined ? {} : { rutaAnterior })
  } as CambioWorktree
}

const EJES: EstadoArchivoWorktree[] = ['A', 'M', 'D', 'R', '?', 'C', 'T', 'U']

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) Sección "Changes" (eje unstaged): EDITABLE salvo borrados')
  // ---------------------------------------------------------------------------
  for (const st of EJES) {
    const destino = resolverDestinoDiffWorktree(cambio('.', st), 'unstaged')
    const esperado = st !== 'D'
    check(
      `(1) unstaged estadoWorktree='${st}' -> editable=${esperado}`,
      esDiffEditable(destino) === esperado,
      `after.source=${destino.despues.origen} status=${destino.estado} editable=${esDiffEditable(destino)}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(2) Sección "Staged Changes" (eje staged): NUNCA editable')
  // ---------------------------------------------------------------------------
  for (const st of EJES) {
    if (st === '?') continue // untracked no existe en el índice
    const destino = resolverDestinoDiffWorktree(cambio(st, '.'), 'staged')
    check(
      `(2) staged estadoIndice='${st}' -> NO editable (el lado derecho es el índice)`,
      !esDiffEditable(destino),
      `after.source=${destino.despues.origen} status=${destino.estado}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) Historial de commits: NUNCA editable')
  // ---------------------------------------------------------------------------
  {
    const estados: EstadoArchivo[] = ['A', 'M', 'D', 'R']
    for (const st of estados) {
      const destino = resolverDestinoDiff('abc1234', 'def5678', {
        ruta: 'src/App.tsx',
        estado: st,
        ...(st === 'R' ? { rutaAnterior: 'src/Viejo.tsx' } : {})
      } as never)
      check(
        `(3) commit-vs-padre status='${st}' -> NO editable (es historia)`,
        !esDiffEditable(destino),
        `after.source=${destino.despues.origen}`
      )
    }
    const primerCommit = resolverDestinoDiff('abc1234', null, {
      ruta: 'src/App.tsx',
      estado: 'A'
    } as never)
    check(
      '(3) commit SIN padre (primer commit) -> NO editable',
      !esDiffEditable(primerCommit),
      `before.source=${primerCommit.antes.origen} after.source=${primerCommit.despues.origen}`
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
      const destino = resolverDestinoDiffWorktree(cambio('.', st, 'src/Viejo.tsx'), 'unstaged')
      if (esDiffEditable(destino) && destino.despues.ruta !== destino.ruta) {
        todos = false
        detalles.push(`${st}: after=${destino.despues.ruta} target=${destino.ruta}`)
      }
    }
    check(
      '(4a) todo diff declarado editable escribe en la MISMA ruta que muestra',
      todos,
      todos ? 'todas las combinaciones coinciden' : detalles.join(' | ')
    )

    // Y el predicado se apaga si esa invariante se rompiera.
    const manipulado = resolverDestinoDiffWorktree(cambio('.', 'M'), 'unstaged')
    const roto = { ...manipulado, despues: { ...manipulado.despues, ruta: 'src/OtroArchivo.tsx' } }
    check(
      '(4b) si el lado derecho apuntara a otra ruta, deja de ser editable',
      !esDiffEditable(roto),
      `after.path=${roto.despues.ruta} target.path=${roto.ruta}`
    )
  }

  // ---------------------------------------------------------------------------
  hr('(5) Caso mixto MM: el mismo archivo en las DOS secciones')
  // ---------------------------------------------------------------------------
  {
    const mm = cambio('M', 'M')
    const preparado = resolverDestinoDiffWorktree(mm, 'staged')
    const sinPreparar = resolverDestinoDiffWorktree(mm, 'unstaged')
    check(
      '(5a) un archivo staged Y modificado sale editable solo desde "Changes"',
      !esDiffEditable(preparado) && esDiffEditable(sinPreparar),
      `staged=${esDiffEditable(preparado)} unstaged=${esDiffEditable(sinPreparar)}`
    )
    check(
      '(5b) sus pestañas son distintas (no colisionan): STAGED vs WORKTREE',
      preparado.commitHash === 'STAGED' && sinPreparar.commitHash === 'WORKTREE',
      `${preparado.commitHash} / ${sinPreparar.commitHash}`
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
    const mm = cambio('M', 'M')
    const preparado = resolverDestinoDiffWorktree(mm, 'staged')
    const sinPreparar = resolverDestinoDiffWorktree(mm, 'unstaged')
    check(
      '(6a) ningún centinela llega crudo a la pantalla',
      !etiquetaRevisiones(preparado.commitHash).startsWith('STAGED') &&
        !etiquetaRevisiones(sinPreparar.commitHash).startsWith('WORKTRE'),
      `staged="${etiquetaRevisiones(preparado.commitHash)}" unstaged="${etiquetaRevisiones(sinPreparar.commitHash)}"`
    )
    check(
      '(6b) y los dos ejes se distinguen (que es para lo que está la etiqueta)',
      etiquetaRevisiones(preparado.commitHash) !== etiquetaRevisiones(sinPreparar.commitHash),
      `${etiquetaRevisiones(preparado.commitHash)} vs ${etiquetaRevisiones(sinPreparar.commitHash)}`
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
    // que sin la guarda `esDiffEditable` diría true, el pane pediría el buffer
    // compartido del .jar y Ctrl+S escribiría texto de Monaco encima del binario.
    const jar = resolverDestinoDiffWorktree(cambio('.', 'M', undefined, 'codigo/lib/cliente.jar'), 'unstaged')
    check(
      '(7a) el .jar del working-tree SÍ sería editable sin la guarda',
      esDiffEditable(jar) === true,
      `after.source=${jar.despues.origen}`
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
      esDiffEditable(jar, enMemoria) === false,
      'false'
    )
    check(
      '(7c) y el contenido en memoria manda también sobre un diff de commit',
      esDiffEditable(
        resolverDestinoDiff('abc123', 'def456', { ruta: 'x.jar', estado: 'M' } as never),
        enMemoria
      ) ===
        false,
      'false'
    )
    check(
      '(7d) sin contenido en memoria (undefined) todo sigue exactamente igual',
      esDiffEditable(jar, undefined) === true && esDiffEditable(jar) === true,
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
