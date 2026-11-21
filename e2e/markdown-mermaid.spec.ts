// =============================================================================
// Un bloque mermaid de un Markdown se dibuja con el texto de sus etiquetas en la vista renderizada: las
// etiquetas son HTML dentro del SVG y el saneado tiene que conservarlas sin dejar pasar nada ejecutable.
// Comprueba el dibujo y la ampliación de diagramas e imágenes en el pane, en dos tamaños.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

import { crearTemporal } from './temporales'
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, fijarZoom, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

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
    proyecto = crearTemporal(join(tmpdir(), 'tessera-e2e-mermaid-'))
    writeFileSync(join(proyecto, 'diagrama.md'), `# Diagrama\n\n${DIAGRAMA}\n\nOtro.\n\n${DIAGRAMA_LLANO}\n\nFin.\n`, 'utf8')
    for (const nivel of [-1, 1]) writeFileSync(join(proyecto, `zoom${nivel}.md`), `# Zoom\n\n${DIAGRAMA_LARGO}\n`, 'utf8')
    s = await abrirTessera()
    await s.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({ canceled: false, filePaths: [dir] })
    }, proyecto)
    await s.ventana.locator('.project-tabs-empty-link').click()
    await s.ventana.locator('.tree-row:visible').filter({ hasText: 'diagrama.md' }).first().click()
    await expect(s.ventana.locator('.markdown-preview')).toHaveCount(1)
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
      await expect.poll(() => s.ventana.evaluate(() => window.innerWidth)).toBe(contenido)
      await expect(s.ventana.locator('.mermaid-diagrama.dibujado')).toHaveCount(2)
      const diagrama = s.ventana.locator('.mermaid-diagrama.dibujado').first()
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
    const diagramas = s.ventana.locator('.mermaid-diagrama.dibujado')
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
        await fijarZoom(s.ventana, nivel)
        await s.ventana.locator('.tree-row:visible').filter({ hasText: `zoom${nivel}.md` }).first().click()
        const diagrama = s.ventana.locator('.markdown-preview:visible .mermaid-diagrama.dibujado')
        await expect(diagrama).toHaveCount(1)
        const etiqueta = await diagrama.evaluate((el) => {
          const div = Array.from(el.querySelectorAll<HTMLElement>('.edgeLabel foreignObject div')).find((d) => (d.textContent ?? '').includes('Pedido con cliente'))
          return div ? { ancho: div.clientWidth, contenido: div.scrollWidth, alto: div.getBoundingClientRect().height, linea: parseFloat(getComputedStyle(div).lineHeight) } : null
        })
        expect(etiqueta, 'la etiqueta de la arista').not.toBeNull()
        expect(etiqueta!.contenido, JSON.stringify(etiqueta)).toBeLessThanOrEqual(etiqueta!.ancho + 1)
        expect(etiqueta!.alto, JSON.stringify(etiqueta)).toBeGreaterThan(etiqueta!.linea * 1.5)
      } finally {
        await fijarZoom(s.ventana, 0)
      }
    })
  }

  test('lo que una etiqueta intenta ejecutar no llega al documento', async () => {
    const diagrama = s.ventana.locator('.mermaid-diagrama.dibujado').first()
    const restos = await diagrama.evaluate((el) => ({
      guiones: el.querySelectorAll('script, iframe, object, embed').length,
      manejadores: Array.from(el.querySelectorAll('*')).filter((n) => Array.from(n.attributes).some((a) => a.name.startsWith('on'))).length,
      inyectado: (window as unknown as { __inyectado?: number }).__inyectado ?? null
    }))
    expect(restos).toEqual({ guiones: 0, manejadores: 0, inyectado: null })
  })
})


const CAPTURA = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="teal"/></svg>').toString('base64')}`
const INSIGNIA_20 = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="coral"/></svg>').toString('base64')}`
const IMAGEN_200 = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="navy"/></svg>').toString('base64')}`
const ALTERNATIVO = 'Mapa de dependencias entre servicios de la aplicación y sus bases de datos'

for (const [idioma, ampliar, volver, tituloDiagrama, tituloImagen] of [
  ['es', 'Ampliar', 'Volver al documento', 'Diagrama 2', 'Imagen 2'],
  ['en', 'Enlarge', 'Back to document', 'Diagram 2', 'Image 2']
]) {
  test.describe(`ampliado de Markdown (${idioma})`, () => {
    let s: SesionTessera
    let agentes: ReturnType<typeof montarAgenteFalso>
    let ruta: string

    test.beforeAll(async () => {
      agentes = montarAgenteFalso()
      const proyecto = join(agentes.raiz, 'repo')
      mkdirSync(proyecto)
      ruta = join(proyecto, 'arquitectura.md')
      const parrafos = Array.from({ length: 65 }, (_, i) => `Párrafo ${i + 1}.`).join('\n\n')
      writeFileSync(ruta, `${parrafos}\n\n${DIAGRAMA}\n\n${DIAGRAMA_LLANO}\n\n![${ALTERNATIVO}](${CAPTURA})\n\n![](${CAPTURA})\n\n\`\`\`mermaid\n?\n\`\`\`\n`)
      writeFileSync(join(proyecto, 'tamanos.md'), `![Insignia](${INSIGNIA_20})\n\n![Grande](${IMAGEN_200})\n`)
      writeFileSync(join(proyecto, 'clic.md'), `${DIAGRAMA_LLANO}\n\n![Grande](${IMAGEN_200})\n\n[![Enlazada](${IMAGEN_200})](#seccion)\n\n## Seccion\n\nTexto.\n`)
      s = await abrirTessera({ ...agentes.env, TESSERA_FORZAR_IDIOMA: idioma }, {
        sembrar: (datos) => {
          const perfil = 'personal'
          writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
          writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({
            version: 1,
            activeProfileId: perfil,
            byProfile: { [perfil]: { openProjects: [{ projectHostPath: proyecto, name: 'repo', estado: 'active' }], activePath: proyecto } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`${perfil}|${proyecto}`] }
          }))
        }
      })
      await expect(s.ventana.locator('.right-panel .agent-pane:not(.hidden)')).toBeVisible({ timeout: 60_000 })
      await s.ventana.locator('.sidebar .tree-row:visible', { hasText: 'arquitectura.md' }).click()
    })

    test.afterAll(async () => {
      await s?.cerrar()
      if (agentes) await borrarTemporal(agentes.raiz)
    })

    for (const [ancho, alto] of [[900, 620], [1600, 1000]] as const) {
      test(`amplía un diagrama y una imagen dentro del pane (${ancho}×${alto})`, async () => {
        const ventana = s.ventana
        await s.app.evaluate(({ BrowserWindow }, medidas) => {
          const principal = BrowserWindow.getAllWindows()[0]
          principal.unmaximize()
          principal.setSize(medidas.ancho, medidas.alto)
        }, { ancho, alto })
        const contenido = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize()[0])
        await expect.poll(() => ventana.evaluate(() => window.innerWidth)).toBe(contenido)

        const pane = ventana.locator('.editor-area > .editor:not(.hidden)')
        const documento = pane.locator('.markdown-preview')
        const ampliado = pane.locator('.ampliado-markdown')
        const diagrama = documento.locator('.ampliable-markdown:has(> .mermaid-diagrama.dibujado:not(.con-error))').nth(1)
        const imagen = documento.locator('.imagen-markdown').first()
        const agente = ventana.locator('.right-panel .agent-pane:not(.hidden)')
        const error = documento.locator('.ampliable-markdown:has(> .mermaid-diagrama.con-error)')
        await expect(error).toHaveCount(1)
        await expect(error.getByRole('button', { name: ampliar })).toHaveCount(0)

        for (const [origen, titulo] of [[diagrama, tituloDiagrama], [imagen, ALTERNATIVO]] as const) {
          const boton = origen.getByRole('button', { name: ampliar, exact: true })
          await boton.scrollIntoViewIfNeeded()
          await ventana.mouse.move(0, 0)
          await documento.focus()
          await expect(boton).toHaveCSS('opacity', '0')
          await origen.hover()
          await expect(boton).toHaveCSS('opacity', '1')
          await ventana.mouse.move(0, 0)
          await boton.focus()
          await expect(boton).toHaveCSS('opacity', '1')

          const desplazamiento = await documento.evaluate((el) => el.scrollTop)
          expect(desplazamiento).toBeGreaterThan(0)
          if (origen === diagrama) await boton.click()
          else await boton.press('Enter')
          await expect(ampliado).toBeVisible()
          await expect(agente).toBeVisible()
          expect(await ampliado.evaluate((el) => el.getAnimations().length)).toBe(0)
          const cabecera = ampliado.locator('header')
          const botonVolver = ampliado.getByRole('button', { name: volver })
          await expect(botonVolver).toBeVisible()
          await expect(botonVolver).toHaveText('')
          await expect(cabecera.getByText('arquitectura.md')).toBeVisible()
          await expect(cabecera.getByText(titulo, { exact: true })).toHaveCount(1)
          expect(await cabecera.evaluate((el) => el.scrollWidth === el.clientWidth)).toBe(true)
          expect(await ampliado.evaluate((el) => {
            const pane = el.closest('.editor')!.getBoundingClientRect()
            const visor = el.getBoundingClientRect()
            return visor.x === pane.x && visor.y === pane.y && visor.width === pane.width && visor.height === pane.height
          })).toBe(true)

          const barra = ampliado.getByRole('toolbar')
          await expect(barra.getByRole('button')).toHaveCount(4)
          const porcentaje = barra.locator('.image-tool-level')
          const inicial = await porcentaje.innerText()
          const lienzo = ampliado.locator('img.image-canvas')
          const anchoLienzo = await lienzo.evaluate((el) => el.clientWidth)
          await ampliado.locator('.image-stage').hover()
          await ventana.mouse.wheel(0, -120)
          await expect(porcentaje).not.toHaveText(inicial)
          if (origen === diagrama) {
            await expect(lienzo).toHaveAttribute('src', /^blob:/)
            expect(await lienzo.evaluate((el) => el.clientWidth)).toBeGreaterThan(anchoLienzo)
          }
          await expect(ampliado.getByRole('button', { name: volver })).toBeFocused()
          await ventana.keyboard.press('Escape')
          await expect(ampliado).toHaveCount(0)
          await expect(boton).toBeFocused()
          expect(await documento.evaluate((el) => el.scrollTop)).toBe(desplazamiento)
        }

        const boton = documento.locator('.imagen-markdown').nth(1).getByRole('button', { name: ampliar, exact: true })
        await boton.focus()
        await boton.press('Enter')
        await expect(ampliado.locator('header').getByText(tituloImagen, { exact: true })).toBeVisible()
        await ampliado.getByRole('button', { name: volver }).click()
        await expect(boton).toBeFocused()
      })
    }

    test('Escape cierra el ampliado tras arrastrar en el escenario', async () => {
      const ventana = s.ventana
      const documento = ventana.locator('.markdown-preview')
      const ampliado = ventana.locator('.ampliado-markdown')
      const boton = documento.locator('.imagen-markdown').first().getByRole('button', { name: ampliar, exact: true })
      await boton.focus()
      await boton.press('Enter')
      await expect(ampliado).toBeVisible()
      const escenario = ampliado.locator('.image-stage')
      const caja = await escenario.boundingBox()
      expect(caja).not.toBeNull()
      await ventana.mouse.move(caja!.x + caja!.width / 2, caja!.y + caja!.height / 2)
      await ventana.mouse.down()
      await ventana.mouse.move(caja!.x + caja!.width / 2 + 40, caja!.y + caja!.height / 2 + 25)
      await ventana.mouse.up()
      await ventana.keyboard.press('Escape')
      await expect(ampliado).toHaveCount(0)
      await expect(boton).toBeFocused()
    })

    test('Escape cierra Configuración y deja abierto el ampliado', async () => {
      const ventana = s.ventana
      const ampliado = ventana.locator('.ampliado-markdown')
      const boton = ventana.locator('.markdown-preview .imagen-markdown').first().getByRole('button', { name: ampliar, exact: true })
      await boton.click()
      await expect(ampliado).toBeVisible()
      await ventana.keyboard.press(`${MOD}+,`)
      const ajustes = ventana.locator('.ajustes-modal')
      await expect(ajustes).toBeVisible()
      await ventana.keyboard.press('Escape')
      await expect(ajustes).toHaveCount(0)
      await expect(ampliado).toBeVisible()
      await ventana.keyboard.press('Escape')
      await expect(ampliado).toHaveCount(0)
    })

    test('vuelve al documento cuando se elimina el diagrama o la imagen ampliada', async () => {
      const ventana = s.ventana
      const documento = ventana.locator('.markdown-preview')
      const ampliado = ventana.locator('.ampliado-markdown')
      for (const [selector, titulo, cuerpo] of [
        ['.ampliable-markdown:has(> .mermaid-diagrama.dibujado)', 'Sin diagramas', `![Mapa](${CAPTURA})`],
        ['.imagen-markdown', 'Sin imágenes', 'Fin.']
      ]) {
        const boton = documento.locator(selector).first().getByRole('button', { name: ampliar, exact: true })
        await boton.focus()
        await boton.press('Enter')
        await expect(ampliado.getByRole('button', { name: volver })).toBeFocused()
        writeFileSync(ruta, `# ${titulo}\n\n${cuerpo}\n`)
        await expect(ampliado).toHaveCount(0)
        await expect(documento.getByText(titulo)).toBeVisible()
        await expect(documento).toBeFocused()
      }
    })

    test('una imagen de 20 px no ofrece ampliar y una de 200 px sí', async () => {
      const ventana = s.ventana
      await ventana.locator('.sidebar .tree-row:visible', { hasText: 'tamanos.md' }).click()
      const documento = ventana.locator('.editor-area > .editor:not(.hidden) .markdown-preview')
      const pequena = documento.locator('img[alt="Insignia"]')
      const grande = documento.locator('img[alt="Grande"]')
      await expect(pequena).toBeVisible()
      await expect(grande).toBeVisible()
      await expect.poll(() => documento.locator('.imagen-markdown').count()).toBe(1)
      await expect(documento.locator('.imagen-markdown img')).toHaveAttribute('alt', 'Grande')
      await expect(documento.getByRole('button', { name: ampliar, exact: true })).toHaveCount(1)
      await expect(pequena.locator('xpath=ancestor::*[contains(@class,"ampliable-markdown")]')).toHaveCount(0)
    })

    test('un clic sobre el diagrama o una imagen grande amplía; sobre una imagen enlazada no', async () => {
      const ventana = s.ventana
      await ventana.locator('.sidebar .tree-row:visible', { hasText: 'clic.md' }).click()
      const pane = ventana.locator('.editor-area > .editor:not(.hidden)')
      const documento = pane.locator('.markdown-preview')
      const ampliado = pane.locator('.ampliado-markdown')
      const diagrama = documento.locator('.mermaid-diagrama.dibujado:not(.con-error)').first()
      const imagenGrande = documento.locator('img[alt="Grande"]')
      const imagenEnlazada = documento.locator('img[alt="Enlazada"]')

      await expect(diagrama).toHaveCount(1)
      await expect.poll(() => documento.locator('.imagen-markdown').count()).toBe(2)
      await expect(diagrama).toHaveCSS('cursor', 'zoom-in')
      await expect(imagenGrande).toHaveCSS('cursor', 'zoom-in')
      await expect(imagenEnlazada).not.toHaveCSS('cursor', 'zoom-in')

      await diagrama.click()
      await expect(ampliado).toBeVisible()
      await expect(ampliado.locator('header').getByText(idioma === 'es' ? 'Diagrama 1' : 'Diagram 1', { exact: true })).toBeVisible()
      await ventana.keyboard.press('Escape')
      await expect(ampliado).toHaveCount(0)

      await imagenGrande.click()
      await expect(ampliado).toBeVisible()
      await expect(ampliado.locator('header').getByText('Grande', { exact: true })).toBeVisible()
      await ampliado.getByRole('button', { name: volver }).click()
      await expect(ampliado).toHaveCount(0)

      await imagenEnlazada.click()
      await expect(ampliado).toHaveCount(0)
    })
  })
}
