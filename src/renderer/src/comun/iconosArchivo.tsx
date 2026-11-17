// =============================================================================
// Iconos por tipo de archivo: el paquete `vscode-material-icons` resuelve el icono a partir del
// nombre y aquí se pinta su SVG. Los SVG no van en el JS: los sirve un plugin de Vite bajo
// `/material-icons/<icono>.svg` (ver electron.vite.config.ts). Lo comparten el árbol del
// explorador, el de git y las pestañas del editor, con el tamaño de `--icono-archivo`.
// Solo recibe el nombre del archivo; las carpetas las pinta `iconosArbol.tsx`.
// =============================================================================

import { getIconForFilePath } from 'vscode-material-icons'

/** Base pública donde el plugin de Vite sirve los SVG (dev y build). */
const ICONOS_BASE = './material-icons'

/**
 * Icono del archivo `name`, o un documento neutro (`document.svg`) para lo desconocido.
 * `className` permite colgarlo de otra superficie sin heredar el layout del árbol, no cambiar el
 * tamaño (todas las clases leen `--icono-archivo`). Decorativo: `alt` vacío y `aria-hidden`.
 */
export function IconoTipoArchivo({
  nombre,
  className = 'tree-icon'
}: {
  nombre: string
  className?: string
}): React.JSX.Element {
  const icono = getIconForFilePath(nombre)
  return <img className={className} src={`${ICONOS_BASE}/${icono}.svg`} alt="" aria-hidden="true" draggable={false} />
}
