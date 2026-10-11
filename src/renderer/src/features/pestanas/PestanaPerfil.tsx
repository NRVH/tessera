// =============================================================================
// PestanaPerfil: una pestaña de la banda de perfiles (punto, nombre o input de renombrado,
// arrastre, clic, doble clic, menú y teclado). Sin estado propio: `ProfileTabs` le pasa el
// arrastre y el renombrado que guardan `useArrastrePerfiles` y `useRenombrarPerfil`.
// El color se pinta con `tintaPerfil` (cenizo); el guardado en profiles.json no cambia.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================
import type { Profile } from '../../../../main/profiles/types'
import { pegarRecortado } from '../../util/pasteTrim'
import { tintaPerfil } from './colorPerfil'
import { ProfileDot } from './ProfileDot'
import type { ProfileDotState } from './profileDotState'
import type { useArrastrePerfiles } from './useArrastrePerfiles'
import type { useRenombrarPerfil } from './useRenombrarPerfil'

interface PestanaPerfilProps {
  profile: Profile
  active: boolean
  dotState: ProfileDotState
  hasAttention: boolean
  isWorking: boolean
  /** Un agente del perfil te espera. */
  isWaiting: boolean
  arrastre: ReturnType<typeof useArrastrePerfiles>
  renombrado: ReturnType<typeof useRenombrarPerfil>
  onSelect: () => void
  onMenu: (x: number, y: number) => void
}

function claseDePestana(
  dotState: ProfileDotState,
  active: boolean,
  dragOver: boolean,
  dragging: boolean
): string {
  // `state-*` lleva el estado de hibernación a la PESTAÑA (el nombre se atenúa con él).
  return (
    `profile-tab state-${dotState}${active ? ' active' : ''}` +
    `${dragOver ? ' drag-over' : ''}` +
    `${dragging ? ' dragging' : ''}`
  )
}

function InputRenombrar({
  renombrado
}: {
  renombrado: ReturnType<typeof useRenombrarPerfil>
}): React.JSX.Element {
  return (
    <input
      className="profile-rename-input"
      autoFocus
      value={renombrado.draft}
      onChange={(e) => renombrado.setDraft(e.target.value)}
      onPaste={pegarRecortado(renombrado.setDraft)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') renombrado.commitRename()
        else if (e.key === 'Escape') renombrado.cancelRename()
      }}
      onBlur={renombrado.commitRename}
    />
  )
}

// `--profile-color` alimenta el contorno y el halo de la activa.
function estiloDePestana(tinta: string): React.CSSProperties {
  return { '--profile-color': tinta } as React.CSSProperties
}

/** Pestaña de un perfil dentro de la banda. */
export function PestanaPerfil({
  profile,
  active,
  dotState,
  hasAttention,
  isWorking,
  isWaiting,
  arrastre,
  renombrado,
  onSelect,
  onMenu
}: PestanaPerfilProps): React.JSX.Element {
  const renaming = renombrado.renamingId === profile.id
  const tinta = tintaPerfil(profile.color)
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      className={claseDePestana(
        dotState,
        active,
        arrastre.dragOverId === profile.id,
        arrastre.dragId === profile.id
      )}
      title={profile.nombre}
      data-perfil-id={profile.id}
      style={estiloDePestana(tinta)}
      draggable={!renaming}
      onDragStart={(e) => arrastre.alEmpezar(profile.id, e)}
      onDragOver={(e) => arrastre.alPasarSobre(profile.id, e)}
      onDragLeave={() => arrastre.alSalir(profile.id)}
      onDrop={(e) => arrastre.alSoltar(profile.id, e)}
      onDragEnd={arrastre.alTerminar}
      onClick={() => {
        if (!renaming) onSelect()
      }}
      onDoubleClick={() => renombrado.startRename(profile)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if (!renaming && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <ProfileDot state={dotState} color={tinta} working={isWorking} attention={hasAttention} waiting={isWaiting} />
      {renaming ? (
        <InputRenombrar renombrado={renombrado} />
      ) : (
        <span className="profile-tab-name">{profile.nombre}</span>
      )}
    </div>
  )
}
