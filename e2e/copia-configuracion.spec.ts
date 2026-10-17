// =============================================================================
// Exportar e importar la configuración sobre la app empaquetada, entre dos «equipos» (dos `userData`
// limpios): A exporta con una frase un perfil con conexiones SSH y de bases (con sus contraseñas), un
// agente a mano y un ajuste; B importa (primero con la frase equivocada) eligiendo qué entra (una
// conexión desmarcada, el túnel de una base que se marca con ella) y queda con lo elegido, con las
// contraseñas legibles con SU almacén; otra B desmarca un perfil entero y no le llega nada de él. El
// archivo no lleva secretos en claro, salvo exportado sin frase: entonces va sin cifrar, con su aviso
// al exportar y al importar. Los diálogos nativos se sustituyen.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, PLATAFORMA, type SesionTessera } from './tessera'

const FRASE = 'frase de prueba larga'
const SECRETO_SSH = 'clave-ssh-de-prueba'
const SECRETO_BD = 'clave-bd-de-prueba'

const PERFILES = JSON.stringify([
  { id: 'personal', nombre: 'Personal', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }], sandbox: { habilitado: false } },
  { id: 'trabajo', nombre: 'Trabajo', color: '#336699', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/trabajo/claude' }], sandbox: { habilitado: false } }
])
const SOLO_PERSONAL = JSON.stringify([JSON.parse(PERFILES)[0]])

const AGENTE = { id: 'm-eco', nombre: 'Eco', comando: 'eco-agente' }

async function abrirCategoria(win: Page): Promise<void> {
  await win.keyboard.press(`${PLATAFORMA === 'mac' ? 'Meta' : 'Control'}+,`)
  await expect(win.locator('.ajustes-modal')).toHaveCount(1)
  await win.locator('.ajustes-riel-item[data-cat="copia"]').click()
}

test.describe.serial('Exportar e importar la configuración', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-copia-e2e-'))
  const archivo = join(dir, 'copia.tessera')
  let s: SesionTessera | null = null

  test.afterAll(async () => {
    await s?.cerrar()
    rmSync(dir, { recursive: true, force: true })
  })

  test('A exporta un perfil con sus conexiones, sus contraseñas, un agente y un ajuste', async () => {
    s = await abrirTessera({}, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES)
        writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({ version: 1, activeProfileId: 'personal', byProfile: {}, settings: { agentesNativos: [AGENTE], uiFontSize: 15 } }))
      }
    })
    const win = s.win
    await win.evaluate(
      async ({ ssh, bd }) => {
        const grupo = await window.tessera.ssh.crearGrupo({ profileId: 'trabajo', nombre: 'Servidores' })
        const salto = await window.tessera.ssh.crear({ profileId: 'trabajo', alias: 'salto', grupoId: grupo.id, host: 'salto.ejemplo', puerto: 22, usuario: 'yo', metodo: 'contrasena', disponibleAgentes: false, secreto: ssh })
        await window.tessera.ssh.crear({ profileId: 'trabajo', alias: 'suelta', grupoId: null, host: 'suelta.ejemplo', puerto: 22, usuario: 'yo', metodo: 'contrasena', disponibleAgentes: false })
        // La base va por el túnel de «salto»: al importar, una depende de la otra.
        await window.tessera.db.create({ profileId: 'trabajo', alias: 'principal', motor: 'postgres', host: 'db.ejemplo', port: 5432, database: 'app', user: 'app', readonly: true, password: bd, tunelSsh: { conexionId: salto.id } })
      },
      { ssh: SECRETO_SSH, bd: SECRETO_BD }
    )
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, archivo)
    await abrirCategoria(win)
    await win.locator('.ajustes-modal').getByRole('button', { name: 'Exportar…' }).click()
    const modal = win.locator('.copia-modal')
    await modal.getByLabel('Frase', { exact: true }).fill(FRASE)
    await modal.getByLabel('Repite la frase').fill('otra cosa distinta')
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal.getByRole('alert'), 'las frases tienen que coincidir').toContainText('no coinciden')
    await modal.getByLabel('Repite la frase').fill(FRASE)
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal).toContainText('Guardado en «copia.tessera»', { timeout: 30_000 })
    await expect(modal).toContainText('2 conexión(es) SSH, 1 de bases de datos')
    const texto = readFileSync(archivo, 'utf8')
    expect(texto, 'ningún secreto ni nombre en claro en el archivo').not.toContain(SECRETO_BD)
    expect(texto).not.toContain(SECRETO_SSH)
    expect(texto).not.toContain('principal')
    await modal.getByRole('button', { name: 'Cerrar' }).click()
    await s.cerrar()
    s = null
  })

  /** Abre el archivo en una B limpia (solo con «Personal») y llega a la lista de qué importar. */
  async function abrirEnB(conFraseMala: boolean): Promise<{ win: Page; modal: ReturnType<Page['locator']> }> {
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), SOLO_PERSONAL) })
    const win = s.win
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [r] })) as typeof dialog.showOpenDialog
    }, archivo)
    await abrirCategoria(win)
    await win.locator('.ajustes-modal').getByRole('button', { name: 'Importar…' }).click()
    const modal = win.locator('.copia-modal')
    await expect(modal).toContainText('copia.tessera')
    if (conFraseMala) {
      await modal.getByLabel('Frase').fill('no es la frase')
      await modal.getByRole('button', { name: 'Abrir' }).click()
      await expect(modal.getByRole('alert')).toContainText('La frase no es la de este archivo', { timeout: 30_000 })
    }
    await modal.getByLabel('Frase').fill(FRASE)
    await modal.getByRole('button', { name: 'Abrir' }).click()
    await expect(modal.getByRole('checkbox', { name: 'Trabajo', exact: true })).toBeChecked({ timeout: 30_000 })
    return { win, modal }
  }

  test('B importa: frase equivocada, elige qué entra (con dependencias) y queda con lo elegido', async () => {
    const { win, modal } = await abrirEnB(true)
    const casilla = (nombre: string) => modal.getByRole('checkbox', { name: nombre, exact: true })
    await expect(modal, 'el perfil que ya está, sin casilla').toContainText('Personal')
    await expect(casilla('Personal')).toHaveCount(0)
    await expect(modal.locator('.copia-ya .copia-ya-existe').first(), 'y lo dice en su píldora').toHaveText('Ya existe')
    await modal.screenshot({ path: test.info().outputPath('importar.png') })
    await expect(casilla('Agente · Eco')).toBeChecked()
    const ajustes = casilla('Ajustes de Tessera (sustituyen las preferencias de este equipo)')
    await expect(ajustes, 'los ajustes, marcados de serie como todo').toBeChecked()
    await expect(modal.getByRole('checkbox', { name: 'Todo', exact: true }), 'con todo marcado, «Todo» también').toBeChecked()
    await casilla('SSH · suelta').uncheck()
    await expect(casilla('Trabajo'), 'el perfil, a medias').toBeChecked({ indeterminate: true })
    // Sin «salto» la base se quedaría sin su túnel: se desmarca con ella, y marcarla la vuelve a traer.
    await casilla('SSH · salto').uncheck()
    await expect(casilla('Base de datos · principal')).not.toBeChecked()
    await expect(modal).toContainText('También se desmarca «principal»: necesita «salto».')
    await casilla('Base de datos · principal').check()
    await expect(casilla('SSH · salto')).toBeChecked()
    await expect(modal).toContainText('También se marca «salto»: «principal» la necesita.')
    await modal.getByRole('button', { name: 'Importar' }).click()
    await expect(modal).toContainText('Importado.', { timeout: 30_000 })
    await expect(modal).toContainText('1 perfil(es) nuevo(s), 1 conexión(es) SSH, 1 de bases de datos y 1 agente(s) añadidos; ajustes aplicados')
    const r = await win.evaluate(async () => {
      const conexiones = (await window.tessera.ssh.listar()).conexiones
      const bd = (await window.tessera.db.list('trabajo')).find((c) => c.alias === 'principal')
      return { ssh: conexiones.find((c) => c.alias === 'salto'), suelta: conexiones.find((c) => c.alias === 'suelta'), bd }
    })
    expect(r.suelta, 'la desmarcada no entra').toBeUndefined()
    expect(r.ssh?.profileId).toBe('trabajo')
    expect(r.ssh?.tieneSecreto && !r.ssh?.secretoIlegible, 'la contraseña SSH, cifrada con el almacén de B').toBe(true)
    expect(r.bd?.tieneSecreto && !r.bd?.secretoIlegible, 'la de la base, también').toBe(true)
    await modal.getByRole('button', { name: 'Cerrar' }).click()
    await win.locator('.ajustes-modal').press('Escape')
    await expect(win.locator('.tabs-profiles').getByRole('tab', { name: /Trabajo/ }), 'el perfil nuevo aparece').toBeVisible()
    // El agente y el ajuste se guardan como si se hubieran cambiado a mano.
    await expect
      .poll(() => {
        const ajustes = JSON.parse(readFileSync(join(s!.datos, 'workspace-state.json'), 'utf8')).settings
        return [ajustes.agentesNativos?.map((d: { id: string }) => d.id), ajustes.uiFontSize]
      })
      .toEqual([['m-eco'], 15])
    await s!.cerrar()
    s = null
  })

  test('otra B desmarca un perfil entero, desmarca y marca todo, y solo entra lo elegido', async () => {
    const { win, modal } = await abrirEnB(false)
    const importar = modal.getByRole('button', { name: 'Importar' })
    const todo = modal.getByRole('checkbox', { name: 'Todo', exact: true })
    await expect(todo, 'de serie entra todo').toBeChecked()
    await modal.getByRole('checkbox', { name: 'Trabajo', exact: true }).uncheck()
    await expect(modal.getByRole('checkbox', { name: 'SSH · salto' }), 'desmarcar el perfil desmarca lo suyo').not.toBeChecked()
    await expect(modal.getByRole('checkbox', { name: 'Base de datos · principal' })).not.toBeChecked()
    await expect(todo, 'con parte marcada, «Todo» queda a medias').toBeChecked({ indeterminate: true })
    await expect(modal.locator('.copia-todo')).toContainText(/\d+ de \d+ seleccionados/)
    // A medias, pulsarla marca todo; marcada, lo desmarca.
    await todo.click()
    await expect(modal.getByRole('checkbox', { name: 'Trabajo', exact: true }), '«Todo» vuelve a marcar el perfil entero').toBeChecked()
    await expect(modal.getByRole('checkbox', { name: 'Base de datos · principal' })).toBeChecked()
    await todo.click()
    await expect(modal.getByRole('checkbox', { name: 'Agente · Eco' })).not.toBeChecked()
    await expect(importar, 'sin nada marcado no se importa').toBeDisabled()
    await expect(todo).not.toBeChecked()
    await modal.getByRole('checkbox', { name: 'Agente · Eco' }).check()
    await importar.click()
    await expect(modal).toContainText('Importado.', { timeout: 30_000 })
    await expect(modal).toContainText('0 perfil(es) nuevo(s), 0 conexión(es) SSH, 0 de bases de datos y 1 agente(s) añadidos.')
    const r = await win.evaluate(async () => ({
      perfiles: (await window.tessera.getProfiles()).map((p) => p.id),
      ssh: (await window.tessera.ssh.listar()).conexiones.length,
      bd: (await window.tessera.db.list('trabajo')).length
    }))
    expect(r, 'ni el perfil desmarcado ni sus conexiones').toEqual({ perfiles: ['personal'], ssh: 0, bd: 0 })
    await expect
      .poll(() => {
        const ajustes = JSON.parse(readFileSync(join(s!.datos, 'workspace-state.json'), 'utf8')).settings
        return [ajustes.agentesNativos?.map((d: { id: string }) => d.id), ajustes.uiFontSize === 15]
      }, { message: 'el agente marcado entra; los ajustes desmarcados no' })
      .toEqual([['m-eco'], false])
    await s!.cerrar()
    s = null
  })

  // Sin frase solo si se pide, con el aviso a la vista; y al importarlo, el aviso antes de enseñar nada.
  test('sin frase: se marca con su aviso, el archivo va sin cifrar y B lo importa tras avisar, sin pedir frase', async () => {
    const sinFrase = join(dir, 'sin-frase.tessera')
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES) })
    const win = s.win
    await win.evaluate(async (ssh) => {
      await window.tessera.ssh.crear({ profileId: 'trabajo', alias: 'abierta', grupoId: null, host: 'abierta.ejemplo', puerto: 22, usuario: 'yo', metodo: 'contrasena', disponibleAgentes: false, secreto: ssh })
    }, SECRETO_SSH)
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, sinFrase)
    await abrirCategoria(win)
    await win.locator('.ajustes-modal').getByRole('button', { name: 'Exportar…' }).click()
    const modal = win.locator('.copia-modal')
    await expect(modal.getByText('El archivo irá sin cifrar'), 'NEGATIVO: el aviso no sale sin pedirlo').toHaveCount(0)
    await modal.getByRole('checkbox', { name: 'Exportar sin frase' }).check()
    await expect(modal.getByLabel('Frase', { exact: true }), 'sin frase no hay campos de frase').toHaveCount(0)
    await expect(modal.getByRole('note')).toContainText('El archivo irá sin cifrar')
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal).toContainText('Guardado en «sin-frase.tessera»', { timeout: 30_000 })
    await expect(modal, 'el resumen recuerda que va sin cifrar, no que guarde una frase').toContainText('El archivo va sin cifrar')
    const archivoSinFrase = JSON.parse(readFileSync(sinFrase, 'utf8'))
    expect(archivoSinFrase.cifrado, 'la cabecera dice que va sin cifrar').toBeNull()
    expect(Buffer.from(archivoSinFrase.datos, 'base64').toString('utf8'), 'y el secreto va legible').toContain(SECRETO_SSH)
    await s.cerrar()

    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), SOLO_PERSONAL) })
    const b = s.win
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [r] })) as typeof dialog.showOpenDialog
    }, sinFrase)
    await abrirCategoria(b)
    await b.locator('.ajustes-modal').getByRole('button', { name: 'Importar…' }).click()
    const importar = b.locator('.copia-modal')
    await expect(importar.getByRole('note')).toContainText('no está cifrado')
    await expect(importar.getByLabel('Frase'), 'no se pide frase').toHaveCount(0)
    await importar.getByRole('button', { name: 'Continuar' }).click()
    const abierta = importar.getByRole('checkbox', { name: 'SSH · abierta' })
    await expect(abierta, 'sin cifrar, nada viene marcado: cualquiera pudo cambiar el archivo').not.toBeChecked({ timeout: 30_000 })
    await expect(importar.getByRole('note'), 'y el aviso sigue sobre la lista').toContainText('nada viene marcado')
    await expect(importar.getByRole('button', { name: 'Importar' })).toBeDisabled()
    await abierta.check()
    await importar.getByRole('button', { name: 'Importar' }).click()
    await expect(importar).toContainText('Importado.', { timeout: 30_000 })
    const ssh = await b.evaluate(async () => (await window.tessera.ssh.listar()).conexiones.find((c) => c.alias === 'abierta'))
    expect(ssh?.tieneSecreto && !ssh?.secretoIlegible, 'la contraseña entra y queda cifrada con el almacén de B').toBe(true)
  })
})
