#!/usr/bin/env node
// =============================================================================
// Prueba de la recarga en vivo de pestañas (npm run test:recarga-en-vivo).
// Fija qué buffers se releen cuando un archivo cambia por fuera: solo el target activo, nunca un
// buffer sucio, `parcial` manda sobre la lista y solo pestañas de archivo. Los sucios no se
// releen pero sí se comprueban (`panesAComprobar`), sin tocar el buffer.
// Decisiones: docs/decisiones/editor/recarga-en-vivo.md
// =============================================================================

import { panesAComprobar, panesARecargar } from './recargaEnVivo.ts'
import type { EditorTab } from './editorTabsModel.ts'

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

/** Misma composición que App: target + id, separados por NUL. */
const paneKey = (t: string, id: string): string => `${t}\u0000${id}`
const TARGET = 'perfil-alfa\u0000C:/proy'

const archivo = (path: string): EditorTab =>
  ({ id: path, pane: { kind: 'file', file: { path, name: path.split('/').pop() ?? path } } }) as EditorTab
const sinTitulo = (id: string): EditorTab =>
  ({ id, pane: { kind: 'untitled', untitled: { id, name: 'sin titulo' } } }) as EditorTab
const diff = (id: string): EditorTab => ({ id, pane: { kind: 'diff', target: {} } }) as EditorTab

const base = {
  parcial: false,
  sucios: new Set<string>(),
  targetKey: TARGET as string | null,
  paneKey
}

function main(): void {
  const tabs = [archivo('README.md'), archivo('src/a.ts'), sinTitulo('untitled-1'), diff('diff:WORKTREE:src/a.ts')]

  // -------------------------------------------------------------------------
  hr('1) LO NORMAL: solo el archivo que cambió')
  {
    const r = panesARecargar({ ...base, tabs, cambiadas: ['README.md'] })
    check(
      'recarga la pestaña del archivo cambiado, y solo esa',
      r.length === 1 && r[0] === paneKey(TARGET, 'README.md'),
      JSON.stringify(r)
    )
    check(
      'un cambio que no corresponde a ninguna pestaña no recarga nada',
      panesARecargar({ ...base, tabs, cambiadas: ['otro/fichero.txt'] }).length === 0,
      '[]'
    )
    check(
      'sin cambios no hay recarga (el watcher habla más que el editor)',
      panesARecargar({ ...base, tabs, cambiadas: [] }).length === 0,
      '[]'
    )
  }

  // -------------------------------------------------------------------------
  hr('2) NUNCA UN BUFFER SUCIO')
  {
    const sucios = new Set([paneKey(TARGET, 'README.md')])
    check(
      'el archivo cambiado NO se recarga si tiene cambios sin guardar',
      panesARecargar({ ...base, tabs, cambiadas: ['README.md'], sucios }).length === 0,
      'protegido'
    )
    const r = panesARecargar({ ...base, tabs, cambiadas: ['README.md', 'src/a.ts'], sucios })
    check(
      'y su vecino LIMPIO sí se recarga (proteger uno no bloquea a los demás)',
      r.length === 1 && r[0] === paneKey(TARGET, 'src/a.ts'),
      JSON.stringify(r)
    )
    // El dirty se indexa por paneKey, no por id: el mismo nombre de archivo sucio en
    // OTRO proyecto no puede proteger —ni desproteger— a este.
    const sucioAjeno = new Set([paneKey('otro-target', 'README.md')])
    check(
      'un sucio del MISMO nombre en otro target no afecta a este',
      panesARecargar({ ...base, tabs, cambiadas: ['README.md'], sucios: sucioAjeno }).length === 1,
      'no interfiere'
    )
  }

  // -------------------------------------------------------------------------
  hr('3) `parcial`: la lista truncada no se cree')
  {
    const r = panesARecargar({ ...base, tabs, cambiadas: [], parcial: true })
    check(
      'con parcial y SIN rutas se releen todas las de archivo',
      r.length === 2 &&
        r.includes(paneKey(TARGET, 'README.md')) &&
        r.includes(paneKey(TARGET, 'src/a.ts')),
      JSON.stringify(r)
    )
    const sucios = new Set([paneKey(TARGET, 'src/a.ts')])
    check(
      'parcial NO es excusa para machacar un buffer sucio',
      panesARecargar({ ...base, tabs, cambiadas: [], parcial: true, sucios }).length === 1,
      'el sucio sigue protegido'
    )
  }

  // -------------------------------------------------------------------------
  hr('4) SOLO PESTAÑAS DE ARCHIVO, Y SOLO DEL TARGET ACTIVO')
  {
    check(
      'un untitled nunca se recarga (no existe en disco)',
      panesARecargar({ ...base, tabs, cambiadas: ['untitled-1'], parcial: true }).every(
        (k) => !k.endsWith('untitled-1')
      ),
      'excluido'
    )
    check(
      'un diff nunca se recarga (su contenido sale de git)',
      panesARecargar({ ...base, tabs, cambiadas: [], parcial: true }).every(
        (k) => !k.includes('diff:')
      ),
      'excluido'
    )
    check(
      'sin target confirmado no se recarga NADA (leería el proyecto equivocado)',
      panesARecargar({ ...base, tabs, cambiadas: ['README.md'], targetKey: null }).length === 0,
      '[]'
    )
    check(
      'las claves devueltas llevan SIEMPRE el target activo',
      panesARecargar({ ...base, tabs, cambiadas: [], parcial: true }).every((k) =>
        k.startsWith(TARGET)
      ),
      'namespaced'
    )
  }

  // -------------------------------------------------------------------------
  hr('5) panesAComprobar: las SUCIAS no releen, pero sí se les pregunta si existen')
  {
    const sucios = new Set([paneKey(TARGET, 'README.md')])
    const comprobar = panesAComprobar({ ...base, tabs, cambiadas: ['README.md'], sucios })
    check(
      'la pestaña sucia que cambió entra a COMPROBAR (es la que reload no puede tocar)',
      comprobar.length === 1 && comprobar[0] === paneKey(TARGET, 'README.md'),
      JSON.stringify(comprobar)
    )
    check(
      'y no entra a recargar: las dos listas son DISJUNTAS',
      panesARecargar({ ...base, tabs, cambiadas: ['README.md'], sucios }).length === 0,
      'sin solape'
    )
    // Un buffer LIMPIO no se pregunta dos veces: al releer ya se enteraría del
    // borrado, así que preguntarle sería un viaje al main de más por cada cambio.
    check(
      'un buffer LIMPIO no se comprueba (ya se entera al releer)',
      panesAComprobar({ ...base, tabs, cambiadas: ['README.md'] }).length === 0,
      '[]'
    )
    const entrada = { ...base, tabs, cambiadas: ['README.md', 'src/a.ts'], sucios }
    const union = [...panesAComprobar(entrada), ...panesARecargar(entrada)].sort()
    check(
      'juntas cubren TODOS los candidatos, sin repetir ninguno',
      union.length === 2 &&
        union[0] === paneKey(TARGET, 'README.md') &&
        union[1] === paneKey(TARGET, 'src/a.ts'),
      JSON.stringify(union)
    )
    // Las mismas cuatro reglas valen igual: un untitled no tiene disco que mirar y
    // sin target confirmado la ruta se resolvería contra el proyecto equivocado.
    const todoSucio = new Set([
      paneKey(TARGET, 'README.md'),
      paneKey(TARGET, 'src/a.ts'),
      paneKey(TARGET, 'untitled-1'),
      paneKey(TARGET, 'diff:WORKTREE:src/a.ts')
    ])
    const conParcial = panesAComprobar({ ...base, tabs, cambiadas: [], parcial: true, sucios: todoSucio })
    check(
      'solo pestañas de ARCHIVO, también al comprobar',
      conParcial.length === 2 && conParcial.every((k) => !k.includes('untitled') && !k.includes('diff:')),
      JSON.stringify(conParcial)
    )
    check(
      'sin target confirmado no se comprueba nada',
      panesAComprobar({ ...base, tabs, cambiadas: ['README.md'], sucios, targetKey: null }).length === 0,
      '[]'
    )
  }

  // -------------------------------------------------------------------------
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
