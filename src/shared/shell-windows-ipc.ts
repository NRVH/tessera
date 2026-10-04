// =============================================================================
// Contrato IPC de «Abrir con Tessera» desde el gestor de archivos: lo que llega al elegirlo.
// El main resuelve y el renderer abre: el renderer no ve la ruta del host, recibe una
// contenedora ya elegida (`openKnownProject` + `openEditorTab`).
// Cola + `invoke` y no un `send` suelto: la apertura puede llegar sin renderer o mientras se
// recarga. Al recoger, el renderer manda sus proyectos abiertos: si la ruta cae en uno, se
// activa ese en vez de abrir otro solapado.
// Decisiones: docs/decisiones/sistema/cola-de-aperturas.md
// =============================================================================

export const SHELL_WINDOWS_CHANNELS = {
  /**
   * invoke: recoge y VACÍA la cola de aperturas pendientes.
   * TomarAperturasRequest -> ResultadoApertura[].
   */
  TOMAR_APERTURAS: 'shellWindows:tomarAperturas',
  /**
   * send main -> renderer: "hay algo nuevo en la cola". Sin carga útil a propósito:
   * quien manda la verdad es la cola, no el mensaje.
   */
  HAY_APERTURAS: 'shellWindows:hayAperturas',
  /** invoke: sin request -> EstadoIntegracionShell. Qué hay registrado ahora mismo. */
  INTEGRACION_ESTADO: 'shellWindows:integracionEstado',
  /** invoke: EstadoIntegracion -> ResultadoIntegracion. Escribe/borra el registro. */
  INTEGRACION_APLICAR: 'shellWindows:integracionAplicar',
  /**
   * invoke: sin request. Abre el panel de Windows donde se eligen las aplicaciones
   * predeterminadas, que es el ÚNICO sitio desde el que se puede hacer (ver abajo).
   */
  ABRIR_APPS_PREDETERMINADAS: 'shellWindows:abrirAppsPredeterminadas'
} as const

/**
 * Por qué la integración puede no estar disponible. No es un `boolean` porque cada
 * caso se explica distinto en la interfaz, y "no disponible" a secas deja al usuario
 * mirando un interruptor apagado sin saber qué hacer.
 */
export type DisponibilidadShell =
  /** Todo en orden: se puede registrar y quitar en caliente. */
  | 'ok'
  /** No es Windows. */
  | 'otro-sistema'
  /**
   * `npm run dev`: el ejecutable es `electron.exe` dentro de `node_modules`, así que
   * registrarlo dejaría un menú que lanza un Electron pelado sin Tessera dentro.
   */
  | 'desarrollo'
  /**
   * Tessera portable: su .exe vive en una carpeta temporal que el propio lanzador
   * borra al salir, de modo que la clave del registro apuntaría a algo que ya no
   * existe en cuanto cierras la app.
   */
  | 'portable'

/** Lo que hay registrado ahora mismo, para pintar el panel de Configuración. */
export interface EstadoIntegracionShell {
  disponibilidad: DisponibilidadShell
  /** Lo último que Tessera aplicó al registro. */
  aplicado: {
    carpetas: boolean
    archivos: boolean
    extensiones: string[]
  }
  /**
   * El registro apunta a OTRO ejecutable (Tessera cambió de carpeta). Se reconcilia
   * sola al arrancar; el campo existe para poder decirlo si alguna vez no se pudo.
   */
  desactualizado: boolean
}

/** Cómo fue el intento de escribir en el registro. */
export interface ResultadoIntegracion {
  ok: boolean
  /** Operaciones que fallaron, ya en texto legible. Vacío si `ok`. */
  fallos: string[]
}

/** Un proyecto abierto ahora mismo, tal y como lo conoce el modelo de pestañas. */
export interface ProyectoAbierto {
  profileId: string
  projectHostPath: string
}

/** Lo que el renderer aporta para que el main pueda resolver. */
export interface TomarAperturasRequest {
  /** Proyectos abiertos, de todos los perfiles. Puede venir vacío. */
  abiertos: readonly ProyectoAbierto[]
  /**
   * ¿Ya restauró el renderer sus pestañas? Si no es `true`, `abiertos` todavía no dice
   * nada y el main resuelve también contra los proyectos PERSISTIDOS: sin eso, en frío
   * se acuñaría un proyecto nativo encima de uno restaurado que corría en contenedor.
   */
  pestanasCargadas?: boolean
}

/** Una apertura ya resuelta: el renderer solo tiene que ejecutarla. */
export interface AperturaResuelta {
  /**
   * Contenedora que hay que abrir o activar. `projectHostPath` es la única ruta de
   * Windows que cruza el puente, igual que la que devuelve `openProjectDialog`.
   */
  contenedora: { projectHostPath: string; name: string }
  /**
   * Perfil en el que el main vio esa contenedora abierta, o `null` si no la vio en
   * ninguno. Es una PISTA: si se resolvió contra lo persistido puede nombrar un perfil
   * o un proyecto que el renderer no restauró, así que decide él con sus pestañas.
   */
  profileIdExistente: string | null
  /**
   * Archivo que abrir en el editor, con la ruta POSIX RELATIVA a la contenedora
   * (que es lo único que `CenterPane` acepta), o `null` si se pidió una carpeta.
   */
  archivo: { path: string; name: string } | null
  /**
   * Ruta —archivo o carpeta— que revelar en el árbol de archivos, POSIX relativa a
   * la contenedora: el explorador despliega sus ancestros y hace scroll hasta ella.
   * `null` cuando la ruta pedida ERA la contenedora y no hay nada que desplegar.
   */
  revelar: string | null
}

/**
 * Resultado por cada ruta que llegó. El fallo se cuenta con el NOMBRE, no con la
 * ruta: un aviso que dijera "no existe D:\Users\ana\…" filtraría al renderer justo
 * lo que el invariante prohíbe, y para el usuario "no existe «proyecto-x»" dice lo
 * mismo.
 */
export type ResultadoApertura =
  | { ok: true; apertura: AperturaResuelta }
  | { ok: false; nombre: string; motivo: MotivoFalloApertura }

/** Por qué no se pudo abrir. Cerrado a propósito: el texto lo pone el renderer. */
export type MotivoFalloApertura =
  | 'no-existe'
  | 'sin-permiso'
  | 'ruta-invalida'
  /** La contenedora se pudo resolver pero el archivo no cae dentro de ella. */
  | 'fuera-de-la-contenedora'
