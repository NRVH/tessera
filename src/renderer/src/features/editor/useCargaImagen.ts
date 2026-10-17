// =============================================================================
// Carga de los bytes de una imagen por IPC y su object-URL, que se revoca al cambiar o desmontar.
// `loading` se apaga en el onLoad/onError del <img>, cuando de verdad se decodifica.
// Lo usa `useImageViewer`.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { imageMimeForPath } from './viewerKind'
import { revocarUrl } from './visorComun'
import { txImagen } from './textosVisores.ts'

interface EntradaCarga {
  setLoading: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  /** Devuelve la vista (zoom, rotación, medidas) a su estado inicial. */
  reiniciar: () => void
}

/** Carga la imagen de `path` (del proyecto `raiz`); expone su URL, su peso y el aviso del visor. */
export function useCargaImagen(raiz: string, path: string, { setLoading, setError, reiniciar }: EntradaCarga) {
  const [notice, setNotice] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [size, setSize] = useState(0)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotice(null)
    reiniciar()

    async function load(): Promise<void> {
      try {
        const res = await window.tessera.files.readBinary({ raiz, path })
        if (cancelled) return
        if (res.truncated) {
          setError(txImagen().supera50)
          setLoading(false)
          return
        }
        setSize(res.size)
        // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
        const mime = imageMimeForPath(path)
        const nuevo = URL.createObjectURL(
          new Blob([res.bytes as BlobPart], mime ? { type: mime } : undefined)
        )
        revocarUrl(urlRef)
        urlRef.current = nuevo
        setUrl(nuevo)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [raiz, path, setLoading, setError, reiniciar])

  useEffect(() => () => revocarUrl(urlRef), [])

  return { notice, setNotice, url, size }
}
