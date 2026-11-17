// =============================================================================
// En un Mac, Tessera no habla de Windows. `test-nombres-sistema.mts` fija la tabla para las
// tres plataformas y barre el fuente; lo que no puede saber es si la interfaz de VERDAD la
// llama con la plataforma correcta, que llega por `window.tessera.plataforma` y no por
// `plataformaActual()` (en el renderer no hay `process`: revienta solo empaquetado). La
// comprobación fuerte es el BARRIDO del modal de Configuración buscando «Windows»; las
// etiquetas concretas son el control positivo de que el panel llegó a pintarse.
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, MOD, PERFILES_SIN_SANDBOX, PLATAFORMA, type SesionTessera } from './tessera'

// SÓLO macOS. El barrido busca «Windows» COLADO en la interfaz de un Mac; en Windows ese
// nombre es el correcto (sale de `nombresSistema`), así que la gemela sería otra prueba
// —que allí la interfaz diga «Windows» y no «macOS»— y hoy la cubre la tabla de las tres
// plataformas de `test:nombres-sistema`.
test.skip(PLATAFORMA !== 'mac', 'el vocabulario que se barre aquí es el de macOS')

let s: SesionTessera

test.beforeAll(async () => {
  s = await abrirTessera({}, {
    sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
  })
})
test.afterAll(async () => {
  await s?.cerrar()
})

test('el renderer SABE que está en un Mac (y lo sabe por el preload, no por `process`)', async () => {
  // Es la premisa de todo lo demás: si esto dijera 'otra', el barrido de abajo pasaría
  // por el motivo equivocado —los nombres genéricos tampoco dicen «Windows»— y la
  // prueba sería un verde vacío.
  expect(await s.ventana.evaluate(() => window.tessera.plataforma)).toBe('mac')

  // Y que la plataforma llega SIN tocar `process`: en el renderer no existe, y el día
  // que alguien meta un `plataformaActual()` en la cadena del vocabulario, esto es lo
  // que lo distingue de un fallo cualquiera.
  expect(await s.ventana.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe(
    'undefined'
  )
})

test('Configuración › Acerca de habla de «su Mac»', async () => {
  await s.ventana.keyboard.press(`${MOD}+,`)
  await expect(s.ventana.locator('.ajustes-modal')).toHaveCount(1)
  await s.ventana.locator('.ajustes-riel-item[data-cat="acerca"]').click()
  const puntos = s.ventana.locator('.ajustes-acerca-puntos li')
  // La frase de las cuentas nombra el equipo por el vocabulario compartido.
  await expect(puntos.nth(0)).toContainText('la cuenta de su Mac')
})

test('BARRIDO: ninguna categoría del modal nombra Windows', async () => {
  // Se recorre el riel entero, no sólo las dos categorías de arriba: el rótulo que se
  // cuele mañana no tiene por qué caer donde cayó el de ayer. Abre el modal si no lo dejó
  // abierto el caso anterior: tras un rojo, Playwright rehace la sesión.
  if ((await s.ventana.locator('.ajustes-modal').count()) === 0) await s.ventana.keyboard.press(`${MOD}+,`)
  await expect(s.ventana.locator('.ajustes-riel-item').first()).toBeVisible()
  const categorias = await s.ventana.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.ajustes-riel-item')).map(
      (b) => b.dataset.cat ?? ''
    )
  )
  expect(categorias.length).toBeGreaterThan(0)

  const sucias: string[] = []
  const vistos: string[] = []
  for (const cat of categorias) {
    await s.ventana.locator(`.ajustes-riel-item[data-cat="${cat}"]`).click()
    const texto = await s.ventana.locator('.ajustes-modal-panel').innerText()
    vistos.push(texto)
    // «Windows» sólo puede aparecer en esta plataforma dentro de un bloque que aquí no
    // se monta (el del registro), así que cualquier aparición es un fallo. `PowerShell`
    // va también: es la shell de la otra plataforma, y nombrarla aquí es el mismo error
    // con otra palabra.
    for (const palabra of ['Windows', 'PowerShell']) {
      if (texto.includes(palabra)) {
        const linea = texto.split('\n').find((l) => l.includes(palabra)) ?? ''
        sucias.push(`${cat}: [${palabra}] ${linea.trim()}`)
      }
    }
  }
  expect(sucias, 'categorías que le hablan de Windows a un usuario de Mac').toEqual([])

  // DOS CONTROLES POSITIVOS, porque el barrido tiene dos formas de estar vacío y las
  // dos dan verde:
  //   · que el panel no pinte nada (selector cambiado, modal no montado) — se exige
  //     texto de verdad;
  //   · que el clic en el riel NO cambie de categoría, con lo que las seis vueltas
  //     habrían leído el mismo panel seis veces. Se exige que haya tantos textos
  //     distintos como categorías.
  expect(vistos.every((t) => t.length > 50), 'algún panel salió vacío').toBe(true)
  expect(new Set(vistos).size, 'el riel no está cambiando de panel al hacer clic').toBe(categorias.length)

  await s.ventana.keyboard.press('Escape')
  await expect(s.ventana.locator('.ajustes-modal')).toHaveCount(0)
})

test('el menú del perfil nombra el ESTADO de la red, no un sistema ni una promesa', async () => {
  // Otro archivo (`PestanasPerfil.tsx`) y otro camino: los menús contextuales no pasan por
  // el modal de ajustes, así que un barrido del modal no los cubre. El rótulo dice en qué
  // red ESTÁ este perfil («Red del contenedor: aislada…»), cierto en las dos plataformas, y
  // los puntos suspensivos anuncian el diálogo, que es quien explica dónde acaban los
  // puertos (con `nombresSistema` y el diagnóstico). Se fijan las tres mitades negativas:
  // ni «Windows» a pelo, ni una promesa sobre macOS, ni un rótulo-acción con palomita que
  // no hace nada visible y sin diálogo detrás.
  await s.ventana.locator('.profile-tab-name', { hasText: 'Personal' }).click({ button: 'right' })
  await expect(s.ventana.locator('.ctx-menu')).toHaveCount(1)
  const fila = s.ventana.getByRole('menuitem', { name: 'Agentes en Docker' })
  await fila.hover()
  const menu = s.ventana.getByRole('menu', { name: 'Agentes en Docker' })
  await expect(menu).toBeVisible()
  const texto = await menu.innerText()
  expect(texto).toContain('Red del contenedor:')
  expect(texto, 'los puntos suspensivos son la convención de "abre un diálogo"').toMatch(
    /Red del contenedor: (aislada|la de su equipo)…/
  )
  expect(texto).not.toContain('Windows')
  expect(texto, 'el rótulo no puede prometer que los puertos acaban en el Mac').not.toContain(
    'puertos a macOS'
  )

  // Y la columna de la palomita se va con el toggle: era el único ítem marcable del menú,
  // así que MenuContextual ya no reserva esa casilla y los iconos dejan de flotar lejos del
  // borde izquierdo. Se comprueba por el DOM, que es lo único que no se puede "arreglar"
  // sin querer desde el CSS.
  await expect(
    s.ventana.locator('.ctx-menu-check'),
    'ningún ítem del menú de perfil es ya un toggle'
  ).toHaveCount(0)

  await s.ventana.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})
