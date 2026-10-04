// =============================================================================
// iconosBdObjetos: los glifos de los objetos del catálogo (esquema, tablas, vistas,
// rutinas, columnas, claves, índices, colecciones, claves de Redis) y el icono por
// tipo de objeto del árbol y de las pestañas. Los reexporta `iconosBd.tsx`.
// Decisiones: docs/decisiones/bd/ui-area-iconos.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../shared/db-explorador-ipc'
import { Svg } from './iconosBdSvg'

/** Esquema: tres bloques apilados (el "namespace"). */
export function IconoEsquema(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="4" width="8" height="6" rx="1.2" />
      <rect x="13" y="4" width="8" height="6" rx="1.2" />
      <rect x="8" y="14" width="8" height="6" rx="1.2" />
      <path d="M7 10v2h10v-2M12 12v2" />
    </Svg>
  )
}

// --- Objetos --------------------------------------------------------------------

export function IconoTabla(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M3 14.5h18M9 9.5V20" />
    </Svg>
  )
}

/** Vista: tabla con un ojo (es una consulta guardada, no datos propios). */
export function IconoVista(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" strokeDasharray="3 2" />
      <path d="M6.5 12s2-3.2 5.5-3.2 5.5 3.2 5.5 3.2-2 3.2-5.5 3.2S6.5 12 6.5 12Z" />
      <circle cx="12" cy="12" r="1.3" />
    </Svg>
  )
}

/** Vista materializada: tabla con el borde entero y el ojo (datos persistidos). */
export function IconoVistaMaterializada(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M6.5 12s2-3.2 5.5-3.2 5.5 3.2 5.5 3.2-2 3.2-5.5 3.2S6.5 12 6.5 12Z" />
      <circle cx="12" cy="12" r="1.3" />
    </Svg>
  )
}

/** Tabla foránea (PG): tabla con una flecha que sale. */
export function IconoTablaForanea(): React.JSX.Element {
  return (
    <Svg>
      <path d="M14 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
      <path d="M3 9.5h18M9 9.5V20" />
      <path d="M16 17h5M18.5 14.5 21 17l-2.5 2.5" />
    </Svg>
  )
}

/**
 * Tabla virtual (SQLite: fts5, rtree…): la tabla con la rejilla de puntos (se lee como
 * una tabla, pero la sirve un módulo, no filas propias). Provisional.
 */
export function IconoTablaVirtual(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M9 9.5V20" strokeDasharray="1.5 2" />
      <path d="M3 14.5h18" strokeDasharray="1.5 2" />
    </Svg>
  )
}

/** Rutina (procedimiento o función): f(x). */
export function IconoRutina(): React.JSX.Element {
  return (
    <Svg>
      <path d="M10 5.5c-1.6-.5-3 .3-3.3 2L5 19" />
      <path d="M4.5 11h5" />
      <path d="M13 9c-1.2 1.6-1.2 6.4 0 8M19 9c1.2 1.6 1.2 6.4 0 8M14.8 10.5l2.4 5M17.2 10.5l-2.4 5" />
    </Svg>
  )
}

/** Paquete (Oracle): la caja. */
export function IconoPaquete(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </Svg>
  )
}

/** Secuencia: 1 2 3. */
export function IconoSecuencia(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 8.5 6 7v10" />
      <path d="M10 8.5c0-1 .9-1.6 2-1.6s2 .7 2 1.7c0 1.8-4 3.4-4 8.4h4" />
      <path d="M17 7.4c.5-.4 1.1-.5 1.7-.5 1.2 0 2 .7 2 1.7 0 1.1-.9 1.8-2 1.8 1.3 0 2.3.8 2.3 2.1 0 1.4-1.1 2.3-2.4 2.3-.7 0-1.3-.2-1.8-.6" />
    </Svg>
  )
}

/** Sinónimo: el eslabón (un alias que apunta a otro objeto). */
export function IconoSinonimo(): React.JSX.Element {
  return (
    <Svg>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </Svg>
  )
}

/** Tipo (de objeto, de colección o de PG): llaves con una T. */
export function IconoTipoBd(): React.JSX.Element {
  return (
    <Svg>
      <path d="M7 4c-1.7 0-2.5.8-2.5 2.5V10L3 12l1.5 2v3.5C4.5 19.2 5.3 20 7 20" />
      <path d="M17 4c1.7 0 2.5.8 2.5 2.5V10L21 12l-1.5 2v3.5c0 1.7-.8 2.5-2.5 2.5" />
      <path d="M9 9h6M12 9v7" />
    </Svg>
  )
}

/** Disparador: el rayo. */
export function IconoDisparador(): React.JSX.Element {
  return (
    <Svg>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
    </Svg>
  )
}

export function IconoColumna(): React.JSX.Element {
  return (
    <Svg>
      <rect x="8" y="3.5" width="8" height="17" rx="1.5" />
      <path d="M8 9h8M8 14.5h8" />
    </Svg>
  )
}

/** Clave primaria. */
export function IconoLlave(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H21M17.5 12v3M20 12v2" />
    </Svg>
  )
}

/** Clave foránea: la llave con una flecha. */
export function IconoLlaveForanea(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="7" cy="12" r="3" />
      <path d="M10 12h6" />
      <path d="M14 9l3 3-3 3M19 8v8" />
    </Svg>
  )
}

export function IconoIndice(): React.JSX.Element {
  return (
    <Svg>
      <path d="M5 5v14M5 6h3M5 12h3M5 18h3" />
      <path d="M11 6h8M11 12h8M11 18h8" />
    </Svg>
  )
}

/** Colección de documentos: las llaves `{ }` de un documento. */
export function IconoColeccion(): React.JSX.Element {
  return (
    <Svg>
      <path d="M9 4.5H8a2 2 0 0 0-2 2v3a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 6 14.5v3a2 2 0 0 0 2 2h1" />
      <path d="M15 4.5h1a2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5v3a2 2 0 0 1-2 2h-1" />
    </Svg>
  )
}

/**
 * Una clave de un motor de claves: la llave de la PK, sin el color de la PK (aquí no es
 * una restricción: es el nombre con el que se guarda el valor).
 */
export function IconoClaveKv(): React.JSX.Element {
  return <IconoLlave />
}

/** Filtrar las claves de una base por un patrón (`MATCH`): el embudo, el glifo habitual de «filtrar». */
export function IconoFiltro(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z" />
    </Svg>
  )
}

/** Consola SQL: ventana con el prompt. */
export function IconoConsola(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" />
    </Svg>
  )
}

/** Icono por tipo de objeto del árbol y de las pestañas. */
export function IconoObjetoBd({ tipo }: { tipo: DbTipoObjeto }): React.JSX.Element {
  switch (tipo) {
    case 'tabla':
      return <IconoTabla />
    case 'vista':
      return <IconoVista />
    case 'vistaMaterializada':
      return <IconoVistaMaterializada />
    case 'tablaForanea':
      return <IconoTablaForanea />
    case 'tablaVirtual':
      return <IconoTablaVirtual />
    case 'rutina':
      return <IconoRutina />
    case 'paquete':
      return <IconoPaquete />
    case 'secuencia':
      return <IconoSecuencia />
    case 'sinonimo':
      return <IconoSinonimo />
    case 'tipoObjeto':
    case 'tipoColeccion':
    case 'tipo':
      return <IconoTipoBd />
    case 'disparador':
      return <IconoDisparador />
  }
}
