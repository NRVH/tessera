// =============================================================================
// La mitad del main de «escribir con seguridad», por la cadena entera de la app empaquetada
// (`window.tessera.db` y `dbExplorador` → IPC → registro / controlador → gestor → proceso
// de sesión → PostgreSQL de `postgresEfimero.ts`) sin pasar por la interfaz: el entorno
// viaja y vuelve por el `ConnectionStore` real (importa electron), `DATOS_ENVIAR`, el
// `confirmado` de `CONSOLA_EJECUTAR` y el cuarto argumento de `CONSOLA_TX` cruzan el canal
// `advanced`, y el bloque de memoria del agente de datos nombra la conexión de producción.
// Nada depende del sistema (rutas con `join`, `userData` temporal de `abrirTessera`).
// =============================================================================

import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { aLaVista, crearProyecto } from './consolaAyudas'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

const PERFIL = 'personal'
const PK_ID = { tipo: 'pk' as const, columnas: ['id'] }
const PROFILE = { esquema: 'public', nombre: 'profile', tipo: 'tabla' as const }

test.describe.configure({ mode: 'serial' })

test.describe('explorador de BD: el main de la escritura por la cadena entera', () => {
  let s: SesionTessera | null = null
  let pg: PostgresEfimero | null = null
  let falso: AgenteFalso | null = null
  let motivoSalto: string | null = null
  let conexionId = ''
  let conexionProd = ''
  let conexionRo = ''

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

  test('(0) el ENTORNO de una conexión se guarda y vuelve por el registro real', async () => {
    const win = s!.win
    await aLaVista(win)
    const p = pg!
    const crear = (alias: string, readonly: boolean, entorno?: 'produccion'): Promise<string> =>
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
              readonly: c.readonly,
              ...(c.entorno ? { entorno: c.entorno } : {})
            })
          ).id,
        { alias, host: p.host, port: p.port, password: p.password, readonly, entorno }
      )
    conexionId = await crear('PG-F3', false)
    conexionProd = await crear('PG-F3-PROD', false, 'produccion')
    conexionRo = await crear('PG-F3-RO', true)
    const lista = await win.evaluate(async (perfil) => (await window.tessera.db.list(perfil)).map((c) => ({ id: c.id, entorno: c.entorno ?? null })), PERFIL)
    expect(lista.find((c) => c.id === conexionProd)?.entorno, 'la de producción lo conserva').toBe('produccion')
    expect(lista.find((c) => c.id === conexionId)?.entorno, 'sin entorno, nada').toBeNull()
    // Editar SOLO el entorno: vuelve el nuevo.
    const editada = await win.evaluate(
      async (c) =>
        (
          await window.tessera.db.update(c.id, {
            profileId: 'personal',
            alias: 'PG-F3',
            motor: 'postgres',
            host: c.host,
            port: c.port,
            database: 'postgres',
            user: 'postgres',
            readonly: false,
            entorno: 'pruebas'
          })
        ).entorno ?? null,
      { id: conexionId, host: p.host, port: p.port }
    )
    expect(editada, 'editar el entorno lo cambia').toBe('pruebas')
  })

  test('(1) la rejilla: identidad al abrir y «Enviar» TODO O NADA', async () => {
    const win = s!.win
    const r = await win.evaluate(
      async (a) => {
        const api = window.tessera.dbExplorador
        const tabla = await api.abrirTabla({ conexionId: a.id, peticionId: 'e2e-t1', objeto: a.objeto, maxFilas: 100 })
        const sinPk = await api.abrirTabla({ conexionId: a.id, peticionId: 'e2e-t2', objeto: { esquema: 'public', nombre: 'numeros', tipo: 'tabla' }, maxFilas: 100 })
        const bien = await api.enviarCambios({
          conexionId: a.id,
          peticionId: 'e2e-env1',
          objeto: a.objeto,
          identidad: a.pk,
          cambios: [
            { tipo: 'actualizar', clave: ['2'], valores: { nota: 'desde e2e' } },
            { tipo: 'insertar', valores: { id: '4', nombre: 'Nuevo' } },
            { tipo: 'borrar', clave: ['3'] }
          ]
        })
        const mal = await api.enviarCambios({
          conexionId: a.id,
          peticionId: 'e2e-env2',
          objeto: a.objeto,
          identidad: a.pk,
          cambios: [
            { tipo: 'actualizar', clave: ['1'], valores: { nota: 'no debe quedar' } },
            { tipo: 'actualizar', clave: ['99'], valores: { nota: 'no existe' } }
          ]
        })
        return {
          identidad: tabla.ok ? tabla.valor.identidad : null,
          noEditables: tabla.ok ? tabla.valor.noEditables : null,
          sinPk: sinPk.ok ? sinPk.valor.identidad?.tipo : null,
          bien: bien.ok ? bien.valor : bien.error,
          mal: mal.ok ? mal.valor : mal.error
        }
      },
      { id: conexionId, objeto: PROFILE, pk: PK_ID }
    )
    expect(r.identidad).toEqual(PK_ID)
    expect(r.noEditables, 'profile no tiene columnas que no se editen').toEqual([])
    expect(r.sinPk, 'sin PK ni UNIQUE NOT NULL: no se edita').toBe('ninguna')
    expect(r.bien).toMatchObject({ tipo: 'hecho', cambios: 3 })
    expect(pg!.psql("SELECT string_agg(id || ':' || coalesce(nota, 'NULL'), ',' ORDER BY id) FROM public.profile").out).toBe('1:NULL,2:desde e2e,4:NULL')
    expect(r.mal, 'el 2.º no toca ninguna fila').toMatchObject({ tipo: 'error', indice: 1, filas: 0 })
    expect(pg!.psql('SELECT coalesce(nota, $$NULL$$) FROM public.profile WHERE id = 1').out, '… y el 1.º no quedó').toBe('NULL')
  })

  test('(2) producción: la consola nace en Manual (sin sesión, null) y el main exige la confirmación', async () => {
    const win = s!.win
    const r = await win.evaluate(
      async (a) => {
        const api = window.tessera.dbExplorador
        const consola = await api.crearConsola(a.perfil, a.prod)
        const k = consola.ok ? consola.valor.id : ''
        const nacida = await api.estadoConsola(a.perfil, k)
        const sinConfirmar = await api.ejecutar({ perfilId: a.perfil, consolaId: k, ejecucionId: 'p1', sql: "update public.profile set nota = 'consola' where id = 1", maxFilas: 10 })
        const confirmada = await api.ejecutar({ perfilId: a.perfil, consolaId: k, ejecucionId: 'p2', sql: "update public.profile set nota = 'consola' where id = 1", maxFilas: 10, confirmado: true })
        const pendiente = await api.estadoConsola(a.perfil, k)
        const commitSin = await api.tx(a.perfil, k, 'commit')
        const commitCon = await api.tx(a.perfil, k, 'commit', true)
        const envSin = await api.enviarCambios({ conexionId: a.prod, peticionId: 'e2e-p1', objeto: a.objeto, identidad: a.pk, cambios: [{ tipo: 'actualizar', clave: ['2'], valores: { nota: 'rejilla' } }] })
        const envCon = await api.enviarCambios({ conexionId: a.prod, peticionId: 'e2e-p2', objeto: a.objeto, identidad: a.pk, cambios: [{ tipo: 'actualizar', clave: ['2'], valores: { nota: 'rejilla' } }], confirmado: true })
        return {
          nacida: nacida ? { txModo: nacida.txModo, fase: nacida.fase } : null,
          sinConfirmar: sinConfirmar.ok ? 'pasó' : sinConfirmar.error.motivo,
          confirmada: confirmada.ok,
          pendiente: pendiente ? { tx: pendiente.tx, txModo: pendiente.txModo } : null,
          commitSin: commitSin.ok ? 'pasó' : commitSin.error.motivo,
          commitCon: commitCon.ok ? commitCon.valor.tx : commitCon.error.mensaje,
          envSin: envSin.ok ? 'pasó' : envSin.error,
          envCon: envCon.ok ? envCon.valor.tipo : envCon.error.mensaje
        }
      },
      { perfil: PERFIL, prod: conexionProd, objeto: PROFILE, pk: PK_ID }
    )
    // sin sesión, `estadoConsola` es null. La barra pinta el Manual con el que
    // nacerá sobre la conexión VIVA (`modoTxInicial`); una sesión inventada por el main la
    // leía el renderer una vez al montar y se quedaba vieja si la conexión cambiaba.
    expect(r.nacida, 'sin sesión: null (nada inventado que se quede viejo)').toBeNull()
    expect(r.sinConfirmar, 'UPDATE sin confirmar: rechazado').toBe('produccion')
    expect(r.confirmada).toBe(true)
    expect(r.pendiente, 'la sesión nace en Manual: el UPDATE no se confirmó solo').toEqual({ tx: 'pendiente', txModo: 'manual' })
    expect(r.commitSin, 'el Commit sin confirmar: rechazado').toBe('produccion')
    expect(r.commitCon).toBe('ninguna')
    expect(pg!.psql('SELECT nota FROM public.profile WHERE id = 1').out).toBe('consola')
    expect(r.envSin).toMatchObject({ motivo: 'produccion' })
    expect((r.envSin as { mensaje: string }).mensaje).toContain('PG-F3-PROD')
    expect(r.envCon).toBe('hecho')
    expect(pg!.psql('SELECT nota FROM public.profile WHERE id = 2').out).toBe('rejilla')
  })

  // la casilla «Solo lectura» es de los AGENTES (`tdb`). Desde el explorador,
  // la tabla de una conexión con ella marcada tiene identidad y «Enviar» SE APLICA; se deja
  // el dato como estaba.
  test('(3) «Solo lectura para los agentes»: el explorador edita, con identidad y «Enviar» aplicado', async () => {
    const win = s!.win
    const antes = pg!.psql('SELECT nota FROM public.profile WHERE id = 1').out
    const enviar = (nota: string, peticionId: string) =>
      win.evaluate(
        async (a) => {
          const api = window.tessera.dbExplorador
          const env = await api.enviarCambios({ conexionId: a.ro, peticionId: a.peticionId, objeto: a.objeto, identidad: a.pk, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nota: a.nota } }] })
          return env.ok ? env.valor.tipo : env.error.motivo
        },
        { ro: conexionRo, objeto: PROFILE, pk: PK_ID, nota, peticionId }
      )
    const identidad = await win.evaluate(
      async (a) => {
        const tabla = await window.tessera.dbExplorador.abrirTabla({ conexionId: a.ro, peticionId: 'e2e-ro1', objeto: a.objeto, maxFilas: 100 })
        return tabla.ok ? tabla.valor.identidad?.tipo : null
      },
      { ro: conexionRo, objeto: PROFILE }
    )
    expect(identidad, 'la casilla de los agentes no quita la identidad').toBe('pk')
    expect(await enviar('desde RO de agentes', 'e2e-ro2')).toBe('hecho')
    expect(pg!.psql('SELECT nota FROM public.profile WHERE id = 1').out).toBe('desde RO de agentes')
    expect(await enviar(antes, 'e2e-ro3')).toBe('hecho')
    expect(pg!.psql('SELECT nota FROM public.profile WHERE id = 1').out).toBe(antes)
  })

  test('(4) el agente del espacio de datos sabe qué conexión es de PRODUCCIÓN', async () => {
    const win = s!.win
    await win.evaluate(async (perfil) => {
      await window.tessera.db.ensureWorkspace(perfil, 'Personal')
    }, PERFIL)
    const archivo = join(s!.datos, 'conexiones', PERFIL, 'CLAUDE.md')
    await expect.poll(() => existsSync(archivo), { timeout: 10_000 }).toBe(true)
    const texto = readFileSync(archivo, 'utf8')
    expect(texto).toContain('Son de PRODUCCIÓN: **PG-F3-PROD**')
    expect(texto.replace(/\s+/g, ' ')).toContain('No escribas en una conexión de PRODUCCIÓN salvo que el usuario te lo pida explícitamente')
    expect(texto, 'la de pruebas no sale como producción').not.toMatch(/Son de PRODUCCIÓN:[^\n]*PG-F3\*\*/)
  })
})
