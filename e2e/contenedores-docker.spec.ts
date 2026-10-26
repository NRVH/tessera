// =============================================================================
// Configuración › Contenedores Docker: el deslizador del límite con su semáforo, «Sin límite» como
// último paso, el aviso por color y que el valor llega a `workspace-state.json`. Docker puede o no
// responder en quien corre la prueba: con memoria se comprueba el semáforo; sin ella, el aviso de
// «Docker no responde» y el deslizador deshabilitado. `TESSERA_E2E_CAPTURAS=<carpeta>` guarda una captura.
// =============================================================================

import { expect, test, type Locator } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cortesSemaforo, type CortesSemaforo } from '../src/shared/semaforoContenedores.ts'
import { abrirTessera, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

let s: SesionTessera
let memoria: number | null = null
let cortes: CortesSemaforo

/** `settings.limiteContenedores` de `workspace-state.json`; undefined si no está (o el archivo no existe aún). */
function limiteGuardado(): number | undefined {
  const ruta = join(s.datos, 'workspace-state.json')
  if (!existsSync(ruta)) return undefined
  try {
    const doc = JSON.parse(readFileSync(ruta, 'utf8')) as { settings?: { limiteContenedores?: number } }
    return doc.settings?.limiteContenedores
  } catch {
    return undefined
  }
}

test.beforeAll(async () => {
  s = await abrirTessera({}, { sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX) })
  memoria = await s.win.evaluate(async () => (await window.tessera.estadoDocker.recursos()).memoriaBytes)
  cortes = cortesSemaforo(memoria ?? 0)
  await s.win.keyboard.press(`${MOD}+,`)
  await expect(s.win.locator('.ajustes-modal')).toHaveCount(1)
  await s.win.locator('.ajustes-riel-item[data-cat="contenedores"]').click()
})
test.afterAll(async () => {
  await s?.cerrar()
})

function barra(): Locator {
  return s.win.locator('input.limite-barra')
}

test('la sección enseña el deslizador, el valor y las explicaciones', async () => {
  await expect(barra()).toHaveCount(1)
  await expect(s.win.locator('.limite-valor')).toHaveCount(1)
  await expect(s.win.locator('.ajustes-grupo-ayuda').first()).toContainText('entre 0,3 y 1,5 GB')
  await expect(s.win.locator('.ajustes-radios .ajustes-radio')).toHaveCount(3)
  await expect(s.win.locator('.ajustes-switch')).toHaveCount(2)
  await expect(s.win.locator('.ajustes-grupo-ayuda').nth(1)).toContainText('Si todos están protegidos')
  const dir = process.env.TESSERA_E2E_CAPTURAS
  if (dir) {
    mkdirSync(dir, { recursive: true })
    await s.win.locator('.ajustes-modal').screenshot({ path: join(dir, 'contenedores-docker.png'), animations: 'disabled' })
  }
})

test('sin respuesta de Docker: aviso y deslizador deshabilitado', async () => {
  test.skip(memoria !== null, 'Docker responde en este equipo')
  await expect(s.win.locator('.limite-bloque .limite-maquina')).toContainText('Docker no responde')
  await expect(barra()).toBeDisabled()
  await expect(s.win.locator('.limite-valor')).toHaveAttribute('data-color', 'ninguno')
})

test('el semáforo cambia de color y «Sin límite» es el último paso', async () => {
  test.skip(memoria === null, 'Docker no responde: no hay cortes que calcular')
  const ultimo = cortes.maximo + 1
  await expect(barra()).toBeEnabled()
  await expect(barra()).toHaveAttribute('min', '1')
  await expect(barra()).toHaveAttribute('max', String(ultimo))

  // Por defecto, el recomendado: el último verde.
  await expect(s.win.locator('.limite-valor')).toHaveAttribute('data-color', 'verde')
  await expect(s.win.locator('.limite-valor-texto')).toContainText(String(cortes.verdeHasta))
  await expect(s.win.locator('.limite-aviso.verde')).toContainText('con holgura')
  await expect(s.win.locator('.limite-bloque .limite-maquina')).toContainText('se recomiendan hasta')

  await barra().fill(String(cortes.verdeHasta + 1))
  await expect(s.win.locator('.limite-valor')).toHaveAttribute('data-color', 'amarillo')
  await expect(s.win.locator('.limite-aviso.amarillo')).toContainText('Muy justo')

  await barra().fill(String(cortes.maximo))
  await expect(s.win.locator('.limite-valor')).toHaveAttribute('data-color', 'rojo')
  await expect(s.win.locator('.limite-aviso.rojo')).toContainText('Excesivo')

  await barra().fill(String(ultimo))
  await expect(s.win.locator('.limite-valor-texto')).toHaveText('Sin límite')
  await expect(s.win.locator('.limite-valor')).toHaveAttribute('data-color', 'rojo')
  await expect(s.win.locator('.limite-aviso.rojo')).toContainText('Sin límite no hay red')
})

test('el valor llega a workspace-state.json y «Usar el recomendado» lo quita', async () => {
  test.skip(memoria === null, 'Docker no responde: el deslizador está deshabilitado')
  await barra().fill(String(cortes.maximo + 1))
  // «Sin límite» se guarda como 0.
  await expect.poll(limiteGuardado, { timeout: 10_000 }).toBe(0)

  await barra().fill('2')
  await expect.poll(limiteGuardado, { timeout: 10_000 }).toBe(2)
  await expect(s.win.locator('.limite-valor-texto')).toContainText('2')

  await s.win.locator('.limite-cabecera .limite-enlace').click()
  await expect.poll(limiteGuardado, { timeout: 10_000 }).toBeUndefined()
  await expect(s.win.locator('.limite-cabecera .limite-enlace')).toHaveCount(0)
  await expect(s.win.locator('.limite-valor-texto')).toContainText(String(cortes.verdeHasta))
})

test('la política para hacer sitio se guarda', async () => {
  await s.win.locator('.ajustes-radio', { hasText: 'Los primeros que abriste' }).click()
  await s.win.locator('.ajustes-switch').first().click()
  await expect
    .poll(
      () => {
        const ruta = join(s.datos, 'workspace-state.json')
        if (!existsSync(ruta)) return null
        try {
          const st = (JSON.parse(readFileSync(ruta, 'utf8')) as { settings?: { primeroEnPararse?: string; protegerTrabajando?: boolean } }).settings
          return `${st?.primeroEnPararse}|${st?.protegerTrabajando}`
        } catch {
          return null
        }
      },
      { timeout: 10_000 }
    )
    .toBe('primeros|false')
})

/** `settings` de `workspace-state.json` (vacío si el archivo no existe aún o no se lee). */
function ajustesGuardados(): Record<string, unknown> {
  const ruta = join(s.datos, 'workspace-state.json')
  if (!existsSync(ruta)) return {}
  try {
    return (JSON.parse(readFileSync(ruta, 'utf8')) as { settings?: Record<string, unknown> }).settings ?? {}
  } catch {
    return {}
  }
}

test('«Si Docker se satura» enseña sus tres controles con los valores de serie', async () => {
  const selects = s.win.locator('select.ajustes-select')
  await expect(selects).toHaveCount(2)
  await expect(selects.nth(0)).toHaveValue('90')
  await expect(selects.nth(1)).toHaveValue('30')
  const aviso = s.win.locator('.ajustes-switch').nth(1)
  await expect(aviso).toHaveAttribute('aria-checked', 'true')
  await expect(s.win.locator('.ajustes-grupo-ayuda').nth(2)).toContainText('Si todos los que quedan están trabajando')
})

test('cambiar umbral, tiempo y aviso llega a workspace-state.json', async () => {
  const selects = s.win.locator('select.ajustes-select')
  await selects.nth(0).selectOption('95')
  await selects.nth(1).selectOption('120')
  await s.win.locator('.ajustes-switch').nth(1).click()
  await expect
    .poll(() => {
      const a = ajustesGuardados()
      return `${a.saturacionUmbral}|${a.saturacionSegundos}|${a.avisarAntesDeParar}`
    }, { timeout: 10_000 })
    .toBe('95|120|false')
})

test('«Últimas paradas» enseña el texto vacío y «Actualizar» lo mantiene', async () => {
  await expect(s.win.locator('.paradas-vacio')).toHaveText('Tessera no ha parado ningún contenedor.')
  await expect(s.win.locator('.parada-fila')).toHaveCount(0)
  await s.win.locator('.paradas-actualizar').click()
  await expect(s.win.locator('.paradas-vacio')).toHaveCount(1)
})
