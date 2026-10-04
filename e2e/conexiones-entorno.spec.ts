// =============================================================================
// El entorno de una conexión («escribir con seguridad») sobre la app empaquetada y contra
// un PostgreSQL de `postgresEfimero.ts`: se elige en el diálogo con el teclado, el main lo
// guarda y de ahí salen las marcas del árbol, la pestaña y la barra; en producción un
// UPDATE pide confirmar ANTES de enviar (cancelar no llega al servidor: lo dice psql), Tx
// Manual por defecto, el COMMIT confirma y el ROLLBACK no; una escritura por el preload sin
// `confirmado` vuelve con 'produccion'; sin entorno, ni marcas ni preguntas. En serie y
// compartiendo app; ninguna prueba deja una transacción pendiente (el cierre se colgaría).
// =============================================================================

import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import {
  CONSOLA,
  PESTANAS,
  aLaVista,
  crearProyecto,
  ejecutarTodoSeleccionado,
  elegirDelMenu,
  esperarFinEjecucion,
  fila,
  verSalida
} from './consolaAyudas'
import { esperarConsolaLista } from './monaco'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const ALIAS = 'PG-PROD'
const PERFIL = 'personal'

test.describe.configure({ mode: 'serial' })

/** El color que resuelve `valor` (un `var(--x)`) en el sitio de `el`, para comparar sin copiar hex. */
async function colorResuelto(el: Locator, valor: string): Promise<string> {
  return el.evaluate((nodo, v) => {
    const sonda = document.createElement('span')
    sonda.style.color = v
    nodo.appendChild(sonda)
    const c = getComputedStyle(sonda).color
    sonda.remove()
    return c
  }, valor)
}

/** El diálogo de confirmación abierto cuyo título casa con `titulo`. */
function confirmacion(win: Page, titulo: RegExp): Locator {
  return win.getByRole('dialog', { name: titulo })
}

test.describe('explorador de BD: entorno de producción', () => {
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
    // Agente FALSO, como en los otros specs: el proyecto que se abre lanzaría el
    // `claude` de verdad de quien corre la suite.
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
            activeProfileId: PERFIL,
            byProfile: {
              [PERFIL]: {
                openProjects: [{ projectHostPath: proyecto, name: 'proyecto-consola', estado: 'active' }],
                activePath: proyecto
              }
            },
            settings: { defaultProjectMode: 'windows', windowsModeProjects: [`${PERFIL}|${proyecto}`] }
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

  const nota = (id: number): string => pg!.psql(`select coalesce(nota, '<null>') from public.profile where id = ${id};`).out

  // (1) EL DIÁLOGO: alta de una conexión de PRODUCCIÓN rellenando el formulario a mano y
  // eligiendo el entorno CON EL TECLADO (flechas en el grupo de radios). La ayuda ya NO
  // cambia con «Solo lectura para los agentes»: promete confirmaciones igual.
  test('(1) se crea una conexión de producción con el diálogo, eligiendo el entorno con el teclado', async () => {
    const win = s!.win
    const p = pg!
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    await win.locator('.db-arbol .sidebar-header button[aria-label="Nueva conexión"]').click()
    const dialogo = win.locator('.db-conexion-modal')
    await expect(dialogo).toBeVisible()

    await dialogo.locator('[data-campo="alias"]').fill(ALIAS)
    await dialogo.locator('.dbc-motor-control select').selectOption('postgres')
    await dialogo.locator('[data-campo="host"]').fill(p.host)
    await dialogo.locator('[data-campo="port"]').fill(String(p.port))
    await dialogo.locator('[data-campo="database"]').fill('postgres')
    await dialogo.locator('[data-campo="user"]').fill('postgres')
    await dialogo.locator('.dbc-pass input').fill(p.password)

    // El grupo de radios: arranca en «Sin entorno»; Tab/foco entra en él y las flechas eligen.
    const grupo = dialogo.getByRole('group', { name: 'Entorno' })
    await expect(grupo).toBeVisible()
    const radio = (valor: string): Locator => grupo.locator(`input[type="radio"][value="${valor}"]`)
    await expect(radio('')).toBeChecked()
    await radio('').focus()
    for (let i = 0; i < 3; i++) await win.keyboard.press('ArrowRight')
    await expect(radio('produccion')).toBeChecked()
    await expect(radio('')).not.toBeChecked()
    // El foco se VE en la opción (el círculo del radio va oculto).
    const opcionProd = dialogo.locator('.dbc-entorno-opcion.dbc-entorno-produccion')
    expect(await opcionProd.evaluate((el) => getComputedStyle(el).outlineStyle), 'anillo de foco en la opción').toBe('solid')

    // «Solo lectura para los agentes» viene marcada y, ahora, NO cambia la
    // ayuda de producción (la casilla es de los agentes: al usuario se le pide confirmar
    // igual). La mitad negativa: ni con ella marcada ni sin ella dice que se rechace nada.
    const ayuda = dialogo.locator('.dbc-entorno-ayuda')
    const soloLectura = dialogo.getByLabel('Solo lectura para los agentes (recomendado)')
    await expect(soloLectura).toBeChecked()
    await expect(ayuda).toContainText('confirmación')
    await expect(ayuda).toContainText('Tx Manual')
    await expect(ayuda).not.toContainText('rechaza')
    await soloLectura.uncheck()
    await expect(ayuda).toContainText('confirmación')
    await expect(ayuda).toContainText('Tx Manual')

    await dialogo.locator('button[type="submit"]').click()
    await expect(dialogo).toHaveCount(0, { timeout: 15_000 })

    // El main lo GUARDÓ (vuelve en la lista), no solo lo pintó el renderer.
    const guardada = await win.evaluate(
      async (a) => (await window.tessera.db.list(a.perfil)).find((c) => c.alias === a.alias) ?? null,
      { perfil: PERFIL, alias: ALIAS }
    )
    expect(guardada, 'la conexión existe').not.toBeNull()
    expect(guardada!.entorno, 'el entorno se guardó').toBe('produccion')
    expect(guardada!.readonly).toBe(false)
  })

  // (2) LAS MARCAS: franja y tinte rojos en la fila del árbol, franja y tinte en la
  // pestaña de la consola, y el chip «Producción» en ROJO RELLENO junto al alias de la
  // barra. Y la consola nueva, antes de ejecutar nada, dice «Tx: Manual».
  test('(2) marcas rojas en el árbol, la pestaña y la barra, y la consola nueva en Tx Manual', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await expect(conexion).toHaveCount(1, { timeout: 15_000 })
    await expect(conexion).toHaveClass(/\bdb-fila-produccion\b/)
    const franja = conexion.locator('.marca-entorno-compacta.marca-entorno-produccion')
    await expect(franja).toHaveCount(1)
    await expect(franja).toHaveAttribute('aria-label', 'Entorno: Producción')
    expect(await conexion.getAttribute('title'), 'el tooltip lo dice con palabras').toContain('Entorno: Producción')
    const tinte = await conexion.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(tinte, 'la fila va teñida').toContain('linear-gradient')

    await conexion.click()
    await win.keyboard.press(`${MOD}+KeyN`)
    await expect(win.locator(PESTANAS)).toHaveCount(1)
    await expect(win.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(win)

    const pestana = win.locator(PESTANAS).first()
    await expect(pestana).toHaveClass(/\bdb-tab-produccion\b/)
    await expect(pestana.locator('.marca-entorno-compacta.marca-entorno-produccion')).toHaveCount(1)
    expect(await pestana.getAttribute('title'), 'tooltip de la pestaña').toContain('Producción')

    const barra = win.locator(`${CONSOLA} .db-consola-barra`)
    await expect(barra).toHaveClass(/\bdb-consola-barra-produccion\b/)
    const chip = barra.locator('.db-consola-identidad .marca-entorno-chip.marca-entorno-produccion')
    await expect(chip).toContainText('Producción')
    expect(
      await chip.evaluate((el) => el.previousElementSibling?.classList.contains('db-consola-alias') ?? false),
      'el chip va junto al alias'
    ).toBe(true)
    const fondo = await chip.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(fondo, 'rojo RELLENO (es un estado)').toBe(await colorResuelto(chip, 'var(--entorno-produccion-relleno)'))

    await expect(barra).toContainText('Tx: Manual')
    await expect(win.locator(`${CONSOLA} .db-consola-tx-modo`)).toHaveAttribute('aria-pressed', 'true')
  })

  // (3) MITAD NEGATIVA: una consulta NO pide confirmación en producción. Y después de
  // ella la barra sigue en Manual, ahora con el modo que informa el MAIN.
  test('(3) un SELECT no pide confirmación y la sesión del main sigue en Manual', async () => {
    const win = s!.win
    await ejecutarTodoSeleccionado(win, 'select nota from public.profile where id = 1')
    await esperarFinEjecucion(win)
    await expect(win.getByRole('dialog')).toHaveCount(0)
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1)
    await expect(win.locator(`${CONSOLA} .db-consola-barra`)).toContainText('Tx: Manual')
    await expect(win.locator(`${CONSOLA} .db-consola-tx-modo`)).toHaveAttribute('aria-pressed', 'true')
  })

  // (4) UN UPDATE ABRE LA CONFIRMACIÓN ANTES DE ENVIAR NADA. Cancelar: psql (otra sesión)
  // no ve nada, la Salida no tiene su eco y no hay transacción. Aceptar: se ejecuta, y
  // como la consola está en Manual queda PENDIENTE (psql sigue sin verlo).
  test('(4) un UPDATE pide confirmación: cancelar no ejecuta, aceptar sí (y queda pendiente)', async () => {
    const win = s!.win
    const sql = "update public.profile set nota = 'e2e-prod' where id = 1"
    expect(nota(1), 'partida').toBe('<null>')

    await ejecutarTodoSeleccionado(win, sql)
    const pregunta = confirmacion(win, /^Producción: ¿ejecutar en PG-PROD\?$/)
    await expect(pregunta).toBeVisible()
    await expect(pregunta).toContainText(`«${ALIAS}» es una conexión de producción.`)
    await expect(pregunta).toContainText('La sentencia escribe: UPDATE.')
    const cancelar = pregunta.getByRole('button', { name: 'Cancelar' })
    const aceptar = pregunta.getByRole('button', { name: 'Ejecutar en producción' })
    await expect(cancelar, 'destructivo: el foco arranca en Cancelar').toBeFocused()
    await expect(aceptar).toHaveClass(/\bdanger\b/)
    await cancelar.click()
    await expect(pregunta).toHaveCount(0)
    await esperarFinEjecucion(win)
    expect(nota(1), 'cancelar no llegó al servidor').toBe('<null>')
    // En Manual el SELECT de (3) pudo dejar la transacción «abierta» (el BEGIN perezoso
    // de PG); lo que no puede haber es nada PENDIENTE.
    await expect(win.locator(`${CONSOLA} .db-consola-barra`), 'ni transacción pendiente').not.toContainText('Tx pendiente')
    const salida = await verSalida(win)
    await expect(salida, 'ni eco en la Salida').not.toContainText('e2e-prod')

    await ejecutarTodoSeleccionado(win, sql)
    await expect(pregunta).toBeVisible()
    await pregunta.getByRole('button', { name: 'Ejecutar en producción' }).click()
    await expect(pregunta).toHaveCount(0)
    await esperarFinEjecucion(win)
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1)
    await expect(win.locator(`${CONSOLA} .db-consola-tx`)).toHaveText('Tx pendiente (1)')
    expect(nota(1), 'Tx Manual: sin COMMIT, otra sesión no lo ve').toBe('<null>')
  })

  // (5) EL COMMIT DE LA BARRA PIDE CONFIRMACIÓN (cancelar lo deja pendiente; aceptar
  // confirma y psql lo ve). El ROLLBACK no pregunta: no escribe.
  test('(5) Commit pide confirmación y Rollback no', async () => {
    const win = s!.win
    const commit = win.locator(`${CONSOLA} button.db-consola-commit`)
    const rollback = win.locator(`${CONSOLA} button.db-consola-rollback`)
    const barraTx = win.locator(`${CONSOLA} .db-consola-tx`)

    await commit.click()
    const pregunta = confirmacion(win, /^Producción: ¿confirmar en PG-PROD\?$/)
    await expect(pregunta).toBeVisible()
    await expect(pregunta).toContainText('El COMMIT hace definitivos los cambios pendientes')
    await pregunta.getByRole('button', { name: 'Cancelar' }).click()
    await expect(pregunta).toHaveCount(0)
    await expect(barraTx, 'cancelar el Commit no confirma nada').toHaveText('Tx pendiente (1)')
    expect(nota(1)).toBe('<null>')

    await commit.click()
    await expect(pregunta).toBeVisible()
    await pregunta.getByRole('button', { name: 'Confirmar (Commit)' }).click()
    await expect(pregunta).toHaveCount(0)
    await expect(barraTx).toHaveCount(0)
    expect(nota(1), 'tras el Commit confirmado, otra sesión lo ve').toBe('e2e-prod')

    // Rollback: otro UPDATE (aceptado) y se revierte SIN pregunta.
    await ejecutarTodoSeleccionado(win, "update public.profile set nota = 'e2e-deshacer' where id = 1")
    await confirmacion(win, /^Producción: ¿ejecutar en PG-PROD\?$/).getByRole('button', { name: 'Ejecutar en producción' }).click()
    await esperarFinEjecucion(win)
    await expect(barraTx).toHaveText('Tx pendiente (1)')
    await rollback.click()
    await expect(win.getByRole('dialog'), 'el Rollback no pregunta').toHaveCount(0)
    await expect(barraTx).toHaveCount(0)
    expect(nota(1), 'revertido').toBe('e2e-prod')
  })

  // (6) LA SEGUNDA BARRERA ES DEL MAIN: una escritura por el preload SIN `confirmado`
  // vuelve con 'produccion' y no llega al servidor; con él, pasa (y se revierte).
  test('(6) el main rechaza una escritura en producción sin confirmar', async () => {
    const win = s!.win
    const antes = nota(2)
    const r = await win.evaluate(
      async (a) => {
        const conexion = (await window.tessera.db.list(a.perfil)).find((c) => c.alias === a.alias)
        const lista = await window.tessera.dbExplorador.listarConsolas(a.perfil)
        const consola = lista.ok ? lista.valor.find((k) => k.conexionId === conexion?.id) : undefined
        if (!consola) return { consolaId: null, sin: null, con: null, tx: null }
        const base = { perfilId: a.perfil, consolaId: consola.id, sql: a.sql, maxFilas: 10 }
        const sin = await window.tessera.dbExplorador.ejecutar({ ...base, ejecucionId: 'e2e-sin-confirmar' })
        const con = await window.tessera.dbExplorador.ejecutar({ ...base, ejecucionId: 'e2e-confirmado', confirmado: true })
        // Lo que dejó el segundo (Tx Manual) se revierte: nada queda pendiente al salir.
        const tx = await window.tessera.dbExplorador.tx(a.perfil, consola.id, 'rollback')
        return { consolaId: consola.id, sin, con, tx }
      },
      { perfil: PERFIL, alias: ALIAS, sql: "update public.profile set nota = 'sin-confirmar' where id = 2" }
    )
    expect(r.consolaId, 'la consola de la conexión').not.toBeNull()
    expect(r.sin?.ok, 'sin confirmar: rechazada').toBe(false)
    if (r.sin && !r.sin.ok) expect(r.sin.error.motivo).toBe('produccion')
    expect(r.con?.ok, 'confirmada: pasa').toBe(true)
    expect(r.tx?.ok, 'y se revierte').toBe(true)
    if (r.tx?.ok) expect(r.tx.valor.tx).toBe('ninguna')
    expect(nota(2), 'nada llegó a confirmarse').toBe(antes)
  })

  // (7) MITAD NEGATIVA: quitar el entorno en el diálogo de edición quita las marcas, y
  // una consola NUEVA de esa conexión arranca en Auto y ejecuta un UPDATE sin preguntar.
  test('(7) sin entorno: ni marcas ni confirmación, y la consola nueva en Auto', async () => {
    const win = s!.win
    const conexion = fila(win, 'conexion', ALIAS)
    await conexion.click({ button: 'right' })
    await elegirDelMenu(win, 'Editar conexión…')
    const dialogo = win.locator('.db-conexion-modal')
    await expect(dialogo).toBeVisible()
    const grupo = dialogo.getByRole('group', { name: 'Entorno' })
    await expect(grupo.locator('input[type="radio"][value="produccion"]')).toBeChecked()
    await grupo.locator('.dbc-entorno-ninguno').click()
    await expect(grupo.locator('input[type="radio"][value=""]')).toBeChecked()
    await dialogo.locator('button[type="submit"]').click()
    await expect(dialogo).toHaveCount(0, { timeout: 15_000 })

    const guardada = await win.evaluate(
      async (a) => (await window.tessera.db.list(a.perfil)).find((c) => c.alias === a.alias) ?? null,
      { perfil: PERFIL, alias: ALIAS }
    )
    expect(guardada?.entorno ?? null, 'el main lo quitó (entrada sin el campo = sin entorno)').toBeNull()
    await expect(conexion).not.toHaveClass(/\bdb-fila-produccion\b/)
    await expect(conexion.locator('.marca-entorno')).toHaveCount(0)
    await expect(win.locator(`${PESTANAS} .marca-entorno`)).toHaveCount(0)
    await expect(win.locator(`${CONSOLA} .marca-entorno`)).toHaveCount(0)

    await conexion.click()
    await win.keyboard.press(`${MOD}+KeyN`)
    await expect(win.locator(PESTANAS)).toHaveCount(2)
    await esperarConsolaLista(win)
    const barra = win.locator(`${CONSOLA} .db-consola-barra`)
    await expect(barra).toContainText('Tx: Auto')
    await expect(barra).not.toHaveClass(/\bdb-consola-barra-produccion\b/)
    await ejecutarTodoSeleccionado(win, "update public.profile set nota = 'e2e-sin-entorno' where id = 3")
    await esperarFinEjecucion(win)
    await expect(win.getByRole('dialog'), 'sin entorno no se pregunta').toHaveCount(0)
    await expect(win.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1)
    expect(nota(3), 'Tx Auto: confirmado al momento').toBe('e2e-sin-entorno')
  })
})
