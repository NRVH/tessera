// =============================================================================
// Diálogos del árbol: crear, renombrar, confirmar el reemplazo de una importación y
// confirmar el borrado. Solo montan el que toque; el estado y las operaciones son del
// árbol. Devuelven un fragmento: no añaden nada al DOM.
// =============================================================================
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PromptDialog } from '../../comun/PromptDialog'
import { cerrarDialogo, crearNodo, eliminarNodos, importarNodos, renombrarNodo } from './operacionesArbol'
import type { Arbol, FileDialog } from './tiposArbol'
import { txExplorador } from './textos.ts'

type DialogoBorrado = Extract<NonNullable<FileDialog>, { kind: 'delete' }>

/** Tope de nombres que lista el diálogo de borrado: cincuenta viñetas no se leen. */
const TOPE_LISTADO = 10

/** Título y mensaje del borrado; con un solo elemento se conserva el texto de siempre. */
function textosBorrado(d: DialogoBorrado): { title: string; message: string } {
  const t = txExplorador()
  const varios = d.paths.length > 1
  const aviso = d.hayCarpeta ? (varios ? t.avisoContenidoCarpetas : t.avisoContenido) : ''
  if (!varios) {
    return {
      title: d.hayCarpeta ? t.eliminarCarpeta : t.eliminarArchivo,
      message: t.seguroEliminar(d.nombres[0], aviso)
    }
  }
  const listado = d.nombres
    .slice(0, TOPE_LISTADO)
    .map((n) => `• ${n}`)
    .join('\n')
  const resto = d.nombres.length - TOPE_LISTADO
  return {
    title: t.eliminarElementos(d.paths.length),
    message: t.seguroEliminarVarios(d.paths.length, listado, resto, aviso)
  }
}

/** Los diálogos del árbol; solo uno está montado a la vez. */
export function DialogosArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { dialog, dialogError, importConflict, setImportConflict } = arbol
  const t = txExplorador()
  return (
    <>
      {(dialog?.kind === 'newFile' || dialog?.kind === 'newFolder') && (
        <PromptDialog
          title={dialog.kind === 'newFile' ? t.nuevoArchivo : t.nuevaCarpeta}
          label={dialog.kind === 'newFile' ? t.nombreArchivo : t.nombreCarpeta}
          confirmLabel={t.crear}
          error={dialogError}
          onConfirm={(nm) => void crearNodo(arbol, dialog.dir, nm, dialog.kind === 'newFolder')}
          onCancel={() => cerrarDialogo(arbol)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title={t.renombrar}
          label={t.nuevoNombre}
          confirmLabel={t.renombrar}
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
          title={importConflict.conflicts.length > 1 ? t.reemplazarArchivos : t.reemplazarArchivo}
          message={t.yaExiste(
            importConflict.conflicts.length > 1,
            importConflict.conflicts.map((n) => `• ${n}`).join('\n')
          )}
          confirmLabel={t.reemplazar}
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
          confirmLabel={t.eliminar}
          onConfirm={() => void eliminarNodos(arbol, dialog.paths)}
          onCancel={() => cerrarDialogo(arbol)}
        />
      )}
    </>
  )
}
