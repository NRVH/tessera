// =============================================================================
// Estado y efectos de BinaryViewerPane: carga del contenido, object-URL del PDF, del audio o del
// vídeo y Ctrl+F del docx.
// Vive en un hook (y no en subcomponentes) para conservar el orden de los efectos del pane.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { sanitizeDocxHtml } from './htmlContent'
import { useDomSearch } from './useDomSearch'
import { cargarBinario } from './binaryViewerCarga'
import { mediaMimeForPath } from './viewerKind'
import { abrirExterno, revelarEnCarpeta, revocarUrl } from './visorComun'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { txBinario } from './textosVisores.ts'
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

/** Object-URL de unos bytes; sin tipo, el navegador lo deduce del contenido. */
function urlDeBytes(bytes: Uint8Array, tipo: string): string {
  // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
  return URL.createObjectURL(new Blob([bytes as BlobPart], tipo ? { type: tipo } : undefined))
}

/** Estado del visor binario: contenido cargado, aviso, búsqueda del docx y acciones de sistema. */
export function useBinaryViewer({ file, kind, buscable, bytesLado }: EntradaBinaryViewer) {
  const raiz = useRaizDelProyecto()
  const [loading, setLoading] = useState(true)
  // `tecnico`: una excepción, no un motivo escrito para el usuario.
  const [error, setError] = useState<{ texto: string; tecnico: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string>('')

  // Ctrl+F solo en el docx: el PDF es un iframe con su propia búsqueda y el zip es una tabla.
  const busqueda = useDomSearch({ activo: buscable && kind === 'docx', html: docxHtml })
  const [zipEntries, setZipEntries] = useState<ZipEntry[] | null>(null)

  // Espejo en ref: el cleanup no debe capturar el estado.
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotice(null)

    function aplicar(r: ResultadoCarga): void {
      if (r.tipo === 'error') {
        setError({ texto: r.mensaje, tecnico: false })
      } else if (r.tipo === 'bytes') {
        const nueva = urlDeBytes(r.bytes, kind === 'pdf' ? 'application/pdf' : mediaMimeForPath(file.path))
        revocarUrl(urlRef)
        urlRef.current = nueva
        setUrl(nueva)
      } else if (r.tipo === 'docx') {
        setDocxHtml(sanitizeDocxHtml(r.html))
        if (r.avisos > 0) {
          setNotice(txBinario().convertido(r.avisos))
        }
      } else {
        setZipEntries(r.entries)
      }
    }

    async function load(): Promise<void> {
      try {
        const r = await cargarBinario(kind, { raiz, path: file.path }, bytesLado)
        if (cancelled) return
        aplicar(r)
      } catch (err) {
        if (!cancelled) setError({ texto: err instanceof Error ? err.message : String(err), tecnico: true })
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
  }, [raiz, file.path, kind, bytesLado?.source, bytesLado?.hash, bytesLado?.path])

  useEffect(() => () => revocarUrl(urlRef), [])

  /** El navegador no pudo decodificar el audio o el vídeo: códec o contenedor que no conoce. */
  const alFallarReproduccion = (): void => setError({ texto: txBinario().noReproducible, tecnico: false })

  async function avisar(accion: Promise<string | null>): Promise<void> {
    const aviso = await accion
    if (aviso) setNotice(aviso)
  }
  const openExternally = (): Promise<void> => avisar(abrirExterno({ raiz, path: file.path }))
  const revealInFolder = (): Promise<void> => avisar(revelarEnCarpeta({ raiz, path: file.path }))

  return { loading, error, notice, url, docxHtml, zipEntries, busqueda, alFallarReproduccion, openExternally, revealInFolder }
}
