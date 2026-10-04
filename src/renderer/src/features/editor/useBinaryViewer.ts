// =============================================================================
// Estado y efectos de BinaryViewerPane: carga del contenido, object-URL del PDF y Ctrl+F del docx.
// Vive en un hook (y no en subcomponentes) para conservar el orden de los efectos del pane.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { sanitizeDocxHtml } from './htmlContent'
import { useDomSearch } from './useDomSearch'
import { cargarBinario } from './binaryViewerCarga'
import { abrirExterno, revelarEnCarpeta, revocarUrl } from './visorComun'
import type { KindBinario, ResultadoCarga } from './binaryViewerCarga'
import type { DiffSide } from './diffEditorTipos'
import type { ZipEntry } from '../../../../shared/files-ipc'
import type { OpenFile } from './centerPane'

interface EntradaBinaryViewer {
  file: OpenFile
  kind: KindBinario
  buscable: boolean
  bytesLado?: DiffSide
}

/** Estado del visor binario: contenido cargado, aviso, búsqueda del docx y acciones de sistema. */
export function useBinaryViewer({ file, kind, buscable, bytesLado }: EntradaBinaryViewer) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string>('')

  // Ctrl+F solo en el docx: el PDF es un iframe con su propia búsqueda y el zip es una tabla.
  const busqueda = useDomSearch({
    activo: buscable && kind === 'docx',
    html: docxHtml
  })
  const [zipEntries, setZipEntries] = useState<ZipEntry[] | null>(null)

  // Espejo en ref: el cleanup no debe capturar el estado.
  const pdfUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotice(null)

    function aplicar(r: ResultadoCarga): void {
      if (r.tipo === 'error') {
        setError(r.mensaje)
      } else if (r.tipo === 'pdf') {
        // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
        const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }))
        revocarUrl(pdfUrlRef)
        pdfUrlRef.current = url
        setPdfUrl(url)
      } else if (r.tipo === 'docx') {
        setDocxHtml(sanitizeDocxHtml(r.html))
        if (r.avisos > 0) {
          setNotice(`Convertido con ${r.avisos} aviso(s) de formato. Usa "Abrir en Word" para verlo tal cual.`)
        }
      } else {
        setZipEntries(r.entries)
      }
    }

    async function load(): Promise<void> {
      try {
        const r = await cargarBinario(kind, file.path, bytesLado)
        if (cancelled) return
        aplicar(r)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()

    return () => {
      cancelled = true
    }
    // `bytesLado` se descompone en sus campos: el objeto se construye en el JSX de `PaneDeTab`
    // y depender de su identidad relanzaría la lectura en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, kind, bytesLado?.source, bytesLado?.hash, bytesLado?.path])

  useEffect(() => () => revocarUrl(pdfUrlRef), [])

  async function avisar(accion: Promise<string | null>): Promise<void> {
    const aviso = await accion
    if (aviso) setNotice(aviso)
  }
  const openExternally = (): Promise<void> => avisar(abrirExterno(file.path))
  const revealInFolder = (): Promise<void> => avisar(revelarEnCarpeta(file.path))

  return { loading, error, notice, pdfUrl, docxHtml, zipEntries, busqueda, openExternally, revealInFolder }
}
