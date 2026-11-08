// =============================================================================
// CrearPerfilPopover: popover de la banda de perfiles para crear uno (nombre + color).
// Se cierra con Escape o con un clic fuera. El estado del formulario vive en el padre
// (`useCrearPerfil`); aquí solo se registra el cierre por teclado y ratón.
// Depende de util/pasteTrim.
// =============================================================================
import { useDespedidaDe } from '../../comun/despedida'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Lo que el popover se separa del borde de la ventana cuando no cabe donde se abre. */
const MARGEN = 8
import { pegarRecortado } from '../../util/pasteTrim'
import { PaletaColorPerfil } from './SelectorColorPerfil'
import { txPestanas } from './textos.ts'

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
  const t = txPestanas().perfil
  // Se abre en la X de su botón; con el botón cerca del borde derecho no cabría: se mide y se mete en la ventana.
  const ref = useRef<HTMLDivElement>(null)
  useDespedidaDe(ref, 'flotante')
  const [left, setLeft] = useState(x)
  useLayoutEffect(() => {
    const ancho = ref.current?.offsetWidth ?? 0
    setLeft(Math.max(MARGEN, Math.min(x, window.innerWidth - ancho - MARGEN)))
  }, [x])

  return (
    <div
      ref={ref}
      className="profile-create mov-aparece mov-desde-arriba"
      style={{ top: y, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="profile-create-title">{t.nuevo}</div>
      <div className="profile-create-hint">{t.nuevoSubtitulo}</div>
      <input
        className="profile-create-name"
        autoFocus
        placeholder={t.nombrePlaceholder}
        value={name}
        onChange={(e) => onName(e.target.value)}
        onPaste={pegarRecortado(onName)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
        }}
      />
      <PaletaColorPerfil color={color} onElegir={onColor} />
      <div className="profile-create-actions">
        <button className="btn" onClick={onCancel}>
          {t.cancelar}
        </button>
        <button className="btn primary" onClick={onSubmit} disabled={name.trim() === ''}>
          {t.crear}
        </button>
      </div>
    </div>
  )
}
