// =============================================================================
// Una propuesta de reglas de punta a punta, en la app empaquetada: `tctx proponer` desde la terminal nativa
// de un proyecto (el atajo de `bin/s<N>` y el puente de verdad), el aviso con «Revisar», la revisión con el
// motivo y el diff (Esc la cierra y sigue pendiente; el diálogo de reglas la avisa), Aceptar guarda las
// reglas en el perfil y `tctx reglas` las imprime. La orden vale igual en PowerShell que en sh.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, MOD, type SesionTessera } from './tessera'

const VIGENTES = 'Regla vieja del perfil.'
const PROPUESTA = 'Regla propuesta E2E'
const MOTIVO = 'prueba'

/** Un perfil sin sandbox, con reglas, y un proyecto abierto en modo nativo. */
function sembrar(datos: string, proyecto: string): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      {
        id: 'personal',
        nombre: 'Personal',
        color: '#9814c8',
        agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }],
        reglas: VIGENTES,
        sandbox: { habilitado: false }
      }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`], menuWindowsAvisado: true }
    })
  )
}

/** Deja que React confirme el render provocado por el gesto. */
async function asentar(ventana: Page): Promise<void> {
  await ventana.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Teclea una línea en la terminal que se ve y pulsa Intro. */
async function teclear(ventana: Page, linea: string): Promise<void> {
  await ventana.locator('section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-screen').click()
  await asentar(ventana)
  await ventana.keyboard.type(linea)
  await ventana.keyboard.press('Enter')
}

/** Cuántas veces sale `texto` en el búfer de la terminal que se ve, con su buscador (mira el búfer, no el dibujo). */
async function contarEnTerminal(ventana: Page, texto: string): Promise<number> {
  const pane = ventana.locator('section.terminal-panel .terminal-pane[aria-hidden="false"]')
  await pane.locator('.xterm-screen').click()
  await ventana.keyboard.press(`${MOD}+f`)
  const buscador = pane.locator('.search-box')
  await expect(buscador).toBeVisible()
  const entrada = buscador.locator('.search-box-input')
  await entrada.fill(texto)
  await entrada.press('Enter')
  const etiqueta = await buscador.locator('.search-box-count').innerText()
  await buscador.getByRole('button', { name: 'Cerrar buscador' }).click()
  const m = /(\d+) coincidencias|\d+ \/ (\d+)/.exec(etiqueta)
  return m ? Number(m[1] ?? m[2]) : 0
}

test('propuesta de reglas: tctx proponer, aviso, revisión con diff, aceptar y tctx reglas', async () => {
  const { raiz, env } = montarAgenteFalso()
  const proyecto = join(raiz, 'proyecto')
  mkdirSync(proyecto)
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera(env, { sembrar: (datos) => sembrar(datos, proyecto) })
    const ventana = s.ventana
    await expect(ventana.locator('.profile-tab[data-perfil-id="personal"]')).toBeVisible({ timeout: 30_000 })
    const reglasGuardadas = (): Promise<string | null> =>
      ventana.evaluate(async () => (await window.tessera.obtenerPerfiles()).find((p) => p.id === 'personal')?.reglas ?? null)

    await ventana.getByRole('button', { name: 'Terminal' }).click()
    await expect(ventana.locator('section.terminal-panel .terminal-tab')).toHaveCount(1)
    // Comillas dobles sin nada que expandir: la misma línea vale en PowerShell y en sh.
    await teclear(ventana, `tctx proponer --texto "${PROPUESTA}" --motivo "${MOTIVO}"`)

    const aviso = ventana.locator('.toast', { hasText: 'Un agente propone cambiar las reglas de «Personal»' })
    await expect(aviso, 'llega el aviso de la propuesta').toBeVisible({ timeout: 30_000 })
    expect(await reglasGuardadas(), 'una propuesta no cambia las reglas').toBe(VIGENTES)
    await aviso.locator('.toast-accion', { hasText: 'Revisar' }).click()

    const revision = ventana.getByRole('dialog', { name: 'Propuesta de reglas para «Personal»' })
    await expect(revision).toBeVisible()
    await expect(revision.getByRole('button', { name: 'Cerrar', exact: true })).toHaveAttribute('title', 'Cerrar (Esc)')
    await expect(revision.locator('.modal-pie-auxiliares .btn.danger')).toContainText('Descartar')
    await expect(revision.getByTestId('propuesta-reglas-motivo'), 'el motivo del agente').toHaveText(MOTIVO)
    const diff = revision.getByTestId('propuesta-reglas-diff')
    await expect(diff.locator('.monaco-diff-editor'), 'el diff de Monaco').toBeVisible()
    await expect(diff, 'con las vigentes y las propuestas').toContainText(VIGENTES)
    await expect(diff).toContainText(PROPUESTA)

    await ventana.keyboard.press('Escape')
    await expect(revision, 'Esc cierra sin decidir').toHaveCount(0)
    expect(await reglasGuardadas()).toBe(VIGENTES)

    await ventana.locator('.profile-tab[data-perfil-id="personal"]').click({ button: 'right' })
    await ventana.getByRole('menuitem', { name: 'Reglas para los agentes…' }).click()
    const dialogoReglas = ventana.getByRole('dialog', { name: 'Contexto de los agentes' })
    await expect(dialogoReglas.getByText('Un agente propuso cambiar estas reglas.'), 'la propuesta sigue pendiente y el diálogo lo avisa').toBeVisible()
    await dialogoReglas.getByRole('button', { name: 'Revisar la propuesta' }).click()
    await expect(dialogoReglas).toHaveCount(0)
    await expect(revision).toBeVisible()

    await revision.getByRole('button', { name: 'Aceptar', exact: true }).click()
    await expect(revision).toHaveCount(0)
    await expect.poll(reglasGuardadas, { message: 'el perfil trae las reglas propuestas', timeout: 10_000 }).toBe(PROPUESTA)
    await expect
      .poll(() => ventana.evaluate(() => window.tessera.reglas.pendientes()), { message: 'y la propuesta ya no está pendiente' })
      .toEqual([])
    // La propuesta solo se quita cuando las reglas ya están en disco, no antes.
    expect(await reglasGuardadas(), 'al quitarse la propuesta, las reglas ya estaban guardadas').toBe(PROPUESTA)

    // La orden tecleada ya contiene el texto una vez; `tctx reglas` lo imprime otra.
    expect(await contarEnTerminal(ventana, PROPUESTA)).toBe(1)
    await teclear(ventana, 'tctx reglas')
    await expect.poll(() => contarEnTerminal(ventana, PROPUESTA), { message: 'tctx reglas imprime las vigentes nuevas', timeout: 30_000 }).toBe(2)
  } finally {
    await s?.cerrar()
    await borrarTemporal(raiz)
  }
})
