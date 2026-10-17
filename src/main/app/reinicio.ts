// =============================================================================
// Con qué se vuelve a abrir Tessera al reiniciar desde la app (cambiar de idioma): el ejecutable y
// los argumentos. No se reutilizan tal cual los del arranque: la bandera del instalador haría creer
// al proceso nuevo que viene de actualizar, y las rutas de «Abrir con Tessera» se volverían a abrir.
// En un AppImage el ejecutable vive en un montaje que desaparece al salir: se relanza el AppImage.
// Puro: recibe argv, si la app está empaquetada y la ruta del AppImage. Lo prueba `test-reinicio.mts`.
// =============================================================================

import { FLAG_ACTUALIZADO } from '../../shared/rutasDesdeArgv.ts'

export interface OpcionesReinicio {
  execPath?: string
  args: string[]
}

export function opcionesReinicio(argv: readonly string[], empaquetada: boolean, appImage?: string): OpcionesReinicio {
  const resto = argv.slice(1).filter((a) => a !== FLAG_ACTUALIZADO)
  // Empaquetada, lo que no es una opción es una ruta que entregó el sistema; en desarrollo, el
  // primero es la carpeta de la app y hace falta.
  const args = empaquetada ? resto.filter((a) => a.startsWith('--')) : resto
  return appImage ? { execPath: appImage, args } : { args }
}
