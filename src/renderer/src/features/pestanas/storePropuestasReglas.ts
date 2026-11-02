// =============================================================================
// Store de las propuestas de reglas que dejan los agentes con `tctx proponer`: qué perfiles tienen una
// pendiente, cuál se revisa y cuál se edita antes de aceptarla. Fuera de React, las acciones que hablan con
// el main: abrir la pendiente de un perfil (puede haber cambiado o no existir ya), volver a preguntar y
// resolverla (quitarla solo si sigue siendo esa). Lo leen `CapaPropuestasReglas` y el diálogo de reglas.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { create } from 'zustand'
import type { PropuestaReglas } from '../../../../shared/reglas-ipc.ts'

interface EstadoPropuestas {
  /** Perfiles con una propuesta pendiente. */
  pendientes: ReadonlySet<string>
  /** La propuesta que se revisa, o `null`. */
  abierta: PropuestaReglas | null
  /** La propuesta cuyo texto se edita antes de aceptarlo, o `null`. */
  editando: PropuestaReglas | null
}

export const useStorePropuestasReglas = create<EstadoPropuestas>()(() => ({
  pendientes: new Set<string>(),
  abierta: null,
  editando: null
}))

/** Marca si un perfil tiene una pendiente (sin tocar el estado si no cambia). */
export function marcarPendiente(profileId: string, hay: boolean): void {
  const { pendientes } = useStorePropuestasReglas.getState()
  if (pendientes.has(profileId) === hay) return
  const nuevo = new Set(pendientes)
  if (hay) nuevo.add(profileId)
  else nuevo.delete(profileId)
  useStorePropuestasReglas.setState({ pendientes: nuevo })
}

/** Fija los perfiles con una pendiente (lo que dice el main al montar). */
export function fijarPendientes(ids: readonly string[]): void {
  useStorePropuestasReglas.setState({ pendientes: new Set(ids) })
}

/** Vuelve a preguntar al main si un perfil tiene una pendiente; resuelve con ella. */
export async function refrescarPropuesta(profileId: string): Promise<PropuestaReglas | null> {
  const p = await window.tessera.reglas.obtenerPropuesta(profileId)
  marcarPendiente(profileId, p !== null)
  return p
}

/** Abre la pendiente de un perfil para revisarla; resuelve `false` si ya no la hay. */
export async function revisarPropuesta(profileId: string): Promise<boolean> {
  const p = await refrescarPropuesta(profileId)
  useStorePropuestasReglas.setState({ abierta: p, editando: null })
  return p !== null
}

/** Cierra la revisión o la edición sin decidir: la propuesta sigue pendiente. */
export function cerrarPropuesta(): void {
  useStorePropuestasReglas.setState({ abierta: null, editando: null })
}

/** Pasa de revisar la propuesta abierta a editar su texto. */
export function editarPropuesta(): void {
  const { abierta } = useStorePropuestasReglas.getState()
  if (abierta) useStorePropuestasReglas.setState({ abierta: null, editando: abierta })
}

/**
 * Cierra la revisión tras aceptar (o aceptar editada) y deja al main quitar la propuesta cuando las reglas
 * estén en disco: se guardan con retardo y un fallo no debe llevarse las dos cosas. Mientras tanto sigue
 * pendiente; el aviso de resolución del main refresca el marcador.
 */
export async function aceptarPropuesta(p: Pick<PropuestaReglas, 'profileId' | 'en'>, texto: string): Promise<void> {
  cerrarPropuesta()
  await window.tessera.reglas.resolverAlGuardar({ profileId: p.profileId, en: p.en, texto })
  await refrescarPropuesta(p.profileId)
}

/** La quita del main tras rechazarla, solo si sigue siendo esa: si llegó otra entre medias, esa queda pendiente. */
export async function resolverPropuesta(p: Pick<PropuestaReglas, 'profileId' | 'en'>): Promise<void> {
  cerrarPropuesta()
  await window.tessera.reglas.descartarPropuesta({ profileId: p.profileId, en: p.en })
  await refrescarPropuesta(p.profileId)
}
