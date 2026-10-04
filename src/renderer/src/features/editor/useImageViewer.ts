// =============================================================================
// Estado del visor de imágenes: carga (`useCargaImagen`), vista (`useZoomPanImagen`),
// conmutador imagen⇄código de un SVG y acciones de sistema.
// Lo usa `ImageViewerPane`.
// =============================================================================

import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { isSvgPath } from './viewerKind'
import { abrirExterno, revelarEnCarpeta } from './visorComun'
import { useCargaImagen } from './useCargaImagen'
import { useZoomPanImagen } from './useZoomPanImagen'
import type { OpenFile } from './centerPane'

/** Todo lo que necesita ImageViewerPane para pintarse y reaccionar. */
export function useImageViewer({ file, visible }: { file: OpenFile; visible: boolean }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Ver el código fuente de un SVG (texto) en vez de la imagen renderizada.
  const [showSource, setShowSource] = useState(false)
  const [source, setSource] = useState<string | null>(null)

  const zoom = useZoomPanImagen({ visible, loading, error, showSource })
  const carga = useCargaImagen(file.path, { setLoading, setError, reiniciar: zoom.reiniciar })
  const { setNotice } = carga

  function onImgLoad(e: SyntheticEvent<HTMLImageElement>): void {
    setLoading(false)
    // Decodificada pero sin dimensiones útiles (raro): se trata como no mostrable.
    if (!zoom.alCargar(e)) setError('No se pudieron determinar las dimensiones de la imagen.')
  }

  function onImgError(): void {
    setLoading(false)
    setError(
      'Este formato de imagen no se puede mostrar en el visor. Ábrelo con la aplicación del sistema.'
    )
  }

  async function avisar(accion: Promise<string | null>): Promise<void> {
    const aviso = await accion
    if (aviso) setNotice(aviso)
  }
  const openExternally = (): Promise<void> => avisar(abrirExterno(file.path))
  const revealInFolder = (): Promise<void> => avisar(revelarEnCarpeta(file.path))

  // El texto del SVG se pide la primera vez que se activa el conmutador.
  async function toggleSource(): Promise<void> {
    const next = !showSource
    setShowSource(next)
    if (next && source === null) {
      try {
        const res = await window.tessera.files.read(file.path)
        setSource(res.content)
      } catch (e) {
        setSource(`No se pudo leer el código: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // Al volver a la imagen se re-ajusta: el área estuvo oculta mientras se veía el código.
    if (!next) requestAnimationFrame(() => { if (zoom.fitModeRef.current) zoom.applyFit() })
  }

  return {
    ...zoom,
    loading, error, showSource, source, isSvg: isSvgPath(file.path),
    notice: carga.notice, url: carga.url, size: carga.size,
    onImgLoad, onImgError, openExternally, revealInFolder, toggleSource
  }
}
