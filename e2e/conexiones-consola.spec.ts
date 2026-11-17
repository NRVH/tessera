// =============================================================================
// La consola, el árbol y las pestañas del explorador de BD («uso diario») sobre la app
// empaquetada y contra un PostgreSQL de `postgresEfimero.ts`: un RAISE NOTICE anidado bajo
// su sentencia en la Salida, el selector de esquema que llega a la SESIÓN (`current_schema()`
// lo dice el servidor), «Ver DDL» en un Monaco de solo lectura, el arrastre de una pestaña
// con el DnD de Chromium (y que un clic no es un arrastre) y «Cerrar las de la derecha». Los
// errores de compilación con marcas son de Oracle y quedan para `test:db-oracle`.
// En serie y compartiendo app; acordes por `MOD`.
// =============================================================================

import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import {
  CONSOLA,
  PESTANAS,
  aLaVista,
  arrastrarPestanaAntesDe,
  asentar,
  celdaResultado,
  crearProyecto,
  desplegar,
  ejecutarTodoSeleccionado,
  elegirDelMenu,
  entradaDeshabilitada,
  esperarFinEjecucion,
  fila,
  filaTras,
  nombresPestanas,
  pestana,
  verSalida
} from './consolaAyudas'
import { esperarConsolaLista, HOST_FUENTE, monacoConsola, monacoEn } from './monaco'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, MOD, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const ALIAS = 'PG-CONSOLA'

test.describe.configure({ mode: 'serial' })

test.describe('explorador de BD: consola, árbol y pestañas (segunda entrega)', () => {
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
    // El agente es FALSO (como en el otro spec): el proyecto que se abre lanzaría el
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

  // (0) La conexión (por la API del preload, CON contraseña) y una consola con Mod+N
  // sobre ella. Es la partida de todo lo demás.
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
    // La marca del motor en la fila: el elefante de PostgreSQL (su SVG oficial).
    await expect(conexion.locator('.db-motor-icono svg.db-motor-postgres')).toHaveCount(1)
    await conexion.click()
    await ventana.keyboard.press(`${MOD}+KeyN`)
    await expect(ventana.locator(PESTANAS)).toHaveCount(1)
    await expect(ventana.locator(CONSOLA)).toBeVisible()
    await esperarConsolaLista(ventana)
    // La pestaña de una consola lleva la marca del motor de su conexión.
    await expect(ventana.locator(`${PESTANAS} .db-tab-icono svg.db-motor-postgres`)).toHaveCount(1)
  })

  // (1) SALIDA DEL SERVIDOR: el NOTICE de un bloque DO llega a la Salida, ANIDADO bajo
  // el «completado» de su sentencia, y la sentencia lleva su ✓.
  test('(1) un RAISE NOTICE aparece en la Salida bajo su sentencia', async () => {
    const ventana = s!.ventana
    await ejecutarTodoSeleccionado(ventana, "DO $$ BEGIN RAISE NOTICE 'hola desde el servidor'; END $$")
    await esperarFinEjecucion(ventana)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-ok`)).toHaveCount(1)
    const salida = await verSalida(ventana)
    const linea = salida.locator('.db-salida-fila.db-salida-servidor', { hasText: 'hola desde el servidor' })
    await expect(linea).toHaveCount(1)
    await expect(linea, 'la salida del servidor va anidada (sangrada) bajo su sentencia').toHaveClass(/\banidada\b/)
    // Y en orden: el «completado» de la sentencia va JUSTO antes.
    const tipos = await salida
      .locator('.db-salida-fila')
      .evaluateAll((fs) => fs.map((f) => Array.from(f.classList).find((c) => c.startsWith('db-salida-') && c !== 'db-salida-fila') ?? ''))
    const i = tipos.lastIndexOf('db-salida-servidor')
    expect(tipos[i - 1], `orden de la Salida: ${tipos.join(', ')}`).toBe('db-salida-completado')
  })

  // (1b) GRAMÁTICA LOCAL: sin ejecutar nada, `SELEC` sale subrayado en rojo (el
  // parser de PG en WASM, que vive en el MAIN: esto es lo que demuestra que `libpg-query`
  // viaja en el paquete y carga en el main empaquetado, cosa que ningún test puro ve) y al
  // corregirlo se va. Sin ✗ ni Salida: no se envió nada al servidor.
  test('(1b) un error de sintaxis se subraya al escribir, sin ejecutar', async () => {
    const ventana = s!.ventana
    const rojo = ventana.locator(`${CONSOLA} .squiggly-error`)
    await monacoConsola(ventana, { op: 'fijar', texto: 'SELECT 1;\nSELEC 2;\nSELECT 3' })
    await expect(rojo.first(), 'el parser local marca «SELEC»').toBeVisible({ timeout: 10_000 })
    await expect(rojo).toHaveCount(1)
    await expect(ventana.locator(`${CONSOLA} .db-glifo-error`), 'no se ejecutó nada').toHaveCount(0)
    await monacoConsola(ventana, { op: 'fijar', texto: 'SELECT 1;\nSELECT 2;\nSELECT 3' })
    await expect(rojo, 'corregido, el rojo se va').toHaveCount(0, { timeout: 10_000 })
  })

  // (2) SELECTOR DE ESQUEMA: el botón de la barra abre el popover; elegir `ventas`
  // cambia el esquema de la SESIÓN (lo dice `current_schema()`, que responde el
  // servidor), la barra lo enseña como texto y el eco lo lleva. Volver a «Esquema de
  // la conexión (public)» lo deshace.
  test('(2) el selector de esquema cambia current_schema()', async () => {
    const ventana = s!.ventana
    const boton = ventana.locator(`${CONSOLA} .db-consola-esquema-btn`)
    await expect(boton).toBeEnabled()
    await expect(boton).toHaveAttribute('title', /Esquema: public\. Haga clic para cambiar/)
    await boton.click()
    const emergente = ventana.locator('.db-esquema-consola-pop')
    await expect(emergente).toBeVisible()
    await expect(emergente.locator('.db-pop-fila').first()).toContainText('Esquema de la conexión (public)')
    await emergente.locator('.db-pop-fila').filter({ has: ventana.locator('.db-pop-nombre', { hasText: /^ventas$/ }) }).click()
    await expect(emergente).toHaveCount(0)
    await expect(ventana.locator(`${CONSOLA} .db-consola-esquema`)).toHaveText('ventas')
    await expect(boton).toHaveAttribute('title', /Esquema: ventas\./)

    await ejecutarTodoSeleccionado(ventana, 'select current_schema()')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('ventas', { timeout: 15_000 })
    const salida = await verSalida(ventana)
    await expect(salida, 'el eco lleva el esquema elegido').toContainText('ventas> select current_schema()')

    // De vuelta al de la conexión, con el teclado: el popover abre con el cursor en la
    // opción vigente (ventas) y ↑ lleva a «Esquema de la conexión».
    await boton.click()
    await expect(emergente).toBeVisible()
    await expect(emergente.locator('.db-pop-fila.activa'), 'el cursor abre en la vigente').toContainText('ventas')
    for (let k = 0; k < 5; k++) await ventana.keyboard.press('ArrowUp')
    await ventana.keyboard.press('Enter')
    await expect(emergente).toHaveCount(0)
    await expect(ventana.locator(`${CONSOLA} .db-consola-esquema`)).toHaveText('public')
    await ejecutarTodoSeleccionado(ventana, 'select current_schema()')
    await esperarFinEjecucion(ventana)
    await expect(celdaResultado(ventana, 0, 0)).toHaveText('public', { timeout: 15_000 })

    // Esc cancela: abrir, mover y Esc no cambia nada.
    await boton.click()
    await expect(emergente).toBeVisible()
    await ventana.keyboard.press('ArrowDown')
    await ventana.keyboard.press('Escape')
    await expect(emergente).toHaveCount(0)
    await expect(ventana.locator(`${CONSOLA} .db-consola-esquema`)).toHaveText('public')
  })

  // (3) «VER DDL» de una tabla desde el menú del árbol: pestaña `profile (DDL)`, distinta
  // de la de datos, con el CREATE TABLE en un Monaco de solo lectura.
  test('(3) «Ver DDL» de una tabla abre una pestaña con CREATE TABLE', async () => {
    const ventana = s!.ventana
    const conexion = fila(ventana, 'conexion', ALIAS)
    await desplegar(conexion)
    const esquema = fila(ventana, 'esquema', 'public')
    await expect(esquema).toHaveCount(1, { timeout: 30_000 })
    await desplegar(esquema)
    const tablas = await filaTras(ventana, esquema, 'carpeta', 'tablas-public')
    await expect(tablas.locator('.db-fila-nombre')).toHaveText('tablas')
    await desplegar(tablas)
    const filaTabla = fila(ventana, 'objeto', 'profile')
    await expect(filaTabla).toHaveCount(1, { timeout: 15_000 })
    await filaTabla.click({ button: 'right' })
    await elegirDelMenu(ventana, 'Ver DDL')
    const ddl = pestana(ventana, 'profile (DDL)')
    await expect(ddl).toHaveCount(1)
    await expect(ddl).toHaveClass(/\bactive\b/)
    await expect(ventana.locator('.db-area:not(.hidden) section.db-fuente-ddl:not(.hidden)')).toBeVisible()
    await expect
      .poll(() => monacoEn(ventana, HOST_FUENTE, { op: 'texto' }).catch(() => ''), { timeout: 30_000 })
      .toMatch(/CREATE TABLE/i)
    expect(await monacoEn(ventana, HOST_FUENTE, { op: 'soloLectura' }), 'el DDL es de solo lectura').toBe('si')
    // Y la pestaña de DATOS de la misma tabla es OTRA: doble clic abre la suya.
    await filaTabla.dblclick()
    await expect(pestana(ventana, 'profile')).toHaveCount(1)
    await expect(pestana(ventana, 'profile (DDL)')).toHaveCount(1)
  })

  // (4) ARRASTRAR UNA PESTAÑA: la última («profile», datos) se suelta en el borde
  // izquierdo de la primera (la consola) y pasa a ser la primera. Un clic simple
  // después solo ACTIVA: no reordena.
  test('(4) arrastrar una pestaña cambia su orden, y un clic no', async () => {
    const ventana = s!.ventana
    await aLaVista(ventana)
    expect(await nombresPestanas(ventana)).toEqual(['consola_1', 'profile (DDL)', 'profile'])
    await arrastrarPestanaAntesDe(ventana, pestana(ventana, 'profile'), pestana(ventana, 'consola_1'))
    await expect.poll(() => nombresPestanas(ventana)).toEqual(['profile', 'consola_1', 'profile (DDL)'])
    // La raya de inserción no se queda pintada tras soltar.
    await expect(ventana.locator(`${PESTANAS}.soltar-antes, ${PESTANAS}.soltar-despues`)).toHaveCount(0)

    await pestana(ventana, 'profile (DDL)').click()
    await asentar(ventana)
    await expect(pestana(ventana, 'profile (DDL)')).toHaveClass(/\bactive\b/)
    expect(await nombresPestanas(ventana), 'un clic activa sin mover').toEqual(['profile', 'consola_1', 'profile (DDL)'])
  })

  // (5) «CERRAR A LA DERECHA» desde el menú de la primera: se van la consola (sin nada
  // que preguntar: no ejecuta ni tiene tx) y el DDL. En la primera, «Cerrar a la
  // izquierda» sale deshabilitado.
  test('(5) «Cerrar las de la derecha» cierra las de su derecha', async () => {
    const ventana = s!.ventana
    await pestana(ventana, 'profile').click({ button: 'right' })
    expect(await entradaDeshabilitada(ventana, 'Cerrar las de la izquierda'), 'nada a la izquierda de la primera').toBe(true)
    expect(await entradaDeshabilitada(ventana, 'Cerrar las de la derecha')).toBe(false)
    await elegirDelMenu(ventana, 'Cerrar las de la derecha')
    await expect.poll(() => nombresPestanas(ventana)).toEqual(['profile'])
    await expect(pestana(ventana, 'profile')).toHaveClass(/\bactive\b/)
  })
})
