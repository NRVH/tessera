#!/usr/bin/env node
// =============================================================================
// Lo que corre el hook `pre-commit` (`.githooks/`): tipos, lint y las guardias de texto, en
// paralelo y solo si el commit lleva código. Lint y guardias miran los archivos del commit; tipos y
// ciclos, el repo entero, porque un cambio rompe a quien lo importa. Sale 1 si algo falla.
// `git commit --no-verify` lo salta: solo para un commit que no es de código ejecutable.
// =============================================================================

import { execFileSync, spawn } from 'node:child_process'

const CODIGO = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/
const CONFIG = /^(package(-lock)?\.json|tsconfig[^/]*\.json|eslint\.config\.mjs)$/

const preparados = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)
const codigo = preparados.filter((f) => CODIGO.test(f) && !f.startsWith('out/') && !f.startsWith('dist/'))

if (codigo.length === 0 && !preparados.some((f) => CONFIG.test(f))) process.exit(0)

// Las rutas van como argumentos de `node`, sin shell: ni se parten por espacios ni chocan con el
// límite de la línea de órdenes de Windows. Un commit muy grande se revisa entero.
const rutas = codigo.length > 300 ? [] : codigo
const node = (script, args) => [process.execPath, [script, ...args]]
const pasos = [
  ['tipos', 'npm', ['run', '-s', 'typecheck']],
  ['ciclos', ...node('scripts/calidad/test-ciclos.mts', [])],
  ...(codigo.length === 0
    ? []
    : [
        ['lint', ...node('node_modules/eslint/bin/eslint.js', ['--quiet', ...(rutas.length ? rutas : ['.'])])],
        ['cabeceras', ...node('scripts/calidad/test-cabeceras.mts', rutas)],
        ['menciones', ...node('scripts/calidad/test-menciones.mts', rutas)],
        ['comentarios', ...node('scripts/calidad/test-comentarios.mts', rutas)],
        ['textos', ...node('scripts/calidad/test-textos.mts', rutas)]
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
console.error(
  fallos.length === 0
    ? `antes del commit: ${resultados.map((r) => r.nombre).join(', ')} en verde`
    : `\nantes del commit: ${fallos.length} paso(s) en rojo; el commit no se hace.`
)
process.exit(fallos.length === 0 ? 0 : 1)
