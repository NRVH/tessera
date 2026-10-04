// =============================================================================
// Configuración de las pruebas de interfaz (Playwright + Electron). No hay navegador ni
// `webServer`: el «browser» es la Tessera empaquetada que lanza `abrirTessera()` en cada
// prueba. `workers: 1` y `fullyParallel: false` porque el foco del teclado, el menú de
// aplicación y el semáforo son globales del sistema; `retries: 0` porque un reintento
// escondería justo el intermitente que estas pruebas existen para cazar.
// Decisiones: docs/decisiones/pruebas/arnes-e2e-sobre-la-app-empaquetada.md
// =============================================================================

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Los archivos del arnés (`tessera.ts`) no son specs; sólo lo que acaba en
  // `.spec.ts` se ejecuta.
  testMatch: '**/*.spec.ts',
  // Las capturas del README no son una prueba: solo corren con `npm run capturas:readme`.
  testIgnore: process.env.TESSERA_CAPTURAS_README === '1' ? [] : '**/capturas-readme.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Arrancar una app empaquetada, esperar a `ready-to-show` y hacer varias
  // capturas se sale de los 30 s por defecto en un arranque frío.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // `list` y no `html`: el informe HTML abre un servidor y un navegador al terminar,
  // que en una sesión sin pantalla se queda colgado esperando a que alguien lo cierre.
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  outputDir: 'e2e/.resultados'
})
