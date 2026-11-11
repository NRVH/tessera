// =============================================================================
// El selector de cuenta del agente con cuentas de Docker, sin Docker: se crean por IPC y el agente
// sigue nativo, así que solo se listan y nada levanta un contenedor. Fija renombrar (con el rechazo
// de un nombre repetido a la vista y sin salir de la edición) y que eliminar desde el diálogo deja el
// selector abierto con la lista ya sin ella, para seguir administrando o eligiendo.
// =============================================================================

import { expect, test, type Locator } from '@playwright/test'
import { abrirHumo, cerrarHumo, filaArbol, montarHumo, sembrarHumo } from './humoAyudas'
import { abrirTessera, type SesionTessera } from './tessera'

type ApiCuentas = {
  getProfiles: () => Promise<{ id: string }[]>
  agentAccounts: {
    create: (r: { nombre: string; agente: string; profileId: string; global?: boolean }) => Promise<unknown>
    list: (r: { profileId: string; agente: string }) => Promise<{ nombre: string }[]>
  }
}

const TEXTOS_GLOBALES = {
  es: { globales: 'Globales', privadas: 'Privadas de este perfil', global: 'Global', aviso: 'en todos sus perfiles', cancelar: 'Cancelar', filtro: 'Filtrar cuentas', vacio: 'Ninguna cuenta coincide' },
  en: { globales: 'Global', privadas: 'Private to this profile', global: 'Global', aviso: 'in all your profiles', cancelar: 'Cancel', filtro: 'Filter accounts', vacio: 'No account matches' }
}

for (const idioma of ['es', 'en'] as const) {
  test(`las cuentas globales se distinguen, y con muchas el selector se compacta (${idioma})`, async () => {
    const t = TEXTOS_GLOBALES[idioma]
    const m = montarHumo()
    let s: SesionTessera | undefined
    try {
      s = await abrirTessera({ ...m.env, TESSERA_FORZAR_IDIOMA: idioma }, { sembrar: (datos) => sembrarHumo(datos, m) })
      const win = s.win
      await expect(filaArbol(win, 'src')).toBeVisible({ timeout: 30_000 })
      const crear = (nombres: string[], global: boolean): Promise<void> => win.evaluate(async ([lista, esGlobal]) => {
        const api = (window as unknown as { tessera: ApiCuentas }).tessera
        const profileId = (await api.getProfiles())[0]?.id ?? ''
        for (const nombre of lista as string[]) await api.agentAccounts.create({ nombre, agente: 'claude-code', profileId, global: esGlobal as boolean })
      }, [nombres, global] as const)
      await crear(['Personal'], true)
      await crear(['Trabajo'], false)
      const enOtroPerfil = await win.evaluate(async () => (await (window as unknown as { tessera: ApiCuentas }).tessera.agentAccounts.list({ profileId: 'otro-perfil', agente: 'claude-code' })).map((c) => c.nombre))
      expect(enOtroPerfil, 'la global se ve desde otro perfil y la privada no').toEqual(['Personal'])

      const boton = win.locator('.agent-pane:not(.hidden) .cuenta-btn').first()
      const pop = win.locator('.cuenta-pop')
      await boton.click()
      await expect(pop.locator('.cuenta-seccion-titulo').filter({ hasText: t.globales }).first()).toBeVisible()
      await expect(pop.locator('.cuenta-seccion-titulo').filter({ hasText: t.privadas })).toBeVisible()

      await pop.locator('.cuenta-nueva').click()
      const modal = win.locator('.modal-card')
      await modal.locator('.segmento', { hasText: t.global }).last().click()
      await expect(modal.locator('.cuenta-disponibilidad-aviso .mov-cruce-capa:not([data-saliendo])')).toContainText(t.aviso)
      const sinDesbordes = (l: Locator): Promise<boolean> => l.evaluate((el) => [el, ...Array.from(el.querySelectorAll<HTMLElement>('.modal-cuerpo, .cuenta-disponibilidad, .modal-hint'))].every((x) => x.scrollWidth <= x.clientWidth + 1 && x.scrollHeight <= x.clientHeight + 1))
      for (const [ancho, alto] of [[900, 620], [1600, 1000]] as const) {
        await s.app.evaluate(({ BrowserWindow }, [a, h]) => BrowserWindow.getAllWindows()[0].setSize(a, h), [ancho, alto])
        await win.waitForTimeout(300)
        expect(await sinDesbordes(modal), `el alta cabe a ${ancho}x${alto}`).toBe(true)
      }
      await modal.getByRole('button', { name: t.cancelar }).click()
      await expect(modal).toHaveCount(0)

      await crear(['Cuenta uno', 'Cuenta dos', 'Cuenta tres', 'Cuenta cuatro'], true)
      await boton.click()
      const filtro = pop.getByRole('textbox', { name: t.filtro })
      await expect(filtro).toBeVisible()
      await filtro.fill('cuatro')
      await expect(pop.locator('.cuenta-seccion-lista .cuenta-tarjeta')).toHaveCount(1)
      await filtro.fill('zzz')
      await expect(pop.locator('.cuenta-vacio')).toContainText(t.vacio)
      expect(await pop.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'el selector no desborda a lo ancho').toBe(true)
    } finally {
      await cerrarHumo(s, m)
    }
  })
}

test('renombrar y eliminar cuentas de Docker desde el selector, que sigue abierto', async () => {
  const { s, m } = await abrirHumo()
  try {
    const win = s.win
    await expect(filaArbol(win, 'src')).toBeVisible({ timeout: 30_000 })
    await win.evaluate(async () => {
      const t = (window as unknown as { tessera: ApiCuentas }).tessera
      const profileId = (await t.getProfiles())[0]?.id ?? ''
      await t.agentAccounts.create({ nombre: 'Trabajo', agente: 'claude-code', profileId })
      await t.agentAccounts.create({ nombre: 'Personal', agente: 'claude-code', profileId })
    })
    await win.locator('.agent-pane:not(.hidden) .cuenta-btn').first().click()
    const pop = win.locator('.cuenta-pop')
    const tarjeta = (nombre: string): ReturnType<typeof pop.locator> => pop.locator('.cuenta-tarjeta', { hasText: nombre })
    await expect(tarjeta('Trabajo')).toHaveCount(1)

    // Las acciones van en el menú «⋯» de cada tarjeta: Escape lo cierra a él y el selector sigue.
    const menuDe = async (nombre: string): Promise<void> => {
      await tarjeta(nombre).hover()
      await pop.getByRole('button', { name: `Más acciones de «${nombre}»` }).click()
      await expect(win.locator('.ctx-menu')).toBeVisible()
    }
    await menuDe('Trabajo')
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)
    await expect(pop, 'Escape cierra el menú, no el selector').toBeVisible()

    // Renombrar: un nombre repetido se rechaza con el motivo y la tarjeta sigue en edición.
    await menuDe('Trabajo')
    await win.locator('.ctx-menu').getByRole('menuitem', { name: 'Renombrar' }).click()
    const campo = pop.locator('.cuenta-tarjeta-campo')
    await campo.fill('personal')
    await campo.press('Enter')
    await expect(pop.locator('.cuenta-tarjeta-error'), 'el motivo, a la vista').toContainText('personal')
    await expect(campo, 'sigue editándose').toBeVisible()
    await campo.fill('Oficina')
    await campo.press('Enter')
    await expect(tarjeta('Oficina')).toHaveCount(1)
    await expect(tarjeta('Trabajo')).toHaveCount(0)

    // Escape en el campo solo cancela la edición: el selector no se cierra.
    await menuDe('Oficina')
    await win.locator('.ctx-menu').getByRole('menuitem', { name: 'Renombrar' }).click()
    await campo.press('Escape')
    await expect(campo).toHaveCount(0)
    await expect(pop).toBeVisible()

    // Eliminar: el diálogo va encima y, al terminar, el selector sigue abierto y ya sin ella.
    await menuDe('Oficina')
    await win.locator('.ctx-menu').getByRole('menuitem', { name: 'Eliminar cuenta…' }).click()
    await win.locator('.modal-card button.danger').click()
    await expect(win.locator('.modal-card')).toHaveCount(0)
    await expect(tarjeta('Oficina')).toHaveCount(0)
    await expect(pop, 'el selector sigue abierto tras eliminar').toBeVisible()
    await expect(tarjeta('Personal')).toHaveCount(1)

    // Pulsar otra vez «⋯» cierra su menú, también en el selector.
    await menuDe('Personal')
    await pop.getByRole('button', { name: 'Más acciones de «Personal»' }).click()
    await expect(win.locator('.ctx-menu')).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)

    // Dentro de Configuración, cuya tarjeta frena el mousedown, el menú se cierra de las tres formas y el diálogo sigue.
    await win.keyboard.press('ControlOrMeta+,')
    const ajustes = win.locator('.ajustes-modal')
    await ajustes.locator('.ajustes-riel-item[data-cat="agentes"]').click()
    await ajustes.locator('.gestion-agente[data-agente="claude-code"] .cuentas-desplegar').click()
    const fila = ajustes.locator('.cuentas-configuracion-fila', { hasText: 'Personal' })
    const boton = fila.getByRole('button', { name: 'Más acciones de «Personal»' })
    const abrirMenu = async (): Promise<void> => {
      await fila.hover()
      await boton.click()
      await expect(win.locator('.ctx-menu')).toBeVisible()
    }
    await abrirMenu()
    await ajustes.locator('.modal-title').click()
    await expect(win.locator('.ctx-menu'), 'un clic en el diálogo lo cierra').toHaveCount(0)
    await abrirMenu()
    await boton.click()
    await expect(win.locator('.ctx-menu'), 'el propio «⋯» lo cierra').toHaveCount(0)
    await abrirMenu()
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu'), 'Escape lo cierra').toHaveCount(0)
    await expect(ajustes, 'Escape no cierra el diálogo').toBeVisible()
    await abrirMenu()
    await win.locator('.ctx-menu').getByRole('menuitem', { name: 'Renombrar' }).click()
    await expect(ajustes.locator('.cuenta-tarjeta-campo'), 'una opción del menú sigue funcionando').toBeVisible()
  } finally {
    await cerrarHumo(s, m)
  }
})
