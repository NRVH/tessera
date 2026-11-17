// =============================================================================
// Estado del visor de imágenes: carga (`useCargaImagen`), vista (`useZoomPanImagen`),
// conmutador imagen⇄código de un SVG y acciones de sistema.
// Lo usa `PaneVisorImagen`.
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

/** Todo lo que necesita PaneVisorImagen para pintarse y reaccionar. */
export function useVisorImagen({ archivo, visible }: { archivo: ArchivoAbierto; visible: boolean }) {
  const raiz = useRaizDelProyecto()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Ver el código fuente de un SVG (texto) en vez de la imagen renderizada.
  const [verCodigo, setVerCodigo] = useState(false)
  const [codigoSvg, setCodigoSvg] = useState<string | null>(null)

  const zoom = useZoomPanImagen({ visible, cargando, error, verCodigo })
  const carga = useCargaImagen(raiz, archivo.ruta, { setCargando, setError, reiniciar: zoom.reiniciar })
  const { setAviso } = carga

  function alCargarImg(e: SyntheticEvent<HTMLImageElement>): void {
    setCargando(false)
    // Decodificada pero sin dimensiones útiles (raro): se trata como no mostrable.
    if (!zoom.alCargar(e)) setError(txImagen().sinDimensiones)
  }

  function alFallarImg(): void {
    setCargando(false)
    setError(txImagen().formatoNoMostrable)
  }

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
    if (!siguiente) requestAnimationFrame(() => { if (zoom.modoAjusteRef.current) zoom.ajustarVista() })
  }

  return {
    ...zoom,
    cargando, error, verCodigo, codigoSvg, esSvg: esRutaSvg(archivo.ruta),
    aviso: carga.aviso, url: carga.url, tamano: carga.tamano,
    onCargarImg: alCargarImg, onErrorImg: alFallarImg, abrirExternoConAviso, revelarEnCarpetaConAviso, alternarCodigo
  }
}
