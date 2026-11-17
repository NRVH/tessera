// =============================================================================
// Permiso de hooks desde el panel de git, sobre la app empaquetada: preparar un archivo en un repo con un hook que
// nunca se aceptó enseña el diálogo (con «Ver»), Cancelar no prepara nada, «Continuar sin ejecutarlos» prepara sin
// correrlo, «Ejecutar y recordar» lo corre y ya no vuelve a preguntar. En la ventana mínima el diálogo cabe entero.
// El hook es `post-index-change`, que git corre al escribir el índice. Decisiones:
// docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

test('preparar con un hook pendiente: ver, cancelar, continuar sin él, aceptar y recordar; cabe en 900 × 620', async () => {
  const montaje = montarAgenteFalso()
  const repo = join(montaje.raiz, 'api-pagos')
  const sinHooks = mkdtempSync(join(tmpdir(), 'tessera-e2e-sin-hooks-'))
  mkdirSync(repo)
  // El git de la prueba no corre el hook: lo que se mide es solo lo que hace Tessera.
  const git = (...a: string[]): string =>
    execFileSync('git', ['-c', `core.hooksPath=${sinHooks}`, ...a], { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Pruebas')
  git('config', 'user.email', 'pruebas@example.invalid')
  writeFileSync(join(repo, 'archivo.txt'), 'inicial\n')
  git('add', '.')
  git('commit', '-qm', 'inicial')
  const hook = join(repo, '.git', 'hooks', 'post-index-change')
  const marca = join(repo, 'marca')
  writeFileSync(hook, '#!/bin/sh\nprintf aceptado > marca\n')
  chmodSync(hook, 0o755)
  const previoCommit = join(repo, '.git', 'hooks', 'pre-commit')
  writeFileSync(previoCommit, '#!/bin/sh\nexit 1\n')
  chmodSync(previoCommit, 0o755)
  const preparados = (): string => git('diff', '--cached', '--name-only')
  let sesion: SesionTessera | undefined
  try {
    sesion = await abrirTessera(montaje.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: { personal: { openProjects: [{ projectHostPath: repo, name: 'api-pagos', estado: 'active' }], activePath: repo } },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${repo}`] }
          })
        )
      }
    })
    const { ventana, app } = sesion
    await app.evaluate(({ BrowserWindow }) => {
      const ventana = BrowserWindow.getAllWindows()[0]
      ventana.unmaximize()
      ventana.setContentSize(900, 620)
    })
    await ventana.getByRole('button', { name: /^Git · Cambios/ }).click()
    const panel = ventana.locator('.git-panel')
    const dialogo = ventana.getByRole('dialog', { name: '¿Permitir que «api-pagos» ejecute sus hooks?' })
    /** Quita de preparados desde fuera y espera a que el panel lo vea (su casilla, vacía). */
    const despreparar = async (): Promise<void> => {
      git('reset', '-q')
      await expect(panel.locator('.git-arbol-fila', { hasText: 'archivo.txt' }).first().locator('.git-casilla')).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 })
    }

    /**
     * Cambia el archivo y lo prepara por la API que usan los botones del panel (`window.tessera.git.prepararArchivo`): pasa
     * por el preload, el diálogo y el main igual que un clic. No se espera aquí: la promesa se resuelve cuando el
     * usuario contesta el diálogo.
     */
    const preparar = async (pagina: Page, contenido: string): Promise<void> => {
      writeFileSync(join(repo, 'archivo.txt'), contenido)
      await expect(panel.locator('.git-arbol-fila', { hasText: 'archivo.txt' }).first()).toBeVisible({ timeout: 30_000 })
      // Al cerrar la app al final, la del último paso puede seguir en vuelo: su rechazo no es un fallo de la prueba.
      pagina.evaluate((raiz) => window.tessera.git.prepararArchivo(raiz, 'archivo.txt'), repo).catch(() => undefined)
    }

    await preparar(ventana, 'uno\n')
    await expect(dialogo, 'un hook nunca aceptado pide permiso').toBeVisible({ timeout: 15_000 })
    // El que corre va primero; el otro de la carpeta se enseña porque se copia con él. Los ejemplos de git, no.
    await expect(dialogo.locator('.git-hook-nombre')).toHaveText(['post-index-change', 'pre-commit'])
    await dialogo.getByRole('button', { name: 'Ver', exact: true }).first().click()
    await expect(dialogo.locator('pre')).toContainText('printf aceptado > marca')
    await expect(dialogo.getByRole('button', { name: 'Ver', exact: true }).first()).toHaveAttribute('aria-expanded', 'true')
    if (process.env.TESSERA_E2E_CAPTURAS) await ventana.screenshot({ path: join(process.env.TESSERA_E2E_CAPTURAS, 'hooks-pendientes.png') })
    expect(await ventana.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'nada desborda').toBe(0)
    const caja = await dialogo.boundingBox()
    expect(caja !== null && caja.x >= 0 && caja.y >= 0 && caja.x + caja.width <= 900 && caja.y + caja.height <= 620, 'el diálogo cabe en 900 × 620').toBe(true)

    await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    expect(preparados(), 'Cancelar no prepara').toBe('')
    expect(existsSync(marca), 'ni corre el hook').toBe(false)

    await preparar(ventana, 'dos\n')
    await dialogo.getByRole('button', { name: 'Continuar sin ejecutarlos', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect.poll(preparados, { message: '«sin ejecutarlos» prepara' }).toBe('archivo.txt')
    expect(existsSync(marca), 'sin correr el hook').toBe(false)
    await despreparar()

    await preparar(ventana, 'tres\n')
    await dialogo.getByRole('button', { name: 'Ejecutar y recordar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect.poll(preparados).toBe('archivo.txt')
    await expect.poll(() => existsSync(marca), { message: 'aceptado, el hook corre' }).toBe(true)
    await despreparar()
    rmSync(marca)

    await preparar(ventana, 'cuatro\n')
    await expect.poll(preparados, { message: 'recordado: prepara sin volver a preguntar' }).toBe('archivo.txt')
    await expect(dialogo).toHaveCount(0)
    await expect.poll(() => existsSync(marca)).toBe(true)
    await despreparar()
    rmSync(marca)

    // Una carpeta que no se puede inspeccionar entera no se puede aceptar: el diálogo dice qué lo impide.
    const grande = join(repo, '.git', 'hooks', 'grande')
    writeFileSync(grande, Buffer.alloc(1024 * 1024 + 1))
    await preparar(ventana, 'cinco\n')
    const bloqueado = ventana.getByRole('dialog', { name: 'Los hooks de «api-pagos» no se pueden aceptar' })
    await expect(bloqueado).toBeVisible({ timeout: 15_000 })
    await expect(bloqueado.locator('.modal-sello.es-peligro')).toBeVisible()
    await expect(bloqueado.locator('.modal-message')).toContainText('.git/hooks/grande')
    await expect(bloqueado.getByRole('button', { name: 'Ejecutar y recordar', exact: true })).toHaveCount(0)
    await expect(bloqueado.getByRole('button', { name: 'Ver', exact: true })).toHaveCount(0)
    if (process.env.TESSERA_E2E_CAPTURAS) await ventana.screenshot({ path: join(process.env.TESSERA_E2E_CAPTURAS, 'hooks-incompletos.png') })
    await bloqueado.getByRole('button', { name: 'Continuar sin ejecutarlos', exact: true }).click()
    await expect(bloqueado).toHaveCount(0)
    await expect.poll(preparados).toBe('archivo.txt')
    expect(existsSync(marca), 'sin correr el hook').toBe(false)
  } finally {
    await sesion?.cerrar()
    await borrarTemporal(montaje.raiz)
    rmSync(sinHooks, { recursive: true, force: true })
  }
})
