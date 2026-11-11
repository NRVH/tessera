// =============================================================================
// Un solo desplegable del pie a la vez: el del uso de la cuenta espera un momento antes de cerrarse (admite el
// puntero para fijar una cuenta), y si en ese momento se abre el del contexto, quedarían los dos encima. Quien se
// abre lo anuncia y los demás se cierran en el acto, como pasa con los menús.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useEffect, useRef } from 'react'

const oyentes = new Set<(quien: symbol) => void>()

/** El dueño de un desplegable y cómo anunciar que se abre; `cerrar` corre cuando se abre otro. */
export function useDesplegablePie(cerrar: () => void): () => void {
  const dueno = useRef(Symbol('desplegable-pie')).current
  const alCerrar = useRef(cerrar)
  alCerrar.current = cerrar
  useEffect(() => {
    const oir = (quien: symbol): void => {
      if (quien !== dueno) alCerrar.current()
    }
    oyentes.add(oir)
    return () => {
      oyentes.delete(oir)
    }
  }, [dueno])
  return () => {
    for (const oir of oyentes) oir(dueno)
  }
}
