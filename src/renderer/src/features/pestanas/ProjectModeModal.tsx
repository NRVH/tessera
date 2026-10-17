// =============================================================================
// ProjectModeModal: al abrir un proyecto con el ajuste "Preguntar siempre", elige con qué
// modo abrirlo (nativo en el sistema, o Docker aislado). Cancelar no abre nada.
// El botón nativo se llama como el sistema de quien mira (`nombresSistema`); el id que se
// emite sigue siendo `'windows'` porque es lo que persiste `workspace-state.json`.
// Los glifos son el `ModeIcon` compartido con la pestaña del proyecto.
// =============================================================================
import { ModeIcon } from './modeIcon'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { txPestanas } from './textos.ts'

interface ProjectModeModalProps {
  /** Nombre del proyecto elegido (para el título). */
  name: string
  onPick: (mode: 'windows' | 'docker') => void
  onCancel: () => void
}

export function ProjectModeModal({
  name,
  onPick,
  onCancel
}: ProjectModeModalProps): React.JSX.Element {
  const n = nombresSistema(window.tessera.plataforma)
  const t = txPestanas().modo
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{t.titulo(name)}</div>
        <div className="modal-message">{t.mensaje}</div>
        <div className="project-mode-choices">
          <button className="project-mode-choice" onClick={() => onPick('windows')}>
            <ModeIcon windows color="var(--mode-windows)" size={26} />
            <span className="project-mode-choice-label">{n.sistema}</span>
            <span className="project-mode-choice-hint">{t.nativoHint}</span>
          </button>
          <button className="project-mode-choice" onClick={() => onPick('docker')}>
            <ModeIcon windows={false} color="var(--accent)" size={26} />
            <span className="project-mode-choice-label">Docker</span>
            <span className="project-mode-choice-hint">{t.dockerHint}</span>
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            {t.cancelar}
          </button>
        </div>
      </div>
    </div>
  )
}
