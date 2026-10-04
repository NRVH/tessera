// =============================================================================
// La mitad del main de «productividad SQL» (parámetros, Explain, claves ajenas e historial)
// por la cadena entera de la app empaquetada —`window.tessera.dbExplorador` → IPC →
// controlador → gestor → proceso de sesión con serialización `advanced` → PostgreSQL de
// `postgresEfimero.ts`— sin pasar por la interfaz: el mismo Electron en los dos extremos,
// y el historial en `<userData>/db-historial` (PRIVADO de Tessera: nunca en el espacio de
// datos que lee el agente), que solo cablea `main/index.ts`. Nada depende del sistema.
// =============================================================================

import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { aLaVista, crearProyecto } from './consolaAyudas'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const CON_PARAMETRO = 'select nombre from public.profile where id = $1'

/** Todos los archivos de una carpeta, recursivo (rutas absolutas). */
function archivosDe(dir: string): string[] {
  if (!existsSync(dir)) return []
  const salida: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta))
    else salida.push(ruta)
  }
  return salida
}

test.describe.configure({ mode: 'serial' })

test.describe('explorador de BD: el main de la productividad SQL por la cadena entera', () => {
  let s: SesionTessera | null = null
  let pg: PostgresEfimero | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null
  let conexionId = ''
  let conexionRo = ''
  let consolaId = ''
  let consolaRo = ''

  test.beforeAll(async () => {
    const r = await arrancarPostgres()
    if (!r.ok) {
      if (r.fallo) throw new Error(r.motivo)
      motivoSalto = `sin PostgreSQL de pruebas: ${r.motivo}`
      return
    }
    pg = r.pg
    // Como los otros specs de conexiones: un proyecto nativo con un agente FALSO.
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

  test('(0) dos conexiones (escritura y solo lectura) y una consola en cada una', async () => {
    const win = s!.win
    await aLaVista(win)
    const p = pg!
    const crear = (alias: string, readonly: boolean): Promise<string> =>
      win.evaluate(
        async (c) =>
          (
            await window.tessera.db.create({
              profileId: 'personal',
              alias: c.alias,
              motor: 'postgres',
              host: c.host,
              port: c.port,
              database: 'postgres',
              user: 'postgres',
              password: c.password,
              readonly: c.readonly
            })
          ).id,
        { alias, host: p.host, port: p.port, password: p.password, readonly }
      )
    conexionId = await crear('PG-F2-BACKEND', false)
    conexionRo = await crear('PG-F2-BACKEND-RO', true)
    const nueva = (id: string): Promise<string> =>
      win.evaluate(async (a) => {
        const r = await window.tessera.dbExplorador.crearConsola(a.perfil, a.id)
        return r.ok ? r.valor.id : ''
      }, { perfil: PERFIL, id })
    consolaId = await nueva(conexionId)
    consolaRo = await nueva(conexionRo)
    expect(consolaId && consolaRo, 'las dos consolas').toBeTruthy()
  })

  test('(1) parámetros: los binds cruzan el IPC y el main es la autoridad', async () => {
    const win = s!.win
    const r = await win.evaluate(
      async (a) => {
        const api = window.tessera.dbExplorador
        const con = await api.ejecutar({ perfilId: a.perfil, consolaId: a.consola, ejecucionId: 'b1', sql: a.sql, maxFilas: 50, binds: { '1': '2' } })
        const sin = await api.ejecutar({ perfilId: a.perfil, consolaId: a.consola, ejecucionId: 'b2', sql: a.sql, maxFilas: 50 })
        return {
          filas: con.ok && con.valor.tipo === 'filas' ? (JSON.parse(con.valor.pagina.filasJson) as unknown[][]) : null,
          sin: sin.ok ? null : sin.error
        }
      },
      { perfil: PERFIL, consola: consolaId, sql: CON_PARAMETRO }
    )
    expect(r.filas, 'con $1 = 2 llega la fila de ese id').toEqual([['Analista']])
    expect(r.sin?.motivo, 'sin el valor: rechazado por el main').toBe('parametros')
    expect(r.sin?.parametros).toEqual(['1'])
  })

  test('(2) Explain: el plan llega entero y NO ejecuta, tampoco con la casilla de los agentes', async () => {
    const win = s!.win
    const r = await win.evaluate(
      async (a) => {
        const api = window.tessera.dbExplorador
        const plan = await api.explicar({ perfilId: a.perfil, consolaId: a.consola, ejecucionId: 'x1', sql: 'select * from public.profile p join public.module m on m.profile_id = p.id where p.id = $1', binds: { '1': '1' } })
        const antes = await api.ejecutar({ perfilId: a.perfil, consolaId: a.consolaRo, ejecucionId: 'c1', sql: 'select count(*) from public.profile', maxFilas: 1 })
        const ro = await api.explicar({ perfilId: a.perfil, consolaId: a.consolaRo, ejecucionId: 'x2', sql: 'delete from public.profile' })
        const despues = await api.ejecutar({ perfilId: a.perfil, consolaId: a.consolaRo, ejecucionId: 'c2', sql: 'select count(*) from public.profile', maxFilas: 1 })
        const estado = await api.estadoConsola(a.perfil, a.consolaRo)
        const cuenta = (x: typeof antes): string => (x.ok && x.valor.tipo === 'filas' ? String((JSON.parse(x.valor.pagina.filasJson) as unknown[][])[0]?.[0]) : '?')
        return {
          nodos: plan.ok ? plan.valor.nodos.length : -1,
          raiz: plan.ok ? plan.valor.nodos[0]?.padre : 'error',
          texto: plan.ok ? plan.valor.texto : '',
          ro: ro.ok ? ro.valor.nodos[0]?.operacion : ro.error.mensaje,
          antes: cuenta(antes),
          despues: cuenta(despues),
          tx: estado?.tx
        }
      },
      { perfil: PERFIL, consola: consolaId, consolaRo }
    )
    expect(r.nodos, 'el plan del join tiene varios pasos').toBeGreaterThan(1)
    expect(r.raiz, 'la raíz no tiene padre').toBeNull()
    expect(r.texto).toMatch(/cost=\d+\.\d\d\.\.\d+\.\d\d rows=\d+ width=\d+/)
    // La conexión «RO» tiene la casilla de los AGENTES (no limita al usuario):
    // Explain no ejecuta en ninguna, con casilla o sin ella.
    expect(r.ro, 'con la casilla de los agentes, un DELETE se explica').toBe('ModifyTable')
    expect(r.despues, 'y no se ejecutó').toBe(r.antes)
    expect(r.tx, 'la consola (en Auto) sigue sin transacción').toBe('ninguna')
  })

  test('(3) claves ajenas: profile recibe la de module', async () => {
    const win = s!.win
    const r = await win.evaluate(
      async (a) => {
        const rel = await window.tessera.dbExplorador.fks(a.id, { esquema: 'public', nombre: 'profile', tipo: 'tabla' })
        return rel.ok ? rel.valor : null
      },
      { id: conexionId }
    )
    expect(r).not.toBeNull()
    const entra = r!.entrantes.find((f) => f.desde.tabla === 'module')
    expect(entra?.desde.columnas).toEqual(['profile_id'])
    expect(entra?.hacia.columnas).toEqual(['id'])
  })

  test('(4) el historial es PRIVADO: en <userData>/db-historial y nada en el espacio de datos', async () => {
    const win = s!.win
    const datos = s!.datos
    const lista = await win.evaluate(async (perfil) => {
      const r = await window.tessera.dbExplorador.historial({ perfilId: perfil })
      return r.ok ? r.valor : []
    }, PERFIL)
    expect(lista.some((e) => e.sql === CON_PARAMETRO && e.resultado === 'ok'), 'lo ejecutado está, con $1 y no el valor').toBe(true)
    expect(lista.some((e) => /join public\.module/.test(e.sql)), 'el Explain no se anota').toBe(false)
    // El disco: un archivo por perfil en db-historial…
    const archivo = join(datos, 'db-historial', `${PERFIL}.jsonl`)
    await expect.poll(() => existsSync(archivo), { timeout: 10_000 }).toBe(true)
    expect(readFileSync(archivo, 'utf8')).toContain(CON_PARAMETRO)
    // … y ni rastro en el espacio de datos del perfil, que lee el agente.
    const espacio = join(datos, 'conexiones', PERFIL)
    const conHistoria = archivosDe(espacio).filter((ruta) => /historial|\.jsonl$/i.test(ruta) || readFileSync(ruta, 'utf8').includes('where id = $1'))
    expect(conHistoria, 'ningún archivo del espacio de datos tiene el historial').toEqual([])
    // Borrar todo: el archivo desaparece.
    const borrado = await win.evaluate(async (perfil) => (await window.tessera.dbExplorador.borrarHistorial(perfil, null)).ok, PERFIL)
    expect(borrado).toBe(true)
    await expect.poll(() => existsSync(archivo)).toBe(false)
  })
})
