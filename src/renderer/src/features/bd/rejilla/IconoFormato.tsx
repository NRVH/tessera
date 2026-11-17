// =============================================================================
// El icono de cada formato de filas (CSV, TSV, JSON, SQL INSERT, Markdown) en los menús de exportar y
// de copiar: el mismo que el explorador y las pestañas dan a un archivo de esa extensión
// (`IconoTipoArchivo`), para que el formato se reconozca como se reconoce el archivo que va a salir.
// =============================================================================

import { IconoTipoArchivo } from '../../../comun/iconosArchivo'
import type { DbFormatoFilas } from '../../../../../shared/dbExploradorPeticiones'

/** La extensión del archivo de cada formato: de ella sale el icono. */
const EXTENSION: Record<DbFormatoFilas, string> = {
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  insert: 'sql',
  markdown: 'md'
}

export function IconoFormato({ formato }: { formato: DbFormatoFilas }): React.JSX.Element {
  return <IconoTipoArchivo nombre={`datos.${EXTENSION[formato]}`} className="icono-formato" />
}
