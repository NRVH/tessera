// =============================================================================
// La edición de la rejilla («escribir con seguridad») sobre la app empaquetada y contra un
// PostgreSQL efímero con tres conexiones (`edicionAyudas.ts`): el editor sobre la celda
// con el foco de verdad, «Enviar» todo o nada comprobado desde psql y desde una consola, un
// envío que falla a mitad, Supr sobre filas nuevas y del servidor, la sesión cortada con el
// COMMIT en camino («No se sabe si se aplicó», foco en Cancelar), solo lectura para los
// agentes, «Descartar N cambios», Stop, producción y cerrar la app con cambios sin enviar
// (va el último: termina cerrando la app). Ninguna prueba deja una transacción abierta.
// En serie y compartiendo app; acordes por `MOD`, Supr es `Delete` en las dos.
// =============================================================================

import { expect, test } from '@playwright/test'
import {
  ejecutarTodoSeleccionado,
  esperarFinEjecucion,
  celdaResultado,
  CONSOLA
} from './consolaAyudas'
import { esperarConsolaLista } from './monaco'
import { asentar, celda, entradasMenu, PANE, textoPildora } from './rejillaAyudas'
import {
  ALIAS_ESCRITURA,
  ALIAS_LECTURA,
  ALIAS_PRODUCCION,
  EN_COMMIT,
  abrirTabla,
  arrancarEdicion,
  botonBarra,
  confirmacion,
  dialogoEnvio,
  editorCelda,
  esperarEditable,
  filaRejilla,
  filasPsql,
  lineasEnvio,
  pestanaDe,
  type EntornoEdicion
} from './edicionAyudas'
import { MOD, PLATAFORMA } from './tessera'

test.describe.configure({ mode: 'serial' })

const REJILLA = `${PANE} .db-rejilla`

test.describe('explorador de BD: edición en la rejilla', () => {
  let e: EntornoEdicion | null = null
  let motivoSalto: string | null = null

  test.beforeAll(async () => {
    const r = await arrancarEdicion()
    if ('motivo' in r) {
      motivoSalto = r.motivo
      return
    }
    e = r
  })

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    // El cierre elige SALIR si queda un diálogo de salida (cambios sin enviar de una
    // prueba que falló a medias): esa red vive en `cerrar()` del arnés (e2e/tessera.ts),
    // para toda la suite.
    await e?.cerrar()
  })

  // (1) EDITAR, AÑADIR Y BORRAR, Y ENVIAR con su vista previa. Luego lo comprueban psql
  // (otra sesión) y una consola de Tessera.
  test('(1) editar una celda, añadir una fila y borrar otra, y Enviar con vista previa', async () => {
    const win = e!.s.win
    await abrirTabla(win, ALIAS_ESCRITURA, 'personas')
    await expect(celda(win, 0, 1)).toHaveText('Ana')
    await expect(botonBarra(win, 'Añadir fila'), 'la tabla tiene PK: hay edición').toBeVisible()
    await expect(botonBarra(win, 'Enviar cambios'), 'sin cambios, Enviar apagado').toBeDisabled()

    // Doble clic: el editor sobre la celda, con el valor seleccionado.
    await celda(win, 0, 1).dblclick()
    const editor = editorCelda(win)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('Ana')
    await editor.fill('Ana María')
    await editor.press('Enter')
    await expect(editor, 'Intro confirma y cierra').toHaveCount(0)
    await expect(celda(win, 0, 1)).toHaveText('Ana María')
    await expect(celda(win, 0, 1)).toHaveClass(/\bcambiada\b/)
    await expect(celda(win, 1, 1), 'Intro baja a la fila siguiente').toHaveClass(/\bfoco\b/)
    await expect(win.locator(REJILLA), 'el foco vuelve a la rejilla').toBeFocused()

    // Añadir fila: va ARRIBA, con «+» y sus celdas en <default>; escribir empieza a editar.
    await botonBarra(win, 'Añadir fila').click()
    const nueva = win.locator(`${PANE} .db-rejilla-fila.nueva`)
    await expect(nueva).toHaveCount(1)
    await expect(filaRejilla(win, 0)).toHaveClass(/\bnueva\b/)
    await expect(filaRejilla(win, 0).locator('.db-rejilla-num')).toHaveText('+')
    await expect(celda(win, 0, 2)).toHaveText('<default>')
    await expect(celda(win, 0, 0)).toHaveClass(/\bfoco\b/)
    await expect(win.locator(REJILLA)).toBeFocused()
    await win.keyboard.type('10')
    await expect(editorCelda(win), 'la primera tecla abre el editor con ella').toHaveValue('10')
    await win.keyboard.press('Tab')
    await win.keyboard.type('Nuevo')
    await win.keyboard.press('Enter')
    await expect(celda(win, 0, 0)).toHaveText('10')
    await expect(celda(win, 0, 1)).toHaveText('Nuevo')
    await expect(celda(win, 0, 2), 'lo no escrito sigue con su DEFAULT').toHaveText('<default>')
    // La fila del servidor que se editó sigue siendo la 1 aunque ahora se pinte en la 2.
    await expect(celda(win, 1, 1)).toHaveText('Ana María')
    await expect(filaRejilla(win, 1).locator('.db-rejilla-num')).toHaveText('1')

    // Borrar Carla: su número selecciona la fila entera y Supr la TACHA (hasta Enviar).
    await filaRejilla(win, 3).locator('.db-rejilla-num').click()
    await win.keyboard.press('Delete')
    await expect(filaRejilla(win, 3)).toHaveClass(/\bborrada\b/)
    await expect(celda(win, 3, 1)).toHaveText('Carla')
    await expect(win.locator(`${PANE} .db-barra-pendientes`)).toHaveText(/3 cambios sin enviar/)

    // Enviar: la vista previa en el ORDEN de envío, sin franja de producción.
    await expect(botonBarra(win, 'Enviar cambios')).toBeEnabled()
    await botonBarra(win, 'Enviar cambios').click()
    const dialogo = dialogoEnvio(win)
    await expect(dialogo).toBeVisible()
    await expect(dialogo.locator('.modal-title')).toContainText('Enviar 3 cambios')
    await expect(dialogo.locator('.db-envio-franja'), 'no es producción').toHaveCount(0)
    expect(await lineasEnvio(win)).toEqual([
      'DELETE FROM "public"."personas" WHERE "id" = 3;',
      `UPDATE "public"."personas" SET "nombre" = 'Ana María' WHERE "id" = 1;`,
      `INSERT INTO "public"."personas" ("id", "nombre") VALUES (10, 'Nuevo');`
    ])
    const enviar = dialogo.getByRole('button', { name: 'Enviar', exact: true })
    await expect(enviar, 'fuera de producción el foco va a Enviar').toBeFocused()
    await enviar.click()

    await expect(win.locator('.toast .toast-title', { hasText: '3 cambios aplicados' })).toBeVisible({ timeout: 30_000 })
    await expect(dialogo).toHaveCount(0)
    await expect(win.locator(`${PANE} .db-rejilla-fila.nueva, ${PANE} .db-rejilla-fila.borrada, ${PANE} .db-celda.cambiada`)).toHaveCount(0)
    await expect(textoPildora(win), 'relee la tabla').toHaveText('3 filas', { timeout: 30_000 })
    await expect(celda(win, 0, 1)).toHaveText('Ana María')
    await expect(celda(win, 2, 0)).toHaveText('10')

    // Otra sesión, ajena a Tessera: está aplicado y confirmado.
    expect(filasPsql(e!.pg, 'SELECT id, nombre FROM public.personas ORDER BY id')).toEqual([
      '1|Ana María',
      '2|Bea',
      '10|Nuevo'
    ])

    // Y una consola de Tessera, abierta desde la barra, lo lee igual.
    await botonBarra(win, 'Abrir consola').click()
    await expect(win.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(win)
    await ejecutarTodoSeleccionado(win, 'SELECT id, nombre FROM public.personas ORDER BY id')
    await esperarFinEjecucion(win)
    await expect(celdaResultado(win, 0, 1)).toHaveText('Ana María')
    await expect(celdaResultado(win, 2, 0)).toHaveText('10')
    await expect(celdaResultado(win, 2, 1)).toHaveText('Nuevo')
    // La rejilla de la CONSOLA no edita: su doble clic no abre ningún editor.
    await celdaResultado(win, 0, 1).dblclick()
    await asentar(win)
    await expect(win.locator(`${CONSOLA} .db-celda-editor`)).toHaveCount(0)

    await pestanaDe(win, ALIAS_ESCRITURA, 'personas').click()
    await expect(celda(win, 0, 1)).toHaveText('Ana María')
  })

  // (2) UN ENVÍO QUE FALLA: un UPDATE bueno y un INSERT con la PK repetida. No se aplica
  // NADA (ni el UPDATE: psql lo ve), los cambios se quedan y la fila nueva queda señalada.
  test('(2) un envío con una PK duplicada no aplica nada y señala la fila', async () => {
    const win = e!.s.win
    await botonBarra(win, 'Añadir fila').click()
    await win.keyboard.type('1')
    await win.keyboard.press('Tab')
    await win.keyboard.type('Duplicada')
    await win.keyboard.press('Enter')
    // Bea es la fila 2 (la nueva va arriba).
    await expect(celda(win, 2, 1)).toHaveText('Bea')
    await celda(win, 2, 1).dblclick()
    await editorCelda(win).fill('Beatriz')
    await editorCelda(win).press('Enter')

    // Mod+Intro en la rejilla es Enviar, como en los clientes de bases de datos.
    await celda(win, 2, 1).click()
    await win.keyboard.press(`${MOD}+Enter`)
    const dialogo = dialogoEnvio(win)
    await expect(dialogo).toBeVisible()
    expect(await lineasEnvio(win)).toEqual([
      `UPDATE "public"."personas" SET "nombre" = 'Beatriz' WHERE "id" = 2;`,
      `INSERT INTO "public"."personas" ("id", "nombre") VALUES (1, 'Duplicada');`
    ])
    await dialogo.getByRole('button', { name: 'Enviar', exact: true }).click()

    const errorEnvio = dialogo.locator('.db-envio-error')
    await expect(errorEnvio).toBeVisible({ timeout: 30_000 })
    await expect(errorEnvio.locator('.db-envio-error-titulo')).toHaveText('Falló el cambio 2 de 2: no se aplicó ninguno')
    await expect(errorEnvio).toContainText('23505')
    await expect(dialogo.locator('.db-envio-linea.con-error'), 'la sentencia que falló, marcada').toHaveText(/^INSERT INTO/)
    expect(
      filasPsql(e!.pg, 'SELECT id, nombre FROM public.personas ORDER BY id'),
      'TODO O NADA: el UPDATE bueno también se revirtió'
    ).toEqual(['1|Ana María', '2|Bea', '10|Nuevo'])

    await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(filaRejilla(win, 0), 'la fila que falló, señalada').toHaveClass(/\bcon-error\b/)
    await expect(filaRejilla(win, 0)).toHaveClass(/\bnueva\b/)
    await expect(celda(win, 2, 1), 'los cambios se quedan').toHaveClass(/\bcambiada\b/)
    await expect(win.locator(`${PANE} .db-barra-pendientes`)).toHaveText(/2 cambios sin enviar/)

    // Revertir cambios (barra) pregunta y lo deja todo como en el servidor.
    await botonBarra(win, 'Revertir cambios').click()
    const pregunta = confirmacion(win, 'Descartar 2 cambios')
    await expect(pregunta).toBeVisible()
    await pregunta.getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(win.locator(`${PANE} .db-rejilla-fila.nueva, ${PANE} .db-celda.cambiada, ${PANE} .db-rejilla-fila.con-error`)).toHaveCount(0)
    await expect(celda(win, 1, 1)).toHaveText('Bea')
  })

  // (2b) SUPR SOBRE NUEVAS Y DEL SERVIDOR A LA VEZ. Las nuevas se quitan (nunca
  // existieron) y las del servidor suben a su hueco; la selección era de POSICIONES y se
  // quedaba en ellas, así que pasaba a cubrir filas que nadie eligió y el siguiente Supr
  // las marcaba. Ahora se reubica por la identidad de las filas (`reubicarSeleccion`).
  test('(2b) Supr sobre filas nuevas y del servidor: la selección se queda en las elegidas', async () => {
    const win = e!.s.win
    await esperarEditable(win)
    await botonBarra(win, 'Añadir fila').click()
    await botonBarra(win, 'Añadir fila').click()
    await expect(win.locator(`${PANE} .db-rejilla-fila.nueva`)).toHaveCount(2)
    // Ana María, la primera del servidor, se pinta en la 2 (las nuevas van arriba).
    await expect(celda(win, 2, 1)).toHaveText('Ana María')

    // Las dos nuevas y Ana María: el número de la 0 y Mayús+clic en el de la 2.
    await filaRejilla(win, 0).locator('.db-rejilla-num').click()
    await filaRejilla(win, 2).locator('.db-rejilla-num').click({ modifiers: ['Shift'] })
    await expect(win.locator(`${PANE} .db-rejilla-num.sel`)).toHaveCount(3)
    await win.keyboard.press('Delete')
    await expect(win.locator(`${PANE} .db-rejilla-fila.nueva`), 'las nuevas se van').toHaveCount(0)
    await expect(filaRejilla(win, 0), 'Ana María, tachada, sube a la 0').toHaveClass(/\bborrada\b/)
    await expect(celda(win, 0, 1)).toHaveText('Ana María')
    await expect(
      win.locator(`${PANE} .db-rejilla-num.sel`),
      'la selección es la fila ELEGIDA que queda, no las posiciones 0-2 (Bea y Nuevo no se eligieron)'
    ).toHaveCount(1)
    await expect(filaRejilla(win, 0).locator('.db-rejilla-num')).toHaveClass(/\bsel\b/)

    // Otro Supr no marca nada más.
    await win.keyboard.press('Delete')
    await asentar(win)
    await expect(win.locator(`${PANE} .db-rejilla-fila.borrada`), 'solo la que se eligió').toHaveCount(1)
    await expect(win.locator(`${PANE} .db-barra-pendientes`)).toHaveText(/1 cambio sin enviar/)

    await botonBarra(win, 'Revertir cambios').click()
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(win.locator(`${PANE} .db-rejilla-fila.borrada`)).toHaveCount(0)
  })

  // (2c) EL COMMIT INCIERTO. La conexión se corta con el COMMIT en camino (psql mata la
  // sesión mientras duerme en el disparador DIFERIDO de `confirmar`, como la cortaría una
  // VPN): el servidor pudo confirmarlo, así que el diálogo dice que no se sabe. «Enviar»
  // sigue ahí y activo (Tessera informa, no prohíbe), pero el foco va a Cancelar: antes
  // volvía a Enviar y un Intro reflejo reenviaba el lote (con INSERTs, filas duplicadas).
  test('(2c) con el COMMIT incierto el foco va a Cancelar y un Intro no reenvía', async () => {
    const win = e!.s.win
    await abrirTabla(win, ALIAS_ESCRITURA, 'confirmar')
    await celda(win, 0, 1).dblclick()
    await editorCelda(win).fill('dos')
    await editorCelda(win).press('Enter')
    await botonBarra(win, 'Enviar cambios').click()
    const dialogo = dialogoEnvio(win)
    await dialogo.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(dialogo.locator('.db-envio-estado')).toHaveText('Enviando…')

    // El UPDATE ya pasó y el COMMIT duerme en el disparador: se corta ESA sesión.
    await expect
      .poll(() => filasPsql(e!.pg, `SELECT count(*) FROM pg_stat_activity WHERE ${EN_COMMIT}`)[0], { timeout: 15_000 })
      .toBe('1')
    expect(filasPsql(e!.pg, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ${EN_COMMIT}`)).toEqual(['t'])

    await expect(dialogo.locator('.db-envio-error-titulo')).toHaveText(
      'No se sabe si se aplicó: refresca la tabla antes de reenviar',
      { timeout: 30_000 }
    )
    const enviar = dialogo.getByRole('button', { name: 'Enviar', exact: true })
    const cancelar = dialogo.getByRole('button', { name: 'Cancelar', exact: true })
    await expect(cancelar, 'con el COMMIT incierto el foco va a Cancelar, también fuera de producción').toBeFocused()
    await expect(enviar, 'Enviar sigue activo: Tessera informa, no prohíbe').toBeEnabled()
    // El Intro reflejo cierra el diálogo; no reenvía.
    await win.keyboard.press('Enter')
    await expect(dialogo).toHaveCount(0)
    // Y el foco NO vuelve al botón «Enviar cambios» de la barra (quien abrió el diálogo, y
    // sigue activo): el siguiente Intro lo reabría con el foco en Enviar y el otro
    // reenviaba. Va a la rejilla, donde Intro edita la celda.
    await expect(win.locator(REJILLA), 'al cerrar con el COMMIT incierto, el foco va a la rejilla').toBeFocused()
    await expect(botonBarra(win, 'Enviar cambios'), 'y el botón sigue activo: informa, no prohíbe').toBeEnabled()
    await expect(celda(win, 0, 1), 'los cambios se quedan').toHaveClass(/\bcambiada\b/)
    expect(filasPsql(e!.pg, 'SELECT v FROM public.confirmar WHERE id = 1'), 'la sesión cortada no confirmó').toEqual(['uno'])

    // LA DUDA SOBREVIVE AL DIÁLOGO (la marca de la pestaña): reabrirlo con el botón de la
    // barra lo vuelve a decir y deja el foco en Cancelar; antes reabría LIMPIO, con el
    // foco en Enviar, y un Intro reenviaba el lote que quizá ya se aplicó.
    await botonBarra(win, 'Enviar cambios').click()
    await expect(dialogo.locator('.db-envio-error-titulo'), 'reabierto, sigue avisando').toHaveText(
      'El último envío quedó sin saber si se aplicó'
    )
    await expect(cancelar, 'reabierto, el foco sigue en Cancelar').toBeFocused()
    await expect(enviar, 'y Enviar sigue activo: informa, no prohíbe').toBeEnabled()
    await win.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(win.locator(REJILLA), 'al cerrarlo, otra vez a la rejilla').toBeFocused()

    // Descartar lo pendiente quita la marca: el siguiente cambio abre el diálogo de siempre.
    await botonBarra(win, 'Revertir cambios').click()
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(celda(win, 0, 1)).toHaveText('uno')
    await esperarEditable(win)
    await celda(win, 0, 1).dblclick()
    await editorCelda(win).fill('tres')
    await editorCelda(win).press('Enter')
    await botonBarra(win, 'Enviar cambios').click()
    await expect(dialogo.locator('.db-envio-error-titulo'), 'sin lo pendiente, la marca se fue').toHaveCount(0)
    await expect(enviar, 'y el foco vuelve a Enviar, como siempre fuera de producción').toBeFocused()
    await win.keyboard.press('Escape')
    await botonBarra(win, 'Revertir cambios').click()
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(celda(win, 0, 1)).toHaveText('uno')
  })

  // (3) «SOLO LECTURA PARA LOS AGENTES»: la casilla limita a `tdb`, NO al
  // usuario. Con ella marcada la tabla se edita como cualquier otra: la barra de edición,
  // el editor, el menú y «Enviar», y psql ve el cambio. Se deja el dato como estaba para
  // los casos siguientes (las tres conexiones apuntan a la MISMA base).
  test('(3) con «Solo lectura para los agentes» marcada, el usuario edita y envía', async () => {
    const win = e!.s.win
    await abrirTabla(win, ALIAS_LECTURA, 'personas')
    await expect(celda(win, 0, 1)).toHaveText('Ana María')
    await expect(botonBarra(win, 'Añadir fila'), 'la casilla es de los agentes: hay edición').toBeVisible()
    await expect(win.locator(`${PANE} .db-barra-no-editable`), 'ya no dice «No editable: solo lectura»').toHaveCount(0)

    await celda(win, 0, 1).click({ button: 'right' })
    expect(await entradasMenu(win)).toContain('Editar celda')
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)

    const cambiar = async (texto: string): Promise<void> => {
      await esperarEditable(win)
      await celda(win, 0, 1).dblclick()
      await editorCelda(win).fill(texto)
      await editorCelda(win).press('Enter')
      await botonBarra(win, 'Enviar cambios').click()
      const dialogo = dialogoEnvio(win)
      await expect(dialogo).toBeVisible()
      await dialogo.getByRole('button', { name: 'Enviar', exact: true }).click()
      await expect(dialogo).toHaveCount(0, { timeout: 30_000 })
      await expect(celda(win, 0, 1)).toHaveText(texto, { timeout: 30_000 })
    }
    await cambiar('Ana (desde RO de agentes)')
    expect(filasPsql(e!.pg, 'SELECT nombre FROM public.personas WHERE id = 1'), 'otra sesión lo ve aplicado').toEqual(['Ana (desde RO de agentes)'])
    await cambiar('Ana María')
    expect(filasPsql(e!.pg, 'SELECT nombre FROM public.personas WHERE id = 1')).toEqual(['Ana María'])
  })

  // (4) DESCARTAR: con cambios pendientes, Refrescar, filtrar y ordenar PREGUNTAN; Cancelar
  // lo deja todo como estaba y Descartar sigue adelante. Y el acorde de revertir.
  test('(4) Refrescar, filtrar u ordenar con cambios piden «Descartar N cambios»', async () => {
    const win = e!.s.win
    await pestanaDe(win, ALIAS_ESCRITURA, 'personas').click()
    await expect(celda(win, 1, 1)).toHaveText('Bea')

    const editarBea = async (texto: string): Promise<void> => {
      // Tras «Descartar» la relectura sigue en vuelo un rato: ahí no se edita.
      await esperarEditable(win)
      await celda(win, 1, 1).dblclick()
      await editorCelda(win).fill(texto)
      await editorCelda(win).press('Enter')
      await expect(celda(win, 1, 1)).toHaveClass(/\bcambiada\b/)
    }

    // Refrescar: Cancelar no toca nada.
    await editarBea('Bea X')
    await botonBarra(win, 'Refrescar').click()
    const pregunta = confirmacion(win, 'Descartar 1 cambio')
    await expect(pregunta).toBeVisible()
    await expect(pregunta.getByRole('button', { name: 'Cancelar', exact: true }), 'destructivo: el foco en Cancelar').toBeFocused()
    await pregunta.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(pregunta).toHaveCount(0)
    await expect(celda(win, 1, 1)).toHaveText('Bea X')
    await expect(celda(win, 1, 1)).toHaveClass(/\bcambiada\b/)

    // Refrescar: Descartar relee.
    await botonBarra(win, 'Refrescar').click()
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(celda(win, 1, 1)).toHaveText('Bea')
    await expect(win.locator(`${PANE} .db-celda.cambiada`)).toHaveCount(0)

    // Intro en el filtro: pregunta, y al descartar aplica el filtro. Con el WHERE libre del
    // modo «SQL» (el guiado es el de por defecto), porque la mitad negativa
    // de abajo necesita una subconsulta que duerma, y eso el guiado no lo escribe.
    await editarBea('Bea Y')
    await win.locator(`${PANE} .filtro-guiado`).getByRole('button', { name: 'SQL', exact: true }).click()
    const where = win.locator(`${PANE} .db-filtro-input`).first()
    await where.fill('id <= 2')
    await where.press('Enter')
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(textoPildora(win)).toHaveText('2 filas', { timeout: 30_000 })
    await expect(celda(win, 1, 1)).toHaveText('Bea')
    await where.fill('')
    await where.press('Enter')
    await expect(textoPildora(win), 'sin cambios, el filtro no pregunta').toHaveText('3 filas', { timeout: 30_000 })

    // Ordenar por la cabecera: Cancelar no ordena.
    await editarBea('Bea Z')
    const cabecera = win.locator(`${PANE} .db-rejilla-th`, { has: win.locator('.db-rejilla-th-nombre', { hasText: /^nombre$/ }) })
    await cabecera.click()
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(cabecera.locator('.db-rejilla-orden'), 'no se ordenó').toHaveCount(0)
    await expect(celda(win, 1, 1)).toHaveText('Bea Z')

    // Mod+Alt+Z revierte la selección, sin preguntar (es un gesto sobre lo seleccionado).
    await celda(win, 1, 1).click()
    await win.keyboard.press(`${MOD}+Alt+KeyZ`)
    await expect(celda(win, 1, 1)).toHaveText('Bea')
    await expect(win.locator(`${PANE} .db-celda.cambiada`)).toHaveCount(0)

    // MITAD NEGATIVA: con OTRA lectura en vuelo no se edita. La rejilla sigue enseñando
    // el resultado viejo, y un cambio hecho ahí se quedaba con la posición de una fila
    // del viejo para aplicarse a la que la ocupara en el nuevo. El filtro duerme 3 s
    // (una sola vez: la subconsulta no depende de la fila).
    await where.fill('(SELECT count(*) FROM pg_sleep(3)) = 1')
    await where.press('Enter')
    await expect(win.locator(`${PANE} .db-rejilla.editable`), 'con la lectura en vuelo no se edita').toHaveCount(0)
    await expect(botonBarra(win, 'Añadir fila')).toBeDisabled()
    await celda(win, 1, 1).dblclick()
    await expect(editorCelda(win), 'el doble clic no abre el editor').toHaveCount(0)
    await esperarEditable(win)
    await expect(botonBarra(win, 'Añadir fila')).toBeEnabled()
    await where.fill('')
    await where.press('Enter')
    await esperarEditable(win)
    await expect(celda(win, 1, 1)).toHaveText('Bea')
  })

  // (4b) CERRAR LA PESTAÑA con cambios también pregunta. Depende de que la carcasa
  // (`DbArea.cerrar`) consulte `solicitarCierreDatos` de `registroEdicion.ts` para las
  // pestañas de datos, como hace con las consolas.
  test('(4b) cerrar la pestaña con cambios pide «Descartar N cambios»', async () => {
    const win = e!.s.win
    const pestana = pestanaDe(win, ALIAS_ESCRITURA, 'personas')
    await pestana.click()
    await celda(win, 2, 1).dblclick()
    await editorCelda(win).fill('Nuevo 2')
    await editorCelda(win).press('Enter')
    await celda(win, 2, 1).click()
    await win.keyboard.press(`${MOD}+KeyW`)
    const pregunta = confirmacion(win, 'Descartar 1 cambio')
    await expect(pregunta).toBeVisible()
    await pregunta.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(pestana, 'Cancelar no cierra').toHaveCount(1)
    await expect(celda(win, 2, 1)).toHaveText('Nuevo 2')

    await celda(win, 2, 1).click()
    await win.keyboard.press(`${MOD}+KeyW`)
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(pestana).toHaveCount(0)
    expect(filasPsql(e!.pg, 'SELECT nombre FROM public.personas WHERE id = 10')).toEqual(['Nuevo'])
  })

  // (5) STOP CON UN ENVÍO EN MARCHA: el disparador de `lenta` duerme; Detener lo corta en
  // el servidor, no se aplica nada y los cambios se quedan.
  test('(5) Detener un envío en marcha no aplica nada', async () => {
    const win = e!.s.win
    await abrirTabla(win, ALIAS_ESCRITURA, 'lenta')
    await celda(win, 0, 1).dblclick()
    await editorCelda(win).fill('dos')
    await editorCelda(win).press('Enter')
    await botonBarra(win, 'Enviar cambios').click()
    const dialogo = dialogoEnvio(win)
    await dialogo.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(dialogo.locator('.db-envio-estado')).toHaveText('Enviando…')
    const detener = dialogo.getByRole('button', { name: 'Detener', exact: true })
    await expect(detener).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(dialogo, 'mientras envía, Esc no lo cierra').toBeVisible()
    await detener.click()
    await expect(dialogo.locator('.db-envio-error-titulo')).toContainText('detenido', { timeout: 15_000 })
    expect(filasPsql(e!.pg, 'SELECT v FROM public.lenta WHERE id = 1')).toEqual(['uno'])
    await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(celda(win, 0, 1)).toHaveClass(/\bcambiada\b/)
    await botonBarra(win, 'Revertir cambios').click()
    await confirmacion(win, 'Descartar 1 cambio').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expect(celda(win, 0, 1)).toHaveText('uno')
  })

  // (6) PRODUCCIÓN: la marca en la barra, la franja roja con el alias, el foco en
  // Cancelar y el botón «Ejecutar en producción», que manda con `confirmado`.
  test('(6) en producción, franja roja y «Ejecutar en producción»', async () => {
    const win = e!.s.win
    await abrirTabla(win, ALIAS_PRODUCCION, 'personas')
    await expect(win.locator(`${PANE} .db-barra .marca-entorno-produccion`)).toHaveCount(1)
    await celda(win, 0, 2).dblclick()
    await editorCelda(win).fill('prod')
    await editorCelda(win).press('Enter')
    await botonBarra(win, 'Enviar cambios').click()
    const dialogo = dialogoEnvio(win)
    await expect(dialogo).toBeVisible()
    await expect(dialogo.locator('.db-envio-franja')).toContainText('PRODUCCIÓN')
    await expect(dialogo.locator('.db-envio-franja')).toContainText(ALIAS_PRODUCCION)
    await expect(dialogo.getByRole('button', { name: 'Enviar', exact: true })).toHaveCount(0)
    await expect(dialogo.getByRole('button', { name: 'Cancelar', exact: true }), 'en producción el foco va a Cancelar').toBeFocused()
    await dialogo.getByRole('button', { name: 'Ejecutar en producción', exact: true }).click()
    await expect(win.locator('.toast .toast-title', { hasText: '1 cambio aplicado' })).toBeVisible({ timeout: 30_000 })
    expect(filasPsql(e!.pg, 'SELECT nota FROM public.personas WHERE id = 1')).toEqual(['prod'])
  })

  // (7) CERRAR LA APP CON CAMBIOS SIN ENVIAR. El main pregunta al renderer (con plazo) ANTES
  // del diálogo nativo de salida, que solo miraba transacciones; así la X, Salir/⌘Q y
  // «Reiniciar para actualizar» ya no tiran los cambios sin decir nada.
  //   · El diálogo NATIVO no se pulsa desde Playwright: se sustituye `dialog.showMessageBox`
  //     en el main, como en el (10) de `conexiones.spec.ts`, y se fija el FLUJO: qué
  //     pregunta, que Cancelar deja la app viva CON sus cambios y que «Descartar y salir»
  //     cierra sin escribir nada. `before-quit` y la X pasan por `beginShutdown`: preguntan lo mismo.
  //   · Sin nada pendiente NO hay diálogo: lo prueba cada spec que cierra sin sustituirlo, y
  //     `test-salida-explorador.mts` lo fija caso a caso.
  // VA EL ÚLTIMO: termina cerrando la app, y `afterAll` cierra lo demás.
  test('(7) cerrar la app con cambios sin enviar pregunta (before-quit y la X, también minimizada, que se restaura); Cancelar la deja viva con sus cambios y «Descartar y salir» cierra sin escribir', async () => {
    const sesion = e!.s
    const win = sesion.win
    // La pestaña de `lenta` sigue abierta desde (5), sin cambios.
    await pestanaDe(win, ALIAS_ESCRITURA, 'lenta').click()
    await esperarEditable(win)
    await celda(win, 0, 1).dblclick()
    await editorCelda(win).fill('tres')
    await editorCelda(win).press('Enter')
    await expect(celda(win, 0, 1)).toHaveClass(/\bcambiada\b/)

    await sesion.app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __e2eDialogos: unknown[]; __e2eRespuestas: number[] }
      g.__e2eDialogos = []
      g.__e2eRespuestas = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const o = args[args.length - 1] as { title?: string; message?: string; detail?: string; buttons?: string[] }
        g.__e2eDialogos.push({ title: o.title, message: o.message, detail: o.detail, buttons: o.buttons })
        // Sin respuesta preparada, Cancelar (el índice 1 de este diálogo): nunca se sale a ciegas.
        return { response: g.__e2eRespuestas.shift() ?? 1, checkboxChecked: false }
      }) as unknown as typeof dialog.showMessageBox
    })
    const responder = (r: number): Promise<void> =>
      sesion.app.evaluate((_e, r) => {
        ;(globalThis as unknown as { __e2eRespuestas: number[] }).__e2eRespuestas.push(r)
      }, r)
    const dialogos = (): Promise<Array<{ title?: string; message?: string; detail?: string; buttons?: string[] }>> =>
      sesion.app.evaluate(() => (globalThis as unknown as { __e2eDialogos: [] }).__e2eDialogos)

    // 1) `before-quit` con «Cancelar»: pregunta, y la app sigue con su cambio.
    await responder(1)
    await sesion.app.evaluate(({ app }) => {
      app.quit()
    })
    await expect.poll(async () => (await dialogos()).length, { message: 'before-quit no preguntó' }).toBe(1)
    const q = (await dialogos())[0]
    expect(q.title).toBe('Cambios sin enviar')
    expect(q.message).toBe('Hay un cambio sin enviar.')
    expect(q.buttons).toEqual(['Descartar y salir', 'Cancelar'])
    expect(q.detail, 'el diálogo nombra la conexión y la tabla').toContain(`${ALIAS_ESCRITURA} · public.lenta: 1 cambio`)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar'), 'la ventana sigue abierta').toBeVisible()
    await expect(celda(win, 0, 1), 'el cambio sigue ahí').toHaveText('tres')
    await expect(celda(win, 0, 1)).toHaveClass(/\bcambiada\b/)

    // 2) La X con «Cancelar»: pregunta LO MISMO, y sigue viva.
    const pulsarX = (): Promise<void> =>
      sesion.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })
    await responder(1)
    await pulsarX()
    await expect.poll(async () => (await dialogos()).length, { message: 'la X no preguntó' }).toBe(2)
    expect((await dialogos())[1], 'la X y before-quit preguntan lo mismo').toEqual(q)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar'), 'la ventana sigue abierta').toBeVisible()
    await expect(celda(win, 0, 1), 'el cambio sigue ahí').toHaveText('tres')

    // 2b) Con la ventana MINIMIZADA: antes de preguntar la trae a la vista.
    //     Con el padre minimizado el diálogo caía en la esquina del monitor de más a la
    //     izquierda (medido en Windows). El gesto es el de cada sistema para cerrar una
    //     app minimizada: en Windows, el aspa de su miniatura en la barra de tareas (el
    //     'close' de la ventana); en macOS, Salir desde el Dock (`before-quit`).
    const minimizada = (): Promise<boolean> =>
      sesion.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false)
    await sesion.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize()
    })
    await expect.poll(minimizada, { message: 'la ventana no llegó a minimizarse' }).toBe(true)
    await responder(1)
    if (PLATAFORMA === 'mac') {
      await sesion.app.evaluate(({ app }) => {
        app.quit()
      })
    } else {
      await pulsarX()
    }
    await expect.poll(async () => (await dialogos()).length, { message: 'cerrar minimizada no preguntó' }).toBe(3)
    expect((await dialogos())[2], 'minimizada pregunta lo mismo').toEqual(q)
    await expect.poll(minimizada, { message: 'el diálogo de salida no trajo la ventana a la vista' }).toBe(false)
    await win.waitForTimeout(500)
    await expect(win.locator('.titlebar'), 'la ventana sigue abierta').toBeVisible()
    await expect(celda(win, 0, 1), 'el cambio sigue ahí').toHaveText('tres')

    // 3) La X otra vez, «Descartar y salir»: vuelve a preguntar y cierra, sin escribir nada.
    const cerrada = sesion.app.waitForEvent('close', { timeout: 60_000 })
    await responder(0)
    await pulsarX()
    await cerrada
    expect(filasPsql(e!.pg, 'SELECT v FROM public.lenta WHERE id = 1'), 'no se envió nada').toEqual(['uno'])
  })
})
