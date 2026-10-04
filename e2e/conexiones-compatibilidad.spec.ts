// =============================================================================
// Compatibilidad del registro de conexiones sobre la app empaquetada: lo que esta versión
// no entiende (un motor desconocido, un archivo con `version: "2"`, un JSON roto con y sin
// `.bak`, dos entradas con el mismo id, la copia de otro perfil) se VE, no se toca y se
// puede eliminar sin perder lo demás. La prueba siembra el registro EN DISCO antes de
// arrancar y lee el archivo al final; las reglas las fijan `test-filas-arbol-bd.mts` y
// `test-registro-conexiones.mts`. Solo el primer bloque abre una sesión (PostgreSQL de
// `postgresEfimero.ts`; sin Docker se salta). Cada bloque va en serie con su app. Borrar:
// `Supr` aquí y `⌘⌫` en Mac (`esAtajoBorrado`), donde queda escrito y SIN VERIFICAR.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { PESTANAS, aLaVista, asentar, crearProyecto, desplegar, elegirDelMenu, fila } from './consolaAyudas'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { entradasMenu } from './rejillaAyudas'
import { PERFILES_SIN_SANDBOX, PLATAFORMA, abrirTessera, borrarTemporal, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const ID_PG = 'e2e-compat-pg'
const ALIAS_PG = 'PG-COMPAT'
const ID_AJENA = 'e2e-compat-mysql'
const ALIAS_AJENA = 'SQLS-FUTURA'
/** Montada en el proyecto pero inexistente en el registro: la poda SÍ tiene que quitarla. */
const ID_BORRADA = 'e2e-compat-borrada'
const TEXTO_AJENA = 'Requiere una versión más nueva de Tessera'

/**
 * La ajena TAL CUAL la dejaría una versión más nueva: un motor que esta no conoce y
 * campos que tampoco (`cifrado`, `instancia`). Tiene que salir del archivo IDÉNTICA.
 */
const AJENA_EN_DISCO = {
  id: ID_AJENA,
  profileId: PERFIL,
  alias: ALIAS_AJENA,
  motor: 'mysql',
  host: '127.0.0.1',
  port: 1433,
  database: 'ventas',
  user: 'sa',
  readonly: false,
  cifrado: 'obligatorio',
  instancia: { nombre: 'SQLEXPRESS', puertoDinamico: true }
}

/** La versión del archivo que dejó la versión más nueva: no puede bajar. */
const VERSION_FUTURA = 2

interface RegistroEnDisco {
  version: number
  connections: Array<Record<string, unknown>>
}

function leerRegistro(datos: string, respaldo = false): RegistroEnDisco {
  return JSON.parse(readFileSync(join(datos, `db-connections.json${respaldo ? '.bak' : ''}`), 'utf8')) as RegistroEnDisco
}

function montajesEnDisco(datos: string): Record<string, string[]> {
  const estado = JSON.parse(readFileSync(join(datos, 'workspace-state.json'), 'utf8')) as {
    settings?: { dbMountsByProject?: Record<string, string[]> }
  }
  return estado.settings?.dbMountsByProject ?? {}
}

/** Los `data-tipo` de las filas pintadas del árbol, en orden. */
async function tiposDeFilas(win: Page): Promise<string[]> {
  return win.locator('.db-arbol .db-fila').evaluateAll((filas) => filas.map((f) => f.getAttribute('data-tipo') ?? ''))
}

test.describe('explorador de BD: conexiones de un motor que esta versión no conoce', () => {
  // En serie DENTRO del bloque: cada prueba parte de lo que dejó la anterior (ver la cabecera).
  test.describe.configure({ mode: 'serial' })
  let s: SesionTessera | null = null
  let pg: PostgresEfimero | null = null
  let falso: AgenteFalso | null = null
  let proyecto = ''
  let motivoSalto: string | null = null

  test.beforeAll(async () => {
    const r = await arrancarPostgres()
    if (!r.ok) {
      if (r.fallo) throw new Error(r.motivo)
      motivoSalto = `sin PostgreSQL de pruebas: ${r.motivo}`
      return
    }
    pg = r.pg
    const p = pg
    // Agente FALSO, como en los otros specs: el proyecto que se abre lanzaría el
    // `claude` de verdad de quien corre la suite.
    const agente = montarAgenteFalso()
    falso = agente
    proyecto = crearProyecto(agente.raiz)
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
            settings: {
              defaultProjectMode: 'windows',
              windowsModeProjects: [`${PERFIL}|${proyecto}`],
              dbMountsByProject: { [`${PERFIL}|${proyecto}`]: [ID_PG, ID_AJENA, ID_BORRADA] }
            }
          })
        )
        // La AJENA va PRIMERO en el archivo: se reescribe en su sitio, no al final.
        // La PG, sin contraseña (se guarda después) y con un campo que este formulario
        // no conoce (`compresion`), que tiene que sobrevivir también a `update()`.
        writeFileSync(
          join(datos, 'db-connections.json'),
          JSON.stringify(
            {
              version: VERSION_FUTURA,
              connections: [
                AJENA_EN_DISCO,
                {
                  id: ID_PG,
                  profileId: PERFIL,
                  alias: ALIAS_PG,
                  motor: 'postgres',
                  host: p.host,
                  port: p.port,
                  database: 'postgres',
                  user: 'postgres',
                  readonly: false,
                  compresion: { nivel: 3 }
                }
              ]
            },
            null,
            2
          ) + '\n'
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

  // (1) LA PODA DE ARRANQUE cuenta las ajenas como vivas: quita la conexión que no
  // existe (señal de que corrió y se guardó) y deja la PG y la ajena.
  test('(1) la poda de montajes del arranque no desmonta la conexión ajena', async () => {
    const datos = s!.datos
    const clave = `${PERFIL}|${proyecto}`
    await expect
      .poll(() => montajesEnDisco(datos)[clave] ?? [], {
        timeout: 30_000,
        message: 'la poda de arranque no llegó a quitar el montaje de la conexión inexistente'
      })
      .not.toContain(ID_BORRADA)
    const montadas = montajesEnDisco(datos)[clave] ?? []
    expect(montadas, 'la poda se llevó el montaje de la AJENA (solo contaba db.list)').toContain(ID_AJENA)
    expect(montadas).toContain(ID_PG)
  })

  // (1b) EL SELECTOR «Bases montadas» DEL AGENTE DEL PROYECTO enseña la ajena, que sigue
  // montada tras la poda de (1): atenuada, con el MISMO aviso que su fila del árbol y un
  // tooltip cuya salida es desmontarla (`filaMontajeAjena`). Antes ese texto se escribía
  // a mano en el pane, y a una de forma le decía lo que no era. Y es la prueba de punta a
  // punta de que el pane lee conocidas y ajenas juntas por `db:list:completa`.
  test('(1b) el selector de bases montadas del agente enseña la ajena con el aviso de su fila', async () => {
    const win = s!.win
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    const boton = pane.locator('.db-mount-btn')
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await boton.click()
    const pop = pane.locator('.db-mount-pop')
    await expect(pop).toBeVisible()
    const ajena = pop
      .locator('.db-mount-item.db-mount-ajena')
      .filter({ has: win.locator('.db-mount-alias', { hasText: new RegExp(`^${ALIAS_AJENA}$`) }) })
    await expect(ajena, 'la ajena montada no sale en el selector (su montaje sería un número fantasma)').toHaveCount(1, {
      timeout: 15_000
    })
    await expect(ajena.locator('.db-mount-dest')).toHaveText(`mysql · ${TEXTO_AJENA}`)
    await expect(ajena).toHaveAttribute('title', /Motor: mysql/)
    await expect(ajena, 'allí la salida es desmontarla, no eliminarla').toHaveAttribute('title', /desmontar/)
    await pop.getByRole('button', { name: 'Cerrar' }).click()
    await expect(pop).toHaveCount(0)
  })

  // (2) LA FILA: atenuada, al final, con su motor y el aviso; se selecciona, pero ni se
  // abre ni se despliega, y su menú y su tecla solo ofrecen eliminar (con confirmación).
  test('(2) la ajena se ve atenuada al final del árbol y solo se puede eliminar', async () => {
    const win = s!.win
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()

    const ajena = fila(win, 'ajena', ALIAS_AJENA)
    await expect(ajena, 'la conexión ajena no aparece en el árbol (desaparecía sin decir nada)').toHaveCount(1)
    await expect(fila(win, 'conexion', ALIAS_PG)).toHaveCount(1)
    await expect(ajena).toContainText(TEXTO_AJENA)
    await expect(ajena).toContainText('mysql')
    await expect(ajena).toHaveAttribute('title', /Motor: mysql/)
    // Al FINAL, aunque en el archivo va la primera: detrás de las conexiones conocidas.
    expect(await tiposDeFilas(win)).toEqual(['conexion', 'ajena'])
    // Sin chevron ni punto de sesión: no hay nada que desplegar ni a qué conectarse.
    await expect(ajena.locator('.db-chevron')).toHaveCount(0)
    await expect(ajena.locator('.db-sesion-punto')).toHaveCount(0)

    // Doble clic, los gestos de abrir (Enter, F4 y, en Mac, ⌘↓), → y Espacio: nada. Ni
    // pestañas, ni filas nuevas, ni el diálogo de la conexión.
    await ajena.dblclick()
    await expect(ajena).toHaveAttribute('aria-selected', 'true')
    const teclas = ['Enter', 'F4', 'ArrowRight', ' ', ...(PLATAFORMA === 'mac' ? ['Meta+ArrowDown'] : [])]
    for (const tecla of teclas) await win.keyboard.press(tecla)
    await asentar(win)
    await expect(win.locator(PESTANAS)).toHaveCount(0)
    expect(await tiposDeFilas(win)).toEqual(['conexion', 'ajena'])
    await expect(win.locator('.db-conexion-modal')).toHaveCount(0)
    await expect(win.getByRole('dialog', { name: 'Eliminar conexión' })).toHaveCount(0)
    await expect(ajena).toHaveAttribute('aria-selected', 'true')

    // El menú: SOLO eliminar.
    await ajena.click({ button: 'right' })
    expect(await entradasMenu(win)).toEqual(['Eliminar conexión…'])
    await win.keyboard.press('Escape')
    await expect(win.locator('.ctx-menu')).toHaveCount(0)

    // La tecla de borrar (la nativa de cada plataforma) pide confirmación, y Cancelar
    // la deja donde estaba.
    await ajena.click()
    await win.keyboard.press(PLATAFORMA === 'mac' ? 'Meta+Backspace' : 'Delete')
    const dialogo = win.getByRole('dialog', { name: 'Eliminar conexión' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText(`«${ALIAS_AJENA}»`)
    await expect(dialogo).toContainText('actualiza Tessera')
    await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(ajena).toHaveCount(1)
  })

  // (3) LAS ESCRITURAS: guardar la contraseña (update) y abrir la PG (marcarVerificada)
  // reescriben el registro, y la ajena sale IDÉNTICA y en su sitio, la versión no baja y
  // el campo desconocido de la PG sobrevive al formulario. También en el respaldo.
  test('(3) guardar la contraseña y abrir la PG no borran la ajena del archivo', async () => {
    const win = s!.win
    const datos = s!.datos
    const p = pg!

    // Por el MISMO canal que el diálogo de edición (`db:update`).
    const guardada = await win.evaluate(
      (c) =>
        window.tessera.db.update(c.id, {
          profileId: c.perfil,
          alias: c.alias,
          motor: 'postgres',
          host: c.host,
          port: c.port,
          database: 'postgres',
          user: 'postgres',
          password: c.password,
          readonly: false
        }),
      { id: ID_PG, perfil: PERFIL, alias: ALIAS_PG, host: p.host, port: p.port, password: p.password }
    )
    expect(guardada.tieneSecreto).toBe(true)
    {
      const r = leerRegistro(datos)
      expect(r.connections.find((c) => c.id === ID_AJENA), 'la primera escritura (update) BORRÓ la ajena').toEqual(AJENA_EN_DISCO)
      expect(r.version, 'la escritura bajó la versión del registro').toBeGreaterThanOrEqual(VERSION_FUTURA)
      expect(r.connections.find((c) => c.id === ID_PG)?.compresion, 'update() perdió el campo que el formulario no conoce').toEqual({ nivel: 3 })
    }

    // Abrir la PG: desplegarla abre la sesión del árbol, y eso es `marcarVerificada`.
    await desplegar(fila(win, 'conexion', ALIAS_PG))
    await expect(fila(win, 'esquema', 'public')).toHaveCount(1, { timeout: 30_000 })
    await expect
      .poll(() => leerRegistro(datos).connections.find((c) => c.id === ID_PG)?.verificadaEn, {
        timeout: 15_000,
        message: 'abrir la sesión no llegó a escribir la marca de verificada'
      })
      .toBeTruthy()

    const r = leerRegistro(datos)
    expect(r.connections.find((c) => c.id === ID_AJENA), 'marcarVerificada BORRÓ la ajena').toEqual(AJENA_EN_DISCO)
    expect(r.connections.map((c) => c.id), 'la ajena no se reescribió en su sitio').toEqual([ID_AJENA, ID_PG])
    expect(r.version).toBeGreaterThanOrEqual(VERSION_FUTURA)
    expect(r.connections.find((c) => c.id === ID_PG)?.compresion).toEqual({ nivel: 3 })
    // El respaldo es la escritura anterior: con el fallo, dos escrituras bastaban para
    // que tampoco quedara allí.
    expect(existsSync(join(datos, 'db-connections.json.bak'))).toBe(true)
    expect(leerRegistro(datos, true).connections.some((c) => c.id === ID_AJENA), 'el .bak ya no tiene la ajena').toBe(true)

    // Y el árbol, recargado por `db:changed`, la sigue enseñando detrás de lo desplegado.
    await expect(fila(win, 'ajena', ALIAS_AJENA)).toHaveCount(1)
    const tipos = await tiposDeFilas(win)
    expect(tipos[tipos.length - 1]).toBe('ajena')
    expect(tipos.filter((t) => t === 'ajena')).toHaveLength(1)
  })

  // (4) ELIMINAR la quita del árbol, del registro y de los montajes del proyecto; la PG
  // sigue donde estaba.
  test('(4) eliminarla desde su menú la quita del árbol, del archivo y de los montajes', async () => {
    const win = s!.win
    const datos = s!.datos
    const ajena = fila(win, 'ajena', ALIAS_AJENA)
    await ajena.click({ button: 'right' })
    await elegirDelMenu(win, 'Eliminar conexión…')
    const dialogo = win.getByRole('dialog', { name: 'Eliminar conexión' })
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole('button', { name: 'Eliminar', exact: true }).click()

    await expect(ajena).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS_PG)).toHaveCount(1)
    await expect
      .poll(() => leerRegistro(datos).connections.map((c) => c.id), { message: 'la ajena sigue en el registro' })
      .toEqual([ID_PG])
    await expect
      .poll(() => montajesEnDisco(datos)[`${PERFIL}|${proyecto}`] ?? [], { message: 'la ajena sigue montada' })
      .toEqual([ID_PG])
  })
})

// =============================================================================
// EL REGISTRO ENTERO EN UN FORMATO QUE ESTA VERSIÓN NO RECONOCE (ver la cabecera).
// =============================================================================

const ID_FMT_PG = 'e2e-formato-pg'
const ID_FMT_AJENA = 'e2e-formato-mysql'
/**
 * Montada pero sin entrada ni siquiera en el archivo. Con un registro legible, la poda
 * de arranque la QUITARÍA (es la señal que usa el bloque de arriba); con uno de formato
 * ajeno no se poda nada, así que tiene que seguir ahí: ni lo que parece basura se toca
 * cuando la lista no se entiende.
 */
const ID_FMT_INEXISTENTE = 'e2e-formato-inexistente'
/**
 * `TITULO_FORMATO_AJENO` de `filasArbolBd` (una prueba de interfaz no importa el renderer).
 * No nombra ninguna causa: la misma marca llega con un archivo que no se puede leer (el
 * tercer bloque), y la causa la dice el aviso del main.
 */
const TITULO_FORMATO = 'No se puede usar el registro de conexiones'
/** `MOTIVO_FORMATO_AJENO` de `filasArbolBd`: el porqué de los botones apagados. */
const MOTIVO_FORMATO = 'No disponible: no se puede usar el registro de conexiones'
/**
 * Margen de «no pasa nada» para el disco. Cuando el aviso ya se ve, la lectura de la poda
 * (pedida al arrancar, antes que la de la UI) ya volvió y, si hubiera podado, su guardado
 * ya iría en camino: el badge del botón lo demuestra EN MEMORIA, y esto le da al main el
 * tiempo de escribirlo antes de mirar el archivo.
 */
const MARGEN_DISCO_MS = 1500

test.describe('explorador de BD: el registro entero en un formato que esta versión no reconoce', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let clave = ''
  let registroSembrado = ''
  const montadas = [ID_FMT_PG, ID_FMT_AJENA, ID_FMT_INEXISTENTE]

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    clave = `${PERFIL}|${proyecto}`
    // Un registro que una versión más nueva (o una edición a mano) dejó con `version`
    // como TEXTO: legible, pero de un formato que esta versión no sabe escribir. Dentro,
    // una PG que esta versión sí entendería y una ajena: no se interpreta ninguna.
    registroSembrado =
      JSON.stringify(
        {
          version: '2',
          connections: [
            {
              id: ID_FMT_PG,
              profileId: PERFIL,
              alias: 'PG-FORMATO',
              motor: 'postgres',
              host: '127.0.0.1',
              port: 5432,
              database: 'postgres',
              user: 'postgres',
              readonly: true
            },
            { ...AJENA_EN_DISCO, id: ID_FMT_AJENA }
          ]
        },
        null,
        2
      ) + '\n'
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
            settings: {
              defaultProjectMode: 'windows',
              windowsModeProjects: [clave],
              dbMountsByProject: { [clave]: montadas }
            }
          })
        )
        writeFileSync(join(datos, 'db-connections.json'), registroSembrado)
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('(F1) enseña el aviso en el selector del agente, el árbol y el área, y NO poda los montajes', async () => {
    const win = s!.win
    const datos = s!.datos

    // (a) El SELECTOR «Bases montadas» del agente del proyecto: el aviso, no «Este perfil
    // no tiene conexiones». Y el badge del botón, que cuenta los montajes EN MEMORIA,
    // sigue en tres: la poda de arranque no se los llevó.
    const pane = win.locator('.right-panel .agent-pane:not(.hidden)')
    const boton = pane.locator('.db-mount-btn')
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await boton.click()
    const pop = pane.locator('.db-mount-pop')
    const avisoPop = pop.locator('.db-mount-aviso')
    await expect(avisoPop, 'el selector no enseña el aviso del formato ajeno').toBeVisible({ timeout: 15_000 })
    await expect(avisoPop).toContainText(TITULO_FORMATO)
    await expect(avisoPop, 'el aviso no nombra el archivo (es el del main)').toContainText('db-connections.json')
    await expect(avisoPop).toContainText('se conservan')
    await expect(pop, 'el selector dice que el perfil no tiene conexiones, que es falso').not.toContainText('no tiene conexiones')
    await expect(
      boton.locator('.db-mount-badge'),
      'la poda de arranque desmontó las bases del proyecto (tomó las listas vacías por buenas)'
    ).toHaveText(String(montadas.length))
    await pop.getByRole('button', { name: 'Cerrar' }).click()
    await expect(pop).toHaveCount(0)

    // (b) El ÁRBOL: el aviso persistente en vez de «Sin conexiones», y el alta apagada
    // con su porqué (el main la rechazaría).
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    const arbol = win.locator('.db-arbol')
    const avisoArbol = arbol.locator('.db-arbol-formato')
    await expect(avisoArbol, 'el árbol no enseña el aviso del formato ajeno').toBeVisible({ timeout: 15_000 })
    await expect(avisoArbol).toContainText(TITULO_FORMATO)
    await expect(avisoArbol).toContainText('db-connections.json')
    await expect(avisoArbol).toContainText('no se pierde nada')
    await expect(arbol, 'el árbol dice «Sin conexiones», que es falso').not.toContainText('Sin conexiones')
    const nueva = arbol.getByRole('button', { name: 'Nueva conexión', exact: true })
    await expect(nueva, '«Nueva conexión» se ofrece como si nada').toBeDisabled()
    // El `has:` de Playwright busca DENTRO del envoltorio: el localizador interior no puede
    // arrancar en `.db-arbol` (el envoltorio no la contiene), así que va sin raíz.
    await expect(
      arbol.locator('.btn-envoltura').filter({ has: win.getByRole('button', { name: 'Nueva conexión', exact: true }) })
    ).toHaveAttribute('title', MOTIVO_FORMATO)
    // La causa la dice el aviso del main, que en este bloque es el del FORMATO.
    await expect(avisoArbol).toContainText('no reconoce el formato')

    // (c) El ÁREA vacía: el mismo aviso, y sin el botón de alta.
    const area = win.locator('.db-area:not(.hidden)')
    await expect(area.locator('.pane-empty-title')).toHaveText(TITULO_FORMATO)
    await expect(area).toContainText('db-connections.json')
    await expect(area).toContainText('no se pierde nada')
    await expect(area.getByRole('button', { name: 'Nueva conexión…' })).toHaveCount(0)

    // (d) EL DISCO: los tres montajes siguen en `workspace-state.json` (también el que no
    // existe ni en el archivo), y el registro no se tocó.
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect(
      montajesEnDisco(datos)[clave] ?? [],
      'la poda de arranque desmontó y GUARDÓ: al volver a leerse el registro, los montajes ya no estarían'
    ).toEqual(montadas)
    expect(readFileSync(join(datos, 'db-connections.json'), 'utf8'), 'el registro de formato ajeno se reescribió').toBe(
      registroSembrado
    )
  })

  // (F2) EL CONTEXTO DEL AGENTE DE DATOS (`CLAUDE.md` del espacio del perfil).
  // Se regenera con la lista del main, y con la lista vacía escribía en disco
  // «ninguna configurada todavía» y «Ninguna de este perfil está marcada como de
  // PRODUCCIÓN»: la misma mentira que el «Sin conexiones» del árbol, dicha a quien escribe
  // por `tdb`. Aquí se pide el espacio por el mismo canal que la app y se lee el archivo.
  // No depende de (F1): solo necesita la app arrancada.
  test('(F2) el contexto del agente de datos dice que no puede leer el catálogo, no que esté vacío', async () => {
    const win = s!.win
    await win.evaluate(async (perfil) => {
      await window.tessera.db.ensureWorkspace(perfil, 'Personal')
    }, PERFIL)
    const archivo = join(s!.datos, 'conexiones', PERFIL, 'CLAUDE.md')
    await expect.poll(() => existsSync(archivo), { timeout: 10_000 }).toBe(true)
    const plano = readFileSync(archivo, 'utf8').replace(/\s+/g, ' ')
    expect(plano, 'no dice que no puede leer el catálogo').toContain('Tessera no puede leer el catálogo de este perfil')
    expect(plano, 'no cita el aviso del main (el que nombra el archivo)').toContain('db-connections.json')
    expect(plano, 'dice que el perfil no tiene conexiones, que es falso').not.toContain('ninguna configurada')
    expect(plano, 'afirma que ninguna es de PRODUCCIÓN, sin poder saberlo').not.toContain(
      'Ninguna de este perfil está marcada como de PRODUCCIÓN'
    )
  })
})

// =============================================================================
// UN REGISTRO QUE NO SE PUEDE LEER Y SIN `.bak` (ver la cabecera).
// =============================================================================

const ID_ROTO_PG = 'e2e-roto-pg'
/** El comienzo del aviso de un JSON roto (`mensajeRegistroIlegible` del main). */
const AVISO_ROTO = 'No se puede leer el registro de conexiones (db-connections.json): no es JSON válido'

test.describe('explorador de BD: un registro que no se puede leer y sin .bak', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let clave = ''
  let registroRoto = ''

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    clave = `${PERFIL}|${proyecto}`
    // Una edición a mano con una COMA DE MÁS detrás de la última conexión: el caso de
    // manual. Sin `.bak` (nunca hubo una escritura de Tessera que lo dejara). Antes se
    // tomaba por un registro vacío y escribible, y la primera escritura lo sustituía.
    const pg = {
      id: ID_ROTO_PG,
      profileId: PERFIL,
      alias: 'PG-A-MANO',
      motor: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      readonly: true
    }
    registroRoto = `{\n  "version": 1,\n  "connections": [\n    ${JSON.stringify(pg)},\n  ]\n}\n`
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
            settings: {
              defaultProjectMode: 'windows',
              windowsModeProjects: [clave],
              dbMountsByProject: { [clave]: [ID_ROTO_PG] }
            }
          })
        )
        writeFileSync(join(datos, 'db-connections.json'), registroRoto)
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('(I1) enseña su aviso y el archivo queda byte a byte, también tras intentar un alta', async () => {
    const win = s!.win
    const datos = s!.datos
    const principal = join(datos, 'db-connections.json')
    const respaldo = `${principal}.bak`

    // (a) Recién arrancada: ni el principal cambió ni apareció un `.bak` (que sería la
    // señal de que algo escribió encima).
    expect(readFileSync(principal, 'utf8'), 'el registro roto se reescribió al arrancar').toBe(registroRoto)
    expect(existsSync(respaldo), 'apareció un .bak: alguien escribió el registro').toBe(false)

    // (b) El ÁRBOL: el aviso del main (qué no se pudo leer y qué hacer), con el título que
    // no afirma ninguna causa, y el alta apagada.
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    const arbol = win.locator('.db-arbol')
    const avisoArbol = arbol.locator('.db-arbol-formato')
    await expect(avisoArbol, 'el árbol no enseña el aviso del registro ilegible').toBeVisible({ timeout: 15_000 })
    await expect(avisoArbol).toContainText(TITULO_FORMATO)
    await expect(avisoArbol).toContainText(AVISO_ROTO)
    await expect(avisoArbol).toContainText('corrígelo')
    await expect(avisoArbol, 'el aviso manda a actualizar Tessera por una coma de más').not.toContainText('versión más nueva')
    await expect(arbol, 'el árbol dice «Sin conexiones», que es falso').not.toContainText('Sin conexiones')
    const nueva = arbol.getByRole('button', { name: 'Nueva conexión', exact: true })
    await expect(nueva, '«Nueva conexión» se ofrece como si nada').toBeDisabled()
    await expect(
      arbol.locator('.btn-envoltura').filter({ has: win.getByRole('button', { name: 'Nueva conexión', exact: true }) })
    ).toHaveAttribute('title', MOTIVO_FORMATO)

    // (c) El ÁREA vacía: el mismo aviso, sin el botón de alta.
    const area = win.locator('.db-area:not(.hidden)')
    await expect(area.locator('.pane-empty-title')).toHaveText(TITULO_FORMATO)
    await expect(area).toContainText(AVISO_ROTO)
    await expect(area.getByRole('button', { name: 'Nueva conexión…' })).toHaveCount(0)

    // (d) Una escritura de verdad, por el canal del diálogo: el alta falla con el aviso.
    // Era la primera escritura la que sustituía el archivo.
    const alta = await win.evaluate(async (perfil) => {
      try {
        await window.tessera.db.create({
          profileId: perfil,
          alias: 'NUEVA',
          motor: 'postgres',
          host: '127.0.0.1',
          port: 5432,
          database: 'postgres',
          user: 'postgres',
          readonly: true
        })
        return 'CREÓ'
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    }, PERFIL)
    expect(alta, 'el alta sobre un registro ilegible no falló, o no dijo por qué').toContain(AVISO_ROTO)

    // (e) Y tras el margen: el archivo sigue byte a byte, sin `.bak`, y el montaje del
    // proyecto no se podó (con el registro bloqueado no se poda nada).
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect(readFileSync(principal, 'utf8'), 'el registro roto se reescribió').toBe(registroRoto)
    expect(existsSync(respaldo), 'apareció un .bak: alguien escribió el registro').toBe(false)
    expect(montajesEnDisco(datos)[clave] ?? [], 'la poda desmontó la base de un registro que no pudo leer').toEqual([
      ID_ROTO_PG
    ])
  })
})

// =============================================================================
// UN REGISTRO ROTO CON UN `.bak` LEGIBLE: se rescata y el roto se guarda APARTE (ver la cabecera).
// =============================================================================

const ID_RESCATE_PG = 'e2e-rescate-pg'
const ALIAS_RESCATE = 'PG-DEL-BAK'
/** El título del aviso de `useConexionesBd` (una prueba de interfaz no importa el renderer). */
const TITULO_RECUPERADO = 'Conexiones recuperadas de la copia de respaldo'

/** Lo que el observador del beforeAll apunta de cada aviso de recuperación que aparece. */
interface AvisosVistos {
  titulos: number
  detalles: string[]
}

test.describe('explorador de BD: un registro roto con un .bak legible', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let registroRoto: Buffer = Buffer.alloc(0)

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    const clave = `${PERFIL}|${proyecto}`
    const pg = {
      id: ID_RESCATE_PG,
      profileId: PERFIL,
      alias: ALIAS_RESCATE,
      motor: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      readonly: true
    }
    // El `.bak` que dejó la última escritura buena de Tessera, y el principal que el usuario
    // tocó a mano después: una coma de más, con CRLF y una «ñ» (lo que hay que conservar
    // byte a byte, no «más o menos»).
    registroRoto = Buffer.from(
      `{\r\n  "version": 1,\r\n  "connections": [\r\n    ${JSON.stringify({ ...pg, alias: 'PG-EDITADA-A-MANO-ñ' })},\r\n  ]\r\n}\r\n`,
      'utf8'
    )
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
            settings: {
              defaultProjectMode: 'windows',
              windowsModeProjects: [clave],
              dbMountsByProject: { [clave]: [ID_RESCATE_PG] }
            }
          })
        )
        writeFileSync(join(datos, 'db-connections.json'), registroRoto)
        writeFileSync(join(datos, 'db-connections.json.bak'), JSON.stringify({ version: 1, connections: [pg] }, null, 2))
      }
    })
    // El aviso vive siete segundos y sale en cuanto el renderer lee el registro, así que no
    // se puede esperar a verlo: se APUNTA desde ya cada uno que aparece (los que ya estén y
    // los que vengan). `abrirTessera` vuelve con la barra de título pintada, antes de que
    // ningún aviso haya podido irse. Un nodo se cuenta una vez aunque React lo mueva.
    await s.win.evaluate((titulo) => {
      const w = window as unknown as { __avisosRecuperado?: { titulos: number; detalles: string[] } }
      const vistos = new WeakSet<Element>()
      const registro = { titulos: 0, detalles: [] as string[] }
      w.__avisosRecuperado = registro
      const mirar = (el: Element): void => {
        for (const t of el.matches('.toast') ? [el] : Array.from(el.querySelectorAll('.toast'))) {
          if (vistos.has(t)) continue
          vistos.add(t)
          if (t.querySelector('.toast-title')?.textContent !== titulo) continue
          registro.titulos++
          registro.detalles.push(t.querySelector('.toast-detail')?.textContent ?? '')
        }
      }
      mirar(document.body)
      new MutationObserver((cambios) => {
        for (const c of cambios) for (const n of Array.from(c.addedNodes)) if (n instanceof Element) mirar(n)
      }).observe(document.body, { childList: true, subtree: true })
    }, TITULO_RECUPERADO)
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  test('(R1) usa las del .bak, lo avisa una vez, y la primera escritura guarda el roto aparte byte a byte', async () => {
    const win = s!.win
    const datos = s!.datos
    const principal = join(datos, 'db-connections.json')
    const aparte = `${principal}.ilegible`
    const avisos = (): Promise<AvisosVistos> =>
      win.evaluate(() => (window as unknown as { __avisosRecuperado: AvisosVistos }).__avisosRecuperado)

    // (a) EL AVISO, una vez, con lo que pasó y dónde va a quedar el archivo dañado.
    await expect
      .poll(async () => (await avisos()).titulos, { timeout: 30_000, message: 'no apareció el aviso de la recuperación' })
      .toBe(1)
    const [detalle] = (await avisos()).detalles
    expect(detalle, 'el aviso no dice que el archivo no es JSON').toContain('no es JSON válido')
    expect(detalle, 'el aviso no nombra la copia de respaldo').toContain('db-connections.json.bak')
    expect(detalle, 'el aviso no dice dónde va a quedar el archivo dañado').toContain('db-connections.json.ilegible')

    // (b) LEER NO TOCA NADA: el principal sigue byte a byte y aún no hay copia.
    expect(readFileSync(principal).equals(registroRoto), 'el principal roto se reescribió al arrancar').toBe(true)
    expect(existsSync(aparte), 'la copia aparte apareció sin ninguna escritura').toBe(false)

    // (c) EL ÁRBOL: la conexión del `.bak`, sin el aviso de registro bloqueado.
    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(fila(win, 'conexion', ALIAS_RESCATE), 'no se ven las conexiones del .bak').toHaveCount(1, { timeout: 15_000 })
    await expect(win.locator('.db-arbol .db-arbol-formato'), 'el registro rescatado se trató como bloqueado').toHaveCount(0)

    // (d) UNA ESCRITURA de verdad, por el canal del diálogo.
    const alta = await win.evaluate(async (perfil) => {
      try {
        await window.tessera.db.create({
          profileId: perfil,
          alias: 'NUEVA',
          motor: 'postgres',
          host: '127.0.0.1',
          port: 5432,
          database: 'postgres',
          user: 'postgres',
          readonly: true
        })
        return 'CREÓ'
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    }, PERFIL)
    expect(alta, 'el alta sobre el registro rescatado falló').toBe('CREÓ')

    // (e) La copia APARTE, con los bytes del roto, y el principal ya es JSON con las dos.
    expect(existsSync(aparte), 'la escritura no guardó el roto aparte').toBe(true)
    expect(readFileSync(aparte).equals(registroRoto), 'la copia aparte no es byte a byte el archivo roto').toBe(true)
    const alias = leerRegistro(datos).connections.map((c) => c.alias)
    expect(alias, 'el principal no quedó con las del .bak más el alta').toEqual([ALIAS_RESCATE, 'NUEVA'])

    // (f) El `db:changed` de esa escritura recarga el árbol (se ve la nueva) y NO repite el aviso.
    await expect(fila(win, 'conexion', 'NUEVA'), 'el árbol no se recargó tras el alta').toHaveCount(1, { timeout: 15_000 })
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect((await avisos()).titulos, 'el aviso de la recuperación se repitió con el db:changed').toBe(1)
  })
})

// =============================================================================
// DOS ENTRADAS CON EL MISMO ID (ver la cabecera).
// =============================================================================

/** El id que comparten las tres entradas del registro sembrado. */
const ID_REP = 'e2e-rep-pg'
const ALIAS_REP = 'PG-ORIGINAL'
/** La copia pegada a mano de la original: misma forma, mismo id, otro alias y otro host. */
const ALIAS_COPIA = 'PG-COPIA'
/** Una ajena de motor que comparte también el id. */
const ALIAS_REP_AJENA = 'SQLS-MISMO-ID'
/** Montada pero sin entrada: la poda de arranque la quita (es la señal de que corrió). */
const ID_REP_BORRADA = 'e2e-rep-borrada'
/** `textoAjena` de la copia (una prueba de interfaz no importa el renderer). */
const TEXTO_COPIA = `Comparte el identificador con «${ALIAS_REP}»`

test.describe('explorador de BD: dos entradas del registro con el mismo id', () => {
  test.describe.configure({ mode: 'serial' })
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let clave = ''
  /** La original tal como se sembró: tiene que salir del archivo IDÉNTICA tras cada borrado. */
  const ORIGINAL = {
    id: ID_REP,
    profileId: PERFIL,
    alias: ALIAS_REP,
    motor: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    readonly: true,
    orden: 0
  }

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    clave = `${PERFIL}|${proyecto}`
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
            settings: {
              defaultProjectMode: 'windows',
              windowsModeProjects: [clave],
              dbMountsByProject: { [clave]: [ID_REP, ID_REP_BORRADA] }
            }
          })
        )
        // Nada que abrir: la original no se conecta en ningún momento (su host no importa).
        writeFileSync(
          join(datos, 'db-connections.json'),
          JSON.stringify(
            {
              version: 1,
              connections: [
                ORIGINAL,
                { ...AJENA_EN_DISCO, id: ID_REP, alias: ALIAS_REP_AJENA, orden: 1 },
                { ...ORIGINAL, alias: ALIAS_COPIA, host: 'otra-maquina.invalid', orden: 2 }
              ]
            },
            null,
            2
          ) + '\n'
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

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (D1) LA COPIA sale atenuada con SU porqué (no «cómo está guardada», que es lo que diría
  // por su motor), cada ajena del mismo id en su fila, y el montaje del id sigue: es de la
  // original.
  test('(D1) la copia sale atenuada diciendo con quién comparte el id, y el montaje sigue', async () => {
    const win = s!.win
    const datos = s!.datos
    await expect
      .poll(() => montajesEnDisco(datos)[clave] ?? [], { timeout: 30_000, message: 'la poda de arranque no llegó a correr' })
      .not.toContain(ID_REP_BORRADA)
    expect(montajesEnDisco(datos)[clave], 'la poda se llevó el montaje del id que comparten').toContain(ID_REP)

    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    const copia = fila(win, 'ajena', ALIAS_COPIA)
    await expect(copia, 'la copia no sale como ajena (era una segunda conocida con el mismo id)').toHaveCount(1, { timeout: 15_000 })
    await expect(fila(win, 'conexion', ALIAS_REP)).toHaveCount(1)
    await expect(fila(win, 'conexion', ALIAS_COPIA), 'la copia sigue saliendo como conexión que se puede abrir').toHaveCount(0)
    await expect(copia).toContainText(TEXTO_COPIA)
    await expect(copia, 'el tooltip no explica por qué').toHaveAttribute('title', /no puede distinguirlas/)
    await expect(copia).not.toContainText('cómo está guardada')
    // Las dos ajenas del mismo id, cada una en su fila (antes compartían la clave).
    await expect(fila(win, 'ajena', ALIAS_REP_AJENA)).toHaveCount(1)
    await expect(fila(win, 'ajena', ALIAS_REP_AJENA)).toContainText(TEXTO_AJENA)
    expect(await tiposDeFilas(win)).toEqual(['conexion', 'ajena', 'ajena'])
  })

  // (D2) ELIMINAR LA COPIA: el diálogo dice que la original comparte el identificador y no se
  // toca; se va solo la copia, del árbol y del disco; la original sigue en el árbol, byte a
  // byte en el disco y MONTADA en el proyecto.
  test('(D2) eliminar la copia no toca la original: ni en el árbol, ni en el disco, ni su montaje', async () => {
    const win = s!.win
    const datos = s!.datos
    const copia = fila(win, 'ajena', ALIAS_COPIA)
    await copia.click({ button: 'right' })
    await elegirDelMenu(win, 'Eliminar conexión…')
    const dialogo = win.getByRole('dialog', { name: 'Eliminar conexión' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText(`«${ALIAS_COPIA}»`)
    await expect(dialogo).toContainText(TEXTO_COPIA)
    await expect(dialogo, 'el diálogo no dice que la original comparte el identificador').toContainText(
      `«${ALIAS_REP}» comparte su identificador y no se toca`
    )
    await expect(dialogo, 'el diálogo anuncia un desmontaje que no va a pasar').not.toContainText('Se desmontará')
    await dialogo.getByRole('button', { name: 'Eliminar', exact: true }).click()

    await expect(copia).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS_REP)).toHaveCount(1)
    await expect(fila(win, 'ajena', ALIAS_REP_AJENA)).toHaveCount(1)
    await expect
      .poll(() => leerRegistro(datos).connections.map((c) => c.alias), { message: 'la copia sigue en el registro' })
      .toEqual([ALIAS_REP, ALIAS_REP_AJENA])
    expect(leerRegistro(datos).connections[0], 'eliminar la copia tocó la original en el disco').toEqual(ORIGINAL)
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect(montajesEnDisco(datos)[clave] ?? [], 'eliminar la copia desmontó la original').toEqual([ID_REP])
  })

  // (D3) Y la AJENA DE MOTOR que comparte el id:
  // lo mismo, con el mismo aviso en el diálogo.
  test('(D3) eliminar la ajena de motor del mismo id tampoco toca la original ni su montaje', async () => {
    const win = s!.win
    const datos = s!.datos
    const ajena = fila(win, 'ajena', ALIAS_REP_AJENA)
    await ajena.click()
    await win.keyboard.press(PLATAFORMA === 'mac' ? 'Meta+Backspace' : 'Delete')
    const dialogo = win.getByRole('dialog', { name: 'Eliminar conexión' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText(`«${ALIAS_REP}» comparte su identificador y no se toca`)
    await dialogo.getByRole('button', { name: 'Eliminar', exact: true }).click()

    await expect(ajena).toHaveCount(0)
    await expect(fila(win, 'conexion', ALIAS_REP)).toHaveCount(1)
    expect(await tiposDeFilas(win)).toEqual(['conexion'])
    await expect
      .poll(() => leerRegistro(datos).connections.map((c) => c.alias), { message: 'la ajena sigue en el registro' })
      .toEqual([ALIAS_REP])
    expect(leerRegistro(datos).connections[0]).toEqual(ORIGINAL)
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect(montajesEnDisco(datos)[clave] ?? [], 'eliminar la ajena desmontó la original').toEqual([ID_REP])
  })
})

// =============================================================================
// LA COPIA DE OTRO PERFIL (ver la cabecera).
// =============================================================================

/** El perfil de la ORIGINAL; el activo ('personal') tiene la copia. */
const PERFIL_OTRO = 'otro'
const ID_CRUZADA = 'e2e-cruzada-pg'
const ALIAS_CRUZADA = 'PG-DE-OTRO-PERFIL'
const ALIAS_COPIA_CRUZADA = 'PG-COPIA-AQUI'
/** `textoAjena` de una copia cuya original es de otro perfil (sin nombrarla). */
const TEXTO_COPIA_CRUZADA = 'Comparte el identificador con una conexión de otro perfil'
/**
 * Una consola de cada perfil atada al id: la de ESTE perfil es
 * de la copia y tiene que irse con ella; la del otro es de la original y se queda. VACÍAS a
 * propósito: una vacía se borra sin más (`ConsolasStore.eliminarArchivo`), y una con texto iría
 * a la papelera DE VERDAD del equipo, que el e2e no debe tocar.
 */
const CONSOLA_COPIA = { id: 'e2e-consola-copia', nombre: 'consola-de-la-copia' }
const CONSOLA_ORIGINAL = { id: 'e2e-consola-original', nombre: 'consola-de-la-original' }

/** Las consolas de un perfil en disco (`<userData>/conexiones/<perfil>/consolas`): su índice y si está su archivo. */
function consolasEnDisco(datos: string, perfil: string): Array<{ id: string; conexionId: string; archivo: boolean }> {
  const carpeta = join(datos, 'conexiones', perfil, 'consolas')
  const indice = join(carpeta, 'indice.json')
  if (!existsSync(indice)) return []
  const doc = JSON.parse(readFileSync(indice, 'utf8')) as { consolas?: Array<{ id: string; conexionId: string; nombre: string }> }
  return (doc.consolas ?? []).map((c) => ({ id: c.id, conexionId: c.conexionId, archivo: existsSync(join(carpeta, `${c.nombre}.sql`)) }))
}

/** Siembra una consola VACÍA de `perfil` atada a `conexionId`, con su índice y su archivo. */
function sembrarConsola(datos: string, perfil: string, conexionId: string, c: { id: string; nombre: string }): void {
  const carpeta = join(datos, 'conexiones', perfil, 'consolas')
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(join(carpeta, 'indice.json'), JSON.stringify({ version: 1, consolas: [{ ...c, conexionId, creadaEn: 1 }] }, null, 2) + '\n')
  writeFileSync(join(carpeta, `${c.nombre}.sql`), '')
}

test.describe('explorador de BD: eliminar la copia de una conexión de otro perfil', () => {
  let s: SesionTessera | null = null
  let falso: AgenteFalso | null = null
  let claveAqui = ''
  let claveOtro = ''
  const ORIGINAL_OTRO = {
    id: ID_CRUZADA,
    profileId: PERFIL_OTRO,
    alias: ALIAS_CRUZADA,
    motor: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    readonly: true,
    orden: 0
  }

  test.beforeAll(async () => {
    const agente = montarAgenteFalso()
    falso = agente
    const proyecto = crearProyecto(agente.raiz)
    // El proyecto del otro perfil no se abre: sus montajes se conservan igual (la poda no
    // toca los de proyectos cerrados), y son los que el borrado no puede llevarse.
    const proyectoOtro = join(agente.raiz, 'proyecto-otro-perfil')
    mkdirSync(proyectoOtro, { recursive: true })
    claveAqui = `${PERFIL}|${proyecto}`
    claveOtro = `${PERFIL_OTRO}|${proyectoOtro}`
    s = await abrirTessera(agente.env, {
      sembrar: (datos) => {
        const perfiles = JSON.parse(PERFILES_SIN_SANDBOX) as Array<Record<string, unknown>>
        perfiles.push({
          id: PERFIL_OTRO,
          nombre: 'Otro',
          color: '#1478c8',
          agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${PERFIL_OTRO}/claude` }],
          sandbox: { habilitado: false }
        })
        writeFileSync(join(datos, 'profiles.json'), JSON.stringify(perfiles))
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
            settings: {
              defaultProjectMode: 'windows',
              windowsModeProjects: [claveAqui],
              // El MISMO id montado en un proyecto de cada perfil.
              dbMountsByProject: { [claveAqui]: [ID_CRUZADA], [claveOtro]: [ID_CRUZADA] }
            }
          })
        )
        // La original (del otro perfil) va primero: es la conocida del id; la copia pegada
        // en este perfil es ajena.
        writeFileSync(
          join(datos, 'db-connections.json'),
          JSON.stringify(
            {
              version: 1,
              connections: [ORIGINAL_OTRO, { ...ORIGINAL_OTRO, profileId: PERFIL, alias: ALIAS_COPIA_CRUZADA, host: 'otra-maquina.invalid' }]
            },
            null,
            2
          ) + '\n'
        )
        sembrarConsola(datos, PERFIL, ID_CRUZADA, CONSOLA_COPIA)
        sembrarConsola(datos, PERFIL_OTRO, ID_CRUZADA, CONSOLA_ORIGINAL)
      }
    })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await s?.cerrar()
    if (falso) await borrarTemporal(falso.raiz)
  })

  // (G1) Eliminar la copia de este perfil: el diálogo anuncia el desmontaje EN ESTE PERFIL y que
  // la del otro no se toca; al confirmar, el id se desmonta del proyecto de este perfil EN EL
  // ACTO (antes, hasta el siguiente arranque: el olvido era de todos los perfiles y en este caso
  // no se llamaba) y el del otro perfil sigue montado, con su original byte a byte en disco.
  // Lo que solo la app entera demuestra: que `App` pasa el PERFIL de la fila al olvido
  // (`alEliminarConexion(id, perfil)`, dos textos que el compilador no distingue).
  test('(G1) eliminar la copia la desmonta de ESTE perfil al momento y no toca la del otro', async () => {
    const win = s!.win
    const datos = s!.datos
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect(montajesEnDisco(datos)[claveAqui] ?? [], 'la poda de arranque se llevó el montaje de la copia (es ajena: cuenta como viva)').toEqual([ID_CRUZADA])
    expect(montajesEnDisco(datos)[claveOtro] ?? [], 'la poda de arranque se llevó el montaje del otro perfil').toEqual([ID_CRUZADA])
    // La prueba vale: las dos consolas sembradas siguen ahí antes de borrar (nada las poda al
    // arrancar), así que lo que falte después lo quitó el borrado.
    expect(consolasEnDisco(datos, PERFIL), 'la consola de la copia no llegó al arranque').toEqual([
      { id: CONSOLA_COPIA.id, conexionId: ID_CRUZADA, archivo: true }
    ])
    expect(consolasEnDisco(datos, PERFIL_OTRO), 'la consola de la original no llegó al arranque').toEqual([
      { id: CONSOLA_ORIGINAL.id, conexionId: ID_CRUZADA, archivo: true }
    ])

    await aLaVista(win)
    await win.locator('.activity-item[title="Conexiones a bases de datos"]').click()
    await expect(win.locator('.db-area:not(.hidden)')).toBeVisible()
    const copia = fila(win, 'ajena', ALIAS_COPIA_CRUZADA)
    await expect(copia).toHaveCount(1, { timeout: 15_000 })
    await expect(copia).toContainText(TEXTO_COPIA_CRUZADA)
    await copia.click({ button: 'right' })
    await elegirDelMenu(win, 'Eliminar conexión…')
    const dialogo = win.getByRole('dialog', { name: 'Eliminar conexión' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText('Se desmontará de los proyectos de este perfil donde la tuvieras.')
    await expect(dialogo).toContainText(`Su consola «${CONSOLA_COPIA.nombre}» irá a la papelera.`)
    await expect(dialogo, 'el diálogo cuenta la consola del otro perfil').not.toContainText(CONSOLA_ORIGINAL.nombre)
    await expect(dialogo).toContainText('La conexión de otro perfil que comparte su identificador no se toca: ni sus montajes ni sus consolas.')
    await expect(dialogo, 'el diálogo nombra la conexión del otro perfil').not.toContainText(ALIAS_CRUZADA)
    await dialogo.getByRole('button', { name: 'Eliminar', exact: true }).click()

    await expect(copia).toHaveCount(0)
    await expect
      .poll(() => leerRegistro(datos).connections, { message: 'la copia sigue en el registro' })
      .toEqual([ORIGINAL_OTRO])
    await expect
      .poll(() => montajesEnDisco(datos)[claveAqui] ?? [], {
        timeout: 15_000,
        message: 'el id sigue montado en el proyecto de este perfil (se quitaba al siguiente arranque)'
      })
      .toEqual([])
    // La mitad del MAIN: la consola de la copia se va con ella.
    // Solo la quita `onConexionOlvidadaEnPerfil`, que `main/index.ts` conecta a
    // `ExploradorController.alOlvidarConexionEnPerfil`; esa línea no la ejecuta ningún test
    // puro (la sección 18 de `test-registro-conexiones` reproduce el cableado, no lo importa),
    // así que borrarla dejaba toda la batería en verde. Aquí la consola seguiría en el índice.
    await expect
      .poll(() => consolasEnDisco(datos, PERFIL), {
        timeout: 15_000,
        message: 'la consola de la copia sigue en este perfil (¿está conectado onConexionOlvidadaEnPerfil en main/index.ts?)'
      })
      .toEqual([])
    expect(existsSync(join(datos, 'conexiones', PERFIL, 'consolas', `${CONSOLA_COPIA.nombre}.sql`)), 'su archivo sigue en disco').toBe(false)
    await asentar(win)
    await win.waitForTimeout(MARGEN_DISCO_MS)
    expect(montajesEnDisco(datos)[claveOtro] ?? [], 'eliminar la copia desmontó la original del OTRO perfil').toEqual([ID_CRUZADA])
    expect(consolasEnDisco(datos, PERFIL_OTRO), 'eliminar la copia se llevó la consola de la original del OTRO perfil').toEqual([
      { id: CONSOLA_ORIGINAL.id, conexionId: ID_CRUZADA, archivo: true }
    ])
  })
})
