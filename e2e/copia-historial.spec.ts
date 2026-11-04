// =============================================================================
// El historial de conversaciones en la copia, sobre la app empaquetada y entre dos «equipos»: A exporta
// con frase el perfil con dos cuentas de Docker (con su sesión iniciada) y el historial nativo, viendo antes
// cuánto lleva; B, con el proyecto abierto en otra ruta, importa: las conversaciones llegan a sus cuentas
// (la que falta se crea sin sesión) y las nativas bajo la carpeta del proyecto de aquí. Ninguna credencial viaja.
// Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { abrirTessera, carpetasAgentes, PLATAFORMA, type SesionTessera } from './tessera'

const FRASE = 'frase de prueba larga'
const TRABAJO = { id: 'trabajo', nombre: 'Trabajo', color: '#336699', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/trabajo/claude' }], sandbox: { habilitado: false } }
const PERSONAL = { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } }
const CUENTAS = {
  version: 1,
  accounts: [
    { id: 'default-trabajo-claude-code', nombre: 'Predeterminada', agente: 'claude-code', profileId: 'trabajo', isDefault: true },
    { id: 'cuenta-codex', nombre: 'Laboratorio', agente: 'codex', profileId: 'trabajo' }
  ]
}

/** La carpeta de proyectos de Claude Code de una ruta: todo lo que no es alfanumérico, a «-». */
const carpetaClaude = (ruta: string): string => ruta.replace(/[^A-Za-z0-9]/g, '-')
const linea = (cwd: string, texto: string): string => `${JSON.stringify({ type: 'user', cwd, sessionId: 's1', message: { content: texto } })}\n`

function poner(base: string, rel: string, texto: string): void {
  const abs = join(base, ...rel.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, texto)
}

function todos(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? todos(join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]))
}

async function abrirCategoria(win: Page): Promise<void> {
  await win.keyboard.press(`${PLATAFORMA === 'mac' ? 'Meta' : 'Control'}+,`)
  await expect(win.locator('.ajustes-modal')).toHaveCount(1)
  await win.locator('.ajustes-riel-item[data-cat="copia"]').click()
}

test.describe.serial('El historial de conversaciones en la copia', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-copia-historial-e2e-'))
  const archivo = join(dir, 'copia.tessera')
  const rutaOrigen = join(dir, 'origen', 'demo-historial')
  const rutaAqui = join(dir, 'aqui', 'demo-historial')
  let s: SesionTessera | null = null

  test.afterAll(async () => {
    await s?.cerrar()
    rmSync(dir, { recursive: true, force: true })
  })

  test('A ve cuánto lleva el historial y lo exporta con frase', async () => {
    s = await abrirTessera({}, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify([TRABAJO]))
        writeFileSync(join(datos, 'agent-accounts.json'), JSON.stringify(CUENTAS))
        const claude = join(datos, '.tessera', 'perfiles', 'trabajo', 'claude')
        poner(claude, '.credentials.json', '{"token":"secreto-de-sesion"}')
        poner(claude, 'projects/-workspace-demo-historial/d1.jsonl', linea('/workspace/demo-historial', 'hola desde docker'))
        const codex = join(datos, '.tessera', 'perfiles', 'trabajo', 'codex-cuentas', 'cuenta-codex')
        poner(codex, 'auth.json', '{"token":"secreto-de-codex"}')
        poner(codex, 'sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl', '{"type":"session_meta"}\n')
        const nativa = carpetasAgentes(datos).claude
        poner(nativa, `projects/${carpetaClaude(rutaOrigen)}/n1.jsonl`, linea(rutaOrigen, 'hola nativa'))
      }
    })
    const win = s.win
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, archivo)
    await abrirCategoria(win)
    await win.locator('.ajustes-modal').getByRole('button', { name: 'Exportar…' }).click()
    const modal = win.locator('.copia-modal')
    const historial = modal.getByRole('checkbox', { name: 'Historial de conversaciones', exact: true })
    await expect(historial, 'desmarcado de serie').not.toBeChecked()
    await historial.check()
    const previa = modal.getByTestId('copia-historial-previa')
    await expect(previa).toContainText('Trabajo · Claude Code · Predeterminada: 1 conversación(es)')
    await expect(previa).toContainText('Trabajo · Codex · Laboratorio: 1 conversación(es)')
    await modal.getByRole('checkbox', { name: /Incluir el historial nativo/ }).check()
    await expect(previa).toContainText('Claude Code · este equipo: 1 conversación(es)')
    await expect(modal).toContainText('En total: 3 conversación(es)')
    await modal.screenshot({ path: test.info().outputPath('exportar-historial.png') })
    await modal.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
    await modal.getByLabel('Repetir la frase de contraseña').fill(FRASE)
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal).toContainText('Guardado en «copia.tessera»', { timeout: 60_000 })
    await expect(modal).toContainText('Historial: 3 conversación(es)')
    const texto = readFileSync(archivo, 'utf8')
    expect(texto, 'ni la sesión ni lo hablado en claro').not.toMatch(/secreto-de|hola desde|hola nativa/)
    await s.cerrar()
    s = null
  })

  test('B importa el historial: a sus cuentas, sin credenciales y bajo la ruta del proyecto de aquí', async () => {
    mkdirSync(rutaAqui, { recursive: true })
    s = await abrirTessera({}, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify([PERSONAL]))
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: { personal: { openProjects: [{ projectHostPath: rutaAqui, name: basename(rutaAqui), estado: 'active' }], activePath: rutaAqui } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${rutaAqui}`] }
          })
        )
      }
    })
    const win = s.win
    const datos = s.datos
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [r] })) as typeof dialog.showOpenDialog
    }, archivo)
    await abrirCategoria(win)
    await win.locator('.ajustes-modal').getByRole('button', { name: 'Importar…' }).click()
    const modal = win.locator('.copia-modal')
    await modal.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
    await modal.getByRole('button', { name: 'Abrir' }).click()
    const casilla = (nombre: string) => modal.getByRole('checkbox', { name: nombre, exact: true })
    await expect(casilla('Historial · Claude Code · Predeterminada'), 'cifrado: marcado de serie').toBeChecked({ timeout: 30_000 })
    await expect(casilla('Historial · Codex · Laboratorio')).toBeChecked()
    await expect(casilla('Historial · Claude Code · este equipo')).toBeChecked()
    await modal.screenshot({ path: test.info().outputPath('importar-historial.png') })
    await modal.getByRole('button', { name: 'Importar' }).click()
    await expect(modal).toContainText('Importado.', { timeout: 60_000 })
    const hecho = modal.getByTestId('copia-historial-hecho')
    await expect(hecho).toContainText('Historial: 3 conversación(es) nueva(s)')
    await expect(hecho).toContainText('1 conversación(es) se guardaron bajo la ruta que su proyecto tiene en este equipo.')
    const nativa = carpetasAgentes(datos).claude
    expect(existsSync(join(nativa, 'projects', carpetaClaude(rutaAqui), 'n1.jsonl')), 'la nativa, bajo la carpeta del proyecto de aquí').toBe(true)
    expect(existsSync(join(datos, '.tessera', 'perfiles', 'trabajo', 'claude', 'projects', '-workspace-demo-historial', 'd1.jsonl'))).toBe(true)
    const cuentas = JSON.parse(readFileSync(join(datos, 'agent-accounts.json'), 'utf8')) as typeof CUENTAS
    const laboratorio = cuentas.accounts.find((a) => a.agente === 'codex' && a.nombre === 'Laboratorio')
    expect(laboratorio, 'la cuenta de Codex se crea').toBeTruthy()
    const enLaboratorio = todos(join(datos, '.tessera', 'perfiles', 'trabajo', 'codex-cuentas', laboratorio!.id))
    expect(enLaboratorio, 'con su rollout y nada más').toEqual(['sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl'])
    const todoB = todos(join(datos, '.tessera'))
    expect(todoB.filter((x) => /credentials|auth\.json/.test(x)), 'ninguna sesión viajó').toEqual([])
    await s.cerrar()
    s = null
  })
})
