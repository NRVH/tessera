#!/usr/bin/env node
// =============================================================================
// Compila las tres capas (`electron-vite build`) con heap suficiente para V8. Node dimensiona
// el heap según la RAM: en una máquina de 8 GB da ~2,2 GB y Rollup, que sostiene ~3.350
// módulos y 55 MB de sourcemaps (puestos a propósito: ver `electron.vite.config.ts`), muere
// con «heap out of memory» en «rendering chunks» y `dist/` se queda con la versión anterior.
// Se lanza `process.execPath` con `--max-old-space-size=4096` (holgura sin paginar 8 GB;
// un techo exagerado convierte una fuga en media hora de paginación) salvo que `NODE_OPTIONS`
// ya pida uno: la bandera de la línea de órdenes GANA a la variable, y se la respeta. Vale
// en las dos plataformas: evita el `.bin/electron-vite`, que en Windows es un `.cmd`.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

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

const { status, signal, error } = spawnSync(
  process.execPath,
  [...(heapYaPedido ? [] : [HEAP]), binario, 'build', ...process.argv.slice(2)],
  { stdio: 'inherit' }
)

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
process.exit(status ?? 1)
