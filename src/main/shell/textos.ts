// =============================================================================
// Textos de la integración con el sistema que ve la persona cuando algo falla: «Abrir con Tessera»
// en Linux, el menú del Explorador de Windows y la acción rápida del Finder. Español e inglés
// juntos; se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txShell = crearTextos(
  {
    linux: {
      noDisponible: '«Abrir con Tessera» no está disponible aquí.',
      conservarAplicacion: 'conservar la aplicación de las carpetas',
      escribirEntrada: 'escribir la entrada',
      borrarEntrada: 'borrar la entrada',
      yaExiste: (ruta: string) => `ya existe ${ruta} y no lo creó Tessera; no se sustituye`,
      noSeCita: 'la ruta de Tessera no se puede citar'
    },
    windows: {
      noDisponible: 'La integración con el Explorador no está disponible aquí.',
      escribir: (clave: string) => `escribir ${clave}`,
      borrar: (clave: string) => `borrar ${clave}`
    },
    finder: {
      noDisponible: 'La acción rápida del Finder no está disponible aquí.',
      sinPaquete: 'No se pudo localizar el paquete de Tessera.',
      escribir: 'escribir la acción rápida',
      borrar: 'borrar la acción rápida'
    }
  },
  {
    linux: {
      noDisponible: '“Open with Tessera” is not available here.',
      conservarAplicacion: 'keep the folders’ application',
      escribirEntrada: 'write the entry',
      borrarEntrada: 'delete the entry',
      yaExiste: (ruta: string) => `${ruta} already exists and Tessera did not create it; it is not replaced`,
      noSeCita: 'the Tessera path cannot be quoted'
    },
    windows: {
      noDisponible: 'The File Explorer integration is not available here.',
      escribir: (clave: string) => `write ${clave}`,
      borrar: (clave: string) => `delete ${clave}`
    },
    finder: {
      noDisponible: 'The Finder quick action is not available here.',
      sinPaquete: 'The Tessera package could not be located.',
      escribir: 'write the quick action',
      borrar: 'delete the quick action'
    }
  }
)
