// =============================================================================
// Ayudas de `conexiones-edicion.spec.ts`: arrancar Tessera con un PostgreSQL efímero y
// TRES conexiones a la misma base (normal, solo lectura y producción), abrir una tabla
// bajo la que toque y localizar lo que pinta la edición (editor, filas, barra, diálogo).
// Siembra propia: `personas` para editar; `lenta` (disparador que duerme en UPDATE) para
// un Stop; `confirmar` (disparador DIFERIDO que duerme en el COMMIT) para cortar la sesión
// con `pg_terminate_backend` (57P01, sesión PERDIDA). Reutiliza `rejillaAyudas.ts` y
// `consolaAyudas.ts`; con tres `public` en el árbol, cada paso busca bajo el anterior.
// =============================================================================

import { expect, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso, type AgenteFalso } from './agenteFalso'
import { crearProyecto } from './consolaAyudas'
import { arrancarPostgres, type PostgresEfimero } from './postgresEfimero'
import { botonVista, celda, desplegar, fila, filaTras, PANE, PESTANAS } from './rejillaAyudas'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

export const ALIAS_ESCRITURA = 'ED-ESCRITURA'
export const ALIAS_LECTURA = 'ED-LECTURA'
export const ALIAS_PRODUCCION = 'ED-PRODUCCION'

/** Segundos que duerme el disparador de `lenta`: de sobra para pulsar Detener. */
export const SUENO_LENTA = 30

export const SIEMBRA_EDICION = `
CREATE TABLE public.personas (
  id int PRIMARY KEY,
  nombre text NOT NULL,
  nota text
);
INSERT INTO public.personas VALUES (1, 'Ana', 'a'), (2, 'Bea', 'b'), (3, 'Carla', NULL);
CREATE TABLE public.lenta (id int PRIMARY KEY, v text);
INSERT INTO public.lenta VALUES (1, 'uno');
CREATE FUNCTION public.dormir() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(${SUENO_LENTA});
  RETURN NEW;
END $$;
CREATE TRIGGER lenta_dormir BEFORE UPDATE ON public.lenta FOR EACH ROW EXECUTE FUNCTION public.dormir();
CREATE TABLE public.confirmar (id int PRIMARY KEY, v text);
INSERT INTO public.confirmar VALUES (1, 'uno');
CREATE FUNCTION public.dormir_al_confirmar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(${SUENO_LENTA});
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER confirmar_dormir AFTER UPDATE ON public.confirmar
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.dormir_al_confirmar();
`

/**
 * El backend de Tessera que duerme DENTRO del COMMIT de `confirmar` (su disparador
 * diferido), para `pg_stat_activity`. Ni psql (su propia consulta) ni el Stop de `lenta`
 * (que duerme en un UPDATE, no en un COMMIT) casan con él.
 */
export const EN_COMMIT = "pid <> pg_backend_pid() AND wait_event = 'PgSleep' AND query ILIKE 'commit%'"

export interface EntornoEdicion {
  s: SesionTessera
  pg: PostgresEfimero
  cerrar: () => Promise<void>
}

/**
 * Levanta PostgreSQL con `SIEMBRA_EDICION` y Tessera con un proyecto y el agente falso,
 * entra en la vista de bases de datos y crea las TRES conexiones por la API del preload.
 * Sin Docker o sin la imagen devuelve el MOTIVO para saltar; si la siembra falla, lanza.
 */
export async function arrancarEdicion(): Promise<EntornoEdicion | { motivo: string }> {
  const r = await arrancarPostgres(SIEMBRA_EDICION)
  if (!r.ok) {
    if (r.fallo) throw new Error(r.motivo)
    return { motivo: `sin PostgreSQL de pruebas: ${r.motivo}` }
  }
  const pg = r.pg
  let falso: AgenteFalso | null = null
  let sesion: SesionTessera | null = null
  try {
    falso = montarAgenteFalso()
    const proyecto = crearProyecto(falso.raiz)
    const s = await abrirTessera(falso.env, {
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
    sesion = s
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1600, 1000)
    })
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
    await botonVista(s.win, 'Conexiones a bases de datos').click()
    await expect(s.win.locator('.db-area:not(.hidden)')).toBeVisible()
    for (const c of [
      { alias: ALIAS_ESCRITURA, readonly: false },
      { alias: ALIAS_LECTURA, readonly: true },
      { alias: ALIAS_PRODUCCION, readonly: false, entorno: 'produccion' as const }
    ]) {
      const creada = await s.win.evaluate(
        (a) =>
          window.tessera.db.create({
            profileId: 'personal',
            alias: a.alias,
            motor: 'postgres',
            host: a.host,
            port: a.port,
            database: 'postgres',
            user: 'postgres',
            password: a.password,
            readonly: a.readonly,
            ...(a.entorno ? { entorno: a.entorno } : {})
          }),
        { ...c, host: pg.host, port: pg.port, password: pg.password }
      )
      if (!creada.tieneSecreto) throw new Error(`la conexión ${c.alias} no guardó la contraseña`)
    }
    const raizFalso = falso.raiz
    return {
      s,
      pg,
      cerrar: async () => {
        await s.cerrar()
        pg.parar()
        await borrarTemporal(raizFalso)
      }
    }
  } catch (err) {
    await sesion?.cerrar()
    pg.parar()
    if (falso) await borrarTemporal(falso.raiz)
    throw err
  }
}

let marcas = 0

/** La pestaña de una tabla bajo una conexión (su texto lleva `[ALIAS]`). */
export function pestanaDe(win: Page, alias: string, tabla: string): Locator {
  return win.locator(PESTANAS).filter({ hasText: tabla }).filter({ hasText: `[${alias}]` })
}

/**
 * Abre `public.<tabla>` de la conexión `alias` desde el árbol (doble clic) y espera a su
 * primera celda. Cada paso busca solo dentro del subárbol del anterior.
 */
export async function abrirTabla(win: Page, alias: string, tabla: string): Promise<void> {
  const n = ++marcas
  const conexion = fila(win, 'conexion', alias)
  await desplegar(conexion)
  const esquema = await filaTras(win, conexion, 'esquema', `ed-esq-${n}`, 'public')
  await desplegar(esquema)
  const tablas = await filaTras(win, esquema, 'carpeta', `ed-tablas-${n}`, 'tablas')
  await desplegar(tablas)
  const objeto = await filaTras(win, tablas, 'objeto', `ed-obj-${n}`, tabla)
  await objeto.dblclick()
  await expect(pestanaDe(win, alias, tabla)).toHaveClass(/\bactive\b/)
  await expect(celda(win, 0, 0)).toBeVisible({ timeout: 30_000 })
}

/** Un botón de icono de la barra de la pestaña activa, por su nombre accesible. */
export function botonBarra(win: Page, etiqueta: string): Locator {
  return win.locator(`${PANE} .db-barra button[aria-label="${etiqueta}"]`)
}

/** El editor de celda abierto en la pestaña activa. */
export function editorCelda(win: Page): Locator {
  return win.locator(`${PANE} .db-celda-editor`)
}

/**
 * Espera a que la rejilla de la pestaña activa ADMITA edición. Mientras llega otro
 * resultado (Refrescar, filtrar, la relectura tras «Enviar») no la admite —la rejilla
 * sigue enseñando el resultado viejo y un cambio hecho ahí apuntaría a otra fila—, y un
 * doble clic en ese rato no abre nada. Tras un Refrescar la celda ya enseña el valor del
 * servidor (se descartaron los cambios) ANTES de que llegue el resultado nuevo: esperar
 * a su texto no basta.
 */
export async function esperarEditable(win: Page): Promise<void> {
  await expect(win.locator(`${PANE} .db-rejilla.editable`)).toHaveCount(1, { timeout: 30_000 })
}

/** Una fila de la rejilla de la pestaña activa por su posición (desde 0). */
export function filaRejilla(win: Page, f: number): Locator {
  return win.locator(`${PANE} .db-rejilla-fila[aria-rowindex="${f + 2}"]`)
}

/** El diálogo de «Enviar» (va por portal sobre <body>). */
export function dialogoEnvio(win: Page): Locator {
  return win.locator('.db-envio-modal')
}

/** El diálogo de confirmación abierto (ConfirmDialog), por su título. */
export function confirmacion(win: Page, titulo: string): Locator {
  return win.locator('.modal-card[role="dialog"]', { has: win.locator('.modal-title', { hasText: titulo }) })
}

/** Las líneas de la vista previa del SQL. */
export async function lineasEnvio(win: Page): Promise<string[]> {
  return dialogoEnvio(win)
    .locator('.db-envio-linea')
    .evaluateAll((ls) => ls.map((l) => (l.textContent ?? '').trim()))
}

/** Una consulta por psql que devuelve las filas como líneas `a|b`. */
export function filasPsql(pg: PostgresEfimero, sql: string): string[] {
  const r = pg.psql(sql)
  if (!r.ok) throw new Error(`psql falló: ${r.err}`)
  return r.out === '' ? [] : r.out.split('\n').map((l) => l.replace(/\r$/, ''))
}
