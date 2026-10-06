// =============================================================================
// Soltar archivos o carpetas del equipo sobre el explorador SFTP: resalta adónde irán mientras se
// arrastra algo que trae archivos (no un texto ni una selección de la propia página): la carpeta de la
// lista que hay bajo el puntero o, si no hay ninguna, la zona entera (la carpeta que se ve). Entrega los
// `File` soltados y esa carpeta. Un contador de entradas y salidas evita el parpadeo al pasar por encima
// de los hijos. Las rutas del equipo no las toca el renderer: las saca el preload. Sin dependencias de IPC.
// =============================================================================

import { useRef, useState, type DragEvent } from 'react'

/** El atributo de las filas de carpeta que reciben lo soltado (su valor es el nombre de la carpeta). */
export const ATRIBUTO_CARPETA_SOLTAR = 'data-carpeta-sftp'

export interface ArrastreSftp {
  soltando: boolean
  /** La carpeta de la lista bajo el puntero, o `null` (lo soltado irá a la carpeta que se ve). */
  carpeta: string | null
  manejadores: {
    entra: (e: DragEvent) => void
    sobre: (e: DragEvent) => void
    sale: (e: DragEvent) => void
    suelta: (e: DragEvent) => void
  }
}

const traeArchivos = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

/** La fila de carpeta bajo el puntero (las celdas no reciben eventos: el destino es la fila). */
function carpetaBajo(e: DragEvent): string | null {
  const fila = (e.target as HTMLElement | null)?.closest?.(`[${ATRIBUTO_CARPETA_SOLTAR}]`)
  return fila?.getAttribute(ATRIBUTO_CARPETA_SOLTAR) ?? null
}

/** `onSoltar` recibe los archivos soltados (nunca vacío) y la carpeta de la lista sobre la que cayeron. */
export function useArrastreSftp(onSoltar: (archivos: File[], carpeta: string | null) => void, activo: boolean): ArrastreSftp {
  const [soltando, setSoltando] = useState(false)
  const [carpeta, setCarpeta] = useState<string | null>(null)
  const profundidad = useRef(0)
  const terminar = (): void => {
    profundidad.current = 0
    setSoltando(false)
    setCarpeta(null)
  }
  return {
    soltando,
    carpeta,
    manejadores: {
      entra: (e) => {
        if (!activo || !traeArchivos(e)) return
        e.preventDefault()
        profundidad.current++
        setSoltando(true)
      },
      sobre: (e) => {
        if (!activo || !traeArchivos(e)) return
        e.preventDefault() // sin esto el navegador no admite soltar
        e.dataTransfer.dropEffect = 'copy'
        setCarpeta(carpetaBajo(e))
      },
      sale: (e) => {
        if (!traeArchivos(e)) return
        profundidad.current = Math.max(0, profundidad.current - 1)
        if (profundidad.current === 0) {
          setSoltando(false)
          setCarpeta(null)
        }
      },
      suelta: (e) => {
        if (!activo || !traeArchivos(e)) return
        e.preventDefault()
        const archivos = Array.from(e.dataTransfer.files)
        const destino = carpetaBajo(e)
        terminar()
        if (archivos.length > 0) onSoltar(archivos, destino)
      }
    }
  }
}
