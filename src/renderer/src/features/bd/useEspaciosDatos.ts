// =============================================================================
// Espacios de datos: la carpeta de cada perfil donde vive el agente de datos. Pide
// sus rutas al main para reconocerlas tras un reinicio, las prepara bajo demanda y
// muestra u oculta el agente de datos del perfil activo. Nativo o Docker lo elige cada
// agente desde su cuenta, como en un proyecto.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { notifyError } from '../../comun/notificaciones'
import { ocultarAgenteDb, useStoreBd } from './store'
import type { UsePestanas } from '../pestanas'
import { txArea } from './textosArea.ts'

/** Espacios de datos conocidos y acciones sobre el agente de datos. */
export interface EspaciosDatos {
  /** Rutas de los espacios (una por perfil), con identidad estable. */
  rutasEspacioDatos: Set<string>
  esEspacioDeDatos: (rutaHostProyecto: string) => boolean
  /** Prepara el espacio de un perfil; avisa y devuelve false si falla. */
  asegurarEspacioDeDatos: (perfil: { id: string; nombre: string }) => Promise<boolean>
  /** Muestra u oculta el agente de datos del perfil activo (estable: lo usa el teclado). */
  alternarAgenteDb: () => void
  /** Perfiles con una preparación en vuelo (no se lanza dos veces). */
  preparandoEspacioRef: { current: Set<string> }
}

/** Pide al main las rutas de los espacios de datos, sin crearlas, cuando cambian los perfiles. */
function useRutasEspacios(pestanas: UsePestanas): void {
  const claveIdsPerfiles = pestanas.perfiles.map((p) => p.id).join('|')
  useEffect(() => {
    const ids = claveIdsPerfiles ? claveIdsPerfiles.split('|') : []
    if (ids.length === 0) return
    let vivo = true
    void window.tessera.db
      .rutasEspacios(ids)
      .then((mapa) => {
        if (vivo) useStoreBd.setState({ rutaEspacioDatosPorPerfil: mapa })
      })
      .catch(() => {
        // Sin este mapa el espacio sigue funcionando; solo se pierde reconocerlo al arrancar.
      })
    return () => {
      vivo = false
    }
  }, [claveIdsPerfiles])
}

/** Espacios de datos del perfil y del agente de datos. */
export function useEspaciosDatos(pestanas: UsePestanas): EspaciosDatos {
  const rutaEspacioDatosPorPerfil = useStoreBd((s) => s.rutaEspacioDatosPorPerfil)
  const rutasEspacioDatos = useMemo(() => new Set(Object.values(rutaEspacioDatosPorPerfil)), [rutaEspacioDatosPorPerfil])
  const esEspacioDeDatos = useCallback(
    (rutaHostProyecto: string) => rutasEspacioDatos.has(rutaHostProyecto),
    [rutasEspacioDatos]
  )
  useRutasEspacios(pestanas)
  // La carpeta la crea el main.
  const asegurarEspacioDeDatos = useCallback(async (perfil: { id: string; nombre: string }): Promise<boolean> => {
    try {
      const ref = await window.tessera.db.asegurarEspacio(perfil.id, perfil.nombre)
      useStoreBd.setState((s) => ({
        rutaEspacioDatosPorPerfil:
          s.rutaEspacioDatosPorPerfil[perfil.id] === ref.projectHostPath
            ? s.rutaEspacioDatosPorPerfil
            : { ...s.rutaEspacioDatosPorPerfil, [perfil.id]: ref.projectHostPath }
      }))
      useStoreBd.setState((s) => ({
        espaciosAbiertos: s.espaciosAbiertos.has(perfil.id) ? s.espaciosAbiertos : new Set(s.espaciosAbiertos).add(perfil.id)
      }))
      return true
    } catch (err) {
      console.error('[db] no se pudo preparar el espacio de datos:', err)
      notifyError(txArea().noSePudoPrepararAgenteDatos, err)
      return false
    }
  }, [])
  const perfilActivoRef = useRef(pestanas.perfilActivo)
  perfilActivoRef.current = pestanas.perfilActivo
  const preparandoEspacioRef = useRef(new Set<string>())
  // Mostrar = preparar y, SOLO si sale bien, marcarlo visible; así un fallo no deja la preferencia puesta.
  const alternarAgenteDb = useCallback(() => {
    const perfil = perfilActivoRef.current
    if (!perfil) return
    if (useStoreBd.getState().dbAgenteVisiblePorPerfil[perfil.id] === true) {
      ocultarAgenteDb(perfil.id)
      return
    }
    if (preparandoEspacioRef.current.has(perfil.id)) return
    preparandoEspacioRef.current.add(perfil.id)
    void asegurarEspacioDeDatos(perfil).then((ok) => {
      preparandoEspacioRef.current.delete(perfil.id)
      if (!ok) return
      useStoreBd.setState((s) =>
        s.dbAgenteVisiblePorPerfil[perfil.id] === true
          ? {}
          : { dbAgenteVisiblePorPerfil: { ...s.dbAgenteVisiblePorPerfil, [perfil.id]: true } }
      )
    })
  }, [asegurarEspacioDeDatos])
  return { rutasEspacioDatos, esEspacioDeDatos, asegurarEspacioDeDatos, alternarAgenteDb, preparandoEspacioRef }
}
