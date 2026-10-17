// =============================================================================
// Agentes definidos a mano sobre la app empaquetada, en un proyecto NATIVO: el «+» de las pestañas
// de agente, el modal (con el aviso de un programa que la shell no encuentra), el agente arrancando
// con «cómo reanudar» al abrir y sin él en «Nueva conversación», su contexto leído de un archivo
// del proyecto, copiar su definición, ocultar
// Claude Code en el perfil y que todo quede guardado. El agente es un programa falso que apunta sus
// argumentos. Sin Docker: la capa de imagen la prueba `test-capa-perfil-docker.mts`.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, PLATAFORMA, type SesionTessera } from './tessera'

const PERFIL = 'personal'

/** Un agente manual de mentira: apunta sus argumentos (uno por arranque) y espera. */
function montarEco(agente: AgenteFalso): string {
  const registro = join(agente.raiz, 'eco.log')
  const programa = join(agente.raiz, 'eco.cjs')
  writeFileSync(
    programa,
    [
      `require('fs').appendFileSync(${JSON.stringify(registro)}, JSON.stringify(process.argv.slice(2)) + '\\n')`,
      `process.stdout.write('eco listo\\r\\n')`,
      'setInterval(() => {}, 1000)'
    ].join('\n')
  )
  if (PLATAFORMA === 'windows') {
    writeFileSync(join(agente.bin, 'eco-agente.cmd'), `@echo off\r\n"${process.execPath}" "${programa}" %*\r\n`)
  } else {
    const ruta = join(agente.bin, 'eco-agente')
    writeFileSync(ruta, `#!/bin/sh\nexec "${process.execPath}" "${programa}" "$@"\n`)
    chmodSync(ruta, 0o755)
  }
  return registro
}

function arranquesEco(registro: string): string[][] {
  if (!existsSync(registro)) return []
  return readFileSync(registro, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[])
}

const pestana = (win: Page, nombre: string) => win.locator(`.agent-pane:not(.hidden) .agent-switch-btn[aria-label="${nombre}"]`)
const casilla = (win: Page, nombre: string) => win.getByRole('menuitemcheckbox', { name: nombre, exact: true })
const aviso = (win: Page, titulo: string) => win.locator('.toast', { hasText: titulo })
const nombresDePestanas = (win: Page): Promise<string[]> =>
  win.locator('.agent-pane:not(.hidden) .agent-switch-btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el JSON de los ajustes, leído tal cual del disco
const ajustes = (s: SesionTessera): any => JSON.parse(readFileSync(join(s.datos, 'workspace-state.json'), 'utf8')).settings

test.describe.serial('Agentes definidos a mano', () => {
  let s: SesionTessera
  let agente: AgenteFalso
  let registro: string
  let proyecto: string

  test.beforeAll(async () => {
    agente = montarAgenteFalso()
    registro = montarEco(agente)
    proyecto = join(agente.raiz, 'alfa')
    mkdirSync(proyecto, { recursive: true })
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: PERFIL,
            byProfile: { [PERFIL]: { openProjects: [{ projectHostPath: proyecto, name: 'alfa', estado: 'active' }], activePath: proyecto } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`${PERFIL}|${proyecto}`] }
          })
        )
      }
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (agente) await borrarTemporal(agente.raiz)
  })

  test('un programa que la shell no encuentra se avisa antes de guardar', async () => {
    const win = s.win
    await expect(pestana(win, 'Claude Code')).toBeVisible({ timeout: 30_000 })
    await win.locator('.agent-pane:not(.hidden) [aria-label="Añadir agente"]').click()
    const modal = win.locator('.agman-modal')
    // Se abre desde el título del panel, que va en mayúsculas: el modal no debe heredarlas.
    expect(await modal.evaluate((m) => getComputedStyle(m).textTransform)).toBe('none')
    await modal.getByLabel('Nombre').fill('Fantasma')
    await modal.getByLabel('Comando').fill('no-existe-tessera-xyz')
    await modal.getByRole('button', { name: 'Guardar' }).click()
    await expect(modal.getByRole('alert')).toContainText('no encuentra «no-existe-tessera-xyz»', { timeout: 20_000 })
    await expect(modal.getByRole('button', { name: 'Guardar igualmente' })).toBeVisible()
    await modal.getByRole('button', { name: 'Cancelar' }).click()
    await expect(modal).toHaveCount(0)
    await expect(pestana(win, 'Fantasma'), 'cancelar no lo guarda').toHaveCount(0)
  })

  test('el «+» define un agente, que arranca reanudando y se queda con su pestaña', async () => {
    const win = s.win
    await win.locator('.agent-pane:not(.hidden) [aria-label="Añadir agente"]').click()
    const modal = win.locator('.agman-modal')
    await modal.getByLabel('Nombre').fill('Eco')
    await modal.getByLabel('Comando').fill('eco-agente --modo prueba')
    await modal.getByLabel('Cómo reanudar (opcional)').fill('--continue')
    await modal.getByLabel('Contexto (opcional)').selectOption('archivo')
    await modal.getByLabel('Archivo').fill('uso.jsonl')
    await modal.getByLabel('Campo de lo usado').fill('ctx.usado')
    await modal.getByLabel('Máximo').fill('1000')
    await modal.getByRole('button', { name: 'Guardar' }).click()
    await expect(modal).toHaveCount(0, { timeout: 20_000 })
    await expect(pestana(win, 'Eco'), 'su pestaña, ya elegida').toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => arranquesEco(registro).length, { timeout: 30_000 }).toBe(1)
    expect(arranquesEco(registro)[0], 'al abrir: su comando y cómo reanudar').toEqual(['--modo', 'prueba', '--continue'])
    // Sin uso de cuenta ni historial: Tessera no sabe leerlos de un agente que no conoce.
    await expect(win.locator('.agent-pane:not(.hidden) [aria-label="Historial de conversaciones"]')).toHaveCount(0)
  })

  test('su contexto se lee del archivo que se definió, relativo al proyecto', async () => {
    const win = s.win
    const pct = win.locator('.agent-pane:not(.hidden) .agent-context-pct')
    // Sin el archivo todavía: el anillo está, sin dato, y el desplegable dice por qué.
    await expect(pct).toHaveText('—', { timeout: 30_000 })
    writeFileSync(join(proyecto, 'uso.jsonl'), '{"ctx":{"usado":100}}\n{"ctx":{"usado":400}}\n')
    await expect(pct).toHaveText('40%', { timeout: 30_000 })
    await pct.hover()
    await expect(win.getByRole('tooltip')).toContainText('400 de 1k')
  })

  test('«Nueva conversación» lo lanza sin sus argumentos de reanudar', async () => {
    const win = s.win
    await win.locator('.agent-pane:not(.hidden) [aria-label="Nueva conversación"]').click()
    await expect.poll(() => arranquesEco(registro).length, { timeout: 30_000 }).toBe(2)
    expect(arranquesEco(registro)[1]).toEqual(['--modo', 'prueba'])
  })

  test('su definición se copia como JSON, y Claude Code se oculta en el perfil', async () => {
    const win = s.win
    await pestana(win, 'Eco').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Copiar definición (JSON)' }).click()
    await expect.poll(() => s.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('"tessera": "agente"')
    expect(await s.app.evaluate(({ clipboard }) => clipboard.readText())).not.toContain('m-eco')
    await pestana(win, 'Claude Code').click({ button: 'right' })
    await casilla(win, 'Claude Code').click()
    await expect(pestana(win, 'Claude Code')).toHaveCount(0)
    // El aviso dice qué se ocultó y dónde volver a mostrarlo.
    await expect(aviso(win, 'Claude Code oculto')).toContainText('Configuración › Agentes')
    // Se guarda en los ajustes: el agente, de todo el equipo, y el oculto, de este perfil.
    await expect.poll(() => [ajustes(s).agentesNativos?.map((d: { nombre: string }) => d.nombre), ajustes(s).agentesOcultosPorPerfil?.[PERFIL]]).toEqual([
      ['Eco'],
      ['claude-code']
    ])
    await aviso(win, 'Claude Code oculto').getByRole('button', { name: 'Deshacer' }).click()
    await expect(pestana(win, 'Claude Code'), '«Deshacer» lo vuelve a mostrar').toHaveCount(1)
  })

  test('las pestañas miden lo que su nombre, con contorno y sin «×»', async () => {
    const win = s.win
    const cajas = await win.locator('.agent-pane:not(.hidden) .agent-switch-btn').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { ancho: Math.round(r.width), alto: Math.round(r.height), borde: getComputedStyle(e).borderTopStyle }
      })
    )
    expect(cajas.length).toBe(3)
    expect(new Set(cajas.map((c) => c.ancho)).size, 'no miden todas lo mismo').toBeGreaterThan(1)
    for (const c of cajas) {
      expect(c.ancho).toBeLessThanOrEqual(141)
      expect(c.alto).toBeGreaterThanOrEqual(20)
      expect(c.alto).toBeLessThanOrEqual(24)
      expect(c.borde).toBe('solid')
    }
    await expect(win.locator('.agent-pane:not(.hidden) .agent-switch-fila button', { hasText: '×' })).toHaveCount(0)
  })

  test('ocultar y volver a mostrar desde el clic derecho de la fila', async () => {
    const win = s.win
    await pestana(win, 'Codex').click({ button: 'right' })
    await casilla(win, 'Codex').click()
    await expect(pestana(win, 'Codex')).toHaveCount(0)
    await pestana(win, 'Eco').click({ button: 'right' })
    await expect(casilla(win, 'Codex'), 'el oculto sigue en la lista, sin marcar').toHaveAttribute('aria-checked', 'false')
    await casilla(win, 'Codex').click()
    await expect(pestana(win, 'Codex')).toHaveCount(1)
  })

  test('se pueden ocultar los dos de serie si queda un manual, pero no el último', async () => {
    const win = s.win
    for (const nombre of ['Claude Code', 'Codex']) {
      await pestana(win, 'Eco').click({ button: 'right' })
      await casilla(win, nombre).click()
      await expect(pestana(win, nombre)).toHaveCount(0)
    }
    await expect(win.locator('.agent-pane:not(.hidden) .agent-switch-btn')).toHaveCount(1)
    await pestana(win, 'Eco').click({ button: 'right' })
    await expect(casilla(win, 'Eco'), 'el último a la vista no se oculta').toBeDisabled()
    await casilla(win, 'Claude Code').click()
    await pestana(win, 'Eco').click({ button: 'right' })
    await casilla(win, 'Codex').click()
    await expect(win.locator('.agent-pane:not(.hidden) .agent-switch-btn')).toHaveCount(3)
    await expect.poll(() => ajustes(s).agentesOcultosPorPerfil?.[PERFIL] ?? []).toEqual([])
  })

  test('arrastrar una pestaña la reordena, y el orden se guarda por perfil', async () => {
    const win = s.win
    await pestana(win, 'Eco').dragTo(pestana(win, 'Claude Code'))
    await expect.poll(() => nombresDePestanas(win)).toEqual(['Eco', 'Claude Code', 'Codex'])
    await expect.poll(() => ajustes(s).ordenAgentesPorPerfil?.[PERFIL]).toEqual(['m-eco', 'claude-code', 'codex'])
  })

  test('Configuración › Agentes: la lista del perfil, el ojo, mover y el modo lista', async () => {
    const win = s.win
    await pestana(win, 'Eco').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Gestionar agentes…' }).click()
    const modal = win.locator('.ajustes-modal')
    await expect(modal.locator('.ajustes-riel-item[data-cat="agentes"]')).toHaveAttribute('aria-selected', 'true')
    const filas = modal.locator('.gestion-agente')
    await expect(filas).toHaveCount(3)
    expect(await filas.locator('.gestion-agente-nombre').allInnerTexts()).toEqual(['Eco', 'Claude Code', 'Codex'])
    // Sin ratón: ↓ con el asa enfocada la baja un puesto.
    await modal.getByRole('button', { name: 'Arrastra (o ↑/↓) para ordenar Eco' }).focus()
    await win.keyboard.press('ArrowDown')
    await expect.poll(() => filas.locator('.gestion-agente-nombre').allInnerTexts()).toEqual(['Claude Code', 'Eco', 'Codex'])
    await expect.poll(() => nombresDePestanas(win)).toEqual(['Claude Code', 'Eco', 'Codex'])
    // El ojo oculta y vuelve a mostrar.
    await modal.getByRole('button', { name: 'Ocultar Codex' }).click()
    await expect(pestana(win, 'Codex')).toHaveCount(0)
    await modal.getByRole('button', { name: 'Mostrar Codex' }).click()
    await expect(pestana(win, 'Codex')).toHaveCount(1)
    // El modo lista: un desplegable con el agente actual en vez de las pestañas.
    await modal.getByRole('combobox', { name: 'Selector de agentes' }).selectOption('lista')
    await win.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    const lista = win.locator('.agent-pane:not(.hidden) .agent-lista-btn')
    await expect(lista).toHaveText('Eco')
    await expect(win.locator('.agent-pane:not(.hidden) .agent-switch-btn')).toHaveCount(0)
    await lista.click()
    await expect(casilla(win, 'Eco')).toHaveAttribute('aria-checked', 'true')
    await expect(win.getByRole('menuitem', { name: 'Gestionar agentes…' })).toBeVisible()
    await casilla(win, 'Codex').click()
    await expect(lista).toHaveText('Codex')
    await expect.poll(() => ajustes(s).selectorAgentes).toBe('lista')
  })
})
