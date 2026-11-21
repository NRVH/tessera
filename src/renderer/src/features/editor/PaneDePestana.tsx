// =============================================================================
// Qué visor pinta cada pestaña del editor: Monaco para texto, visores propios para
// imágenes, clases compiladas y binarios, y para un diff el visor que corresponde al
// tipo de archivo (el .svg se compara como texto y un comprimido, por dentro).
// Es una función, no un componente: el árbol de React bajo cada pane no cambia.
// =============================================================================
import { esComprimido } from '../../../../shared/comprimidos'
import { etiquetaRevisiones } from '../git'
import { PaneVisorBinario } from './PaneVisorBinario'
import { seLeePorBytes, type TipoBinario } from './cargaVisorBinario'
import { PaneComprimidoDiff } from './ComprimidoDiffPane'
import { PaneDiffEditor } from './DiffEditorPane'
import type { DestinoDiff } from './diffEditorTipos'
import { PaneEditor } from './EditorPane'
import type { PestanaEditor } from './modeloPestanasEditor'
import { PaneDiffImagen } from './PaneDiffImagen'
import { PaneVisorImagen } from './PaneVisorImagen'
import { PaneClaseJava } from './PaneClaseJava'
import { claveModeloTexto } from './registroModelosTexto'
import { esRutaSvg, tipoVisorDeRuta, type TipoVisorArchivo } from './tipoVisor'
import { fijarModoVistaPane, fijarMetaPane, marcarPaneBorrado, marcarPaneSucio, useStoreEditor, type EstadoEditor } from './store'
import type { EditorApp } from './useEditorApp'

/** Todo lo que un pane necesita de la ventana. */
export interface PaneContexto {
  editor: EditorApp
  estado: Pick<EstadoEditor, 'tokensRecarga' | 'tokensGuardado' | 'peticionesConversionPorClave' | 'peticionesReaperturaPorClave' | 'revelarPorPane'>
  editorAreaOculta: boolean
  diffColapsar: boolean
  onColapsarSinCambios: (v: boolean) => void
  worktreeTick: number
  onGuardado: () => void
  altoFilaGit: number
  variablesGit: Record<string, string>
}

interface Pane {
  claveDestino: string
  pestana: PestanaEditor
  pk: string
  visible: boolean
}

/** Diff de texto, que también pinta el aviso de un archivo borrado. */
function paneDeDiffTexto(p: Pane, destino: DestinoDiff, c: PaneContexto): React.JSX.Element {
  return (
    <PaneDiffEditor
      destino={destino}
      visible={p.visible}
      onSaltarAlFuente={(linea) => c.editor.abrirFuenteDelDiff(destino, linea)}
      claveModelo={claveModeloTexto(p.claveDestino, destino.despues.ruta)}
      onGuardado={c.onGuardado}
      onCambioSucio={(sucio) => marcarPaneSucio(p.pk, sucio)}
      tokenRecarga={c.estado.tokensRecarga.get(p.pk) ?? 0}
      colapsarSinCambios={c.diffColapsar}
      onColapsarSinCambios={c.onColapsarSinCambios}
    />
  )
}

/** Diff con visor propio de clase o de binario; `null` si toca el de texto. */
function paneDeDiffBinario(p: Pane, destino: DestinoDiff, c: PaneContexto, visor: TipoVisorArchivo): React.JSX.Element | null {
  const { claveDestino, pestana, visible } = p
  const cerrar = (): void => c.editor.cerrarPestana(pestana.id)
  const archivo = { ruta: destino.despues.ruta, nombre: destino.despues.ruta.split('/').pop() ?? destino.ruta }
  // Un visor que lee por RUTA solo puede enseñar la revisión si lo pedido es el disco.
  const esDisco = destino.despues.origen === 'worktree'
  if (visor === 'javaClass' && esDisco) {
    return (
      <PaneClaseJava
        archivo={archivo}
        visible={visible}
        claveDestino={claveDestino}
        claveDestinoActivo={c.editor.claveEditorActivo ?? ''}
        fsTick={c.worktreeTick}
        onCerrar={cerrar}
      />
    )
  }
  if (seLeePorBytes(visor) || (visor !== 'monaco' && esDisco)) {
    return (
      <PaneVisorBinario
        archivo={archivo}
        tipo={visor as TipoBinario}
        visible={visible}
        reproductorVisible={visible && !c.editorAreaOculta}
        revision={esDisco ? undefined : etiquetaRevisiones(destino.commitHash)}
        bytesLado={seLeePorBytes(visor) ? destino.despues : undefined}
        onCerrar={cerrar}
      />
    )
  }
  return null
}

/** Visor de un diff: comprimido, imagen, borrado, clase, binario o texto. */
function paneDeDiff(p: Pane, destino: DestinoDiff, c: PaneContexto): React.JSX.Element {
  const { claveDestino, pestana, visible } = p
  const claveDestinoActivo = c.editor.claveEditorActivo ?? ''
  if (esComprimido(destino.ruta)) {
    return (
      <PaneComprimidoDiff
        destino={destino}
        visible={visible}
        clavePane={p.pk}
        altoFila={c.altoFilaGit}
        variablesDensidad={c.variablesGit}
        colapsarSinCambios={c.diffColapsar}
        onColapsarSinCambios={c.onColapsarSinCambios}
        claveDestino={claveDestino}
        claveDestinoActivo={claveDestinoActivo}
        fsTick={c.worktreeTick}
      />
    )
  }
  const visor = esRutaSvg(destino.ruta) ? 'monaco' : tipoVisorDeRuta(destino.ruta)
  if (visor === 'image') {
    return (
      <PaneDiffImagen
        destino={destino}
        visible={visible}
        claveDestino={claveDestino}
        claveDestinoActivo={claveDestinoActivo}
        fsTick={c.worktreeTick}
        onCerrar={() => c.editor.cerrarPestana(pestana.id)}
      />
    )
  }
  // En un borrado no hay archivo que abrir: el diff de texto pinta su aviso.
  if (destino.despues.origen === 'empty') return paneDeDiffTexto(p, destino, c)
  return paneDeDiffBinario(p, destino, c, visor) ?? paneDeDiffTexto(p, destino, c)
}

/** Visor de un archivo del proyecto según su tipo. */
function paneDeArchivo(p: Pane, archivo: { ruta: string; nombre: string }, c: PaneContexto): React.JSX.Element {
  const { claveDestino, pestana, pk, visible } = p
  const cerrar = (): void => c.editor.cerrarPestana(pestana.id)
  const visor = tipoVisorDeRuta(archivo.ruta)
  if (visor === 'monaco') {
    return (
      <PaneEditor
        archivo={archivo}
        visible={visible}
        buscable={visible && !c.editorAreaOculta}
        onGuardado={c.onGuardado}
        onCambioSucio={(sucio) => marcarPaneSucio(pk, sucio)}
        onCambioBorrado={(b) => marcarPaneBorrado(pk, b)}
        onModoVista={(m) => fijarModoVistaPane(pk, m)}
        tokenRecarga={c.estado.tokensRecarga.get(pk) ?? 0}
        onMeta={(m) => fijarMetaPane(pk, m)}
        peticionConversion={c.estado.peticionesConversionPorClave.get(pk)}
        peticionReapertura={c.estado.peticionesReaperturaPorClave.get(pk)}
        claveModelo={claveModeloTexto(claveDestino, archivo.ruta)}
        revelar={c.estado.revelarPorPane.get(pk)}
        // Solo cuenta al montarse (el pane guarda su modo): se lee sin suscribirse, así cambiar de modo no repinta las demás.
        modoInicial={useStoreEditor.getState().modoVistaPorPane.get(pk)}
      />
    )
  }
  if (visor === 'image') return <PaneVisorImagen archivo={archivo} visible={visible} onCerrar={cerrar} />
  if (visor === 'javaClass') {
    // Se descompila contra el proyecto ACTIVO: un pane de otro proyecto no puede pedir.
    return (
      <PaneClaseJava
        archivo={archivo}
        visible={visible}
        claveDestino={claveDestino}
        claveDestinoActivo={c.editor.claveEditorActivo ?? ''}
        fsTick={c.worktreeTick}
        onCerrar={cerrar}
      />
    )
  }
  return <PaneVisorBinario archivo={archivo} tipo={visor} visible={visible} reproductorVisible={visible && !c.editorAreaOculta} onCerrar={cerrar} />
}

/** Elemento del pane de una pestaña (sin su ErrorBoundary, que pone el área). */
export function paneDePestana(p: Pane, c: PaneContexto): React.JSX.Element {
  const pane = p.pestana.pane
  if (pane.tipo === 'diff') return paneDeDiff(p, pane.destino, c)
  if (pane.tipo === 'file') return paneDeArchivo(p, pane.archivo, c)
  // Sin título: el mismo editor, sin lectura de disco; su guardado va al diálogo.
  const sinTitulo = pane.sinTitulo
  const { pk } = p
  return (
    <PaneEditor
      archivo={{ ruta: sinTitulo.nombre, nombre: sinTitulo.nombre }}
      sinTituloId={sinTitulo.id}
      onGuardarSinTitulo={(contenido) => c.editor.guardarPaneSinTitulo(p.pestana.id, sinTitulo, contenido)}
      tokenGuardado={c.estado.tokensGuardado.get(pk) ?? 0}
      visible={p.visible}
      onGuardado={c.onGuardado}
      onCambioSucio={(sucio) => marcarPaneSucio(pk, sucio)}
      onCambioBorrado={(b) => marcarPaneBorrado(pk, b)}
      onMeta={(m) => fijarMetaPane(pk, m)}
    />
  )
}
