// =============================================================================
// Medición del uso de cuenta y sus límites dentro del pie del agente.
// Comparte la misma geometría entre las pruebas del uso propio y de cuentas ocultas.
// El ancho se aplica al pie para recorrer también los tamaños del mosaico.
// =============================================================================
import type { Page } from '@playwright/test'

export async function medirPie(win: Page, ancho: number): Promise<{ visibles: number; cortadas: number; barras: boolean; encimado: boolean }> {
  return win.evaluate(async (px) => {
    const pie = document.querySelector<HTMLElement>('.agent-pane:not(.hidden) .agent-pane-footer')!
    pie.style.width = `${px}px`
    pie.style.flex = '0 0 auto'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const uso = pie.querySelector<HTMLElement>('.agent-usage')
    const marco = uso?.getBoundingClientRect()
    const items = uso && marco && marco.width > 0 ? Array.from(uso.querySelectorAll<HTMLElement>('.agent-usage-item')) : []
    let visibles = 0
    let cortadas = 0
    for (const el of items) {
      const c = el.getBoundingClientRect()
      if (c.width === 0 || c.top >= marco!.bottom) continue // oculta, o en la fila que no se ve
      visibles++
      if (c.right > marco!.right + 0.5 || c.bottom > marco!.bottom + 0.5) cortadas++
    }
    const barra = uso?.querySelector<HTMLElement>('.agent-usage-mini')
    const stats = pie.querySelector<HTMLElement>('.agent-footer-stats')!.getBoundingClientRect()
    const boton = pie.querySelector<HTMLElement>('.agent-reload-btn')!.getBoundingClientRect()
    // El rótulo de dónde vive el agente va entre los dos: tampoco puede pisar a ninguno.
    const lugar = pie.querySelector<HTMLElement>('.agent-footer-lugar')!.getBoundingClientRect()
    const conLugar = lugar.width > 0
    return {
      visibles,
      cortadas,
      barras: !!barra && barra.getBoundingClientRect().width > 0,
      encimado:
        (stats.width > 0 && stats.right > boton.left + 0.5) || (conLugar && boton.right > lugar.left + 0.5)
    }
  }, ancho)
}
