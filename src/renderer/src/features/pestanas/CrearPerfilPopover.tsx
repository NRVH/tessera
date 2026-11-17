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
function useCierrePopover(onCancelar: () => void): void {
  useEffect(() => {
    function alPulsarTeclaVentana(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancelar()
    }
    function alPulsarRaton(): void {
      onCancelar()
    }
    window.addEventListener('keydown', alPulsarTeclaVentana)
    window.addEventListener('mousedown', alPulsarRaton)
    return () => {
      window.removeEventListener('keydown', alPulsarTeclaVentana)
      window.removeEventListener('mousedown', alPulsarRaton)
    }
  }, [onCancelar])
}

/** Popover de creación de perfil: nombre + color + Crear/Cancelar. */
export function CrearPerfilPopover({
  x,
  y,
  nombre,
  color,
  onNombre,
  onColor,
  onEnviar,
  onCancelar
}: {
  x: number
  y: number
  nombre: string
  color: string
  onNombre: (v: string) => void
  onColor: (v: string) => void
  onEnviar: () => void
  onCancelar: () => void
}): React.JSX.Element {
  useCierrePopover(onCancelar)
  const t = txPestanas().perfil
  // Se abre en la X de su botón; con el botón cerca del borde derecho no cabría: se mide y se mete en la ventana.
  const ref = useRef<HTMLDivElement>(null)
  useDespedidaDe(ref, 'flotante')
  const [izquierda, setIzquierda] = useState(x)
  useLayoutEffect(() => {
    const ancho = ref.current?.offsetWidth ?? 0
    setIzquierda(Math.max(MARGEN, Math.min(x, window.innerWidth - ancho - MARGEN)))
  }, [x])

  return (
    <div
      ref={ref}
      className="profile-create mov-aparece mov-desde-arriba"
      style={{ top: y, left: izquierda }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="profile-create-title">{t.nuevo}</div>
      <div className="profile-create-hint">{t.nuevoSubtitulo}</div>
      <input
        className="profile-create-name"
        autoFocus
        placeholder={t.nombrePlaceholder}
        value={nombre}
        onChange={(e) => onNombre(e.target.value)}
        onPaste={pegarRecortado(onNombre)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnviar()
        }}
      />
      <PaletaColorPerfil color={color} onElegir={onColor} />
      <div className="profile-create-actions">
        <button className="btn" onClick={onCancelar}>
          {t.cancelar}
        </button>
        <button className="btn primary" onClick={onEnviar} disabled={nombre.trim() === ''}>
          {t.crear}
        </button>
      </div>
    </div>
  )
}
