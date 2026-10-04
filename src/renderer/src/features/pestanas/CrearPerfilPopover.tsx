// =============================================================================
// CrearPerfilPopover: popover de la banda de perfiles para crear uno (nombre + color).
// Se cierra con Escape o con un clic fuera. El estado del formulario vive en el padre
// (`useCrearPerfil`); aquí solo se registra el cierre por teclado y ratón.
// Depende de util/pasteTrim.
// =============================================================================
import { useEffect } from 'react'
import { pegarRecortado } from '../../util/pasteTrim'

/** Cierra el popover con Escape o con cualquier mousedown (el propio popover lo detiene). */
function useCierrePopover(onCancel: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel()
    }
    function onDown(): void {
      onCancel()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onCancel])
}

/** Popover de creación de perfil: nombre + color + Crear/Cancelar. */
export function CrearPerfilPopover({
  x,
  y,
  name,
  color,
  onName,
  onColor,
  onSubmit,
  onCancel
}: {
  x: number
  y: number
  name: string
  color: string
  onName: (v: string) => void
  onColor: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}): React.JSX.Element {
  useCierrePopover(onCancel)

  return (
    <div
      className="profile-create"
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="profile-create-title">Nuevo perfil</div>
      <input
        className="profile-create-name"
        autoFocus
        placeholder="Nombre del perfil"
        value={name}
        onChange={(e) => onName(e.target.value)}
        onPaste={pegarRecortado(onName)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
        }}
      />
      <label className="profile-create-color">
        <span>Color</span>
        <input type="color" value={color} onChange={(e) => onColor(e.target.value)} />
      </label>
      <div className="profile-create-actions">
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn primary" onClick={onSubmit} disabled={name.trim() === ''}>
          Crear
        </button>
      </div>
    </div>
  )
}
