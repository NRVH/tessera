// =============================================================================
// «Abrir con Tessera» (integración con el gestor de archivos) en la ventana: lo que
// llega de FUERA saca del mosaico antes de actuar, y revelar una ruta sale además
// de la vista de bases de datos. La espera y el orden viven en useAperturasExplorador.
// =============================================================================
import { useMemo } from 'react'
import type { UseTabs } from './useTabs'
import { useAperturasExplorador } from './useAperturasExplorador'
import { useStorePestanas } from './store'
import { salirMosaico } from '../mosaico'
import { revelarRuta } from '../explorador'
import type { EditorApp } from '../editor'
import { useStoreAjustes } from '../ajustes'

/** Engancha las aperturas externas a las pestañas, el editor y el árbol. */
export function useAperturasApp(
  tabs: UseTabs,
  openEditorTab: EditorApp['openEditorTab'],
  forzarModoWindows: (profileId: string, projectHostPath: string) => void,
  salirDeBd: () => void
): void {
  const confirmed = tabs.confirmedTarget
  const settingsLoaded = useStoreAjustes((s) => s.settingsLoaded)
  const pestanasCargadas = useStorePestanas((s) => s.pestanasCargadas)
  const confirmadoParaApertura = useMemo(
    () => (confirmed ? { profileId: confirmed.profileId, projectHostPath: confirmed.project.projectHostPath } : null),
    [confirmed]
  )
  // `salirMosaico(false)`: el teclado lo decide lo que se abre, no la salida.
  useAperturasExplorador({
    ajustesCargados: settingsLoaded,
    pestanasCargadas,
    activeProfileId: tabs.activeProfile?.id ?? null,
    abiertos: tabs.allOpenProjects,
    confirmado: confirmadoParaApertura,
    openKnownProject: (...a: Parameters<typeof tabs.openKnownProject>) => {
      salirMosaico(false)
      return tabs.openKnownProject(...a)
    },
    setActiveProject: (profileId, projectHostPath) => {
      salirMosaico(false)
      tabs.setActiveProject(profileId, projectHostPath)
    },
    setActiveProfile: (profileId) => {
      salirMosaico(false)
      tabs.setActiveProfile(profileId)
    },
    forzarModoWindows,
    quitarAgenteDiferido: tabs.quitarAgenteDiferido,
    abrirArchivo: (file) => {
      salirMosaico(false)
      openEditorTab({ kind: 'file', file })
    },
    // En BD el árbol de archivos no está montado: revelar ahí no se vería.
    revelarEnArbol: (rel) => {
      salirMosaico(false)
      salirDeBd()
      revelarRuta(rel)
    }
  })
}
