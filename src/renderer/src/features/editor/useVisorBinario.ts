// =============================================================================
// Estado y efectos de PaneVisorBinario: carga del contenido, object-URL del PDF, del audio o del
// vídeo y Ctrl+F del docx.
// Vive en un hook (y no en subcomponentes) para conservar el orden de los efectos del pane.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { sanitizeDocxHtml } from './contenidoHtml'
import { useBusquedaDom } from './useBusquedaDom'
import { cargarBinario } from './cargaVisorBinario'
import { mimeMediaDeRuta } from './tipoVisor'
import { abrirExterno, revelarEnCarpeta, revocarUrl } from './visorComun'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { txBinario } from './textosVisores.ts'
import type { TipoBinario, ResultadoCarga } from './cargaVisorBinario'
import type { LadoDiff } from './diffEditorTipos'
import type { EntradaListadoZip } from '../../../../shared/archivos-ipc'
import type { ArchivoAbierto } from './paneCentral'

interface EntradaVisorBinario {
  archivo: ArchivoAbierto
  tipo: TipoBinario
  buscable: boolean
  bytesLado?: LadoDiff
}

/** Object-URL de unos bytes; sin tipo, el navegador lo deduce del contenido. */
function urlDeBytes(bytes: Uint8Array, tipo: string): string {
  // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
  return URL.createObjectURL(new Blob([bytes as BlobPart], tipo ? { type: tipo } : undefined))
}

/** Estado del visor binario: contenido cargado, aviso, búsqueda del docx y acciones de sistema. */
export function useVisorBinario({ archivo, tipo, buscable, bytesLado }: EntradaVisorBinario) {
  const raiz = useRaizDelProyecto()
  const [cargando, setCargando] = useState(true)
  // `tecnico`: una excepción, no un motivo escrito para el usuario.
  const [error, setError] = useState<{ texto: string; tecnico: boolean } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string>('')

  // Ctrl+F solo en el docx: el PDF es un iframe con su propia búsqueda y el zip es una tabla.
  const busqueda = useBusquedaDom({ activo: buscable && tipo === 'docx', html: docxHtml })
  const [entradasZip, setEntradasZip] = useState<EntradaListadoZip[] | null>(null)

  // Espejo en ref: el cleanup no debe capturar el estado.
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError(null)
    setAviso(null)

    function aplicar(r: ResultadoCarga): void {
      if (r.tipo === 'error') {
        setError({ texto: r.mensaje, tecnico: false })
      } else if (r.tipo === 'bytes') {
        const nueva = urlDeBytes(r.bytes, tipo === 'pdf' ? 'application/pdf' : mimeMediaDeRuta(archivo.ruta))
        revocarUrl(urlRef)
        urlRef.current = nueva
        setUrl(nueva)
      } else if (r.tipo === 'docx') {
        setDocxHtml(sanitizeDocxHtml(r.html))
        if (r.avisos > 0) {
          setAviso(txBinario().convertido(r.avisos))
        }
      } else {
        setEntradasZip(r.entradas)
      }
    }

    async function cargar(): Promise<void> {
      try {
        const r = await cargarBinario(tipo, { raiz, ruta: archivo.ruta }, bytesLado)
        if (cancelado) return
        aplicar(r)
      } catch (err) {
        if (!cancelado) setError({ texto: err instanceof Error ? err.message : String(err), tecnico: true })
      } finally {
        if (!cancelado) setCargando(false)
      }
    }
    void cargar()

    return () => {
      cancelado = true
    }
    // `bytesLado` se descompone en sus campos: el objeto se construye en el JSX de `PaneDePestana`
    // y depender de su identidad relanzaría la lectura en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiz, archivo.ruta, tipo, bytesLado?.origen, bytesLado?.hash, bytesLado?.ruta])

  useEffect(() => () => revocarUrl(urlRef), [])

  /** El navegador no pudo decodificar el audio o el vídeo: códec o contenedor que no conoce. */
  const alFallarReproduccion = (): void => setError({ texto: txBinario().noReproducible, tecnico: false })

  async function avisar(accion: Promise<string | null>): Promise<void> {
    const aviso = await accion
    if (aviso) setAviso(aviso)
  }
  const abrirExternoConAviso = (): Promise<void> => avisar(abrirExterno({ raiz, ruta: archivo.ruta }))
  const revelarEnCarpetaConAviso = (): Promise<void> => avisar(revelarEnCarpeta({ raiz, ruta: archivo.ruta }))

  return { cargando, error, aviso, url, docxHtml, entradasZip, busqueda, alFallarReproduccion, abrirExternoConAviso, revelarEnCarpetaConAviso }
}
