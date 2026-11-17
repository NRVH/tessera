// =============================================================================
// «Abrir con Tessera» (integración con el gestor de archivos) en la ventana: lo que
// llega de FUERA saca del mosaico antes de actuar, y revelar una ruta sale además
// de la vista de bases de datos y de la franja a pantalla completa (que tapa el árbol).
// La espera y el orden viven en useAperturasExplorador.
// =============================================================================
import { useMemo } from 'react'
import type { UsePestanas } from './usePestanas'
import { useAperturasExplorador } from './useAperturasExplorador'
import { useStorePestanas } from './store'
import { salirMosaico } from '../mosaico'
import { revelarRuta } from '../explorador'
import type { EditorApp } from '../editor'
import { salirDePantallaCompleta } from '../layout'
import { useStoreAjustes } from '../ajustes'

/** Engancha las aperturas externas a las pestañas, el editor y el árbol. */
export function useAperturasApp(
  pestanas: UsePestanas,
  abrirEnEditor: EditorApp['abrirPestana'],
  salirDeBd: () => void
): void {
  const visto = pestanas.objetivoVisto
  const ajustesCargados = useStoreAjustes((s) => s.ajustesCargados)
  const pestanasCargadas = useStorePestanas((s) => s.pestanasCargadas)
  const vistoParaApertura = useMemo(
    () => (visto ? { perfilId: visto.perfilId, rutaHostProyecto: visto.proyecto.rutaHostProyecto } : null),
    [visto]
  )
  // `salirMosaico(false)`: el teclado lo decide lo que se abre, no la salida.
  useAperturasExplorador({
    ajustesCargados,
    pestanasCargadas,
    perfilActivoId: pestanas.perfilActivo?.id ?? null,
    abiertos: pestanas.todosLosProyectosAbiertos,
    visto: vistoParaApertura,
    abrirProyectoConocido: (...a: Parameters<typeof pestanas.abrirProyectoConocido>) => {
      salirMosaico(false)
      return pestanas.abrirProyectoConocido(...a)
    },
    setActiveProject: (perfilId, rutaHostProyecto, opciones) => {
      salirMosaico(false)
      pestanas.setActiveProject(perfilId, rutaHostProyecto, opciones)
    },
    quitarAgenteDiferido: pestanas.quitarAgenteDiferido,
    abrirArchivo: (archivo) => {
      salirMosaico(false)
      abrirEnEditor({ tipo: 'file', archivo })
    },
    // En BD el árbol de archivos no está montado, y con la franja a pantalla completa está
    // tapado: revelar ahí no se vería, así que se sale de las dos cosas antes de revelar.
    revelarEnArbol: (rel) => {
      salirMosaico(false)
      salirDePantallaCompleta()
      salirDeBd()
      revelarRuta(rel)
    }
  })
}
