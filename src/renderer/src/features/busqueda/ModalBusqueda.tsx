// =============================================================================
// «Buscar en archivos» (Mod+Shift+F) conectado a la ventana. Lleva `key` por perfil:
// el modal lee su estado inicial al montarse y devuelve lo escrito al desmontarse,
// así que cambiar de perfil con él abierto lo remonta con lo del perfil al que llegas.
// =============================================================================
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { ModalBuscarEnArchivos } from './ModalBuscarEnArchivos'
import { useStoreBusqueda } from './store'
import { txBusqueda } from './textos.ts'
import type { UsePestanas } from '../pestanas'
import type { EditorApp } from '../editor'

interface Props {
  pestanas: UsePestanas
  perfilUI: string
  editor: Pick<EditorApp, 'claveEditorActivo' | 'abrirPestana'>
}

/** Modal de búsqueda en archivos, montado solo mientras está abierto. */
export function ModalBusqueda({ pestanas, perfilUI, editor }: Props): React.JSX.Element | null {
  const b = useStoreBusqueda(
    useShallow((s) => ({
      abierto: s.buscarAbierto,
      tokenFoco: s.buscarTokenFoco,
      memoria: s.buscarMemoria,
      consulta: s.buscarConsultaPorPerfil[perfilUI] ?? ''
    }))
  )
  // Identidad estable: es dependencia del efecto que pide el árbol de carpetas.
  const proyectosBuscables = useMemo(
    () => pestanas.proyectosAbiertos.map((p) => ({ nombre: p.nombre, raiz: p.rutaHostProyecto })),
    [pestanas.proyectosAbiertos]
  )
  if (!b.abierto) return null
  const proyectoActivo = pestanas.objetivoConfirmado?.proyecto ?? null
  return (
    <ErrorBoundary etiqueta={txBusqueda().laBusquedaEnArchivos} variante="pane">
      <ModalBuscarEnArchivos
        key={perfilUI}
        nombreProyecto={proyectoActivo?.nombre ?? ''}
        proyectos={proyectosBuscables}
        raizActiva={proyectoActivo?.rutaHostProyecto ?? null}
        onActivarProyecto={(raiz) => {
          if (pestanas.perfilActivo !== null) pestanas.setActiveProject(pestanas.perfilActivo.id, raiz)
        }}
        claveProyecto={editor.claveEditorActivo ?? ''}
        estadoInicial={{ ...b.memoria, consulta: b.consulta }}
        onRecordar={(m) => {
          // `perfilUI` del cierre y no una ref: esta instancia es la del perfil con el que se montó.
          useStoreBusqueda.setState((s) => ({
            buscarMemoria: m,
            buscarConsultaPorPerfil:
              s.buscarConsultaPorPerfil[perfilUI] === m.consulta ? s.buscarConsultaPorPerfil : { ...s.buscarConsultaPorPerfil, [perfilUI]: m.consulta }
          }))
        }}
        // Una coincidencia sin línea (el pool de un .class) se abre sin fingir destino;
        // `columnaArchivo` y no `columna`: la segunda viene sin sangría y recortada.
        onAbrir={(c) =>
          editor.abrirPestana(
            { tipo: 'file', archivo: { ruta: c.ruta, nombre: c.nombre } },
            c.linea > 0 ? { revelar: { linea: c.linea, columna: Math.max(1, c.columnaArchivo) } } : undefined
          )
        }
        onCerrar={() => useStoreBusqueda.setState({ buscarAbierto: false })}
        tokenFoco={b.tokenFoco}
      />
    </ErrorBoundary>
  )
}
