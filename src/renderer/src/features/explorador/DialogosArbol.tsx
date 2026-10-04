// =============================================================================
// Diálogos del árbol: crear, renombrar, confirmar el reemplazo de una importación y
// confirmar el borrado. Solo montan el que toque; el estado y las operaciones son del
// árbol. Devuelven un fragmento: no añaden nada al DOM.
// =============================================================================
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PromptDialog } from '../../comun/PromptDialog'
import { cerrarDialogo, crearNodo, eliminarNodos, importarNodos, renombrarNodo } from './operacionesArbol'
import type { Arbol, FileDialog } from './tiposArbol'

type DialogoBorrado = Extract<NonNullable<FileDialog>, { kind: 'delete' }>

/** Tope de nombres que lista el diálogo de borrado: cincuenta viñetas no se leen. */
const TOPE_LISTADO = 10

/** Título y mensaje del borrado; con un solo elemento se conserva el texto de siempre. */
function textosBorrado(d: DialogoBorrado): { title: string; message: string } {
  const varios = d.paths.length > 1
  const aviso = d.hayCarpeta
    ? varios
      ? '\nSe eliminará también todo el contenido de las carpetas.'
      : '\nSe eliminará también todo su contenido.'
    : ''
  if (!varios) {
    return {
      title: d.hayCarpeta ? 'Eliminar carpeta' : 'Eliminar archivo',
      message: `¿Seguro que quieres eliminar "${d.nombres[0]}"?${aviso}`
    }
  }
  const listado = d.nombres
    .slice(0, TOPE_LISTADO)
    .map((n) => `• ${n}`)
    .join('\n')
  const resto = d.nombres.length - TOPE_LISTADO
  return {
    title: `Eliminar ${d.paths.length} elementos`,
    message: `¿Seguro que quieres eliminar estos ${d.paths.length} elementos?\n${listado}${
      resto > 0 ? `\n…y ${resto} más` : ''
    }${aviso}`
  }
}

/** Los diálogos del árbol; solo uno está montado a la vez. */
export function DialogosArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { dialog, dialogError, importConflict, setImportConflict } = arbol
  return (
    <>
      {(dialog?.kind === 'newFile' || dialog?.kind === 'newFolder') && (
        <PromptDialog
          title={dialog.kind === 'newFile' ? 'Nuevo archivo' : 'Nueva carpeta'}
          label={dialog.kind === 'newFile' ? 'Nombre del archivo' : 'Nombre de la carpeta'}
          confirmLabel="Crear"
          error={dialogError}
          onConfirm={(nm) => void crearNodo(arbol, dialog.dir, nm, dialog.kind === 'newFolder')}
          onCancel={() => cerrarDialogo(arbol)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Renombrar"
          label="Nuevo nombre"
          confirmLabel="Renombrar"
          initialValue={dialog.name}
          selectBasename
          error={dialogError}
          onConfirm={(nm) => void renombrarNodo(arbol, dialog.path, nm)}
          onCancel={() => cerrarDialogo(arbol)}
        />
      )}
      {importConflict && (
        <ConfirmDialog
          danger
          title={importConflict.conflicts.length > 1 ? 'Reemplazar archivos' : 'Reemplazar archivo'}
          message={`Ya existe${importConflict.conflicts.length > 1 ? 'n' : ''} en la carpeta destino:\n${importConflict.conflicts
            .map((n) => `• ${n}`)
            .join('\n')}\n\n¿Reemplazar con lo que soltaste?`}
          confirmLabel="Reemplazar"
          onConfirm={() =>
            void importarNodos(arbol, importConflict.hostPaths, importConflict.destDir, true)
          }
          onCancel={() => setImportConflict(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          danger
          {...textosBorrado(dialog)}
          confirmLabel="Eliminar"
          onConfirm={() => void eliminarNodos(arbol, dialog.paths)}
          onCancel={() => cerrarDialogo(arbol)}
        />
      )}
    </>
  )
}
