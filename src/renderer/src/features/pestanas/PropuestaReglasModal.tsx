// =============================================================================
// PropuestaReglasModal: la revisión de una propuesta de reglas de un agente. El motivo, desde qué
// proyecto llegó y el diff entre las reglas vigentes de AHORA y las propuestas; Aceptar, Editar antes de
// aceptar o Descartar. Esc o el clic fuera cierran sin decidir: la propuesta sigue pendiente.
// Depende de comun/useDialogo y de `DiffReglas`; lo abre `CapaPropuestasReglas`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import '../../comun/formularioModal.css'
import './reglasPerfil.css'
import { useId } from 'react'
import type { Profile } from '../../../../main/profiles/types'
import type { PropuestaReglas } from '../../../../shared/reglas-ipc'
import { alClicEnVelo, useDialogo } from '../../comun/useDialogo'
import { AYUDA, BotonAyuda } from '../academy'
import { DiffReglas } from './DiffReglas'
import { txPestanas } from './textos.ts'

interface PropuestaReglasModalProps {
  profile: Profile
  propuesta: PropuestaReglas
  onAceptar: () => void
  onEditar: () => void
  onDescartar: () => void
  onCerrar: () => void
}

/** El motivo del agente y, si lo hay, el proyecto desde el que propuso. */
function MotivoPropuesta({ propuesta }: { propuesta: PropuestaReglas }): React.JSX.Element {
  const t = txPestanas().propuesta
  return (
    <div className="propuesta-reglas-motivo">
      <span className="dbc-etiqueta">{t.motivo}</span>
      <p className={propuesta.motivo ? undefined : 'vacio'} data-testid="propuesta-reglas-motivo">
        {propuesta.motivo || t.sinMotivo}
      </p>
      {propuesta.proyecto && <p className="desde">{t.desde(propuesta.proyecto)}</p>}
    </div>
  )
}

/** Diálogo de revisión de una propuesta de reglas. */
export function PropuestaReglasModal({ profile, propuesta, onAceptar, onEditar, onDescartar, onCerrar }: PropuestaReglasModalProps): React.JSX.Element {
  const dialogo = useDialogo({ onClose: onCerrar })
  const idTitulo = useId()
  const idAyuda = useId()
  const t = txPestanas().propuesta

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={alClicEnVelo(onCerrar)}>
      <div
        ref={dialogo.ref}
        className="modal-card db-conexion-modal propuesta-reglas-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idAyuda}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={dialogo.alPulsarTecla}
      >
        <div className="dbc-form">
          <div className="dbc-cabecera">
            <div className="dbc-titulo-fila">
              <div id={idTitulo} className="modal-title">
                {t.titulo(profile.nombre)}
              </div>
              <BotonAyuda destino={AYUDA.propuestaDeReglas} />
            </div>
            <div id={idAyuda} className="dbc-ayuda">
              {t.mensaje}
            </div>
          </div>
          <div className="dbc-cuerpo">
            <MotivoPropuesta propuesta={propuesta} />
            <DiffReglas original={profile.reglas ?? ''} modificado={propuesta.texto} />
          </div>
          <div className="modal-actions dbc-acciones">
            <button type="button" className="btn btn-ghost" onClick={onDescartar}>
              {t.descartar}
            </button>
            <span className="dbc-hueco" />
            <button type="button" className="btn btn-ghost" onClick={onEditar}>
              {t.editar}
            </button>
            <button type="button" className="btn primary" onClick={onAceptar}>
              {t.aceptar}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
