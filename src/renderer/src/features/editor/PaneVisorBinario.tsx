// =============================================================================
// PaneVisorBinario: visor de archivos no textuales (pdf, docx, zip, audio, vídeo), gemelo de PaneEditor.
// Misma cáscara `.editor` y clase `.hidden` cuando no es el pane activo; nunca se desmonta.
// El contenido llega solo por IPC (ver `cargaVisorBinario`); el estado, en `useVisorBinario`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { Presente } from '../../comun/Presente'
import { useCallback, useEffect, useRef } from 'react'
import { CajaBusqueda } from '../../comun/CajaBusqueda'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { formatoBytes } from '../../util/formatoBytes'
import { useVisorBinario } from './useVisorBinario'
import { useEntradaContenido } from '../../comun/useEntradaContenido'
import { IconoCerrarVisor, IconoExterno, IconoCarpetaVisor } from './iconosVisor'
import type { TipoBinario } from './cargaVisorBinario'
import type { LadoDiff } from './diffEditorTipos'
import type { EntradaListadoZip } from '../../../../shared/archivos-ipc'
import type { ArchivoAbierto } from './paneCentral'
import { txBinario, txVisorComun } from './textosVisores.ts'
import { nombresSistema } from '../../../../shared/nombresSistema'

interface PropsPaneVisorBinario {
  archivo: ArchivoAbierto
  /** Discriminador del visor. 'monaco'/'image' no llegan aquí (los pintan PaneEditor/PaneVisorImagen). */
  tipo: TipoBinario
  /** Igual que PaneEditor: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  /**
   * ¿Está de verdad a la vista? Gobierna el Ctrl+F del .docx y la pausa del audio y el vídeo
   * (el área entera puede estar oculta).
   */
  buscable?: boolean
  /** Rótulo de revisión de la cabecera, cuando el visor se abre desde un diff. */
  revision?: string
  /**
   * Lado del diff del que sacar los bytes en vez de leerlos del disco. Solo PDF, audio y
   * vídeo: el .docx y el .zip los procesa el main a partir de una ruta, y de una revisión
   * vieja no hay nada que enseñar.
   */
  bytesLado?: LadoDiff
  onCerrar: () => void
}

function etiquetaTipo(tipo: TipoBinario): string {
  const t = txBinario()
  return { pdf: t.tipoPdf, docx: t.tipoDocx, zip: t.tipoZip, audio: t.tipoAudio, video: t.tipoVideo }[tipo]
}

/** Una excepción va plegada como detalle técnico; un motivo escrito para el usuario se ve. */
function textoDelFallo(e: { texto: string; tecnico: boolean }): { detalle: string } | { sugerencia: string } {
  return e.tecnico ? { detalle: e.texto } : { sugerencia: e.texto }
}

export function PaneVisorBinario({
  archivo,
  tipo,
  visible,
  buscable = false,
  revision,
  bytesLado,
  onCerrar
}: PropsPaneVisorBinario): React.JSX.Element {
  const v = useVisorBinario({ archivo, tipo, buscable, bytesLado })
  const entradaRef = useEntradaContenido(JSON.stringify([archivo.ruta, tipo, bytesLado, v.cargando]), visible)
  const { busqueda } = v
  const t = txBinario()
  const comun = txVisorComun()
  return (
    <section ref={entradaRef} className={`editor binary-viewer${visible ? '' : ' hidden'}`}
      aria-label={etiquetaTipo(tipo)}
      aria-hidden={!visible}
    >
      <CabeceraBinaria
        revision={revision}
        aviso={v.aviso}
        etiquetaAbrir={tipo === 'docx' ? t.abrirEnWord : comun.abrirExternamente}
        onAbrir={() => void v.abrirExternoConAviso()}
        onRevelar={() => void v.revelarEnCarpetaConAviso()}
        onCerrar={onCerrar}
      />
      {v.error ? (
        <AvisoCaja tono="error" titulo={t.noSePudoAbrir} {...textoDelFallo(v.error)} />
      ) : v.cargando ? (
        <div className="binary-viewer-status">{comun.cargando}</div>
      ) : tipo === 'pdf' && v.url ? (
        <iframe className="pdf-frame" src={v.url} title={archivo.nombre} />
      ) : (tipo === 'audio' || tipo === 'video') && v.url ? (
        <ReproductorMedia video={tipo === 'video'} url={v.url} visible={buscable} onError={v.alFallarReproduccion} />
      ) : tipo === 'docx' ? (
        // Aquí el contenido y el scroller NO son el mismo nodo: `.docx-preview` es
        // un bloque de altura natural y quien scrollea es `.binary-viewer-body`.
        <div className="binary-viewer-body" ref={busqueda.refContenedorScroll}>
          <div
            className="docx-preview"
            ref={busqueda.refContenido}
            dangerouslySetInnerHTML={{ __html: v.docxHtml }}
          />
        </div>
      ) : tipo === 'zip' && v.entradasZip ? (
        <VistaListadoZip entradas={v.entradasZip} />
      ) : null}
      <Presente visible={busqueda.abierto} className="mov-aparece mov-desde-arriba" style={{ position: 'absolute', top: 0, right: 0, zIndex: 3 }}>
        <CajaBusqueda
          className="en-documento"
          etiquetaAria={t.buscarEnDocumento}
          tokenFoco={busqueda.tokenFoco}
          onBuscar={busqueda.buscar}
          onNavigate={busqueda.navegar}
          resultados={busqueda.resultados}
          onCerrar={busqueda.cerrar}
        />
      </Presente>
    </section>
  )
}

interface PropsCabeceraBinaria {
  revision?: string
  aviso: string | null
  etiquetaAbrir: string
  onAbrir: () => void
  onRevelar: () => void
  onCerrar: () => void
}

function CabeceraBinaria({
  revision,
  aviso,
  etiquetaAbrir,
  onAbrir,
  onRevelar,
  onCerrar
}: PropsCabeceraBinaria): React.JSX.Element {
  const t = txBinario()
  const comun = txVisorComun()
  const mostrarEn = comun.mostrarEnExplorador(nombresSistema(window.tessera.plataforma).gestorArchivos)
  return (
    <header className="panel-header editor-header">
      {/* Sin rótulo de tipo ni ruta: la pestaña ya los dice. KIND_LABEL es el aria-label
          de la <section>, donde la identidad tiene que quedarse. */}
      <span className="panel-title">
        {/* Qué revisión se ve: solo desde un diff. Estos formatos no se comparan, así que se
            pinta siempre el archivo del disco y sin este rótulo el pane mentiría. */}
        {revision && (
          <span className="diff-revisiones">
            {revision}
          </span>
        )}
      </span>
      <div className="panel-actions">
        {aviso && <span className="editor-notice">{aviso}</span>}
        <button
          className="btn"
          onClick={onAbrir}
          title={t.abrirTitulo(etiquetaAbrir)}
        >
          <IconoExterno />
          {etiquetaAbrir}
        </button>
        <button
          className="btn btn-icon"
          onClick={onRevelar}
          title={mostrarEn}
          aria-label={mostrarEn}
        >
          <IconoCarpetaVisor />
        </button>
        <button className="btn btn-icon" onClick={onCerrar} title={comun.cerrarArchivo} aria-label={comun.cerrarArchivo}>
          <IconoCerrarVisor />
        </button>
      </div>
    </header>
  )
}

/** El reproductor nativo de audio o vídeo. Se pausa al ocultarse: la pestaña sigue montada y sonaría. */
function ReproductorMedia(p: { video: boolean; url: string; visible: boolean; onError: () => void }): React.JSX.Element {
  const ref = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    if (!p.visible) ref.current?.pause()
  }, [p.visible])
  // Ref de callback: el mismo vale para el `<audio>` y para el `<video>`.
  const fijar = useCallback((el: HTMLMediaElement | null): void => {
    ref.current = el
  }, [])
  return p.video ? (
    <div className="visor-media es-video">
      <video ref={fijar} src={p.url} controls onError={p.onError} />
    </div>
  ) : (
    <div className="visor-media">
      <audio ref={fijar} src={p.url} controls onError={p.onError} />
    </div>
  )
}

/** Listado del contenido de un .zip: carpetas y archivos con sus tamaños. */
function VistaListadoZip({ entradas }: { entradas: EntradaListadoZip[] }): React.JSX.Element {
  const archivos = entradas.filter((e) => !e.isDir)
  const tamanoTotal = archivos.reduce((n, e) => n + e.size, 0)
  const t = txBinario()
  return (
    <div className="binary-viewer-body">
      <div className="zip-summary">
        {t.zipResumen(archivos.length, entradas.length - archivos.length, formatoBytes(tamanoTotal))}
      </div>
      {entradas.length === 0 ? (
        <div className="binary-viewer-status">{t.archivoVacio}</div>
      ) : (
        <table className="zip-table">
          <thead>
            <tr>
              <th>{t.colNombre}</th>
              <th className="num">{t.colTamano}</th>
              <th className="num">{t.colComprimido}</th>
            </tr>
          </thead>
          <tbody>
            {entradas.map((e) => (
              <tr key={e.name} className={e.isDir ? 'is-dir' : ''}>
                <td title={e.name}>
                  {e.isDir ? '📁 ' : '📄 '}
                  {e.name}
                </td>
                <td className="num">{e.isDir ? '—' : formatoBytes(e.size)}</td>
                <td className="num">{e.isDir ? '—' : formatoBytes(e.compressedSize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

