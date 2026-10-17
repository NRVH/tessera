// =============================================================================
// Abrir un `.tessera` desde el sistema, contra la app empaquetada: en frío (el archivo en el argv),
// con la app abierta (segunda instancia) y, en macOS, por `open-file`. Sale el importar de la
// configuración con ESE archivo pidiendo la frase, sin Configuración abierta y sin abrir el archivo
// como proyecto; uno que no es una copia se avisa con el error de abrirlo a mano. La copia se crea
// exportando en la propia prueba, con el diálogo nativo sustituido.
// Decisiones: docs/decisiones/configuracion/archivos-tessera-del-sistema.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { abrirTessera, PLATAFORMA, rutaAppEmpaquetada, type SesionTessera } from './tessera'

const FRASE = 'frase de prueba larga'
const PERFILES = JSON.stringify([
  { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } },
  { id: 'trabajo', nombre: 'Trabajo', color: '#336699', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/trabajo/claude' }], sandbox: { habilitado: false } }
])
const SOLO_PERSONAL = JSON.stringify([JSON.parse(PERFILES)[0]])

/** El importar con ese archivo, pidiendo la frase, y sin Configuración ni pestaña de editor detrás. */
async function esperarImportar(win: Page, nombre: string): Promise<ReturnType<Page['locator']>> {
  const modal = win.locator('.copia-modal')
  await expect(modal).toBeVisible({ timeout: 30_000 })
  await expect(modal).toContainText(`«${nombre}»`)
  await expect(modal.getByLabel('Frase')).toBeVisible()
  await expect(win.locator('.ajustes-modal'), 'no hace falta abrir Configuración').toHaveCount(0)
  return modal
}

/**
 * Lanza el paquete como SEGUNDA instancia con un archivo, igual que el sistema, y espera a que
 * salga. El cerrojo va atado al userData: se comprueba que es el temporal de la prueba, porque con
 * otro el archivo llegaría a la Tessera de quien la corre.
 */
async function lanzarSegundaInstancia(datos: string, archivo: string): Promise<void> {
  const exe = rutaAppEmpaquetada()
  if (exe === null) throw new Error('Tessera no se empaqueta para esta plataforma.')
  expect(resolve(datos).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase()), 'el userData es un temporal').toBe(true)
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((resolver, rechazar) => {
    const hijo = spawn(exe, [`--user-data-dir=${datos}`, archivo], { env, stdio: 'ignore' })
    const tope = setTimeout(() => {
      hijo.kill()
      rechazar(new Error('la segunda instancia no salió en 30 s'))
    }, 30_000)
    hijo.on('error', rechazar)
    hijo.on('exit', () => {
      clearTimeout(tope)
      resolver()
    })
  })
}

test.describe.serial('Abrir un .tessera desde el sistema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-copia-sistema-e2e-'))
  const archivo = join(dir, 'copia de ana.tessera')
  const roto = join(dir, 'no es copia.tessera')
  let s: SesionTessera | null = null

  test.afterAll(async () => {
    await s?.cerrar()
    rmSync(dir, { recursive: true, force: true })
  })

  test('se exporta una copia con dos perfiles', async () => {
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES) })
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, archivo)
    const r = await s.win.evaluate(async (frase) => {
      const perfiles = await window.tessera.getProfiles()
      return window.tessera.copiaConfiguracion.exportar({ frase, perfiles, apartados: { ssh: false, bd: false, agentes: false, ajustes: false } })
    }, FRASE)
    expect(r.estado).toBe('guardado')
    writeFileSync(roto, 'esto no es una copia de Tessera\n')
    await s.cerrar()
    s = null
  })

  test('en frío: el archivo en el argv abre el importar y se importa', async () => {
    s = await abrirTessera({}, { args: [archivo], sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), SOLO_PERSONAL) })
    const win = s.win
    const modal = await esperarImportar(win, 'copia de ana.tessera')
    const veces = (await win.locator('body').innerText()).split('copia de ana').length - 1
    expect(veces, 'el nombre solo sale en el importar: no se abre como proyecto ni como archivo').toBe(1)
    await modal.getByLabel('Frase').fill(FRASE)
    await modal.getByRole('button', { name: 'Abrir' }).click()
    await expect(modal.getByRole('checkbox', { name: 'Trabajo', exact: true })).toBeChecked({ timeout: 30_000 })
    await modal.getByRole('button', { name: 'Importar' }).click()
    await expect(modal).toContainText('Importado.', { timeout: 30_000 })
    await modal.getByRole('button', { name: 'Cerrar' }).click()
    await expect(modal).toHaveCount(0)
    expect((await win.evaluate(() => window.tessera.getProfiles())).map((p) => p.id)).toEqual(['personal', 'trabajo'])
  })

  test('con la app abierta: la segunda instancia abre el importar; uno que no es copia se avisa', async () => {
    test.skip(s === null, 'necesita la sesión de la prueba anterior')
    const { win, datos } = s!
    await lanzarSegundaInstancia(datos, archivo)
    const modal = await esperarImportar(win, 'copia de ana.tessera')
    await modal.getByRole('button', { name: 'Cancelar' }).click()
    await expect(modal).toHaveCount(0)

    await lanzarSegundaInstancia(datos, roto)
    const aviso = win.locator('.toast', { hasText: 'No se pudo abrir el archivo de configuración' })
    await expect(aviso).toBeVisible({ timeout: 30_000 })
    await expect(aviso, 'el mismo error que al elegirlo a mano').toContainText('El archivo no es una copia de la configuración de Tessera.')
    await expect(win.locator('.copia-modal')).toHaveCount(0)
  })

  test('macOS: `open-file` con un .tessera abre el importar', async () => {
    test.skip(PLATAFORMA !== 'mac', '`open-file` es un evento de Apple: en Windows y Linux el archivo llega por la segunda instancia')
    test.skip(s === null, 'necesita la sesión de la prueba anterior')
    await s!.app.evaluate(({ app: a }, ruta) => a.emit('open-file', { preventDefault: () => {} }, ruta), archivo)
    await esperarImportar(s!.win, 'copia de ana.tessera')
  })
})
