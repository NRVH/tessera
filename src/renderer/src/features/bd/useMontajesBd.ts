// =============================================================================
// Bases de datos montadas en cada proyecto: montar y desmontar (en caliente, el main
// lo aplica a las sesiones vivas), montar un archivo SQLite desde el explorador,
// olvidar una conexión borrada y la poda de arranque contra perfiles y conexiones.
// =============================================================================
import { useCallback, useEffect, useMemo } from 'react'
import { notify, notifyError } from '../../comun/notifications'
import { podarMontajes, quitarConexion, vivosParaPodar } from './dbMounts'
import { useStoreBd } from './store'
import { useStoreAjustes } from '../ajustes'
import type { BasesDeArchivoSidebar } from '../explorador'
import type { UseTabs } from '../pestanas'
import { editorTargetKey } from '../editor'

/** Montajes de bases de datos por proyecto. */
export interface MontajesBd {
  setDbMountedForProject: (profileId: string, projectHostPath: string, ids: string[]) => void
  /** Acciones de «Montar como base de datos» del explorador, del proyecto CONFIRMADO. */
  basesDeArchivo: BasesDeArchivoSidebar | undefined
  /** Quita una conexión borrada de los proyectos de SU perfil y lo propaga a las sesiones. */
  olvidarConexionMontada: (connectionId: string, profileId: string) => void
}

/** Propaga al main los proyectos cuyo montaje cambió o desapareció. */
function propagarCambios(prev: Record<string, string[]>, next: Record<string, string[]>): void {
  const enviar = (clave: string, ids: string[]): void => {
    const corte = clave.indexOf('|')
    if (corte < 0) return
    void window.tessera.db.setScope(clave.slice(0, corte), clave.slice(corte + 1), ids)
  }
  for (const [clave, ids] of Object.entries(next)) if (prev[clave] !== ids) enviar(clave, ids)
  for (const clave of Object.keys(prev)) if (!(clave in next)) enviar(clave, [])
}

/** Poda de arranque, una vez con perfiles y ajustes; nada si el registro tiene formato ajeno. */
function usePodaMontajes(profileIdsKey: string): void {
  const settingsLoaded = useStoreAjustes((s) => s.settingsLoaded)
  useEffect(() => {
    if (!settingsLoaded) return
    const ids = profileIdsKey ? profileIdsKey.split('|') : []
    if (ids.length === 0) return
    let vivo = true
    // Conocidas y ajenas de UNA lectura del registro por perfil.
    void Promise.all(ids.map((id) => window.tessera.db.listCompleta(id).then((lista) => [id, lista] as const)))
      .then((pares) => {
        if (!vivo) return
        const vivos = vivosParaPodar(pares)
        if (vivos === null) return
        useStoreBd.setState((s) => ({ dbMounts: podarMontajes(s.dbMounts, vivos) }))
      })
      .catch(() => {
        // Sin la lista no se poda: mejor conservar de más que borrar montajes buenos.
      })
    return () => {
      vivo = false
    }
  }, [settingsLoaded, profileIdsKey])
}

/** Bases montadas por proyecto y sus acciones. */
export function useMontajesBd(tabs: UseTabs): MontajesBd {
  const confirmed = tabs.confirmedTarget
  const setDbMountedForProject = useCallback(
    (profileId: string, projectHostPath: string, ids: string[]) => {
      const clave = editorTargetKey(profileId, projectHostPath)
      useStoreBd.setState((s) => {
        const next = { ...s.dbMounts }
        // Sin bases se BORRA la entrada: el archivo de ajustes no acumula ruido.
        if (ids.length === 0) delete next[clave]
        else next[clave] = ids
        return { dbMounts: next }
      })
      // En caliente: la siguiente invocación de `tdb` ya lo ve.
      void window.tessera.db.setScope(profileId, projectHostPath, ids)
    },
    []
  )
  const basesDeArchivo = useMemo<BasesDeArchivoSidebar | undefined>(() => {
    if (!confirmed) return undefined
    const profileId = confirmed.profileId
    const projectHostPath = confirmed.project.projectHostPath
    const montadas = (): string[] => useStoreBd.getState().dbMounts[editorTargetKey(profileId, projectHostPath)] ?? []
    return {
      montadaDe: async (relPath) => {
        const r = await window.tessera.db.conexionDeArchivo({ profileId, projectHostPath, relPath })
        return r !== null && montadas().includes(r.id) ? r.id : null
      },
      montar: async (relPath) => {
        try {
          const { conexion, reutilizada } = await window.tessera.db.montarArchivo({ profileId, projectHostPath, relPath })
          const ids = montadas()
          if (!ids.includes(conexion.id)) setDbMountedForProject(profileId, projectHostPath, [...ids, conexion.id])
          notify(
            'success',
            `«${conexion.alias}» montada en el proyecto`,
            (reutilizada ? 'Ya estaba en Conexiones. ' : 'Se añadió a Conexiones. ') +
              (conexion.readonly
                ? 'El agente puede consultarla con tdb, solo para leer.'
                : 'El agente puede consultarla con tdb.')
          )
        } catch (err) {
          notifyError('No se pudo montar la base de datos', err)
        }
      },
      desmontar: (conexionId) =>
        setDbMountedForProject(profileId, projectHostPath, montadas().filter((id) => id !== conexionId))
    }
  }, [confirmed, setDbMountedForProject])
  // Solo en el perfil de la borrada: una copia pegada en otro perfil comparte el id.
  const olvidarConexionMontada = useCallback((connectionId: string, profileId: string) => {
    useStoreBd.setState((s) => {
      const next = quitarConexion(s.dbMounts, connectionId, profileId)
      if (next !== s.dbMounts) propagarCambios(s.dbMounts, next)
      return { dbMounts: next }
    })
  }, [])
  usePodaMontajes(tabs.profiles.map((p) => p.id).join('|'))
  return { setDbMountedForProject, basesDeArchivo, olvidarConexionMontada }
}
