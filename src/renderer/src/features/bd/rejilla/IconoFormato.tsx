// =============================================================================
// El icono de cada formato de filas (CSV, TSV, JSON, SQL INSERT, Markdown) en los menús de exportar y
// de copiar: el mismo que el explorador y las pestañas dan a un archivo de esa extensión
// (`FileTypeIcon`), para que el formato se reconozca como se reconoce el archivo que va a salir.
// =============================================================================

import { FileTypeIcon } from '../../../comun/fileIcons'
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
  return <FileTypeIcon name={`datos.${EXTENSION[formato]}`} className="icono-formato" />
}
