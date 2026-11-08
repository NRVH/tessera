// =============================================================================
// Un glifo por artículo de Tessera Academy, para su tarjeta y la cabecera del lector. viewBox
// 0 0 24 24, trazo ~1.8 y `currentColor`, como los de Configuración; sin tamaño: lo pone el CSS.
// El registro es un `Record` completo sobre `ArticuloId`: un artículo sin icono no compila.
// =============================================================================

import type { ArticuloId } from './indice'

type Trazo = React.ReactNode

function Glifo({ children }: { children: Trazo }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Los trazos de cada artículo. */
const TRAZOS: Record<ArticuloId, Trazo> = {
  bienvenida: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  glosario: (
    <>
      <path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
      <path d="M5 18a2 2 0 0 1 2-2h11" />
      <path d="M9 12l2-5 2 5M9.7 10.5h2.6" />
    </>
  ),
  perfiles: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  proyectos: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />,
  hibernar: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </>
  ),
  agentes: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3.5V7M9 12.5v1.5M15 12.5v1.5" />
    </>
  ),
  cuentas: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  'nativo-o-docker': (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  'continuar-en-otro-agente': (
    <>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </>
  ),
  'delegar-tareas': (
    <>
      <path d="M5 5v7h14M12 12v7M19 12v7" />
      <circle cx="5" cy="4" r="2" />
      <circle cx="12" cy="20" r="2" />
      <circle cx="19" cy="20" r="2" />
    </>
  ),
  'reglas-del-perfil': (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  conversaciones: <path d="M4 5h16v11H9l-5 4z" />,
  mosaico: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  'herramientas-de-los-agentes': (
    <>
      <path d="M4 17l5-5-5-5M12 19h8" />
    </>
  ),
  'bases-de-datos': (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  ssh: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </>
  ),
  'editor-y-explorador': (
    <>
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3v5h5M10 13l-2 2 2 2M14 13l2 2-2 2" />
    </>
  ),
  git: (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 7.5v9M18 10c0 4-6 3-11.5 7" />
    </>
  ),
  terminales: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7.5 9.5l3 2.5-3 2.5M13 15h4" />
    </>
  ),
  'contenedores-docker': (
    <>
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="7" rx="1.5" />
      <rect x="8" y="13" width="8" height="7" rx="1.5" />
    </>
  ),
  'copia-de-configuracion': (
    <>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  atajos: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
    </>
  ),
  actualizaciones: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
    </>
  )
}

export function IconoArticulo({ id }: { id: ArticuloId }): React.JSX.Element {
  return <Glifo>{TRAZOS[id]}</Glifo>
}

/** La «i» en un círculo: el botón ⓘ de los diálogos y los avisos de los artículos. */
export function IconoInfo(): React.JSX.Element {
  return (
    <Glifo>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </Glifo>
  )
}

/** El birrete de Tessera Academy, el mismo que su categoría en Configuración. */
export function IconoBirrete(): React.JSX.Element {
  return (
    <Glifo>
      <path d="M2.5 9.5L12 5l9.5 4.5L12 14z" />
      <path d="M6.5 11.5v4c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4" />
      <path d="M21.5 9.5v5" />
    </Glifo>
  )
}
