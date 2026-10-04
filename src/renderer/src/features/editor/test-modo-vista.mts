#!/usr/bin/env node
// =============================================================================
// Prueba de `modoVista`: qué archivos se pueden previsualizar y qué enseña cada modo.
// (node src/renderer/src/features/editor/test-modo-vista.mts)
// Fija la clasificación por extensión (un punto en una carpeta no es extensión), que 'dividida'
// cuenta como código y como vista, y la poda del modo al cambiar de archivo en un pane keep-alive.
// =============================================================================

import {
  MODOS_VISTA,
  modoInicialPara,
  modoAplicable,
  muestraCodigo,
  muestraVista,
  vistaPreviaDe,
  type ModoVista
} from './modoVista.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78) + `\n${title}\n` + '='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: unknown = ''): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence === '' ? '' : ` -> ${String(evidence)}`}`)
}

hr('(1) Qué archivo se puede previsualizar')
{
  check("'README.md' es markdown", vistaPreviaDe('README.md') === 'markdown')
  check("'docs/guia.markdown' también", vistaPreviaDe('docs/guia.markdown') === 'markdown')
  check('la extensión no distingue mayúsculas', vistaPreviaDe('LEEME.MD') === 'markdown')
  check("'arquitectura.mmd' es un diagrama", vistaPreviaDe('arquitectura.mmd') === 'mermaid')
  check("'flujo.mermaid' también", vistaPreviaDe('flujo.mermaid') === 'mermaid')
  check("'informe.html' es html", vistaPreviaDe('informe.html') === 'html')
  check("'pagina.htm' también", vistaPreviaDe('pagina.htm') === 'html')
  // Fuera a propósito: no son HTML que un navegador pueda pintar tal cual, así que
  // la vista previa enseñaría una página rota. Ver `vistaPreviaDe`.
  check("'vista.ejs' NO (es una plantilla)", vistaPreviaDe('vista.ejs') === null)
  check("'App.vue' NO", vistaPreviaDe('App.vue') === null)
  check("'src/App.java' no tiene vista previa", vistaPreviaDe('src/App.java') === null)
  check('un archivo sin extensión tampoco', vistaPreviaDe('Makefile') === null)
  // La trampa que ya cubría `extensionDe`: el punto está en la CARPETA.
  check(
    'un punto en la carpeta no cuenta como extensión',
    vistaPreviaDe('notas.md/informe.java') === null,
    vistaPreviaDe('notas.md/informe.java')
  )
  check(
    'y al revés, la carpeta no impide reconocer el archivo',
    vistaPreviaDe('v1.2/notas.md') === 'markdown',
    vistaPreviaDe('v1.2/notas.md')
  )
}

hr('(2) Qué enseña cada modo')
{
  check('el control tiene tres posiciones', MODOS_VISTA.length === 3, MODOS_VISTA.join(' / '))
  // El modo inicial depende del FORMATO: un .md es un documento que se lee, así que
  // entra renderizado (es como se comportaba desde que existe su visor); lo que no
  // tiene previsualización no puede empezar en otra cosa que no sea código.
  check("un .md se abre en 'vista'", modoInicialPara('README.md') === 'vista', modoInicialPara('README.md'))
  check("un .java se abre en 'codigo'", modoInicialPara('src/App.java') === 'codigo', modoInicialPara('src/App.java'))
  // Un .mmd es FUENTE que se edita, no un documento que se lee: entra en código y la
  // previsualización se pide. Es lo que se acordó para mermaid y HTML.
  check("un .mmd se abre en 'codigo'", modoInicialPara('flujo.mmd') === 'codigo', modoInicialPara('flujo.mmd'))
  check("y un .html también", modoInicialPara('pagina.html') === 'codigo', modoInicialPara('pagina.html'))
  check(
    'el modo inicial siempre es aplicable a su propio archivo',
    modoAplicable(modoInicialPara('src/App.java'), 'src/App.java') === modoInicialPara('src/App.java')
  )

  check("'codigo' enseña el editor y NO la vista", muestraCodigo('codigo') && !muestraVista('codigo'))
  check("'vista' enseña la vista y NO el editor", muestraVista('vista') && !muestraCodigo('vista'))
  // La propiedad de la que cuelga el layout dividido.
  check(
    "'dividida' enseña LAS DOS",
    muestraCodigo('dividida') && muestraVista('dividida')
  )
  // Ningún modo deja el pane vacío: siempre se ve al menos uno de los dos.
  for (const m of MODOS_VISTA) {
    check(`'${m}' nunca deja el pane vacío`, muestraCodigo(m) || muestraVista(m))
  }
}

hr('(3) Poda al cambiar de archivo (keep-alive)')
{
  for (const m of MODOS_VISTA) {
    check(
      `'${m}' se conserva en un .md`,
      modoAplicable(m, 'README.md') === m,
      modoAplicable(m, 'README.md')
    )
  }
  check(
    "'vista' cae a 'codigo' en un archivo sin previsualización",
    modoAplicable('vista', 'src/App.java') === 'codigo',
    modoAplicable('vista', 'src/App.java')
  )
  check(
    "y 'dividida' también",
    modoAplicable('dividida', 'src/App.java') === 'codigo',
    modoAplicable('dividida', 'src/App.java')
  )
  check(
    'podar es idempotente',
    modoAplicable(modoAplicable('vista' as ModoVista, 'a.java'), 'a.java') === 'codigo'
  )
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const ok = results.filter((r) => r.pass).length
const allPass = ok === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${ok}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
