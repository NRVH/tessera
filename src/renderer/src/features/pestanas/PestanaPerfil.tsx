// =============================================================================
// PestanaPerfil: una pestaña de la banda de perfiles (punto, nombre o input de renombrado,
// arrastre, clic, doble clic, menú y teclado). Sin estado propio: `PestanasPerfil` le pasa el
// arrastre y el renombrado que guardan `useArrastrePerfiles` y `useRenombrarPerfil`.
// El color se pinta con `tintaPerfil` (cenizo); el guardado en profiles.json no cambia.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================
import type { Perfil } from '../../../../main/perfiles/types'
import { pegarRecortado } from '../../util/pasteTrim'
import { tintaPerfil } from './colorPerfil'
import { PuntoColorPerfil } from './PuntoColorPerfil'
import type { EstadoPuntoPerfil } from './estadosPunto'
import type { useArrastrePerfiles } from './useArrastrePerfiles'
import type { useRenombrarPerfil } from './useRenombrarPerfil'

interface PropsPestanaPerfil {
  perfil: Perfil
  activa: boolean
  estadoPunto: EstadoPuntoPerfil
  tieneAtencion: boolean
  isWorking: boolean
  /** Un agente del perfil te espera. */
  estaEsperando: boolean
  arrastre: ReturnType<typeof useArrastrePerfiles>
  renombrado: ReturnType<typeof useRenombrarPerfil>
  onSeleccionar: () => void
  onMenu: (x: number, y: number) => void
}

function claseDePestana(
  estadoPunto: EstadoPuntoPerfil,
  activa: boolean,
  esDestinoArrastre: boolean,
  arrastrando: boolean
): string {
  // `state-*` lleva el estado de hibernación a la PESTAÑA (el nombre se atenúa con él).
  return (
    `profile-tab state-${estadoPunto}${activa ? ' active' : ''}` +
    `${esDestinoArrastre ? ' drag-over' : ''}` +
    `${arrastrando ? ' dragging' : ''}`
  )
}

function CampoRenombrarPerfil({
  renombrado
}: {
  renombrado: ReturnType<typeof useRenombrarPerfil>
}): React.JSX.Element {
  return (
    <input
      className="profile-rename-input"
      autoFocus
      value={renombrado.borrador}
      onChange={(e) => renombrado.setBorrador(e.target.value)}
      onPaste={pegarRecortado(renombrado.setBorrador)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') renombrado.confirmarRenombrado()
        else if (e.key === 'Escape') renombrado.cancelarRenombrado()
      }}
      onBlur={renombrado.confirmarRenombrado}
    />
  )
}

// `--profile-color` alimenta el contorno y el halo de la activa.
function estiloDePestana(tinta: string): React.CSSProperties {
  return { '--profile-color': tinta } as React.CSSProperties
}

/** Pestaña de un perfil dentro de la banda. */
export function PestanaPerfil({
  perfil,
  activa,
  estadoPunto,
  tieneAtencion,
  isWorking: trabajando,
  estaEsperando,
  arrastre,
  renombrado,
  onSeleccionar,
  onMenu
}: PropsPestanaPerfil): React.JSX.Element {
  const renombrando = renombrado.renombrandoId === perfil.id
  const tinta = tintaPerfil(perfil.color)
  return (
    <div
      role="tab"
      aria-selected={activa}
      tabIndex={0}
      className={claseDePestana(
        estadoPunto,
        activa,
        arrastre.destinoArrastreId === perfil.id,
        arrastre.arrastreId === perfil.id
      )}
      title={perfil.nombre}
      data-perfil-id={perfil.id}
      style={estiloDePestana(tinta)}
      draggable={!renombrando}
      onDragStart={(e) => arrastre.alEmpezar(perfil.id, e)}
      onDragOver={(e) => arrastre.alPasarSobre(perfil.id, e)}
      onDragLeave={() => arrastre.alSalir(perfil.id)}
      onDrop={(e) => arrastre.alSoltar(perfil.id, e)}
      onDragEnd={arrastre.alTerminar}
      onClick={() => {
        if (!renombrando) onSeleccionar()
      }}
      onDoubleClick={() => renombrado.iniciarRenombrado(perfil)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if (!renombrando && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSeleccionar()
        }
      }}
    >
      <PuntoColorPerfil estado={estadoPunto} color={tinta} working={trabajando} atencion={tieneAtencion} esperando={estaEsperando} />
      {renombrando ? (
        <CampoRenombrarPerfil renombrado={renombrado} />
      ) : (
        <span className="profile-tab-name">{perfil.nombre}</span>
      )}
    </div>
  )
}
