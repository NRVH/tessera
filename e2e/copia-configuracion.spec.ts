// =============================================================================
// Exportar e importar la configuración sobre la app empaquetada, entre dos «equipos» (dos `userData`
// limpios): A exporta con una frase un perfil con conexiones SSH y de bases (con sus contraseñas), un
// agente a mano y un ajuste; B importa (primero con la frase equivocada) eligiendo qué entra (una
// conexión desmarcada, el túnel de una base que se marca con ella) y queda con lo elegido, con las
// contraseñas legibles con SU almacén; otra B desmarca un perfil entero y no le llega nada de él. El
// archivo no lleva secretos en claro, salvo exportado sin frase, con su aviso. Los archivos de las cuentas y las
// reglas nativas se comparan con este equipo; sustituir pide confirmación. Los diálogos nativos se sustituyen.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirTessera, carpetasAgentes, PLATAFORMA, type SesionTessera } from './tessera'

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
  // En `beforeAll`: el cuerpo de `describe` también corre al listar las pruebas, y esa carpeta no la borra nadie.
  let dir = ''
  let archivo = ''
  let s: SesionTessera | null = null

  test.beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tessera-copia-e2e-'))
    archivo = join(dir, 'copia.tessera')
  })

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
    await modal.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
    await modal.getByLabel('Repetir la frase de contraseña').fill('otra cosa distinta')
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal.getByRole('alert'), 'las frases tienen que coincidir').toContainText('no coinciden')
    await modal.getByLabel('Repetir la frase de contraseña').fill(FRASE)
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal).toContainText('Guardado en «copia.tessera»', { timeout: 30_000 })
    await expect(modal.locator('.modal-pie'), 'la exportación terminada se cierra con la ✕').toHaveCount(0)
    await expect(modal.getByRole('button', { name: 'Cerrar', exact: true })).toHaveAttribute('title', 'Cerrar (Esc)')
    await expect(modal).toContainText('2 conexiones SSH, 1 de bases de datos')
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
      await modal.getByLabel('Frase de contraseña', { exact: true }).fill('no es la frase')
      await modal.getByRole('button', { name: 'Abrir' }).click()
      await expect(modal.getByRole('alert')).toContainText('La frase de contraseña no corresponde a este archivo', { timeout: 30_000 })
    }
    await modal.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
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
    const ajustes = casilla('Ajustes de Tessera (sustituyen los ajustes de este equipo)')
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
    await expect(modal.locator('.modal-pie'), 'la importación terminada no lleva pie').toHaveCount(0)
    await expect(modal).toContainText('1 perfil nuevo, 1 conexión SSH, 1 de bases de datos y 1 agente propio; ajustes aplicados')
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
    await expect(modal).toContainText('0 perfiles nuevos, 0 conexiones SSH, 0 de bases de datos y 1 agente propio.')
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
    await expect(modal.getByText('El archivo no estará cifrado'), 'NEGATIVO: el aviso no sale sin pedirlo').toHaveCount(0)
    await modal.getByRole('checkbox', { name: 'Exportar sin frase de contraseña' }).check()
    await expect(modal.getByLabel('Frase de contraseña', { exact: true }), 'sin frase no hay campos de frase').toHaveCount(0)
    await expect(modal.locator('.modal-aviso.es-aviso')).toContainText('El archivo no estará cifrado')
    await modal.getByRole('button', { name: 'Exportar…' }).click()
    await expect(modal).toContainText('Guardado en «sin-frase.tessera»', { timeout: 30_000 })
    await expect(modal, 'el resumen recuerda que va sin cifrar, no que guarde una frase').toContainText('El archivo no está cifrado')
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
    await expect(importar.locator('.modal-aviso.es-aviso')).toContainText('no está cifrado')
    await expect(importar.getByLabel('Frase de contraseña'), 'no se pide frase').toHaveCount(0)
    await importar.getByRole('button', { name: 'Continuar' }).click()
    const abierta = importar.getByRole('checkbox', { name: 'SSH · abierta' })
    await expect(abierta, 'sin cifrar, nada viene marcado: cualquiera pudo cambiar el archivo').not.toBeChecked({ timeout: 30_000 })
    await expect(importar.locator('.modal-aviso.es-aviso'), 'y el aviso sigue sobre la lista').toContainText('no hay nada marcado')
    await expect(importar.getByRole('button', { name: 'Importar' })).toBeDisabled()
    await abierta.check()
    await importar.getByRole('button', { name: 'Importar' }).click()
    await expect(importar).toContainText('Importado.', { timeout: 30_000 })
    const ssh = await b.evaluate(async () => (await window.tessera.ssh.listar()).conexiones.find((c) => c.alias === 'abierta'))
    expect(ssh?.tieneSecreto && !ssh?.secretoIlegible, 'la contraseña entra y queda cifrada con el almacén de B').toBe(true)
    await s.cerrar()
    s = null
  })

  // El mismo perfil en dos equipos con distinto id: lo del archivo se añade al de aquí, que no cambia de nombre.
  test('añadir a un perfil de aquí con otro id: recibe las conexiones y, si se elige, las reglas, sin crear otro', async () => {
    const conReglas = join(dir, 'con-reglas.tessera')
    const REGLAS_ARCHIVO = 'Usa pnpm.\nLos commits, en español.'
    const REGLAS_AQUI = 'Usa npm.'
    const trabajo = { ...JSON.parse(PERFILES)[1], reglas: REGLAS_ARCHIVO }
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), JSON.stringify([trabajo])) })
    await s.win.evaluate(async (ssh) => {
      const salto = await window.tessera.ssh.crear({ profileId: 'trabajo', alias: 'salto', grupoId: null, host: 'salto.ejemplo', puerto: 22, usuario: 'yo', metodo: 'contrasena', disponibleAgentes: false, secreto: ssh })
      await window.tessera.db.create({ profileId: 'trabajo', alias: 'principal', motor: 'postgres', host: 'db.ejemplo', port: 5432, database: 'app', user: 'app', readonly: true, tunelSsh: { conexionId: salto.id } })
    }, SECRETO_SSH)
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, conReglas)
    await abrirCategoria(s.win)
    await s.win.locator('.ajustes-modal').getByRole('button', { name: 'Exportar…' }).click()
    const exportar = s.win.locator('.copia-modal')
    await exportar.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
    await exportar.getByLabel('Repetir la frase de contraseña').fill(FRASE)
    await exportar.getByRole('button', { name: 'Exportar…' }).click()
    await expect(exportar).toContainText('Guardado en «con-reglas.tessera»', { timeout: 30_000 })
    await s.cerrar()

    // En B, «Trabajo» tiene otro id y otras reglas.
    const aqui = { ...trabajo, id: 'trabajo-pc', color: '#20a060', reglas: REGLAS_AQUI, agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/trabajo-pc/claude' }] }
    s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), JSON.stringify([aqui])) })
    const win = s.win
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [r] })) as typeof dialog.showOpenDialog
    }, conReglas)
    await abrirCategoria(win)
    await win.locator('.ajustes-modal').getByRole('button', { name: 'Importar…' }).click()
    const modal = win.locator('.copia-modal')
    await modal.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
    await modal.getByRole('button', { name: 'Abrir' }).click()
    const destino = modal.getByLabel('Destino de «Trabajo»')
    await expect(destino, 'de serie, al perfil de aquí con el mismo nombre').toHaveValue('trabajo-pc', { timeout: 30_000 })
    await destino.selectOption({ label: 'Perfil nuevo' })
    await expect(modal.getByLabel('Reglas de «Trabajo»'), 'a un perfil nuevo no hay reglas que elegir').toHaveCount(0)
    await destino.selectOption({ label: 'Añadir a «Trabajo»' })
    const reglas = modal.getByLabel('Reglas de «Trabajo»')
    await expect(reglas, 'reglas distintas: de serie se mantienen las de aquí').toHaveValue('mantener')
    await modal.getByRole('button', { name: 'Ver diferencias' }).click()
    await expect(modal.getByTestId('propuesta-reglas-diff'), 'con el mismo diff que la revisión de propuestas').toBeVisible()
    await reglas.selectOption({ label: 'Sustituir por las del archivo' })
    await expect(modal.getByRole('checkbox', { name: 'SSH · salto' })).toBeChecked()
    await expect(modal.getByRole('checkbox', { name: 'Base de datos · principal' })).toBeChecked()
    await modal.getByRole('button', { name: 'Importar' }).click()
    const aviso = win.getByRole('alertdialog')
    await expect(aviso, 'sustituir unas reglas se confirma').toContainText('¿Sustituir 1 archivo de este equipo?')
    await expect(aviso, 'y avisa de que no se recuperan').toContainText('No se podrá recuperar')
    await aviso.getByRole('button', { name: 'Sustituir e importar' }).click()
    await expect(modal).toContainText('Importado.', { timeout: 30_000 })
    await expect(modal).toContainText('0 perfiles nuevos, 1 conexión SSH, 1 de bases de datos')
    await expect(modal).toContainText('Reglas del archivo aplicadas en «Trabajo».')
    const r = await win.evaluate(async () => {
      const perfiles = await window.tessera.getProfiles()
      return {
        perfiles: perfiles.map((p) => [p.id, p.nombre, p.color]),
        reglas: perfiles[0]?.reglas,
        ssh: (await window.tessera.ssh.listar()).conexiones.find((c) => c.alias === 'salto')?.profileId,
        bd: (await window.tessera.db.list('trabajo-pc')).map((c) => c.alias)
      }
    })
    expect(r.perfiles, 'ningún perfil nuevo; el de aquí conserva su nombre y su color').toEqual([['trabajo-pc', 'Trabajo', '#20a060']])
    expect(r.reglas, 'las reglas del archivo, en el perfil de aquí').toBe(REGLAS_ARCHIVO)
    expect(r.ssh, 'la conexión SSH, en el perfil de aquí').toBe('trabajo-pc')
    expect(r.bd, 'y la base, con su túnel').toEqual(['principal'])
    await s.cerrar()
    s = null
  })

  /** Una cuenta de Docker creada de verdad, con sus archivos escritos en su carpeta. */
  async function cuentaConArchivos(win: Page, agente: 'claude-code' | 'codex', nombre: string, archivos: Record<string, string>): Promise<string> {
    const carpeta = await win.evaluate(
      async ({ agente, nombre }) => {
        const c = await window.tessera.agentAccounts.create({ profileId: 'trabajo', agente, nombre })
        return (await window.tessera.configAgente.leer({ agente, accountId: c.id }))!.carpeta
      },
      { agente, nombre }
    )
    mkdirSync(carpeta, { recursive: true })
    for (const [n, texto] of Object.entries(archivos)) writeFileSync(join(carpeta, n), texto)
    return carpeta
  }

  function sembrarNativos(datos: string, claude: string | null, codex: string | null): void {
    const c = carpetasAgentes(datos)
    mkdirSync(c.claude, { recursive: true })
    mkdirSync(c.codex, { recursive: true })
    if (claude !== null) writeFileSync(join(c.claude, 'CLAUDE.md'), claude)
    if (codex !== null) writeFileSync(join(c.codex, 'AGENTS.md'), codex)
    writeFileSync(join(c.codex, 'config.toml'), 'ruta = "solo-de-este-equipo"\n')
  }

  test('archivos de agentes: tres estados, nativos sin marcar, confirmación solo al sustituir y versión anterior', async () => {
    const conArchivos = join(dir, 'con-archivos.tessera')
    const trabajo = JSON.parse(PERFILES)[1]
    s = await abrirTessera({}, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify([trabajo]))
        sembrarNativos(datos, 'Regla nativa de Claude Code.\n', 'Regla nativa de Codex, del archivo.\n')
      }
    })
    await cuentaConArchivos(s.win, 'codex', 'Uno', { 'AGENTS.md': 'Reglas de Uno, del archivo.\n', 'config.toml': 'model = "uno"\n' })
    await cuentaConArchivos(s.win, 'claude-code', 'Dos', { 'CLAUDE.md': 'Reglas de Dos, iguales.\n', 'settings.json': '{ "model": "dos" }', '.credentials.json': '{"token":"SESION-QUE-NO-VIAJA"}' })
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: r })) as typeof dialog.showSaveDialog
    }, conArchivos)
    await abrirCategoria(s.win)
    await s.win.locator('.ajustes-modal').getByRole('button', { name: 'Exportar…' }).click()
    const exportar = s.win.locator('.copia-modal')
    await exportar.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
    await exportar.getByLabel('Repetir la frase de contraseña').fill(FRASE)
    await exportar.getByRole('button', { name: 'Exportar…' }).click()
    await expect(exportar).toContainText('Guardado en «con-archivos.tessera»', { timeout: 30_000 })
    await expect(exportar).toContainText('2 cuentas de Docker')
    await s.cerrar()

    // B tiene las mismas cuentas por nombre: una con otro AGENTS.md y sin config.toml, la otra con el CLAUDE.md igual.
    s = await abrirTessera({}, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify([trabajo]))
        sembrarNativos(datos, null, 'Regla nativa de Codex, de este equipo.\n')
      }
    })
    const win = s.win
    const nativas = carpetasAgentes(s.datos)
    await win.evaluate(() => window.tessera.agentAccounts.create({ profileId: 'trabajo', agente: 'codex', nombre: 'Tres' }).then(() => undefined))
    const uno = await cuentaConArchivos(win, 'codex', 'Uno', { 'AGENTS.md': 'Reglas de Uno, de este equipo.\n' })
    const dos = await cuentaConArchivos(win, 'claude-code', 'Dos', { 'CLAUDE.md': 'Reglas de Dos, iguales.\n' })
    await s.app.evaluate(({ dialog }, r) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [r] })) as typeof dialog.showOpenDialog
    }, conArchivos)
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620))

    async function abrirImportar(): Promise<ReturnType<Page['locator']>> {
      await win.locator('.ajustes-modal').getByRole('button', { name: 'Importar…' }).click()
      const modal = win.locator('.copia-modal')
      await modal.getByLabel('Frase de contraseña', { exact: true }).fill(FRASE)
      await modal.getByRole('button', { name: 'Abrir' }).click()
      await expect(modal.getByLabel('Destino de «Trabajo»')).toBeVisible({ timeout: 30_000 })
      return modal
    }

    await abrirCategoria(win)
    const modal = await abrirImportar()
    await expect(modal.getByRole('checkbox', { name: 'config.toml' }), 'falta aquí: marcado de serie').toBeChecked()
    await expect(modal.getByRole('checkbox', { name: 'settings.json' })).toBeChecked()
    await expect(modal.locator('.copia-ya', { hasText: 'CLAUDE.md' }), 'igual: sin casilla, con su píldora').toContainText('Igual')
    await expect(modal.getByLabel('Qué hacer con AGENTS.md'), 'distinto: de serie se mantiene el de aquí').toHaveValue('mantener')
    await expect(modal.getByRole('checkbox', { name: 'Reglas de Claude Code' }), 'NEGATIVO: la regla nativa que falta no viene marcada').not.toBeChecked()
    await expect(modal.getByLabel('Reglas de Codex en este equipo')).toHaveValue('mantener')
    // No desborda en la ventana mínima.
    expect(await modal.locator('.modal-cuerpo').evaluate((el) => el.scrollWidth - el.clientWidth), 'la lista no desborda a 900×620').toBeLessThanOrEqual(0)
    await modal.getByRole('button', { name: 'Ver diferencias' }).nth(0).click()
    await expect(modal.getByTestId('propuesta-reglas-diff')).toBeVisible()
    await modal.getByRole('button', { name: 'Importar' }).click()
    await expect(win.getByRole('alertdialog'), 'NEGATIVO: si solo se crean archivos, sin confirmación').toHaveCount(0)
    await expect(modal).toContainText('Importado.', { timeout: 30_000 })
    await expect(modal.getByTestId('copia-archivos-hecho'), 'el resultado enumera lo creado').toContainText('config.toml')
    expect(readFileSync(join(uno, 'config.toml'), 'utf8'), 'en la cuenta correspondiente').toBe('model = "uno"\n')
    expect(readFileSync(join(uno, 'AGENTS.md'), 'utf8'), 'lo distinto no se tocó').toBe('Reglas de Uno, de este equipo.\n')
    expect(readFileSync(join(dos, 'settings.json'), 'utf8')).toBe('{ "model": "dos" }')
    expect(existsSync(join(dos, '.credentials.json')), 'NEGATIVO: las credenciales no viajan').toBe(false)
    expect(existsSync(join(nativas.claude, 'CLAUDE.md')), 'NEGATIVO: la nativa sin marcar no se crea').toBe(false)
    await modal.getByRole('button', { name: 'Cerrar' }).click()

    const otra = await abrirImportar()
    await otra.getByLabel('Qué hacer con AGENTS.md').selectOption('sustituir')
    await otra.getByLabel('Reglas de Codex en este equipo').selectOption('sustituir')
    await otra.getByRole('button', { name: 'Importar' }).click()
    const aviso = win.getByRole('alertdialog')
    await expect(aviso).toContainText('¿Sustituir 2 archivos de este equipo?')
    await expect(aviso).toContainText('Reglas de Codex «Uno»')
    await expect(aviso.locator('.copia-mono'), 'la ruta real del archivo, no una supuesta').toContainText('AGENTS.md')
    await expect(aviso.locator('.copia-mono')).not.toContainText('~/.codex/')
    const volver = aviso.getByRole('button', { name: 'Volver a la lista' })
    await expect(volver, 'el foco empieza en volver').toBeFocused()
    expect(await aviso.evaluate((el) => {
      const c = el.getBoundingClientRect()
      return el.scrollWidth <= el.clientWidth && c.top >= 0 && c.bottom <= window.innerHeight && c.left >= 0 && c.right <= window.innerWidth
    }), 'el aviso cabe a 900×620').toBe(true)
    await volver.click()
    await expect(aviso).toHaveCount(0)
    await expect(otra.getByLabel('Qué hacer con AGENTS.md'), 'volver conserva la elección').toHaveValue('sustituir')
    await otra.getByRole('button', { name: 'Importar' }).click()
    await aviso.getByRole('button', { name: 'Sustituir e importar' }).click()
    await expect(otra).toContainText('Importado.', { timeout: 30_000 })
    await expect(otra.getByTestId('copia-archivos-hecho')).toContainText('Archivos sustituidos')
    expect(readFileSync(join(uno, 'AGENTS.md'), 'utf8'), 'sustituido').toBe('Reglas de Uno, del archivo.\n')
    expect(readFileSync(join(uno, 'AGENTS.md.tessera-anterior'), 'utf8'), 'la versión anterior a salvo').toBe('Reglas de Uno, de este equipo.\n')
    expect(readFileSync(join(nativas.codex, 'AGENTS.md'), 'utf8')).toBe('Regla nativa de Codex, del archivo.\n')
    expect(readFileSync(join(nativas.codex, 'AGENTS.md.tessera-anterior'), 'utf8')).toBe('Regla nativa de Codex, de este equipo.\n')
    expect(readFileSync(join(nativas.codex, 'config.toml'), 'utf8'), 'NEGATIVO: la configuración técnica nativa no viaja').toContain('solo-de-este-equipo')
  })
})
