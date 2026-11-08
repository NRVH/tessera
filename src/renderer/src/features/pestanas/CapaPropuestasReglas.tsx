// =============================================================================
// CapaPropuestasReglas: las propuestas de reglas de los agentes en la raíz de la ventana, montada una sola
// vez. Pide las pendientes al montar (el aviso de llegada se pierde sin ventana), avisa de cada una con
// «Revisar» y pinta la revisión o la edición de la abierta. Aceptar las de un perfil guarda por `onSetReglas`
// (el renderer es dueño de los perfiles); las globales, en el contexto global. El main quita la propuesta al
// llegar ese guardado a disco.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import { useEffect, useMemo, useRef } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import { ID_REGLAS_GLOBALES } from '../../../../shared/reglas-ipc'
import { notify } from '../../comun/notifications'
import { guardarContextoGlobal, useStoreContextoGlobal } from '../agentes'
import { PropuestaReglasModal } from './PropuestaReglasModal'
import { ReglasPerfilModal } from './ReglasPerfilModal'
import { aceptarPropuesta, cerrarPropuesta, editarPropuesta, fijarPendientes, marcarPendiente, refrescarPropuesta, resolverPropuesta, revisarPropuesta, useStorePropuestasReglas } from './storePropuestasReglas'
import { txPestanas } from './textos.ts'

interface Props {
  profiles: Profile[]
  onSetReglas: (profileId: string, reglas: string) => void
}

/** Lo que la revisión necesita de un perfil, o del nivel global. */
type NivelConReglas = Pick<Profile, 'id' | 'nombre' | 'reglas'>

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
function useAvisosPropuestas(profiles: NivelConReglas[]): void {
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
      const texto = profileId === ID_REGLAS_GLOBALES ? t.avisoGlobal : t.aviso(perfil.nombre)
      notify('info', texto, undefined, { accion: { etiqueta: t.revisar, onClick: () => abrirRevision(profileId) } })
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

/**
 * Las reglas globales se revisan como las de un perfil más, con su id reservado: el nombre es el del nivel y
 * guardarlas va al contexto global, cuyo dueño es el main.
 */
function usePerfilesConGlobal(
  profiles: Profile[],
  onSetReglas: Props['onSetReglas']
): { lista: NivelConReglas[]; guardar: (profileId: string, reglas: string) => Promise<boolean> } {
  const reglasGlobales = useStoreContextoGlobal((s) => s.global.reglas)
  // Estable entre renders: los avisos pendientes se repasan cuando cambia la lista, no en cada render.
  const lista = useMemo<NivelConReglas[]>(
    () => [...profiles, { id: ID_REGLAS_GLOBALES, nombre: txPestanas().propuesta.global, reglas: reglasGlobales }],
    [profiles, reglasGlobales]
  )
  /** Si no se pudo guardar, lo dice y la propuesta sigue pendiente. */
  const guardar = async (profileId: string, reglas: string): Promise<boolean> => {
    if (profileId !== ID_REGLAS_GLOBALES) {
      onSetReglas(profileId, reglas)
      return true
    }
    try {
      await guardarContextoGlobal({ reglas })
      return true
    } catch (err) {
      notify('error', txPestanas().propuesta.noGuardada(err instanceof Error ? err.message : String(err)))
      return false
    }
  }
  return { lista, guardar }
}

/** La revisión o la edición de la propuesta abierta, y los avisos de las que llegan. */
export function CapaPropuestasReglas({ profiles, onSetReglas }: Props): React.JSX.Element | null {
  const { lista, guardar } = usePerfilesConGlobal(profiles, onSetReglas)
  useAvisosPropuestas(lista)
  const abierta = useStorePropuestasReglas((s) => s.abierta)
  const editando = useStorePropuestasReglas((s) => s.editando)
  const propuesta = abierta ?? editando
  const perfil = propuesta ? lista.find((p) => p.id === propuesta.profileId) : undefined
  if (!propuesta || !perfil) return null
  if (editando) {
    return (
      <ReglasPerfilModal
        profile={perfil}
        textoInicial={editando.texto}
        onCancel={cerrarPropuesta}
        onGuardar={(reglas) => {
          void guardar(perfil.id, reglas).then((ok) => {
            if (ok) void aceptarPropuesta(editando, reglas)
          })
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
        void guardar(perfil.id, propuesta.texto).then((ok) => {
          if (!ok) return
          void aceptarPropuesta(propuesta, propuesta.texto)
          notify('success', txPestanas().propuesta.aceptada)
        })
      }}
    />
  )
}
