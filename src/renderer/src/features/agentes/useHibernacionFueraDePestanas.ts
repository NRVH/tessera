// =============================================================================
// Engancha la hibernación coherente de los targets que no son pestaña (las reglas viven en
// `hibernacionFueraDePestanas.ts`) al ciclo de la ventana: los marca al empezar a hibernarse su
// perfil (`hibernando` de las pestañas), despierta el que se empieza a mirar y olvida los cerrados.
// Las marcas viven en el store de agentes (las lee también el botón «Despertar» del pie). Devuelve
// los hibernados que ve la columna.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import type { OpenAgentTarget, UseTabs } from '../pestanas'
import { despertarAlVerse, marcarAlHibernar, podarMarcas, unirHibernados } from './hibernacionFueraDePestanas'
import { actualizarHibernadosFueraDePestanas, useStoreAgentes } from './store'

/** Los hibernados de la columna, con los targets que no son pestaña de los perfiles hibernados. */
export function useHibernacionFueraDePestanas(
  tabs: Pick<UseTabs, 'hibernatingProfiles' | 'hibernatedTargetKeys'>,
  fueraDePestanas: readonly OpenAgentTarget[],
  claveVista: string | null
): Set<string> {
  const marcados = useStoreAgentes((s) => s.hibernadosFueraDePestanas)
  const hibernando = tabs.hibernatingProfiles
  const antes = useRef<ReadonlySet<string>>(hibernando)
  // Al EMPEZAR la hibernación de un perfil: el main va a cerrar las sesiones de todos sus targets.
  useEffect(() => {
    const previos = antes.current
    antes.current = hibernando
    actualizarHibernadosFueraDePestanas((m) => marcarAlHibernar(m, previos, hibernando, fueraDePestanas))
  }, [hibernando, fueraDePestanas])
  // Perezoso: despierta el que se EMPIEZA a mirar; uno que ya se miraba al hibernar lo despierta su pie.
  useEffect(() => {
    actualizarHibernadosFueraDePestanas((m) => despertarAlVerse(m, claveVista))
  }, [claveVista])
  useEffect(() => {
    actualizarHibernadosFueraDePestanas((m) => podarMarcas(m, fueraDePestanas))
  }, [fueraDePestanas])
  return useMemo(() => unirHibernados(tabs.hibernatedTargetKeys, marcados), [tabs.hibernatedTargetKeys, marcados])
}
