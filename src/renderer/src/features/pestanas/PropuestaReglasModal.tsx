// =============================================================================
// PropuestaReglasModal: la revisión de una propuesta de reglas de un agente. El motivo, desde qué
// proyecto llegó y el diff entre las reglas vigentes de AHORA y las propuestas; Aceptar, Editar antes de
// aceptar o Descartar. Esc o el clic fuera cierran sin decidir: la propuesta sigue pendiente.
// Depende de comun/Modal y de `DiffReglas`; lo abre `CapaPropuestasReglas`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import '../../comun/formularioModal.css'
import './reglasPerfil.css'
import type { Profile } from '../../../../main/profiles/types'
import { ID_REGLAS_GLOBALES, type PropuestaReglas } from '../../../../shared/reglas-ipc'
import { MAX_REGLAS_PERFIL, normalizarReglas, reglasCercaDelTope } from '../../../../shared/reglasPerfil'
import { useStorePestanas } from './store'
import { AvisoModal, Modal, PieModal } from '../../comun/Modal'
import { AYUDA, BotonAyuda } from '../academy'
import { DiffReglas } from './DiffReglas'
import { txPestanas } from './textos.ts'

interface PropuestaReglasModalProps {
  /** El perfil, o el nivel global con su id reservado. */
  profile: Pick<Profile, 'id' | 'nombre' | 'reglas'>
  propuesta: PropuestaReglas
  onAceptar: () => void
  onEditar: () => void
  onDescartar: () => void
  onCerrar: () => void
}

/** El motivo del agente y, si lo hay, el proyecto y el perfil desde los que propuso. */
function MotivoPropuesta({ propuesta }: { propuesta: PropuestaReglas }): React.JSX.Element {
  const t = txPestanas().propuesta
  const perfiles = useStorePestanas((s) => s.tabs.profiles)
  const nombreDePerfil = (id: string): string => perfiles.find((p) => p.id === id)?.nombre ?? id
  return (
    <div className="propuesta-reglas-motivo">
      <span className="dbc-etiqueta">{t.motivo}</span>
      <p className={propuesta.motivo ? undefined : 'vacio'} data-testid="propuesta-reglas-motivo">
        {propuesta.motivo || t.sinMotivo}
      </p>
      {propuesta.proyecto && <p className="desde">{t.desde(propuesta.proyecto)}</p>}
      {propuesta.desdePerfil && <p className="desde">{t.desdePerfil(nombreDePerfil(propuesta.desdePerfil))}</p>}
    </div>
  )
}

/** Diálogo de revisión de una propuesta de reglas. */
export function PropuestaReglasModal({ profile, propuesta, onAceptar, onEditar, onDescartar, onCerrar }: PropuestaReglasModalProps): React.JSX.Element {
  const t = txPestanas().propuesta

  return (
    <Modal titulo={profile.id === ID_REGLAS_GLOBALES ? t.tituloGlobal : t.titulo(profile.nombre)}
      ayuda={<BotonAyuda destino={AYUDA.propuestaDeReglas} />} subtitulo={t.mensaje} tamano="xl"
      className="db-conexion-modal propuesta-reglas-modal" onCerrar={onCerrar}
      pie={<PieModal auxiliares={<button type="button" className="btn danger" onClick={onDescartar}>{t.descartar}</button>}>
        <button type="button" className="btn btn-ghost" onClick={onEditar}>{t.editar}</button>
        <button type="button" className="btn primary" onClick={onAceptar}>{t.aceptar}</button>
      </PieModal>}>
      <MotivoPropuesta propuesta={propuesta} />
      <DiffReglas original={profile.reglas ?? ''} modificado={propuesta.texto} />
      {reglasCercaDelTope(normalizarReglas(propuesta.texto).length) && (
        <AvisoModal tono="aviso"><span data-testid="propuesta-cerca-tope">{t.cercaDelTope(normalizarReglas(propuesta.texto).length, MAX_REGLAS_PERFIL)}</span></AvisoModal>
      )}
    </Modal>
  )
}
