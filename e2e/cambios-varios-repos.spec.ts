// =============================================================================
// Git · Cambios con varios repos sobre la app empaquetada: una carpeta que no es repo agrupa
// tres (uno anidado a dos niveles). La lista solo trae los que tienen cambios, cada archivo con su
// carpeta contada desde su repo, «Cambios» sin su cabecera cuando es la única sección (sus botones
// de lote pasan a la del repo) y la casilla del repo marca todos sus archivos. Las reglas las fija
// `features/git/modelo/test-secciones-cambios.mts`. Agente falso (`agenteFalso.ts`); nada depende
// del sistema salvo el git del PATH. `TESSERA_E2E_CAPTURAS` guarda capturas.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

interface Montaje {
  raiz: string
  env: Record<string, string>
  carpeta: string
}

/** Un repo con un commit en `dir`, y los archivos de `sucios` modificados después. */
function repo(dir: string, archivos: string[], sucios: string[]): void {
  for (const a of archivos) {
    mkdirSync(join(dir, a, '..'), { recursive: true })
    writeFileSync(join(dir, a), 'v1\n')
  }
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', ...args], { cwd: dir, stdio: 'ignore' })
  }
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'inicial')
  for (const a of sucios) writeFileSync(join(dir, a), 'v2\n')
}

/** La carpeta `areas` (no es repo) con `ventas/api` y `ventas/web` sucios y `notas` limpio. */
function montar(): Montaje {
  const { raiz, env } = montarAgenteFalso()
  const carpeta = join(raiz, 'areas')
  repo(join(carpeta, 'ventas', 'api'), ['src/Servicio.java', 'README.md'], ['src/Servicio.java'])
  repo(join(carpeta, 'ventas', 'web'), ['src/App.tsx', 'package.json'], ['src/App.tsx', 'package.json'])
  repo(join(carpeta, 'notas'), ['hoy.md'], [])
  return { raiz, env, carpeta }
}

/** Un perfil sin sandbox con la carpeta abierta en modo nativo. */
function sembrar(datos: string, m: Montaje): void {
  writeFileSync(
    join(datos, 'profiles.json'),
    JSON.stringify([
      {
        id: 'personal',
        nombre: 'Personal',
        color: '#9814c8',
        agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/personal/claude' }],
        sandbox: { habilitado: false }
      }
    ])
  )
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: {
        personal: { openProjects: [{ projectHostPath: m.carpeta, name: 'areas', estado: 'active' }], activePath: m.carpeta }
      },
      settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${m.carpeta}`] }
    })
  )
}

/** Captura opcional: solo si quien corre la prueba pide dónde guardarla. */
async function capturar(win: Page, nombre: string): Promise<void> {
  const dir = process.env.TESSERA_E2E_CAPTURAS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await win.screenshot({ path: join(dir, `${nombre}.png`), animations: 'disabled' })
}

test.describe('Git · Cambios con varios repos', () => {
  let s: SesionTessera
  let m: Montaje

  test.beforeAll(async () => {
    m = montar()
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrar(datos, m) })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (m) await borrarTemporal(m.raiz)
  })

  test('solo los repos con cambios, rutas desde su repo, «Cambios» sin cabecera y la casilla del repo', async () => {
    const win = s.win
    await win.getByRole('button', { name: /^Git · Cambios/ }).click()
    const panel = win.locator('.git-panel')
    const cabeceras = panel.locator('.repo-header')
    await expect(cabeceras, 'los dos repos con cambios, no el limpio').toHaveCount(2, { timeout: 30_000 })
    await expect(panel.locator('.repo-name')).toHaveText(['api', 'web'])
    await expect(panel.getByText('notas'), 'el repo limpio no ocupa la lista').toHaveCount(0)

    const api = panel.locator('.repo-section', { has: win.locator('.repo-name', { hasText: /^api$/ }) })
    await expect(api.locator('.repo-branch-name')).toHaveText('main*')
    await expect(api.locator('.repo-count')).toHaveText('1')
    await expect(api.locator('.working-subsection-header'), 'solo «Cambios»: sin su cabecera').toHaveCount(0)
    const fila = api.locator('.git-arbol-fila', { hasText: 'Servicio.java' })
    await expect(fila.locator('.git-arbol-carpeta'), 'la carpeta se cuenta desde el repo').toHaveText('src')

    const web = panel.locator('.repo-section', { has: win.locator('.repo-name', { hasText: /^web$/ }) })
    const casillaWeb = web.locator('.repo-header .git-casilla')
    await casillaWeb.click()
    await expect(casillaWeb, 'la casilla del repo marca todos sus archivos').toHaveAttribute('aria-checked', 'true')
    await expect(web.locator('.git-arbol-fila .git-casilla.llena')).toHaveCount(2)
    await expect(web.locator('.repo-header').getByRole('button', { name: 'Preparar 2' }), 'el lote de «Cambios» va en la cabecera del repo').toBeVisible()
    // En la columna estrecha por defecto los botones quedan en su icono y caben en la cabecera.
    const cabeceraWeb = await web.locator('.repo-header').boundingBox()
    const descartar = await web.locator('.repo-header').getByRole('button', { name: 'Descartar 2' }).boundingBox()
    expect(cabeceraWeb && descartar && descartar.x + descartar.width <= cabeceraWeb.x + cabeceraWeb.width + 0.5, 'el último botón no se sale de la cabecera').toBe(true)
    await expect(cabeceras, 'marcar no abre ni cierra el repo').toHaveCount(2)
    await expect(web.locator('.git-arbol-fila')).toHaveCount(2)
    await capturar(win, 'cambios-varios-repos')

    await web.locator('.git-arbol-fila', { hasText: 'App.tsx' }).locator('.git-casilla').click()
    await expect(casillaWeb, 'con uno desmarcado, parcial').toHaveAttribute('aria-checked', 'mixed')
  })
})
