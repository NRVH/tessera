// =============================================================================
// Que Tessera recuerde qué proyectos tenías abiertos. El fallo que fija vivía en la
// INTERACCIÓN entre un efecto de React y su limpieza (el escaneo de repos cambiaba la
// dependencia dentro de los 150 ms del guardado, la limpieza mataba el temporizador y la
// deduplicación no reprogramaba), con `serializeWorkspace` y el store en verde: hace falta
// un renderer de verdad con su reloj. El proyecto se abre por `argv`, el camino de «Abrir
// con Tessera», que `rutasDesdeArgv` atiende en las dos plataformas sin diálogo nativo.
// =============================================================================

import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { abrirTessera, PERFILES_SIN_SANDBOX, type SesionTessera } from './tessera'

/** El propio repo: una carpeta que existe seguro y que además es un repositorio git. */
const PROYECTO = resolve(process.cwd())

/** Proyectos que el estado persistido dice tener abiertos; `[]` si aún no hay archivo. */
function proyectosPersistidos(datos: string): string[] {
  const ruta = join(datos, 'workspace-state.json')
  if (!existsSync(ruta)) return []
  try {
    const doc = JSON.parse(readFileSync(ruta, 'utf8')) as {
      byProfile?: Record<string, { openProjects?: Array<{ projectHostPath?: string }> }>
    }
    return Object.values(doc.byProfile ?? {}).flatMap((p) =>
      (p.openProjects ?? []).map((x) => x.projectHostPath ?? '')
    )
  } catch {
    return [] // a medio escribir: la siguiente vuelta del poll lo verá entero
  }
}

test('abrir un proyecto se PERSISTE en workspace-state.json', async () => {
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, {
      args: [PROYECTO],
      sembrar: (datos) => writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
    })
    const datos = s.datos

    // El guardado es incremental y con 150 ms de debounce, pero detrás va el escaneo de
    // repos del proyecto: se da margen de sobra y se sondea, en vez de dormir un número
    // fijo que en una máquina lenta sería falso negativo.
    await expect
      .poll(() => proyectosPersistidos(datos), {
        message:
          'el proyecto abierto no llegó a `workspace-state.json`: el guardado del ' +
          'esqueleto no está ocurriendo (ver la cabecera de este archivo)',
        timeout: 30_000,
        intervals: [500]
      })
      .toContain(PROYECTO)

    // Y el activo apunta a él: sin esto, restaurar abriría las pestañas sin elegir
    // ninguna, que es un arranque a medias.
    const doc = JSON.parse(readFileSync(join(datos, 'workspace-state.json'), 'utf8')) as {
      activeProfileId?: string
      byProfile?: Record<string, { activePath?: string }>
    }
    expect(doc.byProfile?.personal?.activePath, 'el proyecto abierto queda como activo').toBe(
      PROYECTO
    )
    expect(doc.activeProfileId, 'y el perfil activo es el que lo tiene abierto').toBe('personal')
  } finally {
    await s?.cerrar()
  }
})

test('lo persistido se RESTAURA en el arranque siguiente', async () => {
  // La otra mitad del ciclo, y la que el usuario ve. Se siembra el estado a mano —en vez
  // de encadenar con la prueba anterior— para que cada una falle por su cuenta: si sólo
  // se rompe el guardado, esta sigue en verde y señala dónde está el problema.
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera({}, {
      sembrar: (datos) => {
        writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
        writeFileSync(
          join(datos, 'workspace-state.json'),
          JSON.stringify({
            version: 1,
            activeProfileId: 'personal',
            byProfile: {
              personal: {
                openProjects: [{ projectHostPath: PROYECTO, name: 'tessera', estado: 'active' }],
                activePath: PROYECTO
              }
            }
          })
        )
      }
    })

    // Se comprueba en el DOM y no en el disco: que el archivo siga intacto no prueba que
    // la pestaña exista. `.project-tab` es la pestaña de proyecto de `ProjectTabs.tsx`; su
    // ausencia se distingue del vacío porque entonces se pinta «Sin proyectos abiertos».
    await expect(s.win.locator('.tabs-projects .project-tab')).toHaveCount(1, { timeout: 30_000 })
    await expect(
      s.win.locator('.project-tabs-empty'),
      'si sale «Sin proyectos abiertos», la restauración no ocurrió'
    ).toHaveCount(0)

    // NO se vuelve a mirar el archivo, y merece explicación porque la tentación es
    // obvia: en este arranque NADIE lo reescribe —el main siembra `current` con el
    // estado sin podar y no escribe, y la primera proyección del renderer se la traga
    // su propia deduplicación—, así que leerlo sería releer lo que la siembra acaba de
    // escribir. Una aserción que no puede fallar es peor que ninguna: aparenta cubrir
    // la poda de `pruneMissingProjects` y seguiría en verde con la poda rota. Quien
    // cubre eso es la cuenta de pestañas de arriba: si el proyecto se hubiera podado,
    // no habría ninguna.
  } finally {
    await s?.cerrar()
  }
})
