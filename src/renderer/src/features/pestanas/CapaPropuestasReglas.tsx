// =============================================================================
// CapaPropuestasReglas: las propuestas de reglas de los agentes en la raíz de la ventana, montada una sola
// vez. Pide las pendientes al montar (el aviso de llegada se pierde sin ventana), avisa de cada una con
// «Revisar» y pinta la revisión o la edición de la abierta. Aceptar guarda por `onSetReglas` (el renderer
// es dueño de los perfiles); el main quita la propuesta al llegar ese guardado a disco.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import { useEffect, useRef } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import { notify } from '../../comun/notifications'
import { PropuestaReglasModal } from './PropuestaReglasModal'
import { ReglasPerfilModal } from './ReglasPerfilModal'
import { aceptarPropuesta, cerrarPropuesta, editarPropuesta, fijarPendientes, marcarPendiente, refrescarPropuesta, resolverPropuesta, revisarPropuesta, useStorePropuestasReglas } from './storePropuestasReglas'
import { txPestanas } from './textos.ts'

interface Props {
  profiles: Profile[]
  onSetReglas: (profileId: string, reglas: string) => void
}

/** Abre la revisión de un perfil, o avisa de que ya no hay nada que revisar. */
function abrirRevision(profileId: string): void {
  void revisarPropuesta(profileId).then((hay) => {
    if (!hay) notify('info', txPestanas().propuesta.yaNoEsta)
  })
}

/**
 * Se suscribe a las propuestas que llegan y avisa de las pendientes al montar. Las pendientes llegan antes
 * de que se carguen los perfiles: el aviso de un perfil que aún no está espera a que aparezca en la lista.
 */
function useAvisosPropuestas(profiles: Profile[]): void {
  // El aviso lee los perfiles de AHORA al llegar, no los del montaje.
  const perfilesRef = useRef(profiles)
  perfilesRef.current = profiles
  // Perfiles con aviso por dar, sin repetir: cada uno se avisa una sola vez por propuesta.
  const porAvisarRef = useRef(new Set<string>())
  const avisarRef = useRef<(profileId: string) => void>(() => {})
  useEffect(() => {
    let vivo = true
    const avisar = (profileId: string): void => {
      const perfil = perfilesRef.current.find((p) => p.id === profileId)
      if (!perfil) {
        porAvisarRef.current.add(profileId)
        return
      }
      porAvisarRef.current.delete(profileId)
      const t = txPestanas().propuesta
      notify('info', t.aviso(perfil.nombre), undefined, { accion: { etiqueta: t.revisar, onClick: () => abrirRevision(profileId) } })
    }
    avisarRef.current = avisar
    const quitar = window.tessera.reglas.onPropuesta(({ profileId }) => {
      marcarPendiente(profileId, true)
      avisar(profileId)
    })
    const quitarResuelta = window.tessera.reglas.onResuelta(({ profileId }) => void refrescarPropuesta(profileId))
    void window.tessera.reglas.pendientes().then((ids) => {
      if (!vivo) return
      fijarPendientes(ids)
      for (const id of ids) avisar(id)
    })
    return () => {
      vivo = false
      quitar()
      quitarResuelta()
    }
  }, [])
  // Al cambiar la lista (la carga inicial, un perfil nuevo), se avisa de lo que esperaba a su perfil.
  useEffect(() => {
    const { pendientes } = useStorePropuestasReglas.getState()
    for (const id of [...porAvisarRef.current]) {
      if (!pendientes.has(id)) porAvisarRef.current.delete(id) // se resolvió mientras esperaba
      else if (profiles.some((p) => p.id === id)) avisarRef.current(id)
    }
  }, [profiles])
}

/** La revisión o la edición de la propuesta abierta, y los avisos de las que llegan. */
export function CapaPropuestasReglas({ profiles, onSetReglas }: Props): React.JSX.Element | null {
  useAvisosPropuestas(profiles)
  const abierta = useStorePropuestasReglas((s) => s.abierta)
  const editando = useStorePropuestasReglas((s) => s.editando)
  const propuesta = abierta ?? editando
  const perfil = propuesta ? profiles.find((p) => p.id === propuesta.profileId) : undefined
  if (!propuesta || !perfil) return null
  if (editando) {
    return (
      <ReglasPerfilModal
        profile={perfil}
        textoInicial={editando.texto}
        onCancel={cerrarPropuesta}
        onGuardar={(reglas) => {
          onSetReglas(perfil.id, reglas)
          void aceptarPropuesta(editando, reglas)
        }}
      />
    )
  }
  return (
    <PropuestaReglasModal
      profile={perfil}
      propuesta={propuesta}
      onCerrar={cerrarPropuesta}
      onEditar={editarPropuesta}
      onDescartar={() => void resolverPropuesta(propuesta)}
      onAceptar={() => {
        onSetReglas(perfil.id, propuesta.texto)
        void aceptarPropuesta(propuesta, propuesta.texto)
        notify('success', txPestanas().propuesta.aceptada)
      }}
    />
  )
}
