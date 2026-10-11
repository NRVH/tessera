// =============================================================================
// Contrato IPC de «Abrir con Tessera» en Linux: un `tessera.desktop` propio en
// `$XDG_DATA_HOME/applications` que pone Tessera en el «Abrir con» de carpetas y en el lanzador.
// Canal propio y no el del Finder ni el del registro: el mecanismo y sus fallos son otros.
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

export const ESCRITORIO_LINUX_CHANNELS = {
  /** invoke: sin request -> EstadoEscritorioLinux. Qué hay instalado ahora mismo. */
  ESTADO: 'escritorioLinux:estado',
  /** invoke: `{ activo: boolean }` -> ResultadoEscritorioLinux. Instala o borra. */
  APLICAR: 'escritorioLinux:aplicar'
} as const

/** Por qué el `.desktop` puede no poder instalarse; cada caso se explica distinto en la UI. */
export type DisponibilidadEscritorioLinux =
  /** Todo en orden: se puede instalar y quitar en caliente. */
  | 'ok'
  /** No es Linux. */
  | 'otro-sistema'
  /** `npm run dev`: el ejecutable es el Electron de `node_modules`, sin Tessera dentro. */
  | 'desarrollo'

/** Lo que hay instalado ahora mismo, para pintar el panel de Configuración. */
export interface EstadoEscritorioLinux {
  disponibilidad: DisponibilidadEscritorioLinux
  /** ¿Existe NUESTRO `tessera.desktop`? Se mira el DISCO; uno ajeno con ese nombre no cuenta. */
  instalado: boolean
  /** Hay un `tessera.desktop` que no escribió Tessera: no se pisa, y encenderlo falla. */
  ajeno: boolean
  /** El instalado apunta a OTRA copia y no se pudo reescribir al arrancar. */
  desactualizado: boolean
}

/** Cómo fue el intento de escribir o borrar el `.desktop`. */
export interface ResultadoEscritorioLinux {
  ok: boolean
  /** Operaciones que fallaron, ya en texto legible. Vacío si `ok`. */
  fallos: string[]
}
