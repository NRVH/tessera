// =============================================================================
// Configuración de build (electron-vite: main + preload + renderer). El tamaño del
// instalador lo decide `package.json`, no este archivo: electron-builder empaqueta el
// árbol entero de `dependencies` sin comprimir (`asar: false`), así que lo que Vite ya
// bundlea va en `devDependencies` (monaco-editor, react, @xterm/*, …) y en `dependencies`
// solo lo que el main carga en ejecución (node-pty, oracledb, pg, electron-updater y lo que
// `externalizeDepsPlugin` deja fuera). Hacerlo bien quitó ~110 MB, 97 de monaco-editor, y
// con ellos las rutas más profundas de `resources/app/node_modules`: el borde de MAX_PATH
// del instalador (el «error 2» que vigila el pre-vuelo de `src/main/update`).
// =============================================================================

import { resolve, join, normalize, sep } from 'node:path'
import fs from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Sirve los SVG de `vscode-material-icons` (los logos reales del explorador) sin
 * meterlos en git ni inflar el bundle JS: en DEV los expone bajo `/material-icons/`
 * leyéndolos de node_modules; en BUILD copia la carpeta a `out/renderer/material-icons`.
 * Así `fileIcons.tsx` referencia `<img src="./material-icons/<icono>.svg">` y resuelve
 * igual con el dev-server (http) y con `loadFile` en producción (file://). Son ~910
 * archivos que el navegador pide bajo demanda (uno por tipo visible), no van al JS.
 */
function materialIconsPlugin(): Plugin {
  const iconsDir = resolve(__dirname, 'node_modules/vscode-material-icons/generated/icons')
  return {
    name: 'tessera-material-icons',
    buildStart() {
      // `vscode-material-icons` es una devDependency A PROPÓSITO (ver la cabecera de
      // este archivo): sus SVG se COPIAN aquí a out/renderer y en
      // ejecución se sirven desde ahí, nunca desde node_modules. El precio es que un
      // `npm ci --omit=dev` ANTES de construir deja la carpeta sin instalar, y entonces
      // el `cpSync` de writeBundle revienta con un ENOENT crudo a mitad del build, que
      // no dice nada de lo que pasa. Este aviso convierte ese fallo en uno legible.
      if (!fs.existsSync(iconsDir)) {
        this.error(
          `No se encuentran los iconos en ${iconsDir}. ` +
            'vscode-material-icons es una devDependency: instala TODAS las dependencias ' +
            '(npm install) antes de construir, no solo las de producción.'
        )
      }
    },
    configureServer(server) {
      server.middlewares.use('/material-icons', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        const file = normalize(join(iconsDir, rel))
        // Anti-traversal: solo servir DENTRO de iconsDir (con separador final, para
        // que un hermano con prefijo común no pase) y solo .svg existentes.
        if (!file.startsWith(iconsDir + sep) || !file.endsWith('.svg') || !fs.existsSync(file)) {
          return next()
        }
        res.setHeader('Content-Type', 'image/svg+xml')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      // options.dir = out/renderer (única salida del renderer). Copia el set completo.
      const dir = options.dir
      if (!dir) return
      fs.cpSync(iconsDir, join(dir, 'material-icons'), { recursive: true })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Tres entradas: el main (index) y los dos worker_threads que corren CPU
        // pesada fuera del hilo main —los visores (unzip/mammoth) y el barrido de
        // la búsqueda en archivos—. Cada clave emite `out/main/<clave>.js`; quien
        // los lanza (FileService / SearchService) los carga por esa ruta emitida.
        //
        // Son DOS workers y no uno con dos tareas porque su protocolo es distinto:
        // `fileWorker` es de una tarea y una respuesta; `searchWorker` publica
        // resultados a chorros y se cancela con `terminate()`.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          fileWorker: resolve(__dirname, 'src/main/workers/fileWorker.ts'),
          searchWorker: resolve(__dirname, 'src/main/workers/searchWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    server: {
      // host: true => escucha en 0.0.0.0; strictPort => falla si está ocupado en vez de
      // saltar a otro puerto (esconder la colisión dejaría el arranque no determinista: la
      // ventana cargaría de un puerto distinto cada vez). El puerto NO puede ser 1455: es
      // también `CODEX_CALLBACK_PORT` (SandboxManager.ts) y Docker Desktop lo publica en
      // `127.0.0.1:1455` en cuanto un perfil con Codex levanta su contenedor, así que
      // `npm run dev` abortaba con «Port 1455 is already in use» según qué perfiles
      // tuvieras arriba.
      host: true,
      port: 1460,
      strictPort: true
    },
    build: {
      // MINIFICAR EL RENDERER, que NO es el default. electron-vite fija `minify: false`
      // para las tres capas, así que el chunk de arranque venía siendo fuente legible:
      // 8,04 MB en 205.650 líneas que V8 parsea ANTES del primer pixel. Medido tras el
      // cambio: 4,29 MB, y el JS total del renderer pasa de 24,9 a 13,3 MiB. Es la única
      // capa donde compensa: el main y el preload (526 KB + 38 KB) se quedan SIN
      // minificar a propósito, porque su parseo son ~5-10 ms de un arranque de segundos
      // y a cambio se perderían las trazas del proceso main, que son justo las que se
      // leen cuando fallan Docker o node-pty.
      minify: 'esbuild',
      // Sourcemaps SÍ, porque sin ellos el crash-log que `main.tsx` ya vuelca a disco
      // con `e.stack` queda inservible en cuanto se minifica, y eso es tirar una
      // inversión ya hecha. En ejecución no cuestan nada: el `.map` solo se lee si
      // abres DevTools.
      // PERO NO VIAJAN TODOS, y el reparto medido explica por qué: de los 42 MB de
      // mapas, 24,8 son de los WORKERS de Monaco (código de terceros que no se depura
      // desde aquí) y 17,2 del código de Tessera. Como `electron-builder` empaqueta
      // `out/**` con `asar: false`, meterlos todos devolvía casi el 40 % de los ~110 MB
      // que se acababan de ahorrar. Los de los workers se excluyen del INSTALADOR en
      // `electron-builder.yml`; aquí se emiten igual, para poder depurarlos en local.
      sourcemap: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    // Conserva los nombres de funciones y clases al minificar. Es un seguro barato, no
    // una necesidad demostrada: se auditó y no hay un solo `constructor.name` ni
    // `displayName` en el renderer ni en el preload. Pero elimina de golpe toda la clase
    // de fallo "algo dependía de un nombre" y deja el crash-log legible sin tener que
    // resolver un sourcemap a mano.
    esbuild: { keepNames: true },
    plugins: [react(), materialIconsPlugin()]
  }
})
