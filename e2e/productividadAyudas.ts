// =============================================================================
// Ayudas de `conexiones-productividad-consola.spec.ts`: los acordes por plataforma y los
// localizadores del diálogo de parámetros, la pestaña «Plan» y el popover del historial.
// Los acordes salen de la misma tabla que el `title` de los botones (`ACORDES` de
// `renderer/util/atajos.ts`), escritos para el teclado de Playwright; si cambian allí y
// no aquí, la prueba se pone roja, que es lo que tiene que hacer. No es un spec.
// =============================================================================

import { expect, type Locator, type Page } from '@playwright/test'
import { CONSOLA } from './consolaAyudas'
import { MOD } from './tessera'

/** Explicar el plan: Ctrl+Shift+E / ⇧⌘E. */
export const ACORDE_EXPLICAR = `${MOD}+Shift+KeyE`
/** El historial: Ctrl+Shift+H / ⇧⌘H. */
export const ACORDE_HISTORIAL = `${MOD}+Shift+KeyH`
/** Formatear: Ctrl+Alt+L / ⌥⌘L. */
export const ACORDE_FORMATEAR = `${MOD}+Alt+KeyL`

/** El diálogo de parámetros (va por portal a <body>). */
export function dialogoParametros(ventana: Page): Locator {
  return ventana.locator('.modal-card.db-parametros-modal')
}

function exacto(t: string): RegExp {
  return new RegExp(`^${t.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&')}$`)
}

/** El campo de valor de un parámetro por su etiqueta EXACTA (`$1`, `:id`). */
export function campoParametro(ventana: Page, etiqueta: string): Locator {
  return dialogoParametros(ventana)
    .locator('.db-param-fila')
    .filter({ has: ventana.locator('.db-param-nombre', { hasText: exacto(etiqueta) }) })
    .locator('.db-param-valor')
}

/** Las pestañas de la tira de resultados de la consola visible («Salida» incluida). */
export function pestanasResultado(ventana: Page): Locator {
  return ventana.locator(`${CONSOLA} .db-resultados-tabs [role="tab"]`)
}

/** La pestaña de resultado cuyo nombre es EXACTAMENTE `titulo`. */
export function pestanaResultado(ventana: Page, titulo: string): Locator {
  return pestanasResultado(ventana).filter({ has: ventana.locator('.terminal-tab-name', { hasText: exacto(titulo) }) })
}

/** El panel de resultado visible de la consola. */
export function panelVisible(ventana: Page): Locator {
  return ventana.locator(`${CONSOLA} .db-resultados-panel:not(.oculto)`)
}

/** El popover del historial (portal a <body>). */
export function popoverHistorial(ventana: Page): Locator {
  return ventana.locator('.db-hist-pop')
}

/** Las líneas de la Salida de la consola visible, como texto. */
export async function lineasSalida(ventana: Page): Promise<string[]> {
  return ventana.locator(`${CONSOLA} .db-salida .db-salida-texto`).allTextContents()
}

/** Espera a que el popover del historial liste al menos una entrada que contenga `texto`. */
export async function esperarEntradaHistorial(ventana: Page, texto: string): Promise<void> {
  await expect(popoverHistorial(ventana).locator('.db-hist-fila .db-hist-sql', { hasText: texto }).first()).toBeVisible({
    timeout: 15_000
  })
}
