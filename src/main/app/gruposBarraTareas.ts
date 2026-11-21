// =============================================================================
// El grupo propio en la barra de tareas de las ventanas de agente y de las de franja desacoplada: en Windows,
// un AppUserModelID aparte con su icono, para que no se agrupen con Tessera; en Linux, el icono de la ventana;
// en macOS no hay nada que cambiar (un solo icono en el Dock). Lo usan `ventanaAgente.ts` y `ventana.ts`.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md, docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { app, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { plataformaActual, esLinux, esWindows } from '../../shared/plataforma'
import { archivoIconoDeGrupo, comandoDeRelanzamiento, idModeloDeFranja, idModeloDeGrupo, type GrupoBarraTareas, type RelanzamientoDeGrupo } from './gruposBarraTareasPuro'
import { crearIconoFranja, rutaRecursoIcono } from './iconoFranja'

/** El AppUserModelID del grupo en esta ejecución. */
export function idModeloGrupo(grupo: GrupoBarraTareas): string {
  return idModeloDeGrupo(grupo, app.isPackaged)
}

/**
 * La ruta del icono del grupo en esta plataforma, o null si no lo hay o falta el archivo. Empaquetada, sale de los
 * recursos de la app (`extraResources`); en desarrollo, de `build/`.
 */
export function rutaIconoGrupo(grupo: GrupoBarraTareas): string | null {
  const nombre = archivoIconoDeGrupo(grupo, plataformaActual())
  if (nombre === null) return null
  const ruta = rutaRecursoIcono(nombre)
  return existsSync(ruta) ? ruta : null
}

/**
 * Windows: el grupo propio de la ventana, con su icono y, anclada en la barra de tareas, lo que `relanzamiento`
 * ejecute. El relanzamiento solo en la app instalada: en desarrollo el ejecutable es el de Electron.
 */
export function fijarGrupoBarraTareas(ventana: BrowserWindow, grupo: GrupoBarraTareas, relanzamiento: RelanzamientoDeGrupo): void {
  if (!esWindows()) return
  try {
    aplicarDetallesGrupo(ventana, idModeloGrupo(grupo), relanzamiento, rutaIconoGrupo(grupo))
  } catch (err) {
    console.error(`[ventana-${grupo}] no se pudo fijar su grupo de la barra de tareas:`, err)
  }
}

function aplicarDetallesGrupo(ventana: BrowserWindow, id: string, relanzamiento: RelanzamientoDeGrupo, icono: string | null): void {
  const comando = comandoDeRelanzamiento(process.execPath, relanzamiento, app.isPackaged)
  ventana.setAppDetails({
    appId: id,
    ...(icono ? { appIconPath: icono, appIconIndex: 0 } : {}),
    ...(comando ? { relaunchCommand: comando, relaunchDisplayName: relanzamiento.nombre } : {})
  })
}

export function fijarIconoYGrupoFranja(ventana: BrowserWindow, perfil: string, color: unknown): void {
  const enWindows = esWindows()
  // macOS tiene un solo icono en el Dock para toda la aplicación.
  if (!enWindows && !esLinux()) return
  const aplicar = (imagen: NativeImage | string | null, ruta: string | null): void => {
    try {
      if (imagen) ventana.setIcon(imagen)
    } finally {
      if (enWindows) aplicarDetallesGrupo(ventana, idModeloDeFranja(perfil, app.isPackaged), { argumento: null, nombre: app.getName() }, ruta)
    }
  }
  try {
    const { imagen, ruta } = crearIconoFranja(color, enWindows)
    aplicar(imagen, ruta)
  } catch (error) {
    console.error('[franja] no se pudo aplicar el icono del perfil:', error)
    try {
      const reserva = rutaIconoGrupo('franja')
      aplicar(reserva, reserva)
    } catch (errorReserva) {
      console.error('[franja] no se pudo aplicar el icono de reserva:', errorReserva)
    }
  }
}
