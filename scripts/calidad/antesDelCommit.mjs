#!/usr/bin/env node
// =============================================================================
// Lo que corre el hook `pre-commit` (`.githooks/`): tipos, lint y las guardias de texto, en
// paralelo si el commit lleva código o configuración. Las guardias de texto y la de idioma miran el
// commit; tipos, ciclos y claves persistidas, el programa entero, porque sus dependencias cruzan archivos.
// `git commit --no-verify` lo salta: solo para un commit que no es de código ejecutable.
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================

import { execFileSync, spawn } from 'node:child_process'

const CODIGO = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/
const CONFIG = /^(package(-lock)?\.json|tsconfig[^/]*\.json|eslint\.config\.mjs|scripts\/calidad\/claves-persistidas\.tsv)$/

const preparados = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)
const codigo = preparados.filter((f) => CODIGO.test(f) && !f.startsWith('out/') && !f.startsWith('dist/'))

if (codigo.length === 0 && !preparados.some((f) => CONFIG.test(f))) process.exit(0)

try {
  execFileSync('git', ['diff', '--quiet', '--', 'scripts/calidad/claves-persistidas.tsv'], { stdio: 'pipe' })
} catch (error) {
  console.error(error.status === 1
    ? '\n== lista-preparada: FALLA\nLa lista de claves persistidas tiene cambios sin preparar: el commit dejaría claves sin protección. Añada la lista al commit.\n\nantes del commit: el commit no se hace.'
    : `\n== lista-preparada: FALLA\nNo se pudo comprobar la lista: el commit podría dejar claves sin protección. Corrija el acceso a git y repita.\n${error.message}`)
  process.exit(error.status === 1 ? 1 : 2)
}

// Las rutas van como argumentos de `node`, sin shell: ni se parten por espacios ni chocan con el
// límite de la línea de órdenes de Windows. Un commit muy grande se revisa entero.
const rutas = codigo.length > 300 ? [] : codigo
const ejecutableJs = (script, args) => [process.execPath, [script, ...args]]
const pasos = [
  ['tipos', 'npm', ['run', '-s', 'typecheck']],
  ['claves', ...ejecutableJs('scripts/calidad/test-claves-persistidas.mts', ['--programa', 'node'])],
  ['claves-web', ...ejecutableJs('scripts/calidad/test-claves-persistidas.mts', ['--programa', 'web'])],
  ['ciclos', ...ejecutableJs('scripts/calidad/test-ciclos.mts', [])],
  ...(codigo.length === 0
    ? []
    : [
        ['lint', ...ejecutableJs('node_modules/eslint/bin/eslint.js', ['--quiet', ...(rutas.length ? rutas : ['.'])])],
        ['cabeceras', ...ejecutableJs('scripts/calidad/test-cabeceras.mts', rutas)],
        ['menciones', ...ejecutableJs('scripts/calidad/test-menciones.mts', rutas)],
        ['comentarios', ...ejecutableJs('scripts/calidad/test-comentarios.mts', rutas)],
        ['textos', ...ejecutableJs('scripts/calidad/test-textos.mts', rutas)],
        ['registro', ...ejecutableJs('scripts/calidad/test-registro.mts', rutas)],
        ['idioma', ...ejecutableJs('scripts/calidad/test-idioma.mts', ['--commit'])]
      ])
]

/** Corre un paso guardando su salida, para enseñarla solo si falla. */
function correr([nombre, orden, args]) {
  return new Promise((resolver) => {
    // Solo `npm` necesita shell (en Windows es un `.cmd`), y no lleva rutas.
    const hijo = spawn(orden, args, { shell: orden === 'npm' })
    let salida = ''
    hijo.stdout.on('data', (d) => (salida += d))
    hijo.stderr.on('data', (d) => (salida += d))
    hijo.on('close', (codigoSalida) => resolver({ nombre, ok: codigoSalida === 0, salida }))
  })
}

const resultados = await Promise.all(pasos.map(correr))
const fallos = resultados.filter((r) => !r.ok)
for (const f of fallos) console.error(`\n== ${f.nombre}: FALLA\n${f.salida.trim()}`)
// Un paso en verde puede avisar sin detener el commit: se enseña lo que dijo antes de su informe.
for (const r of resultados.filter((p) => p.ok && /^AVISO\b/m.test(p.salida))) {
  console.error(`\n== ${r.nombre}: AVISO\n${r.salida.split(/\n=+\nRESULTADO/)[0].trim()}`)
}
console.error(
  fallos.length === 0
    ? `antes del commit: ${resultados.map((r) => r.nombre).join(', ')} en verde`
    : `\nantes del commit: ${fallos.length} paso(s) en rojo; el commit no se hace.`
)
process.exit(fallos.length === 0 ? 0 : 1)
