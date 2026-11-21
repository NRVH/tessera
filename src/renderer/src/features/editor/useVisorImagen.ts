// =============================================================================
// Decodificación y zoom para el visor de imágenes y el ampliado de Markdown.
// El visor de archivos añade la carga por IPC, el código SVG y las acciones de sistema.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useState } from 'react'
import type { SyntheticEvent } from 'react'
import { esRutaSvg } from './tipoVisor'
import { abrirExterno, revelarEnCarpeta } from './visorComun'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { useCargaImagen } from './useCargaImagen'
import { useZoomPanImagen } from './useZoomPanImagen'
import type { ArchivoAbierto } from './paneCentral'
import { txImagen } from './textosVisores.ts'

export function useImagenAmpliable(visible: boolean, verCodigo = false, mensajeDeError = txImagen().noSePudoLeer) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const zoom = useZoomPanImagen({ visible, cargando, error, verCodigo })

  function alCargarImg(e: SyntheticEvent<HTMLImageElement>): void {
    setCargando(false)
    // Decodificada pero sin dimensiones útiles (raro): se trata como no mostrable.
    if (!zoom.alCargar(e)) setError(txImagen().sinDimensiones)
  }

  function alFallarImg(): void {
    setCargando(false)
    setError(mensajeDeError)
  }

  return { ...zoom, cargando, error, setCargando, setError, onCargarImg: alCargarImg, onErrorImg: alFallarImg }
}

/** Todo lo que necesita PaneVisorImagen para pintarse y reaccionar. */
export function useVisorImagen({ archivo, visible }: { archivo: ArchivoAbierto; visible: boolean }) {
  const raiz = useRaizDelProyecto()
  const [verCodigo, setVerCodigo] = useState(false)
  const [codigoSvg, setCodigoSvg] = useState<string | null>(null)
  const imagen = useImagenAmpliable(visible, verCodigo, txImagen().formatoNoMostrable)
  const carga = useCargaImagen(raiz, archivo.ruta, imagen)
  const { setAviso } = carga

  async function avisar(accion: Promise<string | null>): Promise<void> {
    const aviso = await accion
    if (aviso) setAviso(aviso)
  }
  const abrirExternoConAviso = (): Promise<void> => avisar(abrirExterno({ raiz, ruta: archivo.ruta }))
  const revelarEnCarpetaConAviso = (): Promise<void> => avisar(revelarEnCarpeta({ raiz, ruta: archivo.ruta }))

  // El texto del SVG se pide la primera vez que se activa el conmutador.
  async function alternarCodigo(): Promise<void> {
    const siguiente = !verCodigo
    setVerCodigo(siguiente)
    if (siguiente && codigoSvg === null) {
      try {
        const res = await window.tessera.files.leerArchivo({ raiz, ruta: archivo.ruta })
        setCodigoSvg(res.contenido)
      } catch (e) {
        setCodigoSvg(txImagen().noSePudoLeerCodigo(e instanceof Error ? e.message : String(e)))
      }
    }
    // Al volver a la imagen se re-ajusta: el área estuvo oculta mientras se veía el código.
    if (!siguiente) requestAnimationFrame(() => { if (imagen.modoAjusteRef.current) imagen.ajustarVista() })
  }

  return {
    ...imagen,
    verCodigo, codigoSvg, esSvg: esRutaSvg(archivo.ruta),
    aviso: carga.aviso, url: carga.url, tamano: carga.tamano,
    abrirExternoConAviso, revelarEnCarpetaConAviso, alternarCodigo
  }
}
