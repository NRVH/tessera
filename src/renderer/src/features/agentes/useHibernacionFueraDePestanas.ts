// =============================================================================
// Engancha la hibernación coherente de los targets que no son pestaña (las reglas viven en
// `hibernacionFueraDePestanas.ts`) al ciclo de la ventana: los marca al empezar a hibernarse su
// perfil (`hibernando` de las pestañas), despierta el que se empieza a mirar y olvida los cerrados.
// Las marcas viven en el store de agentes (las lee también el botón «Despertar» del pie). Devuelve
// los hibernados que ve la columna.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import type { DestinoAgenteAbierto, UsePestanas } from '../pestanas'
import { despertarAlVerse, marcarAlHibernar, podarMarcas, unirHibernados } from './hibernacionFueraDePestanas'
import { actualizarHibernadosFueraDePestanas, useStoreAgentes } from './store'

/** Los hibernados de la columna, con los targets que no son pestaña de los perfiles hibernados. */
export function useHibernacionFueraDePestanas(
  pestanas: Pick<UsePestanas, 'perfilIdsHibernando' | 'clavesDestinoHibernados'>,
  fueraDePestanas: readonly DestinoAgenteAbierto[],
  clavesVistas: ReadonlySet<string>
): Set<string> {
  const marcados = useStoreAgentes((s) => s.hibernadosFueraDePestanas)
  const hibernando = pestanas.perfilIdsHibernando
  const antes = useRef<ReadonlySet<string>>(hibernando)
  // Al EMPEZAR la hibernación de un perfil: el main va a cerrar las sesiones de todos sus targets.
  useEffect(() => {
    const previos = antes.current
    antes.current = hibernando
    actualizarHibernadosFueraDePestanas((m) => marcarAlHibernar(m, previos, hibernando, fueraDePestanas))
  }, [hibernando, fueraDePestanas])
  const vistasAntes = useRef<ReadonlySet<string>>(new Set())
  // Si seguía a la vista al hibernar, solo se despierta desde su pie.
  useEffect(() => {
    const nuevas = [...clavesVistas].filter((clave) => !vistasAntes.current.has(clave))
    vistasAntes.current = clavesVistas
    actualizarHibernadosFueraDePestanas((m) => nuevas.reduce(despertarAlVerse, m))
  }, [clavesVistas])
  useEffect(() => {
    actualizarHibernadosFueraDePestanas((m) => podarMarcas(m, fueraDePestanas))
  }, [fueraDePestanas])
  return useMemo(() => unirHibernados(pestanas.clavesDestinoHibernados, marcados), [pestanas.clavesDestinoHibernados, marcados])
}
