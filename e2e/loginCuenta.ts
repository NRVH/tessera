// =============================================================================
// Lo común de las pruebas del inicio de sesión de una cuenta de Docker: un perfil con una cuenta de Codex sin sesión y
// el camino hasta el diálogo, que corre el `codex login` real en su contenedor.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { expect, type Locator, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOD, PLATAFORMA } from './tessera'

export const PERFIL_LOGIN = 'login-e2e'

/**
 * ¿Puede Docker montar un proyecto de aquí? Bajo WSL, la Tessera de Linux habla con Docker Desktop, cuya máquina
 * virtual no ve las carpetas de la distro: ahí el contenedor no llega a tener el proyecto.
 */
export function dockerMontaProyectos(): boolean {
  const r = spawnSync('docker', ['info', '--format', '{{.OperatingSystem}}'], { encoding: 'utf8', timeout: 30_000 })
  return r.status === 0 && !(PLATAFORMA === 'linux' && r.stdout.includes('Docker Desktop'))
}

export function sembrarLogin(datos: string, proyecto: string): void {
  mkdirSync(proyecto, { recursive: true })
  writeFileSync(join(datos, 'profiles.json'), JSON.stringify([{ id: PERFIL_LOGIN, nombre: 'Acceso', color: '#9814c8', agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${PERFIL_LOGIN}/claude` }, { tipo: 'codex', configDir: `./.tessera/perfiles/${PERFIL_LOGIN}/codex` }], sandbox: { habilitado: false } }]))
  writeFileSync(join(datos, 'workspace-state.json'), JSON.stringify({ version: 1, activeProfileId: PERFIL_LOGIN, byProfile: { [PERFIL_LOGIN]: { openProjects: [{ projectHostPath: proyecto, name: 'proyecto', estado: 'active' }], activePath: proyecto } }, settings: { menuWindowsAvisado: true } }))
  writeFileSync(join(datos, 'agent-accounts.json'), JSON.stringify({ version: 1, accounts: [{ id: 'cuenta-login', nombre: 'Cuenta de prueba', agente: 'codex', profileId: PERFIL_LOGIN }] }))
}

/** Abre el diálogo desde Configuración › Agentes y lo devuelve ya esperando la autorización. */
export async function abrirLogin(win: Page): Promise<Locator> {
  await win.keyboard.press(`${MOD}+,`)
  await win.locator('.ajustes-riel-item[data-cat="agentes"]').click()
  const ajustes = win.locator('.ajustes-modal')
  await ajustes.locator('.cuentas-desplegar[aria-label*="Codex"]').click()
  await ajustes.locator('.cuentas-configuracion-fila').filter({ hasText: 'Cuenta de prueba' }).locator('button.btn').first().click()
  const modal = win.locator('.modal-card.cuentas-login')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.cuentas-login-reloj'), 'la autorización empieza a contar').toBeVisible({ timeout: 180_000 })
  return modal
}
