// =============================================================================
// Lo que comparten las barras de las consolas de MongoDB y de Redis: el cronómetro (se
// refresca aquí, así que solo repinta la barra), el texto de estado y el ancla del selector
// de base. Depende de `consola/marcasConsola` para el formato del tiempo.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { formatoDuracion } from '../consola/marcasConsola'
import { TICK_MS, type AnclaSelector, type EnCurso } from './consolaComun'

/** Estado derivado de la barra y la mecánica del botón de la base. */
export interface DatosBarraConsola {
  corriendo: boolean
  /** Lo que anuncia la región viva (sin cronómetro: se leería cada segundo). */
  anunciado: string
  /** Lo que se ve: el anunciado con el tiempo, o el texto de estado. */
  estado: string | null
  motivoEjecutar: string | undefined
  puedeEjecutar: boolean
  botonBaseRef: React.RefObject<HTMLButtonElement>
  ancla: AnclaSelector | null
  cerrarSelector: () => void
  abrirBase: () => void
}

/** Cronómetro, textos de estado y ancla del selector de una barra de consola. */
export function useBarraConsola(enCurso: EnCurso | null, cargado: boolean, textoEstado: string | null): DatosBarraConsola {
  const [ahora, setAhora] = useState(() => Date.now())
  const corriendo = enCurso !== null
  useEffect(() => {
    if (!corriendo) return
    setAhora(Date.now())
    const t = setInterval(() => setAhora(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [corriendo])

  const e = enCurso
  const anunciado = e ? (e.total > 1 ? `Ejecutando ${e.indice + 1} de ${e.total}` : 'Ejecutando') : (textoEstado ?? '')
  const tiempo = e ? formatoDuracion(ahora - e.inicio, true) : ''
  const estado = e ? (tiempo ? `${anunciado} · ${tiempo}` : anunciado) : textoEstado
  const motivoEjecutar = !cargado ? 'La consola todavía se está cargando' : corriendo ? 'Ya hay una ejecución en curso' : undefined

  const botonBaseRef = useRef<HTMLButtonElement>(null)
  const [ancla, setAncla] = useState<AnclaSelector | null>(null)
  useEffect(() => {
    if (corriendo) setAncla(null)
  }, [corriendo])
  const abrirBase = (): void => {
    if (ancla) {
      setAncla(null)
      return
    }
    const r = botonBaseRef.current?.getBoundingClientRect()
    if (r) setAncla({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  return {
    corriendo,
    anunciado,
    estado,
    motivoEjecutar,
    puedeEjecutar: motivoEjecutar === undefined,
    botonBaseRef,
    ancla,
    cerrarSelector: () => setAncla(null),
    abrirBase
  }
}
