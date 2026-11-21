// =============================================================================
// PaneVisorBinario: visor de archivos no textuales (PDF, ZIP, audio, vídeo).
// Misma cáscara `.editor` y clase `.hidden` cuando no es el pane activo; nunca se desmonta.
// El contenido llega solo por IPC (ver `cargaVisorBinario`); el estado, en `useVisorBinario`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
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
   * ¿Está de verdad a la vista? Gobierna la pausa del audio y el vídeo si se oculta el área.
   */
  reproductorVisible?: boolean
  /** Rótulo de revisión de la cabecera, cuando el visor se abre desde un diff. */
  revision?: string
  /**
   * Lado del diff del que sacar los bytes en vez de leerlos del disco. Solo PDF, audio y
   * vídeo: los ZIP de una revisión se comparan por sus entradas en el diff de comprimidos.
   */
  bytesLado?: LadoDiff
  onCerrar: () => void
}

function etiquetaTipo(tipo: TipoBinario): string {
  const t = txBinario()
  return { pdf: t.tipoPdf, zip: t.tipoZip, audio: t.tipoAudio, video: t.tipoVideo }[tipo]
}

/** Una excepción va plegada como detalle técnico; un motivo escrito para el usuario se ve. */
function textoDelFallo(e: { texto: string; tecnico: boolean }): { detalle: string } | { sugerencia: string } {
  return e.tecnico ? { detalle: e.texto } : { sugerencia: e.texto }
}

export function PaneVisorBinario({
  archivo,
  tipo,
  visible,
  reproductorVisible = false,
  revision,
  bytesLado,
  onCerrar
}: PropsPaneVisorBinario): React.JSX.Element {
  const v = useVisorBinario({ archivo, tipo, bytesLado })
  const entradaRef = useEntradaContenido(JSON.stringify([archivo.ruta, tipo, bytesLado, v.cargando]), visible)
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
        <ReproductorMedia video={tipo === 'video'} url={v.url} visible={reproductorVisible} onError={v.alFallarReproduccion} />
      ) : tipo === 'zip' && v.entradasZip ? (
        <VistaListadoZip entradas={v.entradasZip} />
      ) : null}
    </section>
  )
}

interface PropsCabeceraBinaria {
  revision?: string
  aviso: string | null
  onAbrir: () => void
  onRevelar: () => void
  onCerrar: () => void
}

function CabeceraBinaria({
  revision,
  aviso,
  onAbrir,
  onRevelar,
  onCerrar
}: PropsCabeceraBinaria): React.JSX.Element {
  const t = txBinario()
  const comun = txVisorComun()
  const mostrarEn = comun.mostrarEnExplorador(nombresSistema(window.tessera.plataforma).gestorArchivos)
  return (
    <header className="panel-header editor-header">
      {revision && (
        <span className="panel-title">
          <span className="diff-revisiones">
            {revision}
          </span>
        </span>
      )}
      <div className="panel-actions acciones-con-aviso">
        {aviso && <span className="editor-notice" title={aviso}>{aviso}</span>}
        <button
          className="btn"
          onClick={onAbrir}
          title={t.abrirTitulo(comun.abrirExternamente)}
        >
          <IconoExterno />
          {comun.abrirExternamente}
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

