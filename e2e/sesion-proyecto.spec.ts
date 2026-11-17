// =============================================================================
// La sesión de cada proyecto y la ventana entre arranques, sobre la app empaquetada: se dejan dos archivos
// abiertos (uno con el cursor en la línea 40 y otro en «Solo editor»), una carpeta desplegada, dos terminales
// (una renombrada y activa) y la ventana con un tamaño propio; se cierra Tessera y se arranca otra vez con
// los mismos datos, y todo vuelve como estaba. Lo guardado solo lleva rutas relativas al proyecto.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md, docs/decisiones/app/ventana-arranque-y-recuperacion.md
// =============================================================================

import { expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { arrastrarPestanaAntesDe } from './consolaAyudas'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

const ARCHIVOS_A_CONSERVAR = ['profiles.json', 'workspace-state.json', 'ventana.json']
// Un tamaño que cabe en una pantalla pequeña: la ventana no puede pasar del área útil y se recortaría.
const VENTANA = { x: 80, y: 60, width: 1320, height: 680 }

function sembrarPrimera(datos: string, repo: string): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: repo, name: 'repo', estado: 'active' }], activePath: repo } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${repo}`] }
    })
  )
}

test.describe.serial('La sesión de cada proyecto vuelve al reabrir Tessera', () => {
  let agentes: AgenteFalso
  let repo: string
  let datosPrimera = ''
  let s: SesionTessera | null = null

  // Lo que se mide aquí es la posición de la ventana: el arnés no debe llevarla a otro monitor al arrancar.
  const pantallaElegida = process.env.TESSERA_E2E_PANTALLA

  test.beforeAll(() => {
    delete process.env.TESSERA_E2E_PANTALLA
    agentes = montarAgenteFalso()
    repo = join(agentes.raiz, 'repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'a.ts'), Array.from({ length: 80 }, (_, i) => `const linea${i + 1} = ${i + 1}`).join('\n'))
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2\n')
    writeFileSync(join(repo, 'LEEME.md'), '# Proyecto\n\nTexto.\n')
  })

  test.afterAll(async () => {
    if (pantallaElegida !== undefined) process.env.TESSERA_E2E_PANTALLA = pantallaElegida
    await s?.cerrar()
    if (datosPrimera) await borrarTemporal(datosPrimera)
    if (agentes) await borrarTemporal(agentes.raiz)
  })

  test('se deja trabajo abierto y se cierra Tessera', async () => {
    s = await abrirTessera(agentes.env, { sembrar: (datos) => sembrarPrimera(datos, repo) })
    const ventanaPrincipal = s.ventana
    // La ventana con un tamaño propio, sin maximizar: primero se espera a que deje de estarlo, porque al
    // desmaximizar el sistema le devuelve su tamaño anterior y pisaría uno puesto antes.
    const app = s.app
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false)
    await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b), VENTANA)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).toMatchObject(VENTANA)

    // La carpeta desplegada y a.ts con el cursor en la línea 40.
    await ventanaPrincipal.locator('.sidebar .tree-row:visible', { hasText: 'src' }).first().click({ timeout: 30_000 })
    await ventanaPrincipal.locator('.sidebar .tree-row:visible', { hasText: 'a.ts' }).first().click()
    const lineas = ventanaPrincipal.locator('.editor-area .monaco-editor .view-lines').filter({ visible: true }).first()
    await expect(lineas).toContainText('const linea1 = 1')
    await lineas.click({ position: { x: 5, y: 5 } })
    await ventanaPrincipal.keyboard.press('Control+Home')
    for (let i = 0; i < 39; i++) await ventanaPrincipal.keyboard.press('ArrowDown')
    // Columna 1 en todas: en macOS Control+Inicio no mueve el cursor y se queda donde cayó el clic.
    await ventanaPrincipal.keyboard.press('Home')
    await expect(ventanaPrincipal.locator('.editor-area .monaco-editor .active-line-number').filter({ visible: true }).first()).toHaveText('40')

    // LEEME.md en «Solo editor» (de serie se abre en la vista previa), y activa.
    await ventanaPrincipal.locator('.sidebar .tree-row:visible', { hasText: 'LEEME.md' }).first().click()
    await ventanaPrincipal.getByRole('radio', { name: 'Solo editor' }).click()
    await expect(ventanaPrincipal.getByRole('radio', { name: 'Solo editor' })).toHaveAttribute('aria-checked', 'true')

    // Dos terminales: la segunda renombrada y activa.
    await ventanaPrincipal.getByRole('button', { name: 'Terminal', exact: true }).click()
    const panel = ventanaPrincipal.locator('section.terminal-panel')
    await expect(panel.locator('.terminal-tab')).toHaveCount(1, { timeout: 30_000 })
    await panel.locator('> .panel-header').hover()
    await panel.getByRole('button', { name: 'Nueva terminal', exact: true }).click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await panel.locator('.terminal-tab').nth(1).dblclick()
    await panel.locator('.terminal-tab-input').fill('Servidor')
    await ventanaPrincipal.keyboard.press('Enter')
    await expect(panel.locator('.terminal-tab').nth(1)).toContainText('Servidor')
    await arrastrarPestanaAntesDe(ventanaPrincipal, panel.locator('.terminal-tab').nth(1), panel.locator('.terminal-tab').first())
    await expect(panel.locator('.terminal-tab').first(), 'arrastrada al principio').toContainText('Servidor')

    // La sesión se guarda con una espera corta; se comprueba en el archivo antes de cerrar.
    const archivo = join(s.datos, 'workspace-state.json')
    const clave = `personal|${repo}`
    await expect
      .poll(() => JSON.stringify(JSON.parse(readFileSync(archivo, 'utf8')).sesiones?.[clave] ?? null), { timeout: 15_000 })
      .toContain('ordenTerminales')
    datosPrimera = s.datos
    await s.cerrar({ conservarDatos: true })
    s = null

    const sesion = JSON.parse(readFileSync(archivo, 'utf8')).sesiones[clave]
    expect(sesion.pestanas, 'las pestañas, con rutas relativas al proyecto').toEqual([
      { ruta: 'src/a.ts', linea: 40, columna: 1 },
      { ruta: 'LEEME.md', modo: 'codigo' }
    ])
    expect(sesion.activa).toBe('LEEME.md')
    expect(sesion.carpetas).toContain('src')
    expect(sesion.terminales).toEqual([{}, { nombre: 'Servidor' }])
    expect(sesion.terminalActiva).toBe(1)
    expect(sesion.ordenTerminales, 'con su sitio en la tira').toEqual(['l:1', 'l:0'])
    const ventana = JSON.parse(readFileSync(join(datosPrimera, 'ventana.json'), 'utf8'))
    expect(ventana, 'la ventana, con su tamaño propio y sin maximizar').toMatchObject({ ...VENTANA, maximizada: false })
  })

  test('al reabrir con los mismos datos, todo vuelve como estaba', async () => {
    s = await abrirTessera(agentes.env, {
      sembrar: (datos) => {
        for (const f of ARCHIVOS_A_CONSERVAR) if (existsSync(join(datosPrimera, f))) copyFileSync(join(datosPrimera, f), join(datos, f))
      }
    })
    const ventana = s.ventana

    const limites = await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return { ...w.getBounds(), maximizada: w.isMaximized() }
    })
    expect(limites, 'la ventana vuelve con su tamaño y su posición').toMatchObject({ ...VENTANA, maximizada: false })

    const pestanas = ventana.locator('.editor-tab')
    await expect(pestanas, 'vuelven los dos archivos, en su orden').toHaveText([/a\.ts/, /LEEME\.md/], { timeout: 30_000 })
    await expect(ventana.locator('.editor-tab.active'), 'con la activa de antes').toContainText('LEEME.md')
    await expect(ventana.getByRole('radio', { name: 'Solo editor' }), 'en el modo que se dejó').toHaveAttribute('aria-checked', 'true')

    await expect(ventana.locator('.sidebar .tree-row:visible', { hasText: 'b.ts' }), 'la carpeta sigue desplegada').toBeVisible()

    await pestanas.filter({ hasText: 'a.ts' }).click()
    await expect(
      ventana.locator('.editor-area .monaco-editor .active-line-number').filter({ visible: true }).first(),
      'y el cursor, en la línea donde estaba'
    ).toHaveText('40')

    const panel = ventana.locator('section.terminal-panel')
    if (!(await panel.isVisible())) await ventana.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(panel.locator('.terminal-tab'), 'vuelven las dos terminales').toHaveCount(2, { timeout: 30_000 })
    await expect(panel.locator('.terminal-tab').first(), 'con su nombre y en el orden en que se dejaron').toContainText('Servidor')
    await expect(panel.locator('.terminal-tab.active'), 'y la activa de antes').toContainText('Servidor')
  })
})
