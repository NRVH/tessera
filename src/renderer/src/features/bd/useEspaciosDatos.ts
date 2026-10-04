// =============================================================================
// Espacios de datos: la carpeta de cada perfil donde vive el agente de datos. Pide
// sus rutas al main para reconocerlas tras un reinicio, las prepara bajo demanda
// (siempre en modo nativo) y muestra u oculta el agente de datos del perfil activo.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { notifyError } from '../../comun/notifications'
import { ocultarAgenteDb, useStoreBd } from './store'
import { asegurarModoNativo, type UseTabs } from '../pestanas'
import { editorTargetKey } from '../editor'

/** Espacios de datos conocidos y acciones sobre el agente de datos. */
export interface EspaciosDatos {
  /** Rutas de los espacios (una por perfil), con identidad estable. */
  espacioPathsSet: Set<string>
  esEspacioDeDatos: (projectHostPath: string) => boolean
  /** Prepara el espacio de un perfil; avisa y devuelve false si falla. */
  asegurarEspacioDeDatos: (perfil: { id: string; nombre: string }) => Promise<boolean>
  /** Muestra u oculta el agente de datos del perfil activo (estable: lo usa el teclado). */
  alternarAgenteDb: () => void
  /** Perfiles con una preparación en vuelo (no se lanza dos veces). */
  preparandoEspacioRef: { current: Set<string> }
}

/** Pide al main las rutas de los espacios de datos, sin crearlas, cuando cambian los perfiles. */
function useRutasEspacios(tabs: UseTabs): void {
  const profileIdsKey = tabs.profiles.map((p) => p.id).join('|')
  useEffect(() => {
    const ids = profileIdsKey ? profileIdsKey.split('|') : []
    if (ids.length === 0) return
    let vivo = true
    void window.tessera.db
      .workspacePaths(ids)
      .then((mapa) => {
        if (vivo) useStoreBd.setState({ dbWorkspacePaths: mapa })
      })
      .catch(() => {
        // Sin este mapa el espacio sigue funcionando; solo se pierde el bloqueo de modo.
      })
    return () => {
      vivo = false
    }
  }, [profileIdsKey])
}

/** Espacios de datos del perfil y del agente de datos. */
export function useEspaciosDatos(tabs: UseTabs): EspaciosDatos {
  const dbWorkspacePaths = useStoreBd((s) => s.dbWorkspacePaths)
  const espacioPathsSet = useMemo(() => new Set(Object.values(dbWorkspacePaths)), [dbWorkspacePaths])
  const esEspacioDeDatos = useCallback(
    (projectHostPath: string) => espacioPathsSet.has(projectHostPath),
    [espacioPathsSet]
  )
  useRutasEspacios(tabs)
  // La carpeta la crea el main; se fuerza a nativo porque en el contenedor no hay `tdb` ni VPN.
  const asegurarEspacioDeDatos = useCallback(async (perfil: { id: string; nombre: string }): Promise<boolean> => {
    try {
      const ref = await window.tessera.db.ensureWorkspace(perfil.id, perfil.nombre)
      useStoreBd.setState((s) => ({
        dbWorkspacePaths:
          s.dbWorkspacePaths[perfil.id] === ref.projectHostPath
            ? s.dbWorkspacePaths
            : { ...s.dbWorkspacePaths, [perfil.id]: ref.projectHostPath }
      }))
      asegurarModoNativo(editorTargetKey(perfil.id, ref.projectHostPath))
      useStoreBd.setState((s) => ({
        espaciosAbiertos: s.espaciosAbiertos.has(perfil.id) ? s.espaciosAbiertos : new Set(s.espaciosAbiertos).add(perfil.id)
      }))
      return true
    } catch (err) {
      console.error('[db] no se pudo preparar el espacio de datos:', err)
      notifyError('No se pudo preparar el agente de datos', err)
      return false
    }
  }, [])
  const perfilActivoRef = useRef(tabs.activeProfile)
  perfilActivoRef.current = tabs.activeProfile
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
  return { espacioPathsSet, esEspacioDeDatos, asegurarEspacioDeDatos, alternarAgenteDb, preparandoEspacioRef }
}
