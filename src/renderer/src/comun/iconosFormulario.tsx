// =============================================================================
// iconosFormulario: los glifos de los campos de un formulario de modal que comparten varios diálogos
// (el ojo que enseña u oculta una contraseña: el de conexión de BD y el de una conexión SSH), para que
// ninguno tenga una copia del otro. Trazo de los iconos de la app, `currentColor` y sin tamaño en
// línea (lo pone el CSS de `formularioModal.css`). Sin dependencias.
// =============================================================================

/** Ojo abierto (o tachado) para revelar la contraseña. */
export function IconoOjo({ tachado }: { tachado: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
      {tachado && <path d="M4 20 20 4" />}
    </svg>
  )
}
