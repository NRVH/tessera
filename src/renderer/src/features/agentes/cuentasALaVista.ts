// =============================================================================
// Qué cuentas tienen su uso a la vista en el pie de un panel, por perfil. Cada pie lo anuncia mientras se ve (en
// pantalla, activado y con cuenta) y lo retira al dejar de verse: la lista de uso y la barra de estado no las repiten.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useEffect, useId, useMemo } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { CuentaFijada } from '../../../../shared/workspace-state-ipc'

interface CuentaDePie extends CuentaFijada {
  profileId: string
}

const useStoreALaVista = create<{ pies: Record<string, CuentaDePie> }>(() => ({ pies: {} }))

/** Anuncia la cuenta del pie mientras `visible`; un pie de un agente sin uso de cuenta pasa `null`. */
export function useAnunciarCuentaALaVista(visible: boolean, cuenta: CuentaDePie | null): void {
  const clave = useId()
  const { profileId, agente, accountId } = cuenta ?? {}
  useEffect(() => {
    if (!visible || !profileId || !agente) return
    useStoreALaVista.setState((s) => ({ pies: { ...s.pies, [clave]: { profileId, agente, accountId: accountId ?? null } } }))
    return () => useStoreALaVista.setState((s) => {
      const { [clave]: _retirada, ...pies } = s.pies
      return { pies }
    })
  }, [clave, visible, profileId, agente, accountId])
}

/**
 * Las cuentas a la vista en los pies de un perfil, sin repetir. El selector devuelve claves de texto para que la
 * comparación superficial vea iguales dos lecturas iguales; los objetos se arman después.
 */
export function useCuentasALaVista(profileId: string | null): CuentaFijada[] {
  const claves = useStoreALaVista(useShallow((s) => {
    const vistas = new Set<string>()
    for (const pie of Object.values(s.pies)) if (pie.profileId === profileId) vistas.add(JSON.stringify([pie.agente, pie.accountId]))
    return [...vistas].sort()
  }))
  return useMemo(() => claves.map((clave) => {
    const [agente, accountId] = JSON.parse(clave) as [CuentaFijada['agente'], string | null]
    return { agente, accountId }
  }), [claves])
}
