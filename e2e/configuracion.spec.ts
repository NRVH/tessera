// =============================================================================
// Configuración por plataforma sobre la app empaquetada: las capacidades llegan del main
// por el preload y el modal las usa de verdad (lo que `test-filtrar-ajustes.mts` no puede
// saber). La categoría «Integración con el sistema» se monta en las dos plataformas, pero
// el buscador solo cuenta las filas de ESTA (`EXCLUSIVAS`): así se distingue filtrar en el
// catálogo de filtrar en el panel. El interruptor del Finder se comprueba y no se pulsa:
// escribiría en `~/Library/Services` de quien corre la prueba. Cada mitad se salta en la
// plataforma ajena.
// =============================================================================

import { expect, test } from '@playwright/test'
import { abrirTessera, MOD, PLATAFORMA, type SesionTessera } from './tessera'

/**
 * Palabras del buscador EXCLUSIVAS de las filas de integración de cada plataforma, con
 * la fila que tienen que sacar. Exclusivas quiere decir que no son clave de nada más
 * del catálogo: en la plataforma ajena dan cero en TODO el riel, y eso se comprueba.
 */
const EXCLUSIVAS: Record<'mac' | 'windows', Array<{ q: string; fila: string }>> = {
  mac: [
    { q: 'acción rápida', fila: 'Acción rápida' },
    { q: 'servicios', fila: 'Acción rápida' },
    { q: 'finder', fila: 'Acción rápida' }
  ],
  windows: [
    { q: 'asociar', fila: 'Extensiones sugeridas' },
    { q: 'registro', fila: 'Carpetas y unidades' },
    { q: 'unidad', fila: 'Carpetas y unidades' },
    { q: 'predeterminada', fila: 'Extensiones sugeridas' }
  ]
}

let s: SesionTessera

test.beforeAll(async () => {
  s = await abrirTessera()
  // Se abre UNA vez y se deja abierto: todas las pruebas de este archivo miran el
  // mismo modal y ninguna lo cierra. Cada una limpia el buscador, que es el único
  // estado que comparten.
  await s.win.keyboard.press(`${MOD}+,`)
  await expect(s.win.locator('.ajustes-modal')).toHaveCount(1)
})
test.afterAll(async () => {
  await s?.cerrar()
})

/** Deja el buscador de ajustes en blanco (el modal vuelve a la vista por categoría). */
async function sinConsulta(): Promise<void> {
  await s.win.locator('.ajustes-buscador input').fill('')
  await expect(s.win.locator('.ajustes-riel-conteo')).toHaveCount(0)
}

/** Los ids de categoría del riel, en orden. */
function categoriasDelRiel(): Promise<string[]> {
  return s.win.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.ajustes-riel-item')).map(
      (b) => b.dataset.cat ?? ''
    )
  )
}

test('la categoría «Integración con el sistema» SÍ aparece en el riel, en las dos plataformas', async () => {
  await sinConsulta()
  const cats = await categoriasDelRiel()
  // Lo que ESTÁ, y que antes no: en macOS el menú contextual del Finder sí se enciende
  // desde la app (un `.workflow` en `~/Library/Services`).
  expect(cats).toContain('integracion')
  // La categoría vieja no puede sobrevivir con su id antiguo: renombrarla en el
  // catálogo y no en el riel dejaría una entrada que no monta ningún panel.
  expect(cats).not.toContain('windows')
  // Y el riel COMPLETO en su orden: sin esto, un riel roto pasaría lo de arriba con
  // matrícula, y no se vería si la categoría entró en el sitio equivocado.
  expect(cats).toEqual([
    'apariencia',
    'terminales',
    'proyectos',
    'bases-de-datos',
    'integracion',
    'actualizaciones',
    'acerca'
  ])
  // El título del riel es el que ve el usuario, y es la mitad del encargo: un Mac no
  // puede tener una categoría de ajustes llamada «Windows».
  const titulo = await s.win
    .locator('.ajustes-riel-item[data-cat="integracion"]')
    .innerText()
  expect(titulo).toContain('Integración con el sistema')
  expect(titulo).not.toContain('Windows')
})

test('en Mac, la categoría de integración enseña el interruptor del Finder y NO el del registro', async () => {
  test.skip(PLATAFORMA !== 'mac', 'la mitad de Mac; la de Windows es la prueba siguiente')
  await sinConsulta()
  await s.win.locator('.ajustes-riel-item[data-cat="integracion"]').click()
  const panel = s.win.locator('.ajustes-modal-panel')

  // El grupo de Mac, con su único interruptor.
  await expect(panel.locator('.ajustes-grupo-titulo', { hasText: 'Menú contextual del Finder' })).toHaveCount(1)
  await expect(panel.locator('.ajustes-fila-etiqueta', { hasText: 'Acción rápida' })).toHaveCount(1)

  // Y NADA del registro de Windows: ni el grupo del Explorador, ni las casillas de
  // extensiones, ni el botón que abre el panel de aplicaciones predeterminadas. Un
  // panel que pintara esto en Mac sería la casilla inerte con otra cara.
  await expect(panel.locator('.ajustes-grupo-titulo', { hasText: 'Explorador' })).toHaveCount(0)
  await expect(panel.locator('.ajustes-fila-etiqueta', { hasText: 'Extensiones' })).toHaveCount(0)
  await expect(panel.locator('button', { hasText: 'Abrir ajustes de Windows' })).toHaveCount(0)

  // UN interruptor, y HABILITADO. Deshabilitado significaría que el main contestó una
  // `disponibilidad` distinta de 'ok', o sea que el interruptor está ahí para no hacer
  // nada — exactamente lo que este repo prohíbe.
  const interruptor = panel.locator('.ajustes-switch')
  await expect(interruptor).toHaveCount(1)
  await expect(interruptor).toBeEnabled()

  // NO SE PULSA: escribiría en `~/Library/Services` del usuario (ver la cabecera). Lo
  // que sí se comprueba es que el canal existe y contesta, y que lo que dice concuerda
  // con lo que el interruptor pinta — que es lo que descarta un componente
  // desconectado sin tocar el sistema.
  const estado = await s.win.evaluate(() => window.tessera.servicioFinder.estado())
  expect(estado.disponibilidad).toBe('ok')
  expect(typeof estado.instalado).toBe('boolean')
  await expect(interruptor).toHaveAttribute('aria-checked', String(estado.instalado))
})

test('en Windows, la categoría de integración enseña el registro y NO el Finder', async () => {
  test.skip(PLATAFORMA !== 'windows', 'la mitad de Windows; la de Mac es la prueba anterior')
  await sinConsulta()
  await s.win.locator('.ajustes-riel-item[data-cat="integracion"]').click()
  const panel = s.win.locator('.ajustes-modal-panel')

  // Los grupos de Windows, con sus filas: el menú contextual del Explorador y el
  // «Abrir con» de las extensiones.
  await expect(panel.locator('.ajustes-grupo-titulo', { hasText: 'Menú contextual del Explorador' })).toHaveCount(1)
  await expect(panel.locator('.ajustes-fila-etiqueta', { hasText: 'Carpetas y unidades' })).toHaveCount(1)
  await expect(panel.locator('.ajustes-fila-etiqueta', { hasText: 'Cualquier archivo' })).toHaveCount(1)
  await expect(panel.locator('button', { hasText: 'Abrir ajustes de Windows' })).toHaveCount(1)

  // Y NADA del Finder: pintarlo aquí sería la casilla inerte vista desde el otro lado.
  await expect(panel.locator('.ajustes-grupo-titulo', { hasText: 'Finder' })).toHaveCount(0)
  await expect(panel.locator('.ajustes-fila-etiqueta', { hasText: 'Acción rápida' })).toHaveCount(0)

  // DOS interruptores (carpetas y archivos), y HABILITADOS: `win-unpacked` es lo mismo que
  // instala NSIS, no el portable, así que el main tiene que contestar 'ok'.
  const estado = await s.win.evaluate(() => window.tessera.shellWindows.integracionEstado())
  expect(estado.disponibilidad).toBe('ok')
  const interruptores = panel.locator('.ajustes-switch')
  await expect(interruptores).toHaveCount(2)
  for (const i of [0, 1]) await expect(interruptores.nth(i)).toBeEnabled()

  // NO SE PULSAN: escribirían en `HKCU\Software\Classes` del usuario que corre la
  // prueba. Lo que sí se comprueba es que pintan lo que dicen los ajustes, que es lo que
  // descarta un componente desconectado sin tocar el sistema.
  const ajustes = await s.win.evaluate(() => window.tessera.workspace.loadSettings())
  await expect(interruptores.nth(0)).toHaveAttribute('aria-checked', String(ajustes.menuWindowsCarpetas))
  await expect(interruptores.nth(1)).toHaveAttribute('aria-checked', String(ajustes.menuWindowsArchivos))
})

test('la fila «Aplicar al cerrar Tessera» SÍ está en Actualizaciones, y su interruptor hace algo', async () => {
  await sinConsulta()
  await s.win.locator('.ajustes-riel-item[data-cat="actualizaciones"]').click()
  const panel = s.win.locator('.ajustes-modal-panel')

  // La categoría se monta con sus DOS bloques de update, seguidos: el de Tessera (la
  // mitad de comprobar y avisar nunca se fue de Mac) y el de los agentes nativos. La
  // fila de «Aplicar al cerrar» va después, en su propio grupo.
  await expect(panel.locator('.settings-update')).toHaveCount(2)

  // Y la fila que estuvo oculta mientras el ciclo no podía cerrar el círculo.
  await expect(panel.locator('.ajustes-fila-etiqueta', { hasText: 'Aplicar al cerrar' })).toHaveCount(1)
  const interruptor = panel.locator('.ajustes-switch')
  await expect(interruptor).toHaveCount(1)

  // QUE ESTÉ NO BASTA: lo que esta prueba existe para descartar es la casilla inerte,
  // que es el peor síntoma del repo. Se conmuta y se comprueba que el estado LLEGA AL
  // MAIN y vuelve — no que el botón cambie de color, que eso lo haría igual un
  // componente desconectado.
  const preferencia = async (): Promise<boolean> =>
    s.win.evaluate(async () => (await window.tessera.workspace.loadSettings()).aplicarUpdateAlCerrar)

  const antes = await preferencia()
  await expect(interruptor).toHaveAttribute('aria-checked', String(antes))
  await interruptor.click()
  await expect(interruptor).toHaveAttribute('aria-checked', String(!antes))
  await expect.poll(preferencia).toBe(!antes)
  // Se deja como estaba: las pruebas de este archivo comparten el mismo modal.
  await interruptor.click()
  await expect.poll(preferencia).toBe(antes)
})

test('el buscador cuenta sobre el catálogo FILTRADO, no sobre el completo', async () => {
  const consulta = s.win.locator('.ajustes-buscador input')
  const conteo = s.win.locator('.ajustes-riel-item[data-cat="actualizaciones"] .ajustes-riel-conteo')

  // CONTROL POSITIVO PRIMERO: el buscador funciona y sabe contar. Sin esto, un
  // buscador roto daría cero a todo y las comprobaciones de abajo pasarían.
  await consulta.fill('zoom')
  await expect(s.win.locator('.ajustes-riel-item[data-cat="apariencia"] .ajustes-riel-conteo')).toHaveText('1')

  // «instalar» es clave de las DOS filas del grupo Tessera: «Versión» y «Aplicar al
  // cerrar». Tiene que valer 2. Un 1 significaría que la fila recuperada no está en
  // el catálogo, sólo pintada en el panel — y entonces el buscador mentiría.
  await consulta.fill('instalar')
  await expect(conteo).toHaveText('2')

  // «cerrar» y «sola» son SÓLO de esa fila: uno cada una, y la fila aparece.
  for (const q of ['cerrar', 'sola']) {
    await consulta.fill(q)
    await expect(conteo).toHaveText('1')
    await expect(s.win.locator('.ajustes-fila-etiqueta', { hasText: 'Aplicar al cerrar' })).toHaveCount(1)
  }

  // LA CATEGORÍA DE INTEGRACIÓN, CON LAS DOS CARAS DENTRO. Las palabras exclusivas de
  // las filas de ESTA plataforma tienen que contar UNA, y ahí: es lo que descarta que la
  // fila esté pintada a mano en el panel sin pasar por el catálogo (el buscador sólo ve
  // el catálogo).
  const conteoIntegracion = s.win.locator(
    '.ajustes-riel-item[data-cat="integracion"] .ajustes-riel-conteo'
  )
  const propias = PLATAFORMA === 'mac' ? EXCLUSIVAS.mac : EXCLUSIVAS.windows
  const ajenas = PLATAFORMA === 'mac' ? EXCLUSIVAS.windows : EXCLUSIVAS.mac
  for (const { q, fila } of propias) {
    await consulta.fill(q)
    await expect(conteoIntegracion).toHaveText('1')
    await expect(s.win.locator('.ajustes-fila-etiqueta', { hasText: fila })).toHaveCount(1)
  }

  // Y LA PARTE NEGATIVA, DENTRO DE LA MISMA CATEGORÍA: las claves exclusivas de las
  // filas de la OTRA plataforma no existen en ésta, aunque la categoría que las
  // contiene sí se monte. Éste es el par que de verdad distingue "filtrar en el
  // catálogo" de "filtrar en el panel": la categoría está montada, así que un panel que
  // filtrara por su cuenta dejaría estos conteos por encima de cero y la prueba lo
  // cazaría.
  // NO valen «contextual» ni «botón derecho» (las comparten las dos plataformas a
  // propósito: describen la misma idea), ni «explorador» o «abrir con» (la primera es
  // la etiqueta de una fila de Apariencia y la segunda una clave de Proyectos, así que
  // casarían por subcadena y la prueba pasaría por el motivo equivocado).
  for (const { q } of ajenas) {
    await consulta.fill(q)
    await expect(s.win.locator('.ajustes-sin-resultados')).toHaveCount(1)
    const conteos = await s.win.evaluate(() =>
      Array.from(document.querySelectorAll('.ajustes-riel-conteo')).map((e) => e.textContent ?? '')
    )
    expect(conteos.every((c) => c === '0')).toBe(true)
  }

  await sinConsulta()
})

test('Actualizaciones sí está, y la versión que pinta es la del proceso principal', async () => {
  await sinConsulta()
  await s.win.locator('.ajustes-riel-item[data-cat="actualizaciones"]').click()
  // `app.getVersion()` del MAIN contra lo que se ve: en el paquete sale del
  // `package.json` incrustado, así que una versión pintada a mano (o un estado del
  // updater sin `currentVersion`, que dejaría un «—») se caza aquí.
  const version = await s.app.evaluate(({ app }) => app.getVersion())
  expect(version).toMatch(/^\d+\.\d+\.\d+/)
  // Filtrado por su texto: el bloque de los agentes usa la misma clase para sus filas.
  await expect(
    s.win.locator('.settings-update-version', { hasText: 'Versión actual' })
  ).toHaveText(`Versión actual: ${version}`)
})
