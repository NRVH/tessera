// =============================================================================
// La marca de Tessera: cuatro teselas en rejilla con la junta visible, una en el color de
// acento. Relleno plano y sin trazo, con los colores de las variables del tema. Sin tamaño
// inline: lo pone el CSS de cada consumidor, para que escale con `--ui-font`. Sin dependencias.
// =============================================================================

export function MarcaTessera({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="13" height="13" rx="3" fill="var(--fg-faint)" opacity="0.75" />
      <rect x="17" y="2" width="13" height="13" rx="3" fill="var(--accent)" />
      <rect x="2" y="17" width="13" height="13" rx="3" fill="var(--fg-faint)" opacity="0.5" />
      <rect x="17" y="17" width="13" height="13" rx="3" fill="var(--fg-faint)" opacity="0.32" />
    </svg>
  )
}
