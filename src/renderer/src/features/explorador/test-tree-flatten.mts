#!/usr/bin/env node
// =============================================================================
// Prueba de flattenTree (aplanado PURO del árbol para virtualizar).
// (node src/renderer/src/features/explorador/test-tree-flatten.mts)
// -----------------------------------------------------------------------------
// Cubre filas de archivos y carpetas, expansión, compactación de cadenas, placeholders
// (loading, empty, error), el orden y las profundidades en un árbol anidado, y qué cadenas
// conserva un refresco (un .jar expandido no pierde sus filas ni la selección de dentro).
// =============================================================================

import {
  entradasConCadena,
  flattenTree,
  necesitaCadena,
  podarCadenas,
  type ChainInfo,
  type FlatRow
} from './treeFlatten.ts'
import { podarSeleccion } from './seleccionArbol.ts'
import type { FileEntry } from '../../../../shared/files-ipc.ts'

function dir(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir' }
}
function file(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'file' }
}
function chain(segments: FileEntry[], children: FileEntry[]): ChainInfo {
  return { segments, children }
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
/** Resumen compacto de las filas: "path@depth" para nodos, "!variant@depth" para placeholders. */
function sig(rows: FlatRow[]): string {
  return rows
    .map((r) => (r.kind === 'node' ? `${r.key}@${r.depth}${r.isExpanded ? '+' : ''}` : `!${r.variant}@${r.depth}`))
    .join(' ')
}

function main(): void {
  // (1) plano: archivo + carpeta colapsada
  {
    const rows = flattenTree({
      roots: [file('a.txt'), dir('src')],
      chains: new Map([['src', chain([dir('src')], [file('src/x.ts')])]]),
      expanded: new Set(),
      errors: new Map()
    })
    check('(1) plano, colapsado', sig(rows) === 'a.txt@0 src@0', sig(rows))
  }

  // (2) carpeta expandida -> hijos a depth+1
  {
    const rows = flattenTree({
      roots: [dir('src')],
      chains: new Map([['src', chain([dir('src')], [file('src/x.ts'), dir('src/sub')])]]),
      expanded: new Set(['src']),
      errors: new Map()
    })
    check('(2) expandida emite hijos a depth 1', sig(rows) === 'src@0+ src/x.ts@1 src/sub@1', sig(rows))
  }

  // (3) compactación: java -> com -> ejemplo (cadena), expandida por la HOJA 'ejemplo'
  {
    const compact = chain(
      [dir('java'), dir('java/com'), dir('java/com/ejemplo')],
      [file('java/com/ejemplo/App.java')]
    )
    const rows = flattenTree({
      roots: [dir('java')],
      chains: new Map([['java', compact]]),
      expanded: new Set(['java/com/ejemplo']), // la hoja
      errors: new Map()
    })
    const r0 = rows[0]
    const compacted =
      r0.kind === 'node' && r0.segments.length === 3 && r0.leaf.path === 'java/com/ejemplo' && r0.isExpanded
    check(
      '(3) cadena compactada, hijo de la hoja a depth 1',
      compacted && sig(rows) === 'java/com/ejemplo@0+ java/com/ejemplo/App.java@1',
      sig(rows)
    )
  }

  // (4a) expandida SIN cadena cargada -> placeholder loading
  {
    const rows = flattenTree({
      roots: [dir('src')],
      chains: new Map(),
      expanded: new Set(['src']),
      errors: new Map()
    })
    check('(4a) expandida sin cadena -> loading', sig(rows) === 'src@0+ !loading@1', sig(rows))
  }
  // (4b) expandida con 0 hijos -> empty
  {
    const rows = flattenTree({
      roots: [dir('empty')],
      chains: new Map([['empty', chain([dir('empty')], [])]]),
      expanded: new Set(['empty']),
      errors: new Map()
    })
    check('(4b) expandida vacía -> empty', sig(rows) === 'empty@0+ !empty@1', sig(rows))
  }
  // (4c) error registrado -> placeholder error con mensaje
  {
    const rows = flattenTree({
      roots: [dir('boom')],
      chains: new Map(),
      expanded: new Set(['boom']),
      errors: new Map([['boom', 'EACCES']])
    })
    const ph = rows[1]
    check(
      '(4c) error -> placeholder con mensaje',
      ph.kind === 'placeholder' && ph.variant === 'error' && ph.message === 'EACCES',
      sig(rows)
    )
  }

  // (5) colapsada NO emite hijos aunque la cadena esté cargada
  {
    const rows = flattenTree({
      roots: [dir('src')],
      chains: new Map([['src', chain([dir('src')], [file('src/x.ts')])]]),
      expanded: new Set(), // colapsada
      errors: new Map()
    })
    check('(5) colapsada no emite hijos', sig(rows) === 'src@0', sig(rows))
  }

  // (6) anidado de varios niveles con expansión parcial
  {
    const rows = flattenTree({
      roots: [dir('a'), file('z.txt')],
      chains: new Map([
        ['a', chain([dir('a')], [dir('a/b'), file('a/f.ts')])],
        ['a/b', chain([dir('a/b')], [file('a/b/deep.ts')])]
      ]),
      expanded: new Set(['a', 'a/b']),
      errors: new Map()
    })
    check(
      '(6) anidado, orden y profundidades',
      sig(rows) === 'a@0+ a/b@1+ a/b/deep.ts@2 a/f.ts@1 z.txt@0',
      sig(rows)
    )
  }

  // (7) refresco con un .jar expandido: su cadena se conserva y se re-lista con su entrada
  {
    const jar: FileEntry = { ...file('lib.jar'), contenedor: 'jar' }
    const chains = new Map([
      ['lib.jar', chain([jar], [dir('lib.jar!/com')])],
      ['lib.jar!/com', chain([dir('lib.jar!/com')], [file('lib.jar!/com/A.class')])],
      ['a', chain([dir('a')], [dir('a/b')])],
      ['a/b', chain([dir('a/b')], [file('a/b/x.ts')])],
      ['cerrado.jar', chain([{ ...file('cerrado.jar'), contenedor: 'jar' }], [file('cerrado.jar!/B.class')])]
    ])
    const entrada = {
      roots: [dir('a'), { ...file('cerrado.jar'), contenedor: 'jar' as const }, jar],
      chains,
      expanded: new Set(['lib.jar', 'lib.jar!/com']),
      errors: new Map<string, string>()
    }
    const antes = flattenTree(entrada)
    const vivas = entradasConCadena(antes)
    const podadas = podarCadenas(chains, vivas)
    const despues = flattenTree({ ...entrada, chains: podadas })
    check(
      '(7a) el .jar expandido entra en el refresco con SU entrada (contenedor)',
      vivas.get('lib.jar')?.contenedor === 'jar',
      JSON.stringify(vivas.get('lib.jar') ?? null)
    )
    check(
      '(7b) se conservan las cadenas del .jar; caen las de ramas colapsadas y el .jar cerrado',
      [...podadas.keys()].sort().join() === 'a,lib.jar,lib.jar!/com',
      [...podadas.keys()].sort().join()
    )
    check('(7c) las filas de dentro del .jar siguen ahí tras el refresco', sig(despues) === sig(antes), sig(despues))
    const sel = { claves: new Set(['lib.jar!/com']), ancla: 'lib.jar!/com', lider: 'lib.jar!/com' }
    const vivasFilas = new Set(despues.flatMap((r) => (r.kind === 'node' ? [r.key] : [])))
    const podada = podarSeleccion(sel, vivasFilas)
    check(
      '(7d) la selección de dentro del .jar sobrevive al files:changed (Ctrl+V no cae a la raíz)',
      podada === sel && podada.lider === 'lib.jar!/com',
      JSON.stringify({ lider: podada.lider, claves: [...podada.claves] })
    )
    check(
      '(7e) necesitaCadena: un .jar CERRADO no se lee; una carpeta colapsada sí',
      !necesitaCadena(antes.find((r) => r.key === 'cerrado.jar')!) && necesitaCadena(antes.find((r) => r.key === 'a')!),
      'ok'
    )
  }

  console.log('\n' + '='.repeat(78))
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  console.log(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(allPass ? 0 : 1)
}

main()
