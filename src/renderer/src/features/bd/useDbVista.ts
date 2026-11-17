// =============================================================================
// useDbVista — el estado EN MEMORIA de la vista de bases de datos, por perfil: pestañas
// abiertas, nodos expandidos del árbol, fila seleccionada y «Mostrar en el árbol». La
// lógica es la pura de `dbVistaEstado.ts`; esto lee el store de BD (`vistaBd`) y le da
// acciones ESTABLES (funciones de módulo), porque las usan listeners registrados una
// sola vez y las deps de efectos de los panes. Vive en `useBdApp`: el lateral se desmonta.
// Decisiones: docs/decisiones/bd/ui-area-estado-de-la-vista.md
// =============================================================================

import { useEffect, useMemo } from 'react'
import { actualizarVistaBd, useStoreBd } from './store'
import {
  VISTA_PERFIL_VACIA,
  abrirEnVista,
  activarEnVista,
  actualizarPerfil,
  alternarExpandido as alternarExpandidoEn,
  cerrarEnVista,
  fijarSeleccion as fijarSeleccionEn,
  moverEnVista,
  reemplazarEnVista,
  plegarTodo as plegarTodoEn,
  podarConexion as podarConexionEn,
  podarConexiones as podarConexionesEn,
  podarConsolas as podarConsolasEn,
  podarPerfiles,
  revelarPane,
  todasLasPestanas,
  vistaDe as vistaDeMapa,
  type DbVistaMapa,
  type DbVistaPerfil
} from './dbVistaEstado'
import type { DbPane, PestanaBd } from './modeloPestanasBd'
import { fijarMaximizado } from '../layout'

/** Una pestaña de cualquier perfil, con su clave de keep-alive. */
export interface PestanaBdMontada {
  perfilId: string
  pestana: PestanaBd
  clavePane: string
}

/** Las acciones de la vista: no dependen de nada del render, así que su identidad no cambia. */
interface AccionesVistaBd {
  abrir: (perfilId: string, pane: DbPane) => void
  activar: (perfilId: string, pestanaId: string) => void
  cerrar: (perfilId: string, pestanaIds: readonly string[]) => void
  /** La pestaña `pestanaId` pasa a enseñar `pane` en su sitio (una clave renombrada). */
  reemplazar: (perfilId: string, pestanaId: string, pane: DbPane) => void
  /** Reordena la tira (arrastre): `pestanaId` queda antes de `antesDe` (null = al final). */
  mover: (perfilId: string, pestanaId: string, antesDe: string | null) => void
  alternarExpandido: (perfilId: string, clave: string, abierto?: boolean) => void
  plegarTodo: (perfilId: string) => void
  fijarSeleccion: (perfilId: string, clave: string | null) => void
  /** «Mostrar en el árbol»: despliega los antepasados, selecciona y pide desplazar. */
  revelar: (perfilId: string, pane: DbPane) => void
  /** Una conexión se borró en un perfil: fuera de ESE perfil (ver `podarConexion` de dbVistaEstado). */
  podarConexion: (conexionId: string, perfilId: string) => void
  /** Deja en cada perfil del mapa solo sus conexiones vivas (los demás no se tocan). */
  podarConexiones: (vivasPorPerfil: ReadonlyMap<string, readonly string[]>) => void
  /** Quita de un perfil las pestañas de consolas que ya no existen. */
  podarConsolas: (perfilId: string, vivas: readonly string[]) => void
}

export interface DbVistaApi extends AccionesVistaBd {
  /** El mapa entero (perfil -> vista). Identidad estable mientras nada cambie. */
  mapa: DbVistaMapa
  /** Vista de un perfil; la vacía si no tiene nada (o si no hay perfil). */
  vistaDe: (perfilId: string | null) => DbVistaPerfil
  /** Todas las pestañas de todos los perfiles, para el keep-alive del área. */
  todas: readonly PestanaBdMontada[]
  /** Perfiles que tienen al menos una pestaña abierta. */
  perfilesConPestanas: readonly string[]
}

function enPerfil(perfilId: string, cambio: (v: DbVistaPerfil) => DbVistaPerfil): void {
  actualizarVistaBd((m) => actualizarPerfil(m, perfilId, cambio))
}

const ACCIONES: AccionesVistaBd = {
  // Abrir es querer verla: restaura el agente de datos si la tapaba.
  abrir: (perfilId, pane) => {
    fijarMaximizado('agenteDb', false, perfilId)
    enPerfil(perfilId, (v) => abrirEnVista(v, pane))
  },
  activar: (perfilId, pestanaId) => enPerfil(perfilId, (v) => activarEnVista(v, pestanaId)),
  cerrar: (perfilId, pestanaIds) => enPerfil(perfilId, (v) => cerrarEnVista(v, pestanaIds)),
  reemplazar: (perfilId, pestanaId, pane) => enPerfil(perfilId, (v) => reemplazarEnVista(v, pestanaId, pane)),
  mover: (perfilId, pestanaId, antesDe) => enPerfil(perfilId, (v) => moverEnVista(v, pestanaId, antesDe)),
  alternarExpandido: (perfilId, clave, abierto) => enPerfil(perfilId, (v) => alternarExpandidoEn(v, clave, abierto)),
  plegarTodo: (perfilId) => enPerfil(perfilId, plegarTodoEn),
  fijarSeleccion: (perfilId, clave) => enPerfil(perfilId, (v) => fijarSeleccionEn(v, clave)),
  revelar: (perfilId, pane) => enPerfil(perfilId, (v) => revelarPane(v, pane)),
  podarConexion: (conexionId, perfilId) => actualizarVistaBd((m) => podarConexionEn(m, conexionId, perfilId)),
  podarConexiones: (vivasPorPerfil) => actualizarVistaBd((m) => podarConexionesEn(m, vivasPorPerfil)),
  podarConsolas: (perfilId, vivas) => actualizarVistaBd((m) => podarConsolasEn(m, perfilId, vivas))
}

function perfilesConPestanasDe(mapa: DbVistaMapa): string[] {
  const salida: string[] = []
  for (const [perfilId, v] of mapa) if (v.pestanas.pestanas.length > 0) salida.push(perfilId)
  return salida
}

/**
 * @param idsPerfiles los ids de los perfiles VIVOS unidos por comas (la misma clave
 *   `idsPerfiles` de `useVistasPorPerfil`). Cadena y no array: así la dependencia de la poda es un
 *   valor y no una identidad que cambia en cada render.
 */
export function useDbVista(idsPerfiles: string): DbVistaApi {
  const mapa = useStoreBd((s) => s.vistaBd)

  // Poda por perfiles con la guarda de `useVistasPorPerfil`: sin perfiles (el primer render,
  // antes de que llegue la lista por IPC) no se poda nada.
  useEffect(() => {
    if (!idsPerfiles) return
    const vivos = new Set(idsPerfiles.split(','))
    actualizarVistaBd((m) => podarPerfiles(m, vivos))
  }, [idsPerfiles])

  return useMemo(
    () => ({
      mapa,
      vistaDe: (perfilId: string | null): DbVistaPerfil =>
        perfilId === null ? VISTA_PERFIL_VACIA : vistaDeMapa(mapa, perfilId),
      todas: todasLasPestanas(mapa),
      perfilesConPestanas: perfilesConPestanasDe(mapa),
      ...ACCIONES
    }),
    [mapa]
  )
}
