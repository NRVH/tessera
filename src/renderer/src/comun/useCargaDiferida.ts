// =============================================================================
// `useCargaDiferida(cargando)`: la fase del aviso de carga de un panel (`cargaDiferida.ts`),
// derivada en el render de las marcas de la espera: sin fotograma intermedio al acabar la carga.
// Un solo temporizador, hasta el próximo cambio de fase, fuerza el re-render y se quita al
// desmontar.
// Decisiones: docs/decisiones/renderer/carga-diferida.md
// =============================================================================

import { useEffect, useState } from 'react'
import { anotarCarga, evaluarCarga, marcasAlMontar, type FaseCarga, type MarcasCarga } from './cargaDiferida'

/** La fase que toca enseñar mientras `cargando` y, al acabar, hasta cumplir el mínimo visible. */
export function useCargaDiferida(cargando: boolean): FaseCarga {
  const [marcas, setMarcas] = useState<MarcasCarga | null>(() => marcasAlMontar(cargando, Date.now()))
  const [previo, setPrevio] = useState(cargando)
  const [latido, setLatido] = useState(0)

  // Ajuste durante el render: la fase de este mismo render ya cuenta con el cambio.
  let actuales = marcas
  if (cargando !== previo) {
    actuales = anotarCarga(marcas, cargando, Date.now())
    setPrevio(cargando)
    setMarcas(actuales)
  }
  const evaluacion = actuales === null ? null : evaluarCarga(actuales, Date.now())

  const proximoCambio = evaluacion?.proximoCambio ?? null
  useEffect(() => {
    if (proximoCambio === null) return
    const temporizador = setTimeout(() => setLatido((n) => n + 1), Math.max(0, proximoCambio - Date.now()))
    return () => clearTimeout(temporizador)
  }, [proximoCambio, latido])

  return evaluacion?.fase ?? 'nada'
}
