// =============================================================================
// El desplegable informativo del uso en el pie: dónde se ancla y cuándo se cierra. Las lecturas pertenecen al perfil;
// cambiarlo, o que el pie deje de verse, cierra el desplegable anterior.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useEffect, useState } from 'react'
import { ventanaDeNodo } from '../../util/ventanaDe'
import { useDesplegablePie } from './desplegablePie'

/** Ancho del desplegable del uso; va en el CSS de `.agent-usage-pop`. */
const ANCHO_DESPLEGABLE = 240

interface Propiedades {
  ponerAbierto: (valor: boolean) => void
  perfilId: string
  habilitado: boolean
  refrescar: (force?: boolean) => Promise<void>
}

export function useDesplegableUso({ ponerAbierto, perfilId, habilitado, refrescar }: Propiedades) {
  const [ancla, ponerAncla] = useState<{ left: number; bottom: number } | null>(null)
  // Al abrirse el del contexto, este se cierra: no quedan dos encima.
  const anunciarApertura = useDesplegablePie(() => ponerAbierto(false))
  function abrir(elemento: HTMLElement): void {
    const ventana = ventanaDeNodo(elemento)
    const rect = elemento.getBoundingClientRect()
    ponerAncla({ left: Math.max(8, Math.min(rect.left, ventana.innerWidth - ANCHO_DESPLEGABLE - 8)), bottom: ventana.innerHeight - rect.top })
    anunciarApertura()
    ponerAbierto(true)
    void refrescar(true)
  }
  useEffect(() => {
    ponerAbierto(false)
  }, [perfilId, habilitado, ponerAbierto])
  return { ancla, abrir, cerrar: () => ponerAbierto(false) }
}
