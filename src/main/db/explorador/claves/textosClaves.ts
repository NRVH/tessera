// =============================================================================
// Textos del explorador de claves que llegan al usuario desde el main: el fallo de guardar un archivo.
// Se leen al producirse el mensaje, nunca al cargar el módulo.
// Depende de shared/i18n.ts.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txClaves = crearTextos(
  { noSeGuardo: 'No se pudo guardar el archivo (sin permiso o el destino está en uso).' },
  { noSeGuardo: 'Could not save the file (no permission, or the destination is in use).' }
)
