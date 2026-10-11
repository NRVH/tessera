// =============================================================================
// Guardar un texto (la exportación de una clave de Redis a JSON) donde el usuario elija: el diálogo nativo
// de guardar, con la carpeta de las exportaciones de BD, y la escritura del archivo. Es lo único de esa
// exportación que toca Electron; el contrato y las validaciones son de `ControladorClaves`.
// =============================================================================
import { app, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { guardarConDialogo } from '../../util/adaptadores/dialogosNativos'

/**
 * El nombre del archivo guardado, o null si el usuario canceló el diálogo. Lanza si no se pudo escribir.
 * `propuesto` ya viene saneado y con su extensión (lo hace quien compone).
 */
export async function guardarTextoDeUsuario(ventana: BrowserWindow | null, propuesto: string, texto: string): Promise<string | null> {
  const r = await guardarConDialogo(
    'exportar-bd',
    propuesto,
    {
      title: 'Exportar la clave a JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    },
    { ventana: ventana && !ventana.isDestroyed() ? ventana : null, despues: [app.getPath('downloads')] }
  )
  if (r.canceled || !r.filePath) return null
  // El diálogo de algunos sistemas no añade la extensión.
  const ruta = extname(r.filePath) === '' ? `${r.filePath}.json` : r.filePath
  await writeFile(ruta, texto, 'utf8')
  return basename(ruta)
}
