// =============================================================================
// El editor de la configuración de una cuenta de Docker, sin Docker: la cuenta se crea por IPC y no se levanta
// ningún contenedor. Fija que Configuración abre el contexto de los agentes, que la cuenta se elige como ámbito de
// la configuración de Docker de su perfil,
// que un error de sintaxis no guarda, que guardar escribe el archivo, que la capa del perfil solo tiene la
// configuración técnica, que la global se guarda en su capa y no en la nativa, y que cambiar de nivel o cerrar
// con cambios pide confirmación.
// =============================================================================

import { expect, test } from '@playwright/test'
import { abrirHumo, cerrarHumo, filaArbol } from './humoAyudas'
import { MOD } from './tessera'

type ApiConfig = {
  obtenerPerfiles: () => Promise<{ id: string; nombre: string }[]>
  cuentasAgente: { crear: (r: { nombre: string; agente: string; profileId: string }) => Promise<{ id: string }> }
  configAgente: { leer: (r: { agente: string; cuentaId: string | null; capa?: { tipo: 'global' } }) => Promise<{ archivos: { configuracion: { contenido: string } } } | null> }
}

test('editar la configuración de una cuenta de Docker desde Configuración', async () => {
  const { s, m } = await abrirHumo()
  try {
    const ventana = s.ventana
    await expect(filaArbol(ventana, 'src')).toBeVisible({ timeout: 30_000 })
    const { accountId, nombrePerfil } = await ventana.evaluate(async () => {
      const t = (window as unknown as { tessera: ApiConfig }).tessera
      const perfil = (await t.obtenerPerfiles())[0]
      const creada = await t.cuentasAgente.crear({ nombre: 'Pruebas', agente: 'codex', profileId: perfil?.id ?? '' })
      return { accountId: creada.id, nombrePerfil: perfil?.nombre ?? '' }
    })
    const contenido = (): Promise<string | undefined> =>
      ventana.evaluate(async (id) => {
        const t = (window as unknown as { tessera: ApiConfig }).tessera
        return (await t.configAgente.leer({ agente: 'codex', cuentaId: id }))?.archivos.configuracion.contenido
      }, accountId)

    await ventana.keyboard.press(`${MOD}+,`)
    await ventana.locator('.ajustes-riel-item[data-cat="agentes"]').click()
    await ventana.getByRole('button', { name: 'Abrir el contexto de los agentes' }).click()
    const dialogo = ventana.getByRole('dialog', { name: 'Contexto de los agentes' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.locator('.modal-pie'), 'sin pregunta no hay pie').toHaveCount(0)
    await expect(dialogo.getByRole('button', { name: 'Cerrar', exact: true })).toHaveAttribute('title', 'Cerrar (Esc)')

    // En el perfil, la configuración de Docker solo tiene el archivo técnico: las reglas son otra sección.
    await dialogo.getByRole('tab', { name: 'Configuración de Docker' }).click()
    await dialogo.getByRole('radio', { name: 'Codex' }).click()
    await expect(dialogo.getByRole('tab', { name: /config\.toml/ })).toBeVisible()
    await expect(dialogo.getByRole('tab', { name: /AGENTS\.md/ }), 'sin instrucciones en la capa').toHaveCount(0)

    // La capa global se guarda en la capa, no en la configuración del agente en su equipo.
    const capaYNativa = (): Promise<[string | undefined, string | undefined]> =>
      ventana.evaluate(async () => {
        const t = (window as unknown as { tessera: ApiConfig }).tessera
        const leer = async (r: Parameters<ApiConfig['configAgente']['leer']>[0]): Promise<string | undefined> => (await t.configAgente.leer(r))?.archivos.configuracion.contenido
        return [await leer({ agente: 'codex', cuentaId: null, capa: { tipo: 'global' } }), await leer({ agente: 'codex', cuentaId: null })]
      })
    await dialogo.getByRole('tab', { name: /^Global/ }).click()
    await expect(dialogo.getByText('Contexto global', { exact: true })).toBeVisible()
    await dialogo.getByRole('tab', { name: 'Configuración de Docker' }).click()
    await dialogo.getByRole('radio', { name: 'Codex' }).click()
    await dialogo.getByTestId('config-agente-editor').click()
    await ventana.keyboard.type('model_verbosity = "medium"')
    await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialogo.locator('.boton-guardar.ok'), 'el botón confirma en sí mismo').toHaveAttribute('aria-label', 'Guardado')
    await expect(dialogo.getByRole('status').filter({ hasText: 'Guardado' }), 'y el lector de pantalla lo oye').toBeAttached()
    const [capa, nativa] = await capaYNativa()
    expect(capa, 'lo guardado está en la capa global').toBe('model_verbosity = "medium"')
    expect(nativa ?? '', 'y no en la configuración nativa').not.toContain('medium')

    // La cuenta es un ámbito de la configuración de Docker de su perfil: se elige ahí, no en el riel.
    await dialogo.getByRole('tab', { name: new RegExp(`^${nombrePerfil}`) }).click()
    await dialogo.getByRole('tab', { name: 'Configuración de Docker' }).click()
    await dialogo.getByRole('radio', { name: 'Codex' }).click()
    await dialogo.getByLabel('Se aplica a').selectOption({ label: 'Solo la cuenta "Pruebas"' })
    // En una cuenta, la línea de debajo del ámbito es su carpeta; en la capa, a qué cuentas se aplica.
    const deLaCuenta = dialogo.getByText(/^Carpeta: /)
    await expect(deLaCuenta).toBeVisible()
    await expect(dialogo.getByRole('tab', { name: new RegExp(`^${nombrePerfil}`) }), 'el riel sigue en su perfil').toHaveAttribute('aria-selected', 'true')
    await expect(dialogo.getByRole('tab', { name: /config\.toml/ })).toHaveAttribute('aria-selected', 'true')
    await expect(dialogo.getByText('config.toml todavía no existe. Se creará al guardar.')).toBeVisible()

    const editor = dialogo.getByTestId('config-agente-editor')
    const guardar = dialogo.getByRole('button', { name: 'Guardar', exact: true })
    await expect(guardar, 'sin cambios no hay nada que guardar').toBeDisabled()

    await editor.click()
    await ventana.keyboard.type('model_context_window = = 1')
    await guardar.click()
    await expect(dialogo.getByTestId('config-agente-problema')).toContainText('Error de sintaxis en la línea 1')
    expect(await contenido(), 'con un error no se escribe nada').toBe('')

    await editor.click()
    await ventana.keyboard.press(`${MOD}+A`)
    await ventana.keyboard.type('model_verbosity = "low"')
    await guardar.click()
    await expect(dialogo.locator('.boton-guardar.ok'), 'el botón confirma en sí mismo').toHaveAttribute('aria-label', 'Guardado')
    await expect(dialogo.getByRole('status').filter({ hasText: 'Guardado' }), 'y el lector de pantalla lo oye').toBeAttached()
    expect(await contenido()).toBe('model_verbosity = "low"')

    // Mayús+Tab no se lleva el foco a Configuración, que queda detrás.
    await dialogo.getByRole('tab', { name: /config\.toml/ }).focus()
    await ventana.keyboard.press('Shift+Tab')
    expect(await ventana.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.classList.contains('contexto-modal')), 'el foco sigue en el diálogo').toBe(true)

    await editor.click()
    await ventana.keyboard.type(' ')
    // Cambiar de nivel con cambios pendientes también pide confirmarlo.
    await dialogo.getByRole('tab', { name: /^Global/ }).click()
    await expect(dialogo.getByText('Hay cambios sin guardar.')).toBeVisible()
    await dialogo.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(deLaCuenta).toBeVisible()
    await dialogo.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(dialogo.getByText('Hay cambios sin guardar.')).toBeVisible()
    await dialogo.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(dialogo.getByText('Hay cambios sin guardar.')).toHaveCount(0)
    await dialogo.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await dialogo.getByRole('button', { name: 'Descartar los cambios' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(await contenido(), 'descartar no escribe').toBe('model_verbosity = "low"')
  } finally {
    await cerrarHumo(s, m)
  }
})
