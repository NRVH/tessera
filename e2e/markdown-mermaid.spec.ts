// =============================================================================
// Un bloque mermaid de un Markdown se dibuja con el texto de sus etiquetas en la vista renderizada: las
// etiquetas son HTML dentro del SVG y el saneado tiene que conservarlas sin dejar pasar nada ejecutable.
// Solo existe en el renderer de verdad: mermaid mide el texto en el DOM. En la ventana mínima y en una grande.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal, fijarZoom, type SesionTessera } from './tessera'

/** Con paleta propia, subgrupos, saltos de línea y una etiqueta que intenta colar un manejador. */
const DIAGRAMA = [
  '```mermaid',
  '%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#EEF4FF", "primaryTextColor": "#1F2937", "clusterBkg": "#F8FAFC"}}}%%',
  'flowchart LR',
  '  subgraph Usuarios',
  '    U1(["Personal interno<br/>(navegador)"])',
  '    U2(["Sistemas cliente"])',
  '  end',
  '  subgraph NUBE["Proyecto por ambiente"]',
  '    LB{{"Balanceador global"}}',
  '    API["API de pedidos <img src=x onerror=\'window.__inyectado=1\'>"]',
  '    DB[("Base de datos")]',
  '  end',
  '  U1 -->|"HTTPS interno"| LB',
  '  U2 --> LB',
  '  LB --> API',
  '  API --> DB',
  '  classDef actor fill:#FFF7ED,stroke:#F59E0B,color:#7C2D12',
  '  class U1,U2 actor',
  '```'
].join('\n')

/** Sin paleta propia, y con una directiva que mermaid no puede leer: le toca igual la de la app. */
const DIAGRAMA_LLANO = ['```mermaid', "%%{init: {flowchart: {curve: 'basis'}}}%%", 'flowchart TD', '  A["Pedido recibido"] --> B["Pedido surtido"]', '```'].join('\n')

/** Una etiqueta de arista más ancha que el máximo de mermaid: tiene que partirse en líneas. */
const DIAGRAMA_LARGO = ['```mermaid', 'flowchart TD', '  A["Tienda"] -->|"Pedido con cliente, dirección, teléfono y correo del comprador"| B["API de pedidos"]', '```'].join('\n')

test.describe('Mermaid en la vista renderizada de un Markdown', () => {
  let s: SesionTessera
  let proyecto: string

  test.beforeAll(async () => {
    proyecto = mkdtempSync(join(tmpdir(), 'tessera-e2e-mermaid-'))
    writeFileSync(join(proyecto, 'diagrama.md'), `# Diagrama\n\n${DIAGRAMA}\n\nOtro.\n\n${DIAGRAMA_LLANO}\n\nFin.\n`, 'utf8')
    for (const nivel of [-1, 1]) writeFileSync(join(proyecto, `zoom${nivel}.md`), `# Zoom\n\n${DIAGRAMA_LARGO}\n`, 'utf8')
    s = await abrirTessera()
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [dir] })
    }, proyecto)
    await s.win.locator('.project-tabs-empty-link').click()
    await s.win.locator('.tree-row:visible').filter({ hasText: 'diagrama.md' }).first().click()
    await expect(s.win.locator('.markdown-preview')).toHaveCount(1)
  })
  test.afterAll(async () => {
    await s?.cerrar()
    if (proyecto) await borrarTemporal(proyecto)
  })

  for (const [ancho, alto] of [[900, 620], [1600, 1000]] as const) {
    test(`las etiquetas se leen y el diagrama cabe (${ancho}×${alto})`, async () => {
      await s.app.evaluate(({ BrowserWindow }, d) => {
        const ventana = BrowserWindow.getAllWindows()[0]
        ventana.unmaximize()
        ventana.setSize(d.ancho, d.alto)
      }, { ancho, alto })
      const contenido = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize()[0])
      await expect.poll(() => s.win.evaluate(() => window.innerWidth)).toBe(contenido)
      await expect(s.win.locator('.mermaid-diagrama.dibujado')).toHaveCount(2)
      const diagrama = s.win.locator('.mermaid-diagrama.dibujado').first()
      await expect(diagrama).not.toHaveClass(/con-error/)
      for (const texto of ['Personal interno', '(navegador)', 'Balanceador global', 'API de pedidos', 'Base de datos', 'HTTPS interno', 'Proyecto por ambiente']) {
        await expect(diagrama.getByText(texto, { exact: false }).first(), texto).toBeVisible()
      }
      const medidas = await diagrama.evaluate((el) => {
        const vista = el.closest('.markdown-preview') as HTMLElement
        const svg = el.querySelector('svg') as SVGSVGElement
        return { svg: svg.getBoundingClientRect().width, hueco: el.getBoundingClientRect().width, desborda: vista.scrollWidth - vista.clientWidth }
      })
      expect(medidas.svg, JSON.stringify(medidas)).toBeLessThanOrEqual(medidas.hueco + 1)
      expect(medidas.desborda, JSON.stringify(medidas)).toBeLessThanOrEqual(0)
    })
  }

  test('un diagrama con paleta propia va sobre su fondo y con sus colores; uno sin ella, con los de la app', async () => {
    const diagramas = s.win.locator('.mermaid-diagrama.dibujado')
    await expect(diagramas).toHaveCount(2)
    const leer = (i: number): Promise<{ paleta: boolean; fondo: string; titulo: string; texto: string }> =>
      diagramas.nth(i).evaluate((el) => {
        const color = (sel: string): string => {
          const n = el.querySelector(sel)
          return n ? getComputedStyle(n).color : ''
        }
        return { paleta: el.classList.contains('con-paleta'), fondo: getComputedStyle(el).backgroundColor, titulo: color('.cluster-label span, .cluster-label p'), texto: color('.node .nodeLabel') }
      })
    const propio = await leer(0)
    const llano = await leer(1)
    // Un selector que deje de casar daría colores vacíos, y las comparaciones de abajo pasarían sin comprobar nada.
    expect(propio.titulo, JSON.stringify(propio)).toMatch(/^rgb/)
    expect(llano.texto, JSON.stringify(llano)).toMatch(/^rgb/)
    expect(propio, JSON.stringify(propio)).toMatchObject({ paleta: true, fondo: 'rgb(255, 255, 255)' })
    // El título del subgrupo lo deriva mermaid de la paleta del diagrama: no es el claro de la app sobre fondo claro.
    expect(propio.titulo, JSON.stringify([propio, llano])).not.toBe(llano.texto)
    expect(llano.paleta, JSON.stringify(llano)).toBe(false)
    expect(llano.fondo, JSON.stringify(llano)).toBe('rgba(0, 0, 0, 0)')
    // Texto claro, el de la app sobre su fondo oscuro: con el tema por omisión de mermaid saldría oscuro.
    const brillo = (llano.texto.match(/\d+/g) ?? []).slice(0, 3).reduce((suma, n) => suma + Number(n), 0)
    expect(brillo, JSON.stringify(llano)).toBeGreaterThan(450)
  })

  // Va el último: cambia el zoom de la ventana, y un diagrama solo se mide al dibujarse.
  for (const nivel of [-1, 1]) {
    test(`con el zoom en ${nivel}, una etiqueta larga se parte en líneas en vez de salir cortada`, async () => {
      try {
        await fijarZoom(s.win, nivel)
        await s.win.locator('.tree-row:visible').filter({ hasText: `zoom${nivel}.md` }).first().click()
        const diagrama = s.win.locator('.markdown-preview:visible .mermaid-diagrama.dibujado')
        await expect(diagrama).toHaveCount(1)
        const etiqueta = await diagrama.evaluate((el) => {
          const div = Array.from(el.querySelectorAll<HTMLElement>('.edgeLabel foreignObject div')).find((d) => (d.textContent ?? '').includes('Pedido con cliente'))
          return div ? { ancho: div.clientWidth, contenido: div.scrollWidth, alto: div.getBoundingClientRect().height, linea: parseFloat(getComputedStyle(div).lineHeight) } : null
        })
        expect(etiqueta, 'la etiqueta de la arista').not.toBeNull()
        expect(etiqueta!.contenido, JSON.stringify(etiqueta)).toBeLessThanOrEqual(etiqueta!.ancho + 1)
        expect(etiqueta!.alto, JSON.stringify(etiqueta)).toBeGreaterThan(etiqueta!.linea * 1.5)
      } finally {
        await fijarZoom(s.win, 0)
      }
    })
  }

  test('lo que una etiqueta intenta ejecutar no llega al documento', async () => {
    const diagrama = s.win.locator('.mermaid-diagrama.dibujado').first()
    const restos = await diagrama.evaluate((el) => ({
      guiones: el.querySelectorAll('script, iframe, object, embed').length,
      manejadores: Array.from(el.querySelectorAll('*')).filter((n) => Array.from(n.attributes).some((a) => a.name.startsWith('on'))).length,
      inyectado: (window as unknown as { __inyectado?: number }).__inyectado ?? null
    }))
    expect(restos).toEqual({ guiones: 0, manejadores: 0, inyectado: null })
  })
})
