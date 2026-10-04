// =============================================================================
// Carga las carpetas de los proyectos abiertos para el selector de ámbito, solo al pasar a
// «En una carpeta». La petición en vuelo se invalida al desmontar, no al cambiar de ámbito.
// Decisiones: docs/decisiones/busqueda/busqueda-en-archivos.md
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CarpetasResult, ProyectoBuscable } from '../../../../shared/search-ipc'

/** Lo cargado del árbol de carpetas y el estado de la carga. */
export interface CarpetasBusqueda {
  datos: CarpetasResult | null
  cargando: boolean
  error: string | null
}

/** Pide las carpetas de los proyectos cuando el ámbito es «carpeta» y la lista de proyectos cambió. */
export function useCarpetasBusqueda(
  modo: 'proyecto' | 'carpeta',
  proyectos: ProyectoBuscable[]
): CarpetasBusqueda {
  const [datos, setDatos] = useState<CarpetasResult | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recargar solo cuando cambian DE VERDAD las raíces, no en cada render del modal. Va por
  // `JSON.stringify` y no con un separador, porque cualquier carácter puede estar en una ruta.
  const firma = useMemo(() => JSON.stringify(proyectos.map((p) => p.raiz)), [proyectos])
  const firmaCargada = useRef<string | null>(null)

  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  useEffect(() => {
    // Solo al pasar a «En una carpeta»: recorrer varios proyectos cuesta.
    if (modo !== 'carpeta') return
    if (proyectos.length === 0) return
    if (firmaCargada.current === firma) return
    firmaCargada.current = firma
    const mia = firma
    setCargando(true)
    setError(null)

    // Sin limpieza que la cancele al cambiar de ámbito: dejaba la petición sin dueño y el
    // desplegable deshabilitado para siempre. El resultado sigue valiendo, va indexado por firma.
    window.tessera.search
      .carpetas({ proyectos })
      .then((r) => {
        // La firma pudo cambiar mientras viajaba: esta respuesta sería de otra lista.
        if (!montado.current || firmaCargada.current !== mia) return
        setDatos(r)
        setCargando(false)
      })
      .catch((err) => {
        if (!montado.current) return
        // Se olvida la firma para que volver a «En una carpeta» reintente.
        if (firmaCargada.current === mia) {
          firmaCargada.current = null
          setCargando(false)
        }
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [modo, firma, proyectos])

  return { datos, cargando, error }
}
