// =============================================================================
// El explorador SFTP de verdad (E24), contra el servidor SSH de pruebas y con el OpenSSH del sistema: se
// abre desde el menú de la conexión con su contraseña guardada, lista la carpeta de inicio, crea una carpeta,
// entra y sale, y la borra con su confirmación. Solo corre con el servidor de pruebas levantado:
// `bash scripts/pruebas/ssh.sh correr npx playwright test e2e/explorador-sftp.spec.ts`; si no, se salta.
// =============================================================================

import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

const DESTINO = process.env.TESSERA_TEST_SSH
const SECRETOS = process.env.TESSERA_TEST_SSH_DIR

test.describe.serial('El explorador SFTP contra un servidor de verdad', () => {
  test.skip(!DESTINO || !SECRETOS, 'sin TESSERA_TEST_SSH: corre con scripts/pruebas/ssh.sh correr')
  let s: SesionTessera
  let raiz = ''

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    raiz = agente.raiz
    const proyecto = join(raiz, 'alfa')
    mkdirSync(proyecto)
    // Como `conexiones-ssh.spec.ts`: un perfil sin sandbox con un proyecto nativo (sin Docker ni modal de modo).
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        const perfil = { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } }
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify([perfil]))
        const estado = {
          version: 1,
          activeProfileId: 'personal',
          byProfile: { personal: { openProjects: [{ projectHostPath: proyecto, name: 'alfa', estado: 'active' }], activePath: proyecto } },
          settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
        }
        writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify(estado))
      }
    })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (raiz) await borrarTemporal(raiz)
  })

  const panel = (): Locator => s.win.locator('section.terminal-panel')

  test('se abre con la contraseña guardada, lista, crea una carpeta, entra y sale, y la borra', async () => {
    const win = s.win
    const [host, puerto] = (DESTINO ?? '').split(':')
    const secreto = readFileSync(join(SECRETOS ?? '', 'ssh-pw.txt'), 'utf8').trim()
    await win.evaluate(
      ({ host, puerto, secreto }) =>
        window.tessera.ssh.crear({ profileId: 'personal', alias: 'Servidor', grupoId: null, host, puerto, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, secreto }),
      { host, puerto: Number(puerto), secreto }
    )
    await win.getByRole('button', { name: 'Terminal', exact: true }).click()
    await win.locator('section.terminal-panel .panel-header').first().hover()
    await panel().getByRole('button', { name: 'Conexiones SSH', exact: true }).click()
    const lista = win.getByRole('dialog', { name: 'Conexiones SSH' })
    // Sin grupos, la conexión sale suelta, sin cabecera «Sin grupo».
    await lista.getByRole('treeitem', { name: /^Servidor,/ }).click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Abrir explorador SFTP' }).click()

    await expect(panel().getByRole('tab', { name: 'SFTP · Servidor, archivos remotos por SFTP' })).toBeVisible({ timeout: 30_000 })
    const explorador = panel().locator('.terminal-pane:visible')
    const barra = explorador.getByRole('toolbar', { name: 'Archivos remotos por SFTP' })
    await expect(barra, 'conectó sin pedir la contraseña').toBeVisible({ timeout: 30_000 })
    await expect(explorador.getByRole('navigation', { name: 'Ruta de la carpeta' })).toContainText('pruebas')

    const nombre = `e2e-${process.pid} ñ`
    await barra.getByRole('button', { name: 'Nueva carpeta' }).click()
    const dialogo = win.getByRole('dialog', { name: 'Nueva carpeta' })
    await dialogo.getByRole('textbox').fill(nombre)
    await dialogo.getByRole('textbox').press('Enter')
    const fila = explorador.getByRole('option', { name: new RegExp(`^${nombre}, `) })
    await expect(fila, 'la carpeta nueva aparece').toBeVisible({ timeout: 15_000 })

    // Arrastrar archivos sobre la carpeta: la fila se resalta y el aviso la nombra (Playwright no suelta
    // archivos reales del sistema; el destino lo fija `destinoDeSoltar` en test:sftp-explorador).
    const arrastre = await win.evaluateHandle(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'x.txt'))
      return dt
    })
    await fila.dispatchEvent('dragenter', { dataTransfer: arrastre })
    await fila.dispatchEvent('dragover', { dataTransfer: arrastre })
    await expect(fila, 'la carpeta bajo el puntero se resalta').toHaveClass(/soltar-aqui/)
    await expect(explorador.locator('.sftp-aviso-soltar')).toHaveText(`Suelta para subir a «${nombre}»`)
    await fila.dispatchEvent('dragleave', { dataTransfer: arrastre })
    await expect(fila).not.toHaveClass(/soltar-aqui/)
    // Captura opcional, solo si quien corre la prueba pide dónde guardarla.
    if (process.env.TESSERA_E2E_CAPTURAS) await win.screenshot({ path: join(process.env.TESSERA_E2E_CAPTURAS, 'sftp-explorador.png'), animations: 'disabled' })
    await fila.dblclick()
    await expect(explorador.getByRole('navigation', { name: 'Ruta de la carpeta' }), 'entró en ella').toContainText(nombre)
    await barra.getByRole('button', { name: 'Subir un nivel' }).click()
    await expect(fila).toBeVisible()

    await fila.click()
    await barra.getByRole('button', { name: 'Eliminar' }).click()
    const confirmar = win.getByRole('dialog', { name: 'Eliminar 1 elemento' })
    await confirmar.getByRole('button', { name: 'Eliminar', exact: true }).click()
    await expect(fila, 'se borró y la lista se refrescó').toHaveCount(0, { timeout: 15_000 })
  })
})
