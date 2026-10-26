#!/usr/bin/env node
// =============================================================================
// Compila las tres capas (`electron-vite build`, dos pasadas: la segunda, la página de la ventana de
// agente) con heap para V8 y, en Windows, el programa de contraseñas de SSH (`compilarAskpass.mjs`).
// Node dimensiona el heap según la RAM: con 8 GB da ~2,2 GB y Rollup (~3.350 módulos y 55 MB de
// sourcemaps, ver `electron.vite.config.ts`) muere con «heap out of memory». Se lanza `process.execPath`
// con `--max-old-space-size=4096` (holgura sin paginar 8 GB) salvo que `NODE_OPTIONS` ya pida uno, que
// gana. Vale en las dos plataformas: evita el `.bin/electron-vite`, que en Windows es un `.cmd`.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { compilarAskpass } from './compilarAskpass.mjs'

const require = createRequire(import.meta.url)

// `electron-vite/bin/electron-vite.js` NO se puede pedir directo: el `exports` del
// paquete sólo publica `.`, `./node` y `./package.json`, y pedir cualquier otra cosa
// muere con ERR_PACKAGE_PATH_NOT_EXPORTED. Se resuelve el `package.json` —que sí está
// exportado— y se compone la ruta desde su carpeta, que además aguanta que npm lo
// haya izado a un `node_modules` de más arriba.
const binario = path.join(
  path.dirname(require.resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js'
)

const HEAP = '--max-old-space-size=4096'
const heapYaPedido = /--max-old-space-size=/.test(process.env.NODE_OPTIONS ?? '')

/** Una pasada de `electron-vite build`; la de la página de agente no vacía `out/renderer`. */
function pasada(pagina) {
  return spawnSync(process.execPath, [...(heapYaPedido ? [] : [HEAP]), binario, 'build', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TESSERA_COMPILAR_PAGINA: pagina }
  })
}

// Dos pasadas: la ventana principal y, sobre su salida, la página de la ventana de agente (por qué, en
// `electron.vite.config.ts`).
let resultado = pasada('principal')
if (resultado.status === 0) resultado = pasada('agente')
const { status, signal, error } = resultado

if (error) {
  console.error(`[compilar] no se pudo lanzar electron-vite: ${error.message}`)
  process.exit(1)
}

// `status` es null si lo mató una señal; en ese caso no hay código que propagar y
// devolver 0 sería decir que compiló. Y se DICE: el OOM de V8 acaba en SIGABRT, y
// sin esta línea lo último en pantalla son cuarenta líneas de pila de node.
if (signal) {
  console.error(
    `\n[compilar] electron-vite murió por ${signal}.` +
      (signal === 'SIGABRT'
        ? ' Si justo encima pone «JavaScript heap out of memory», el build ya no cabe en el ' +
          `heap (${heapYaPedido ? 'el de tu NODE_OPTIONS' : HEAP}): súbelo con ` +
          'NODE_OPTIONS=--max-old-space-size=<MB>, que este script respeta.'
        : '')
  )
}
if (status === 0) {
  try {
    compilarAskpass({ siempre: true })
  } catch (e) {
    console.error(`[compilar] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
process.exit(status ?? 1)
