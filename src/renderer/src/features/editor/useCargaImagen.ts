// =============================================================================
// Carga de los bytes de una imagen por IPC y su object-URL, que se revoca al cambiar o desmontar.
// `loading` se apaga en el onLoad/onError del <img>, cuando de verdad se decodifica.
// Lo usa `useVisorImagen`.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { mimeImagenDeRuta } from './tipoVisor'
import { revocarUrl } from './visorComun'
import { txImagen } from './textosVisores.ts'

interface EntradaCarga {
  setCargando: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  /** Devuelve la vista (zoom, rotación, medidas) a su estado inicial. */
  reiniciar: () => void
}

/** Carga la imagen de `path` (del proyecto `raiz`); expone su URL, su peso y el aviso del visor. */
export function useCargaImagen(raiz: string, ruta: string, { setCargando, setError, reiniciar }: EntradaCarga) {
  const [aviso, setAviso] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [tamano, setTamano] = useState(0)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError(null)
    setAviso(null)
    reiniciar()

    async function cargar(): Promise<void> {
      try {
        const res = await window.tessera.files.leerBinario({ raiz, ruta })
        if (cancelado) return
        if (res.truncado) {
          setError(txImagen().supera50)
          setCargando(false)
          return
        }
        setTamano(res.tamano)
        // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
        const mime = mimeImagenDeRuta(ruta)
        const nuevo = URL.createObjectURL(
          new Blob([res.bytes as BlobPart], mime ? { type: mime } : undefined)
        )
        revocarUrl(urlRef)
        urlRef.current = nuevo
        setUrl(nuevo)
      } catch (err) {
        if (!cancelado) {
          setError(err instanceof Error ? err.message : String(err))
          setCargando(false)
        }
      }
    }
    void cargar()

    return () => {
      cancelado = true
    }
  }, [raiz, ruta, setCargando, setError, reiniciar])

  useEffect(() => () => revocarUrl(urlRef), [])

  return { aviso, setAviso, url, tamano }
}
