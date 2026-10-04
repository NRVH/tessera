// =============================================================================
// Contrato IPC de la acción rápida del Finder: el equivalente macOS de «Abrir con Tessera».
// Canal propio y no `SHELL_WINDOWS_CHANNELS`: no comparten mecanismo (registro frente a un
// `.workflow` en `~/Library/Services`) ni forma de estado; un tipo unión mentiría a medias.
// Un solo interruptor: las extensiones ya las declara `CFBundleDocumentTypes` al empaquetar,
// y solo la entrada de «Servicios» se conmuta en caliente.
// No se usa `lsregister -u`: Launch Services vuelve a registrar la app sola y el apagado no dura.
// Decisiones: docs/decisiones/sistema/accion-rapida-del-finder.md
// =============================================================================

export const SERVICIO_FINDER_CHANNELS = {
  /** invoke: sin request -> EstadoServicioFinder. Qué hay instalado ahora mismo. */
  ESTADO: 'servicioFinder:estado',
  /** invoke: `{ activo: boolean }` -> ResultadoServicioFinder. Instala o borra. */
  APLICAR: 'servicioFinder:aplicar'
} as const

/**
 * Por qué la acción rápida puede no poder instalarse. No es un `boolean` por el mismo
 * motivo que en Windows: cada caso se explica distinto en la interfaz, y "no
 * disponible" a secas deja al usuario mirando un interruptor apagado sin saber qué
 * hacer.
 */
export type DisponibilidadFinder =
  /** Todo en orden: se puede instalar y quitar en caliente. */
  | 'ok'
  /** No es macOS. */
  | 'otro-sistema'
  /**
   * `npm run dev`: el ejecutable es el Electron de `node_modules`, así que la acción
   * rápida lanzaría un Electron pelado sin Tessera dentro.
   */
  | 'desarrollo'
  /**
   * La app está empaquetada pero no se pudo deducir la ruta de su `.app` a partir del
   * ejecutable. No debería pasar nunca —un `.app` siempre tiene la forma
   * `X.app/Contents/MacOS/X`—, pero si pasara, el `.workflow` nacería con un `open -a`
   * apuntando a nada, y eso es peor que no instalarlo.
   */
  | 'sin-bundle'

/** Lo que hay instalado ahora mismo, para pintar el panel de Configuración. */
export interface EstadoServicioFinder {
  disponibilidad: DisponibilidadFinder
  /** ¿Existe el `.workflow` en `~/Library/Services`? Se mira el DISCO, no la memoria. */
  instalado: boolean
  /**
   * El `.workflow` instalado apunta a OTRA copia de Tessera (la app cambió de carpeta).
   * Se reconcilia sola al arrancar; el campo existe para poder decirlo si no se pudo.
   */
  desactualizado: boolean
}

/** Cómo fue el intento de escribir en `~/Library/Services`. */
export interface ResultadoServicioFinder {
  ok: boolean
  /** Operaciones que fallaron, ya en texto legible. Vacío si `ok`. */
  fallos: string[]
}
