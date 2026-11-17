// =============================================================================
// Diálogos del árbol: crear, renombrar, confirmar el reemplazo de una importación y
// confirmar el borrado. Solo montan el que toque; el estado y las operaciones son del
// árbol. Devuelven un fragmento: no añaden nada al DOM.
// =============================================================================
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { DialogoPrompt } from '../../comun/DialogoPrompt'
import { cerrarDialogo, crearNodo, eliminarNodos, importarNodos, renombrarNodo } from './operacionesArbol'
import type { Arbol, DialogoArchivo } from './tiposArbol'
import { txExplorador } from './textos.ts'

type DialogoBorrado = Extract<NonNullable<DialogoArchivo>, { tipo: 'delete' }>

/** Tope de nombres que lista el diálogo de borrado: cincuenta viñetas no se leen. */
const TOPE_LISTADO = 10

/** Título y mensaje del borrado; con un solo elemento se conserva el texto de siempre. */
function textosBorrado(d: DialogoBorrado): { titulo: string; mensaje: string } {
  const t = txExplorador()
  const varios = d.rutas.length > 1
  const aviso = d.hayCarpeta ? (varios ? t.avisoContenidoCarpetas : t.avisoContenido) : ''
  if (!varios) {
    return {
      titulo: d.hayCarpeta ? t.eliminarCarpeta(d.nombres[0]) : t.eliminarArchivo(d.nombres[0]),
      mensaje: t.seguroEliminar(d.nombres[0], aviso)
    }
  }
  const listado = d.nombres
    .slice(0, TOPE_LISTADO)
    .map((n) => `• ${n}`)
    .join('\n')
  const resto = d.nombres.length - TOPE_LISTADO
  return {
    titulo: t.eliminarElementos(d.rutas.length),
    mensaje: t.seguroEliminarVarios(d.rutas.length, listado, resto, aviso)
  }
}

/** Los diálogos del árbol; solo uno está montado a la vez. */
export function DialogosArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { dialogo, errorDialogo, conflictoImportacion, setConflictoImportacion } = arbol
  const t = txExplorador()
  return (
    <>
      {(dialogo?.tipo === 'newFile' || dialogo?.tipo === 'newFolder') && (
        <DialogoPrompt
          titulo={dialogo.tipo === 'newFile' ? t.nuevoArchivo : t.nuevaCarpeta}
          etiqueta={dialogo.tipo === 'newFile' ? t.nombreArchivo : t.nombreCarpeta}
          etiquetaConfirmar={t.crear}
          error={errorDialogo}
          onConfirmar={(nm) => void crearNodo(arbol, dialogo.dir, nm, dialogo.tipo === 'newFolder')}
          onCancelar={() => cerrarDialogo(arbol)}
        />
      )}
      {dialogo?.tipo === 'rename' && (
        <DialogoPrompt
          titulo={t.renombrar}
          etiqueta={t.nuevoNombre}
          etiquetaConfirmar={t.renombrar}
          valorInicial={dialogo.nombre}
          seleccionarNombreBase
          error={errorDialogo}
          onConfirmar={(nm) => void renombrarNodo(arbol, dialogo.ruta, nm)}
          onCancelar={() => cerrarDialogo(arbol)}
        />
      )}
      {conflictoImportacion && (
        <DialogoConfirmar
          peligro
          titulo={t.reemplazarTitulo(conflictoImportacion.conflictos.length)}
          mensaje={t.yaExiste(
            conflictoImportacion.conflictos.length > 1,
            conflictoImportacion.conflictos.map((n) => `• ${n}`).join('\n')
          )}
          etiquetaConfirmar={t.reemplazar}
          onConfirmar={() =>
            void importarNodos(arbol, conflictoImportacion.rutasHost, conflictoImportacion.destDir, true)
          }
          onCancelar={() => setConflictoImportacion(null)}
        />
      )}
      {dialogo?.tipo === 'delete' && (
        <DialogoConfirmar
          peligro
          {...textosBorrado(dialogo)}
          etiquetaConfirmar={t.eliminar}
          onConfirmar={() => void eliminarNodos(arbol, dialogo.rutas)}
          onCancelar={() => cerrarDialogo(arbol)}
        />
      )}
    </>
  )
}
