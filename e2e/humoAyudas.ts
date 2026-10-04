// =============================================================================
// Montaje común de la red de caracterización: un repo git de prueba con commits de
// fecha, autor y contenido fijos (hashes reproducibles), el agente falso y un
// `workspace-state.json` con el proyecto abierto en modo nativo.
// Lo usan `humo-app.spec.ts` (recorrido) y `capturas-app.spec.ts` (referencias).
// =============================================================================

import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { montarAgenteFalso } from './agenteFalso'
import { abrirTessera, borrarTemporal, PERFILES_SIN_SANDBOX, PLATAFORMA, type SesionTessera } from './tessera'

/** Nombre FIJO de la carpeta del proyecto: sale en la pestaña y en la cabecera del árbol. */
export const NOMBRE_PROYECTO = 'humo'

/** Texto que solo existe en `src/dos.txt`: lo que se busca en archivos. */
export const MARCADOR_BUSQUEDA = 'aguja_de_busqueda'

/** Contenido de cada commit; el último cambio de `uno.txt` queda sin confirmar. */
const COMMITS: { mensaje: string; fecha: string; archivos: Record<string, string> }[] = [
  {
    mensaje: 'primer commit',
    fecha: '2024-01-02T10:00:00Z',
    archivos: {
      'LEEME.txt': 'Proyecto de humo.\n',
      'src/uno.txt': 'linea uno\nlinea dos\nlinea tres\n',
      'src/dos.txt': `alfa\n${MARCADOR_BUSQUEDA}\nomega\n`
    }
  },
  {
    mensaje: 'segundo commit: amplía dos.txt',
    fecha: '2024-01-03T11:30:00Z',
    archivos: { 'src/dos.txt': `alfa\n${MARCADOR_BUSQUEDA}\nbeta\nomega\n` }
  }
]

/** Cambio sin confirmar de `src/uno.txt`, que es lo que enseña el diff. */
export const UNO_MODIFICADO = 'linea uno\nlinea dos cambiada\nlinea tres\n'

/** Ventana de tamaño conocido: las capturas y los topes de ancho dependen de él. */
export const TAMANO_VENTANA = { ancho: 1500, alto: 950 }

export interface MontajeHumo {
  /** Temporal del agente falso; contiene el proyecto. Se borra al final. */
  raiz: string
  /** Ruta del host del proyecto. */
  proyecto: string
  /** Entorno de la app (PATH con el agente falso). */
  env: Record<string, string>
}

/**
 * Entorno de git sin nada de quien corre la prueba: un `GIT_DIR` o `GIT_WORK_TREE`
 * heredado lo haría trabajar sobre otro repo, y la config global o del sistema podría
 * cambiar el objeto commit y el hash, que en las capturas sale sin máscara.
 */
function entornoGit(fecha: string): Record<string, string> {
  const heredado = Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^GIT_/i.test(k))
  return {
    ...(Object.fromEntries(heredado) as Record<string, string>),
    // Git en Windows no abre `\\.\nul` (lo que da `os.devNull`), pero sí `NUL`.
    GIT_CONFIG_GLOBAL: PLATAFORMA === 'windows' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Prueba Humo',
    GIT_AUTHOR_EMAIL: 'humo@example.invalid',
    GIT_COMMITTER_NAME: 'Prueba Humo',
    GIT_COMMITTER_EMAIL: 'humo@example.invalid',
    GIT_AUTHOR_DATE: fecha,
    GIT_COMMITTER_DATE: fecha
  }
}

/** Ejecuta git en el proyecto con identidad, fecha y finales de línea fijos; falla con su stderr. */
export function git(proyecto: string, fecha: string, ...args: string[]): string {
  // Sin ganchos de quien corre la prueba: podrían reescribir el mensaje y el hash.
  const sinGanchos = join(proyecto, '.git', 'sin-ganchos')
  const fijos = ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${sinGanchos}`]
  try {
    const env = entornoGit(fecha)
    return execFileSync('git', [...fijos, ...args], { cwd: proyecto, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim()
    throw new Error(`git ${args.join(' ')} falló en ${proyecto}: ${stderr || String(err)}`, { cause: err })
  }
}

/** Hash completo de `HEAD` del proyecto, leído con el mismo entorno aislado que lo creó. */
export function hashHead(proyecto: string): string {
  return git(proyecto, COMMITS[COMMITS.length - 1].fecha, 'rev-parse', 'HEAD').trim()
}

/** Crea el agente falso y, dentro de su temporal, el repo con sus commits y el cambio pendiente. */
export function montarHumo(): MontajeHumo {
  const { raiz, env } = montarAgenteFalso()
  try {
    const proyecto = join(raiz, NOMBRE_PROYECTO)
    mkdirSync(join(proyecto, 'src'), { recursive: true })
    git(proyecto, COMMITS[0].fecha, 'init', '-q', '-b', 'main')
    for (const c of COMMITS) {
      for (const [ruta, texto] of Object.entries(c.archivos)) writeFileSync(join(proyecto, ruta), texto)
      git(proyecto, c.fecha, 'add', '-A')
      git(proyecto, c.fecha, 'commit', '-q', '-m', c.mensaje)
    }
    writeFileSync(join(proyecto, 'src', 'uno.txt'), UNO_MODIFICADO)
    return { raiz, proyecto, env }
  } catch (err) {
    // El temporal lleva una copia del ejecutable de Node: no se deja atrás.
    try {
      rmSync(raiz, { recursive: true, force: true, maxRetries: 5 })
    } catch (e) {
      console.warn(`[e2e] no se pudo borrar el temporal ${raiz} (${String(e)})`)
    }
    throw err
  }
}

/** `profiles.json` y `workspace-state.json`: el proyecto abierto, nativo y sin avisos de estreno. */
export function sembrarHumo(datos: string, m: MontajeHumo): void {
  writeFileSync(join(datos, 'profiles.json'), PERFILES_SIN_SANDBOX)
  writeFileSync(
    join(datos, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: 'personal',
      byProfile: {
        personal: {
          openProjects: [{ projectHostPath: m.proyecto, name: NOMBRE_PROYECTO, estado: 'active' }],
          activePath: m.proyecto
        }
      },
      settings: {
        defaultProjectMode: 'windows',
        windowsModeProjects: [`personal|${m.proyecto}`],
        menuWindowsAvisado: true
      }
    })
  )
}

/**
 * Pone la ventana en `TAMANO_VENTANA` y comprueba que el área de contenido lo tiene.
 * Se reaplica mientras se espera: salir de maximizada no es inmediato en todos los sistemas.
 */
async function fijarTamano(s: SesionTessera): Promise<void> {
  const esperado = `${TAMANO_VENTANA.ancho}x${TAMANO_VENTANA.alto}`
  let medida = { contenido: '', area: '' }
  for (let intento = 0; intento < 25; intento++) {
    medida = await s.app.evaluate(({ BrowserWindow, screen }, t) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w.isMaximized()) w.unmaximize()
      w.setSize(t.ancho, t.alto)
      const [ancho, alto] = w.getContentSize()
      const area = screen.getDisplayMatching(w.getBounds()).workAreaSize
      return { contenido: `${ancho}x${alto}`, area: `${area.width}x${area.height}` }
    }, TAMANO_VENTANA)
    if (medida.contenido === esperado) return
    await s.win.waitForTimeout(200)
  }
  throw new Error(
    `La ventana se queda en ${medida.contenido} y estas pruebas necesitan ${esperado} ` +
      `(área útil de la pantalla: ${medida.area}). Hace falta una pantalla más grande; no es una regresión.`
  )
}

/** Monta el proyecto, arranca la app con él abierto y fija el tamaño; si algo falla, no deja temporales. */
export async function abrirHumo(): Promise<{ s: SesionTessera; m: MontajeHumo }> {
  const m = montarHumo()
  let s: SesionTessera | undefined
  try {
    s = await abrirTessera(m.env, { sembrar: (datos) => sembrarHumo(datos, m) })
    await fijarTamano(s)
    return { s, m }
  } catch (err) {
    await cerrarHumo(s, m)
    throw err
  }
}

/** Cierra la app y borra el temporal del montaje; admite que el arranque se quedara a medias. */
export async function cerrarHumo(s: SesionTessera | undefined, m: MontajeHumo | undefined): Promise<void> {
  await s?.cerrar()
  if (m) await borrarTemporal(m.raiz)
}

/** Deja que React confirme el render provocado por el gesto. */
export async function asentar(win: Page): Promise<void> {
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** La fila del explorador con ese nombre. */
export function filaArbol(win: Page, nombre: string) {
  return win.locator('.sidebar .tree-row', { hasText: nombre }).first()
}

/** Abre un archivo desde el explorador y espera a que su pestaña sea la activa. */
export async function abrirDesdeArbol(win: Page, nombre: string): Promise<void> {
  await filaArbol(win, nombre).click()
  await expect(win.locator('.editor-tab.active', { hasText: nombre })).toHaveCount(1)
}
