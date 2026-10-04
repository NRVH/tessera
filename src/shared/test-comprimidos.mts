#!/usr/bin/env node
// =============================================================================
// Prueba del catálogo de COMPRIMIDOS COMPARABLES (npm run test:comprimidos): qué
// archivo abre el diff de contenedores en vez del aviso de binario. De más, mete algo
// que `zipRandom` no lee (.7z, .tar.gz); de menos, vuelve el callejón sin salida.
// Cubre: la familia ZIP dentro y el resto fuera; MAYÚSCULAS (.JAR); `carpeta.jar/x.ts`
// NO es comprimido; y el invariante EXT_COMPRIMIDOS contiene a EXT_CONTENEDOR, para
// que el diff herede solo lo que se añada al árbol de archivos.
// =============================================================================

import { EXT_COMPRIMIDOS, esComprimido } from './comprimidos.ts'
import { EXT_CONTENEDOR } from './jarPath.ts'

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

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) La familia ZIP entra; lo que no es ZIP, no')
  const dentro = [
    'codigo/lib/ConstanciasClientEJB.jar',
    'dist/app.war',
    'entregables/Sistema.ear',
    'libs/comunes.aar',
    'respaldo.zip',
    'movil/app.apk',
    'python/paquete-1.0.whl',
    'dotnet/Paquete.1.0.0.nupkg',
    'jdk/java.base.jmod'
  ]
  for (const ruta of dentro) {
    check(`comparable: ${ruta}`, esComprimido(ruta), 'true')
  }

  const fuera = [
    'respaldo.7z',
    'respaldo.rar',
    'respaldo.tar',
    'respaldo.tar.gz',
    'respaldo.tgz',
    'imagen.iso',
    'src/App.tsx',
    'com/ejemplo/Servicio.class',
    'docs/manual.pdf',
    'build/icon.png'
  ]
  for (const ruta of fuera) {
    check(`NO comparable: ${ruta}`, !esComprimido(ruta), 'false')
  }

  // -------------------------------------------------------------------------
  hr('(2) Mayúsculas y rutas raras')
  check('LIB/COMUNES.JAR (mayúsculas) sí es comprimido', esComprimido('LIB/COMUNES.JAR'), 'true')
  check('Entregable.EAR sí es comprimido', esComprimido('Entregable.EAR'), 'true')
  check('sin extensión (bin/run) no lo es', !esComprimido('bin/run'), 'false')
  check('Makefile no lo es', !esComprimido('Makefile'), 'false')
  check('cadena vacía no lo es', !esComprimido(''), 'false')
  check('un punto final (notas.) no lo es', !esComprimido('notas.'), 'false')

  // -------------------------------------------------------------------------
  hr('(3) El punto antes del último "/" no cuenta')
  check(
    'carpeta.jar/x.ts NO es comprimido (la extensión es ts)',
    !esComprimido('carpeta.jar/x.ts'),
    'false'
  )
  check(
    'carpeta.zip/otra/archivo NO es comprimido (no hay extensión)',
    !esComprimido('carpeta.zip/otra/archivo'),
    'false'
  )
  check(
    'carpeta.old/lib.jar SÍ lo es (la extensión es jar)',
    esComprimido('carpeta.old/lib.jar'),
    'true'
  )

  // -------------------------------------------------------------------------
  hr('(4) INVARIANTE: el catálogo del diff CONTIENE al del árbol')
  const faltan = [...EXT_CONTENEDOR].filter((ext) => !EXT_COMPRIMIDOS.has(ext))
  check(
    'toda EXT_CONTENEDOR está en EXT_COMPRIMIDOS',
    faltan.length === 0,
    faltan.length === 0 ? `las ${EXT_CONTENEDOR.size} están` : `faltan: ${faltan.join(', ')}`
  )
  check(
    'y EXT_COMPRIMIDOS es ESTRICTAMENTE mayor (al menos .zip de más)',
    EXT_COMPRIMIDOS.size > EXT_CONTENEDOR.size && EXT_COMPRIMIDOS.has('zip'),
    `${EXT_COMPRIMIDOS.size} > ${EXT_CONTENEDOR.size}`
  )

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
