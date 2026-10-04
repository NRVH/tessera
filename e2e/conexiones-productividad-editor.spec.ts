// =============================================================================
// El editor de «productividad SQL» sobre la app empaquetada y contra un PostgreSQL de
// `postgresEfimero.ts` (siembra dos FKs): la cadena entera de las claves ajenas hasta el
// widget de Monaco con su ON, «Expandir columnas» con su rango y `filterText` (y la
// bombilla), «Formatear SQL» con sql-formatter cargado por import dinámico DENTRO del
// paquete y deshecho de una vez, y el tokenizador de `tessera-oracle-sql` registrado en la
// app (`q'[it's]'` como una sola cadena). Las acciones se llaman por su etiqueta, sin
// acordes, con las operaciones de `monaco.ts`. En serie y compartiendo app.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { CONSOLA, PESTANAS, aLaVista, crearProyecto, fila } from './consolaAyudas'
import { esperarConsolaLista, monacoConsola } from './monaco'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const ALIAS = 'PG-EDITOR'

/** Tipos estándar de token por carácter de cada línea (0 otro, 1 comentario, 2 cadena). */
interface Tokens {
  lenguaje: string
  lineas: number[][]
  /** El lenguaje del modelo después de devolverlo a como estaba. */
  restaurado: string
}

/** Monaco: `StandardTokenType.String`. */
const CADENA = 2

/** El widget de sugerencias visible y su fila activa (la primera, que es la que acepta Enter). */
const WIDGET = '.suggest-widget.visible'

/**
 * Pide sugerencias hasta que la PRIMERA fila contiene `texto` (la primera pregunta puede
 * volver sin las FKs si tardan más que el tope de 800 ms: la siguiente ya las tiene).
 */
async function sugerirHastaPrimera(win: Page, texto: string, msMax = 20_000): Promise<void> {
  const hasta = Date.now() + msMax
  let ultima = ''
  while (Date.now() < hasta) {
    await monacoConsola(win, { op: 'sugerir' })
    const widget = win.locator(WIDGET)
    await expect(widget).toBeVisible({ timeout: 15_000 })
    const primera = widget.locator('.monaco-list-row').first()
    ultima = (await primera.textContent().catch(() => '')) ?? ''
    if (ultima.indexOf(texto) >= 0) return
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)
  }
  throw new Error(`la primera sugerencia no llegó a ser «${texto}» (última: «${ultima}»)`)
}

test.describe.configure({ mode: 'serial' })

test.describe('explorador de BD: productividad SQL en el editor', () => {
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
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.beforeEach(() => {
    test.skip(motivoSalto !== null, motivoSalto ?? '')
  })

  test.afterAll(async () => {
    await s?.cerrar()
    pg?.parar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (0) La conexión (por la API del preload) y una consola con Mod+N.
  test('(0) conexión y consola', async () => {
    const win = s!.win
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    const p = pg!
    const creada = await win.evaluate(
      (c) =>
        window.tessera.db.create({
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
      { alias: ALIAS, host: p.host, port: p.port, password: p.password }
    )
    expect(creada.tieneSecreto).toBe(true)
    const conexion = fila(win, 'conexion', ALIAS)
    await expect(conexion).toHaveCount(1)
    await conexion.click()
    await win.keyboard.press(`${MOD}+KeyN`)
    await expect(win.locator(PESTANAS)).toHaveCount(1)
    await expect(win.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(win)
  })

  // (1) `JOIN ` tras una tabla con FK: la PRIMERA sugerencia es la tabla relacionada CON
  // su condición, con un alias libre y el ON en la caja en que se escribió el JOIN.
  test('(1) tras JOIN sugiere la tabla relacionada por FK con su ON', async () => {
    const win = s!.win
    await monacoConsola(win, { op: 'fijar', texto: '' })
    await monacoConsola(win, { op: 'teclear', texto: 'select * from profile p join ' })
    await sugerirHastaPrimera(win, 'module m on m.profile_id = p.id')
    await win.keyboard.press('Enter')
    await expect.poll(() => monacoConsola(win, { op: 'texto' })).toBe('select * from profile p join module m on m.profile_id = p.id')

    // Entre esquemas: `ventas` no es el de la consola (public), así que va calificada.
    await monacoConsola(win, { op: 'fijar', texto: '' })
    await monacoConsola(win, { op: 'teclear', texto: 'SELECT * FROM ventas.factura f JOIN ' })
    await sugerirHastaPrimera(win, 'ventas.cliente c ON c.id = f.cliente_id')
    await win.keyboard.press('Escape')
  })

  // (2) Tras `ON ` del JOIN: la condición de la FK entre la tabla nueva y la de la izquierda.
  test('(2) tras ON sugiere la condición de la FK', async () => {
    const win = s!.win
    await monacoConsola(win, { op: 'fijar', texto: 'select * from ventas.cliente c join ventas.factura f on ' })
    await sugerirHastaPrimera(win, 'f.cliente_id = c.id')
    await win.keyboard.press('Enter')
    await expect.poll(() => monacoConsola(win, { op: 'texto' })).toBe('select * from ventas.cliente c join ventas.factura f on f.cliente_id = c.id')
  })

  // (3) «Expandir columnas» como ítem de completado JUSTO tras el `*`: sustituye el
  // comodín (no la palabra del cursor) por las columnas en el orden de la tabla.
  test('(3) el * se expande desde el completado', async () => {
    const win = s!.win
    const texto = 'select * from profile'
    await monacoConsola(win, { op: 'fijar', texto })
    await monacoConsola(win, { op: 'posicionar', offset: texto.indexOf('*') + 1 })
    await sugerirHastaPrimera(win, 'Expandir columnas')
    await win.keyboard.press('Enter')
    await expect.poll(() => monacoConsola(win, { op: 'texto' })).toBe('select id, nombre, saldo, nota from profile')
  })

  // (4) La misma expansión desde la BOMBILLA (acción de código), sobre un `p.*` con dos
  // tablas: solo las de `p`, calificadas como se escribió.
  test('(4) el * se expande desde la acción de código', async () => {
    const win = s!.win
    const texto = 'select p.* from profile p join module m on m.profile_id = p.id'
    await monacoConsola(win, { op: 'fijar', texto })
    await monacoConsola(win, { op: 'posicionar', offset: texto.indexOf('*') })
    // Sin acorde: ⌘. es Detener en la consola de Mac; se abre como la bombilla.
    await monacoConsola(win, { op: 'comando', id: 'editor.action.quickFix' })
    const accion = win.locator('.action-widget .monaco-list-row', { hasText: 'Expandir columnas' })
    await expect(accion).toBeVisible({ timeout: 15_000 })
    // La lista de acciones de Monaco pone encima una capa (`context-view-pointerBlock`)
    // que ella misma retira con el PRIMER movimiento del ratón (`actionWidget.js`): un
    // usuario siempre mueve el ratón antes de hacer clic. El `click` de Playwright
    // comprueba quién recibe el clic ANTES de mover el ratón, y la capa lo tapaba. Se
    // mueve primero, como haría el usuario.
    const caja = await accion.boundingBox()
    if (!caja) throw new Error('la acción «Expandir columnas» no tiene caja')
    await win.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2)
    await accion.click()
    await expect
      .poll(() => monacoConsola(win, { op: 'texto' }), { timeout: 15_000 })
      .toBe('select p.id, p.nombre, p.saldo, p.nota from profile p join module m on m.profile_id = p.id')
  })

  // (5) «Formatear SQL»: cada sentencia por separado, el comentario y el `;` en su sitio,
  // y un solo Deshacer vuelve al texto de antes.
  test('(5) Formatear SQL, y se deshace de una vez', async () => {
    const win = s!.win
    const original = 'select id,nombre from profile where id=1;\n-- nota\nselect 1'
    await monacoConsola(win, { op: 'fijar', texto: original })
    await monacoConsola(win, { op: 'accionPorEtiqueta', etiqueta: 'Formatear SQL' })
    const esperado = 'SELECT\n    id,\n    nombre\nFROM\n    profile\nWHERE\n    id = 1;\n-- nota\nSELECT\n    1'
    await expect.poll(() => monacoConsola(win, { op: 'texto' }), { timeout: 15_000 }).toBe(esperado)
    await monacoConsola(win, { op: 'comando', id: 'undo' })
    await expect.poll(() => monacoConsola(win, { op: 'texto' })).toBe(original)
  })

  // (6) El lenguaje de las consolas de Oracle está registrado en la app y deja
  // `q'[it's]'` como UNA cadena: `from` no lo es, y la línea siguiente tampoco empieza
  // dentro de una cadena (que es lo que hacía el `sql` de Monaco).
  test("(6) q'[…]' es una cadena en el lenguaje de la consola de Oracle", async () => {
    const win = s!.win
    const texto = "select q'[it's]' from dual\nwhere x = 'a'"
    const r = JSON.parse(await monacoConsola(win, { op: 'tokens', lenguaje: 'tessera-oracle-sql', texto })) as Tokens
    expect(r.lenguaje, 'el lenguaje existe en el Monaco de la app').toBe('tessera-oracle-sql')
    const [l1, l2] = r.lineas
    const ini = texto.indexOf("q'")
    const fin = texto.indexOf(' from')
    expect(l1.slice(ini, fin).every((t) => t === CADENA), `q'[it's]' entera como cadena: ${JSON.stringify(l1)}`).toBe(true)
    expect(l1[fin + 1], '`from` no es cadena').not.toBe(CADENA)
    expect(l2[0], 'la línea siguiente no empieza dentro de una cadena').not.toBe(CADENA)
    expect(l2[l2.length - 2], "'a' sí es cadena").toBe(CADENA)
    // Y la consola de PG vuelve a su lenguaje.
    expect(r.restaurado, 'la consola de PG sigue en pgsql').toBe('pgsql')
  })
})
