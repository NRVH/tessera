// =============================================================================
// iconosBd: los glifos de la vista de bases de datos (árbol, pestañas, barras de la
// consola y de la rejilla), en un solo sitio para que el mismo concepto se dibuje
// igual en toda la ventana. El nombre de cada uno es el CONCEPTO, no el dibujo. Aquí
// viven las acciones; los motores y los objetos, en `iconosBdMotores.tsx` e
// `iconosBdObjetos.tsx`, y este módulo los reexporta.
// Decisiones: docs/decisiones/bd/ui-area-iconos.md
// =============================================================================

import { Svg } from './iconosBdSvg'

export { IconoBd, IconoMotor, nombreMotor } from './iconosBdMotores'
export {
  IconoClaveKv,
  IconoColeccion,
  IconoColumna,
  IconoConsola,
  IconoEsquema,
  IconoFiltro,
  IconoIndice,
  IconoLlave,
  IconoLlaveForanea,
  IconoObjetoBd
} from './iconosBdObjetos'

// --- Acciones de cabecera y árbol ---------------------------------------------

/** Nueva conexión: el cilindro con un `+`. */
export function IconoNuevaConexion(): React.JSX.Element {
  return (
    <Svg>
      <ellipse cx="10" cy="5.5" rx="6.5" ry="2.6" />
      <path d="M3.5 5.5v11c0 1.44 2.9 2.6 6.5 2.6M16.5 5.5V11" />
      <path d="M3.5 11c0 1.44 2.9 2.6 6.5 2.6" />
      <path d="M18 14v7M14.5 17.5h7" />
    </Svg>
  )
}

/** Nueva consola: la consola con un `+`. */
export function IconoNuevaConsola(): React.JSX.Element {
  return (
    <Svg>
      <path d="M13 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
      <path d="m7 9.5 3 2.5-3 2.5" />
      <path d="M18 14.5v6M15 17.5h6" />
    </Svg>
  )
}

export function IconoRefrescar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </Svg>
  )
}

export function IconoPlegarTodo(): React.JSX.Element {
  return (
    <Svg>
      <path d="m7 20 5-5 5 5M7 4l5 5 5-5" />
    </Svg>
  )
}

/** Desconectar: el enchufe separado. */
export function IconoDesconectar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M8.5 15.5 5 19M19 5l-3.5 3.5" />
      <path d="M7 11l6 6-1.5 1.5a4.24 4.24 0 0 1-6-6L7 11Z" />
      <path d="M17 13l-6-6 1.5-1.5a4.24 4.24 0 0 1 6 6L17 13Z" />
      <path d="M3 3l18 18" />
    </Svg>
  )
}

// --- Acciones de la consola y de la rejilla -----------------------------------

export function IconoEjecutar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M7 4.5v15l12-7.5-12-7.5Z" />
    </Svg>
  )
}

export function IconoEjecutarTodo(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 5v14l8-7-8-7Z" />
      <path d="M12 5v14l8-7-8-7Z" />
    </Svg>
  )
}

export function IconoDetener(): React.JSX.Element {
  return (
    <Svg>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Svg>
  )
}

/** Confirmar (Commit). */
export function IconoCommit(): React.JSX.Element {
  return (
    <Svg>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  )
}

/** Revertir (Rollback): la flecha que vuelve. */
export function IconoRollback(): React.JSX.Element {
  return (
    <Svg>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  )
}

/**
 * Modo de transacción. Las dos flechas cruzadas dicen "alternar", y el `aria-pressed`
 * del botón dice en qué modo está: pulsado = Manual.
 */
export function IconoTx(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 8h13M14 5l3 3-3 3" />
      <path d="M20 16H7M10 13l-3 3 3 3" />
    </Svg>
  )
}

/** Solo lectura: el candado (abre "Editar conexión…"). */
export function IconoCandado(): React.JSX.Element {
  return (
    <Svg>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  )
}

/** Contar filas: Σ. */
export function IconoContar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M17 5H7l6 7-6 7h10" />
    </Svg>
  )
}

/** Fijar una pestaña de resultado: la chincheta. */
export function IconoFijar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M9 4h6l-1 5 3.5 3.5v1.5h-11v-1.5L10 9 9 4Z" />
      <path d="M12 14v6" />
    </Svg>
  )
}

/** Ver definición / fuente: los corchetes angulares. */
export function IconoDefinicion(): React.JSX.Element {
  return (
    <Svg>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </Svg>
  )
}

/**
 * «Ver DDL»: la hoja de guion con la esquina doblada y sus líneas. Distinto de la
 * definición (los corchetes): el DDL es el script para RECREAR el objeto.
 */
export function IconoDdl(): React.JSX.Element {
  return (
    <Svg>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z" />
      <path d="M14 3.5v5h5" />
      <path d="M8.5 12.5h7M8.5 16h4.5" />
    </Svg>
  )
}

/** Limpiar la salida: la escoba. */
export function IconoLimpiar(): React.JSX.Element {
  return (
    <Svg>
      <path d="m14 4 6 6M9 9l6 6" />
      <path d="M9 9 4.5 13.5a3 3 0 0 0 0 4.24L6.26 19.5a3 3 0 0 0 4.24 0L15 15" />
    </Svg>
  )
}

// --- Rejilla y pestaña de datos ------------------------------------------------

/** Exportar a archivo: la flecha que baja a la bandeja. */
export function IconoExportar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </Svg>
  )
}

/** Ver valor: el ojo. */
export function IconoVerValor(): React.JSX.Element {
  return (
    <Svg>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  )
}

/** Traer todas: dos cheurones hacia abajo hasta el final. */
export function IconoTraerTodas(): React.JSX.Element {
  return (
    <Svg>
      <path d="m7 5 5 5 5-5M7 11l5 5 5-5M6 20h12" />
    </Svg>
  )
}
