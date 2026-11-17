// =============================================================================
// La consola de «productividad SQL» sobre la app empaquetada y contra un PostgreSQL de
// `postgresEfimero.ts`: el diálogo de parámetros de punta a punta (`$1` → `binds` → el main
// lo recuenta con el mismo detector; Esc no ejecuta), Explicar plan con el acorde real
// dentro de Monaco y la pestaña «Plan» (la sentencia no se ejecuta), el historial privado
// (el popover lista, Enter inserta en el cursor, el filtro no inserta la lista anterior) y
// Formatear con el acorde y desde el menú de Monaco. Acordes de `productividadAyudas.ts`.
// En serie y compartiendo app. Lo de Oracle (q-quote, Explain en solo lectura) es
// `test:db-oracle` y la prueba contra una base remota de solo lectura.
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import {
  CONSOLA,
  PESTANAS,
  aLaVista,
  celdaResultado,
  crearProyecto,
  esperarFinEjecucion,
  fila,
  verSalida
} from './consolaAyudas'
import { esperarConsolaLista, monacoConsola } from './monaco'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import {
  ACORDE_EXPLICAR,
  ACORDE_FORMATEAR,
  ACORDE_HISTORIAL,
  campoParametro,
  dialogoParametros,
  esperarEntradaHistorial,
  lineasSalida,
  panelVisible,
  pestanaResultado,
  popoverHistorial
} from './productividadAyudas'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const ALIAS = 'PG-PRODUCTIVIDAD'
/** La consulta con parámetro de la prueba (1): la busca después el historial. */
const CON_PARAMETRO = 'select nombre from public.profile where id = $1'

test.describe.configure({ mode: 'serial' })

test.describe('explorador de BD: productividad SQL en la consola', () => {
  let s: SesionTessera | null = null
  let pg: PostgresEfimero | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null

  test.beforeAll(async () => {
    const r = await arrancarPostgres()
    if (!r.ok) {
      if (r.fallo) throw new Error(r.motivo)
      motivoSalto = `sin PostgreSQL de pruebas: ${r.motivo}`
      return
    }
    pg = r.pg
    // Agente FALSO, como en los otros specs: el proyecto lanzaría el de verdad.
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: {
              personal: {
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-consola', estado: 'active' }],
                activePath: proyecto
              }
            },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`personal|${proyecto}`] }
          })
        )
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.ventana.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    await s?.cerrar()
    pg?.parar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) La conexión (por la API del preload, CON contraseña) y una consola con Mod+N.
  test('(0) conexión y consola', async () => {
    const ventana = s!.ventana
    await aLaVista(ventana)
    await ventana.locator('.activity-item[title="Bases de datos"]').click()
    await expect(ventana.locator('.db-area:not(.hidden)')).toBeVisible()
    const p = pg!
    const creada = await ventana.evaluate(
      (c) =>
        window.tessera.db.crearConexion({
          profileId: 'personal',
          alias: c.alias,
          motor: 'postgres',
          host: c.host,
          port: c.port,
          database: 'postgres',
          user: 'postgres',
          password: c.password,
          readonly: false
        }),
      { alias: ALIAS, host: p.host, port: p.port, password: p.contrasena }
    )
    expect(creada.tieneSecreto).toBe(true)
    const conexion = fila(ventana, 'conexion', ALIAS)
    await expect(conexion).toHaveCount(1)
    await conexion.click()
    await ventana.keyboard.press(`${MOD}+KeyN`)
    await expect(ventana.locator(PESTANAS)).toHaveCount(1)
    await expect(ventana.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(ventana)
  })

  // (1) PARÁMETROS: un SELECT con `$1` abre el diálogo antes de ejecutar; se rellena,
  // Enter ejecuta y llega LA fila de ese valor. La segunda vez sale prerrellenado con
  // lo último usado en la consola, y Esc cancela SIN ejecutar nada.
  test('(1) un SELECT con $1 pide el valor, lo ejecuta con él, y Esc no ejecuta nada', async () => {
    const ventana = s!.ventana
    await monacoConsola(ventana, { op: 'fijar', texto: CON_PARAMETRO })
    await ventana.locator(`${CONSOLA} .db-consola-run`).click()
    const dialogo = dialogoParametros(ventana)
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Cerrar', exact: true })).toBeEnabled()
    const campo = campoParametro(ventana, '$1')
    await expect(campo).toBeFocused()
    await campo.fill('2')
    await ventana.keyboard.press('Enter')
    await expect(dialogo).toHaveCount(0)
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('Analista', { timeout: 15_000 })
    await expect(ventana.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1)
    // La pestaña del resultado dice con qué valores se ejecutó.
    const pestana = ventana.locator(`${CONSOLA} .db-resultados-tabs [role="tab"].active`)
    await expect(pestana).toHaveAttribute('title', /Parámetros: \$1 = 2/)

    // Otra vez: prerrellenado con el 2; Esc cancela y la Salida no crece.
    const antes = (await lineasSalida(ventana).catch(() => [])).length
    await ventana.locator(`${CONSOLA} .db-consola-run`).click()
    await expect(dialogo).toBeVisible()
    await expect(campoParametro(ventana, '$1')).toHaveValue('2')
    await ventana.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await verSalida(ventana)
    expect((await lineasSalida(ventana)).length, 'Esc no ejecutó nada (ni eco en la Salida)').toBe(antes)
  })

  // (2) EXPLICAR PLAN con el acorde, DENTRO de Monaco: abre la pestaña «Plan» con el
  // árbol del plan, SIN sustituir el resultado que había; la marca de la sentencia es
  // la del plan (no la ✓: no se ejecutó); el conmutador enseña el plan en texto; sus
  // metadatos salen una vez; y un plan que falla da el ✗ subrayado de siempre.
  test('(2) Explicar plan abre la pestaña Plan con sus nodos', async () => {
    const ventana = s!.ventana
    await monacoConsola(ventana, { op: 'fijar', texto: 'select id, nombre from public.profile where id = 1' })
    await ventana.keyboard.press(ACORDE_EXPLICAR)
    await esperarFinEjecucion(ventana)
    const plan = pestanaResultado(ventana, 'Plan')
    await expect(plan).toHaveCount(1, { timeout: 15_000 })
    await expect(plan).toHaveClass(/\bactive\b/)
    // El resultado de filas de (1) sigue: explicar no tira lo que se estaba mirando.
    await expect(pestanaResultado(ventana, 'public.profile')).toHaveCount(1)
    const filas = panelVisible(ventana).locator('.db-plan-arbol tbody tr')
    await expect(filas.first()).toBeVisible()
    expect(await filas.count(), 'el plan tiene al menos un paso').toBeGreaterThan(0)
    await expect(filas.first().locator('.db-plan-op-texto')).not.toHaveText('')
    // Los metadatos del plan, UNA vez: en la cabecera de resultados, donde van los de
    // cualquier pestaña. La barra del plan los repetía justo debajo.
    await expect(ventana.locator(`${CONSOLA} .db-resultados-meta`)).toContainText(/\d+ pasos?\b/)
    await expect(panelVisible(ventana).locator('.db-plan-barra')).not.toContainText('paso')
    // No se ejecutó: ni ✓ ni barra de «ejecutado», su glifo propio.
    await expect(ventana.locator(`${CONSOLA} .db-glifo-plan`)).toHaveCount(1)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(0)
    // La vista de texto.
    await panelVisible(ventana).locator('.db-plan-vista').click()
    await expect(panelVisible(ventana).locator('.db-plan-texto')).not.toBeEmpty()
    await panelVisible(ventana).locator('.db-plan-vista').click()
    await expect(panelVisible(ventana).locator('.db-plan-arbol')).toBeVisible()
    // La Salida lo dice sin dar a entender que corrió.
    await verSalida(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-salida`)).toContainText('EXPLAIN select id, nombre')
    await expect(ventana.locator(`${CONSOLA} .db-salida`)).toContainText('(la sentencia no se ejecutó)')

    // Con parámetros también pide el diálogo (prerrellenado) y da su plan.
    await monacoConsola(ventana, { op: 'fijar', texto: CON_PARAMETRO })
    await ventana.locator(`${CONSOLA} .db-consola-explicar`).click()
    await expect(dialogoParametros(ventana)).toBeVisible()
    await expect(campoParametro(ventana, '$1')).toHaveValue('2')
    await ventana.keyboard.press('Enter')
    await esperarFinEjecucion(ventana)
    // Un plan nuevo sustituye al anterior sin fijar: sigue habiendo UNA pestaña «Plan».
    await expect(pestanaResultado(ventana, 'Plan')).toHaveCount(1)
    await expect(pestanaResultado(ventana, 'Plan')).toHaveClass(/\bactive\b/)
    await expect(panelVisible(ventana).locator('.db-plan-arbol tbody tr').first()).toBeVisible()

    // Un plan que FALLA en el servidor: el ✗ en la sentencia, el subrayado en su posición
    // y el error en la Salida. Es el mismo tramo que el de una ejecución
    // (`invocarSentencia`, `errorEnModelo`); antes era una copia sin e2e de su camino de
    // error.
    await monacoConsola(ventana, { op: 'fijar', texto: 'select nada_de_nada from public.profile' })
    await ventana.locator(`${CONSOLA} .db-consola-explicar`).click()
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-error`)).toHaveCount(1, { timeout: 15_000 })
    await expect(ventana.locator(`${CONSOLA} .squiggly-error`).first()).toBeVisible()
    await expect(ventana.locator(`${CONSOLA} .db-salida`)).toContainText('nada_de_nada')
  })

  // (3) HISTORIAL: el popover (con su acorde) lista lo ejecutado; el filtro lo acota;
  // Enter INSERTA la elegida en el cursor, terminada con `;`, y cierra.
  test('(3) el historial lista lo ejecutado y Enter lo inserta en el cursor', async () => {
    const ventana = s!.ventana
    await monacoConsola(ventana, { op: 'fijar', texto: '' })
    await ventana.keyboard.press(ACORDE_HISTORIAL)
    const emergente = popoverHistorial(ventana)
    await expect(emergente).toBeVisible()
    await expect(emergente.locator('.db-hist-solo').getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await esperarEntradaHistorial(ventana, CON_PARAMETRO)
    // El filtro acota (lo aplica el main): solo la del parámetro.
    await emergente.locator('.db-hist-filtro').fill('where id = $1')
    await expect(emergente.locator('.db-hist-fila')).toHaveCount(1, { timeout: 15_000 })
    await expect(emergente.locator('.db-hist-fila .db-hist-glifo')).toHaveText('✓')
    await ventana.keyboard.press('Enter')
    await expect(emergente).toHaveCount(0)
    await expect.poll(() => monacoConsola(ventana, { op: 'texto' })).toBe(`${CON_PARAMETRO};`)

    // Con texto delante en la línea, va en una línea NUEVA; y Esc cierra sin tocar nada.
    await monacoConsola(ventana, { op: 'fijar', texto: 'select 1;' })
    await ventana.locator(`${CONSOLA} .db-consola-historial-btn`).click()
    await expect(emergente).toBeVisible()
    await esperarEntradaHistorial(ventana, CON_PARAMETRO)
    await emergente.locator('.db-hist-filtro').fill('where id = $1')
    await expect(emergente.locator('.db-hist-fila')).toHaveCount(1, { timeout: 15_000 })
    await ventana.keyboard.press('Enter')
    // El salto se NORMALIZA: el modelo usa el fin de línea de la plataforma (en Windows
    // Monaco convierte el `\n` insertado en `\r\n`), y lo que se prueba es DÓNDE va la
    // sentencia, no qué salto lleva. Sin esto, en Windows fallaba con un `\r` que el
    // reporte pintaba como espacios.
    const textoLf = async (): Promise<string> => (await monacoConsola(ventana, { op: 'texto' })).replace(/\r\n/g, '\n')
    await expect.poll(textoLf).toBe(`select 1;\n${CON_PARAMETRO};`)
    await ventana.keyboard.press(ACORDE_HISTORIAL)
    await expect(emergente).toBeVisible()
    await ventana.keyboard.press('Escape')
    await expect(emergente).toHaveCount(0)
    expect(await textoLf()).toBe(`select 1;\n${CON_PARAMETRO};`)
    // El CURSOR quedó tras el `;` de lo insertado: se escribe una marca donde esté. En
    // Windows el modelo es CRLF y, contado sobre el texto con `\n`, se quedaba un
    // carácter corto (`= $1¶;`); en Mac (LF) sale igual antes y
    // después del arreglo. `¶` no es de palabra: no abre sugerencias.
    await monacoConsola(ventana, { op: 'teclear', texto: '¶' })
    expect(await textoLf()).toBe(`select 1;\n${CON_PARAMETRO};¶`)
  })

  // (4) FORMATEAR: el acorde cambia el texto (una sola parada de deshacer), y la
  // entrada «Formatear SQL» está en el menú contextual de Monaco.
  test('(4) «Formatear» cambia el texto, con el acorde y desde el menú', async () => {
    const ventana = s!.ventana
    const original = 'select id,nombre from public.profile where id=1 and nombre is not null'
    await monacoConsola(ventana, { op: 'fijar', texto: original })
    await ventana.keyboard.press(ACORDE_FORMATEAR)
    await expect.poll(() => monacoConsola(ventana, { op: 'texto' }), { timeout: 15_000 }).not.toBe(original)
    const formateado = await monacoConsola(ventana, { op: 'texto' })
    expect(formateado, 'el formateador parte en líneas').toContain('\n')
    expect(formateado.replace(/\s+/g, ' ').toLowerCase(), 'no cambia lo que dice').toContain('from public.profile')
    // Una sola parada de deshacer: un Mod+Z vuelve al original.
    await monacoConsola(ventana, { op: 'foco' })
    await ventana.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => monacoConsola(ventana, { op: 'texto' })).toBe(original)

    // Desde el menú contextual del editor (el de Tessera, con las acciones de la consola).
    await ventana.locator(`${CONSOLA} .db-consola-editor .view-lines`).click({ button: 'right' })
    const entrada = ventana.locator('.ctx-menu').getByRole('menuitem', { name: /Formatear SQL/ })
    await expect(entrada).toBeVisible()
    await entrada.click()
    await expect.poll(() => monacoConsola(ventana, { op: 'texto' }), { timeout: 15_000 }).toBe(formateado)
  })

  // (5) Enter con el filtro RECIÉN tecleado: el filtro lo aplica el main tras una pausa,
  // así que la lista que se ve aún es la anterior. Enter no puede insertar su fila
  // activa (la consulta más reciente, que no casa): espera a la lista nueva.
  test('(5) Enter en seguida tras teclear el filtro inserta lo que casa, no la fila vieja', async () => {
    const ventana = s!.ventana
    // Una consulta MÁS RECIENTE que la del parámetro: la primera de la lista sin filtro.
    const reciente = 'select 42 as respuesta'
    await monacoConsola(ventana, { op: 'fijar', texto: reciente })
    await ventana.locator(`${CONSOLA} .db-consola-run`).click()
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('42', { timeout: 15_000 })
    // El main la anota sin esperar: se espera a que el historial la tenga.
    await expect
      .poll(
        () =>
          ventana.evaluate(async (texto) => {
            const r = await window.tessera.bdExplorador.historial({ perfilId: 'personal', texto, limite: 5 })
            return r.ok ? r.valor.length : -1
          }, reciente),
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0)

    await monacoConsola(ventana, { op: 'fijar', texto: '' })
    await ventana.keyboard.press(ACORDE_HISTORIAL)
    const emergente = popoverHistorial(ventana)
    await expect(emergente).toBeVisible()
    await expect(emergente.locator('.db-hist-fila').first().locator('.db-hist-sql')).toHaveText(reciente, { timeout: 15_000 })
    // El filtro y Enter SIN esperar a que la lista cambie.
    await emergente.locator('.db-hist-filtro').fill('where id = $1')
    await ventana.keyboard.press('Enter')
    await expect(emergente).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(() => monacoConsola(ventana, { op: 'texto' })).toBe(`${CON_PARAMETRO};`)
  })

  // (6) «Borrar todo» pregunta EN LÍNEA. Cancelarlo con Esc devuelve el foco al filtro,
  // así que un segundo Esc cierra el popover: antes el foco caía en <body>, fuera del
  // popover, y su teclado dejaba de responder. Y no se borró nada.
  test('(6) cancelar «Borrar todo» con Esc deja vivo el teclado del popover', async () => {
    const ventana = s!.ventana
    await monacoConsola(ventana, { op: 'fijar', texto: '' })
    await ventana.keyboard.press(ACORDE_HISTORIAL)
    const emergente = popoverHistorial(ventana)
    await expect(emergente).toBeVisible()
    await esperarEntradaHistorial(ventana, CON_PARAMETRO)
    const filas = await emergente.locator('.db-hist-fila').count()
    await emergente.locator('.db-hist-borrar-todo').click()
    await expect(emergente.locator('.db-hist-confirmar')).toBeVisible()
    await ventana.keyboard.press('Escape')
    await expect(emergente.locator('.db-hist-confirmar')).toHaveCount(0)
    await expect(emergente.locator('.db-hist-filtro')).toBeFocused()
    await expect(emergente.locator('.db-hist-fila')).toHaveCount(filas)
    await ventana.keyboard.press('Escape')
    await expect(emergente).toHaveCount(0)
  })
})
