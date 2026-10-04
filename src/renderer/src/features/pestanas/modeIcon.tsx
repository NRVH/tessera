// =============================================================================
// Glifo de MODO reutilizable (Windows = monitor / Docker = cubo). SOLO la forma; el
// color y el tamaño los pone el consumidor. Única fuente de la geometría para el
// ModeGlyph de la pestaña (ProjectTabs) y el modal ¿Windows o Docker? (ProjectModeModal).
// =============================================================================

/** Glifo del modo de un proyecto: monitor (nativo) o cubo (contenedor). */
export function ModeIcon({
  windows,
  color,
  size
}: {
  windows: boolean
  color: string
  size: number
}): React.JSX.Element {
  if (windows) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        width={size}
        height={size}
        style={{ flex: `0 0 ${size}px` }}
        aria-hidden="true"
      >
        <rect x="3.5" y="5" width="17" height="11" rx="1.4" />
        <path d="M9 19.5h6M12 16v3.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      width={size}
      height={size}
      style={{ flex: `0 0 ${size}px` }}
      aria-hidden="true"
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" strokeLinejoin="round" />
    </svg>
  )
}
