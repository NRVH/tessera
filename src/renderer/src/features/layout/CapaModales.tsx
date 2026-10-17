// =============================================================================
// Capa de modales de la raíz, en su orden: Configuración, importar un `.tessera` abierto desde el
// sistema, buscar en archivos, el
// modo de un proyecto nuevo, cerrar sin guardar, el menú de elegir conexión y los diálogos de las
// conexiones SSH.
// En la raíz porque un `position: fixed` se resuelve contra cualquier ancestro con
// transform o contain, y la app ya tiene uno vivo.
// =============================================================================
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { ContextMenu } from '../../comun/ContextMenu'
import { ImportarDesdeSistema, ModalAjustes } from '../ajustes'
import { ModalBusqueda } from '../busqueda'
import { ProjectModeModal, useStorePestanas, type UseTabs } from '../pestanas'
import { useStoreEditor, type EditorApp } from '../editor'
import { IconoMotor, motivoSinConsola, useStoreBd, type BdApp } from '../bd'
import { DialogosSsh, PreguntaAskpassSsh } from '../ssh'
import type { SesionesNativas } from '../agentes'
import { txLayout } from './textos.ts'

interface Props {
  tabs: UseTabs
  perfilUI: string
  editor: EditorApp
  bd: BdApp
  sesiones: SesionesNativas
  cambiarZoom: (nivel: number) => void
}

/** «¿Nativo o contenedor?» para el proyecto recién elegido; cancelar no lo abre. */
function PreguntaModo(): React.JSX.Element | null {
  const modeAsk = useStorePestanas((s) => s.modeAsk)
  if (!modeAsk) return null
  const cerrar = (mode: 'windows' | 'docker' | null): void => {
    modeAsk.resolve(mode)
    useStorePestanas.setState({ modeAsk: null })
  }
  return <ProjectModeModal name={modeAsk.name} onPick={(mode) => cerrar(mode)} onCancel={() => cerrar(null)} />
}

/** Cerrar perdiendo trabajo: un sin título o el último pane de un diff editable sucio. */
function CerrarSinGuardar({ editor }: Pick<Props, 'editor'>): React.JSX.Element | null {
  const pendingClose = useStoreEditor((s) => s.pendingClose)
  if (!pendingClose) return null
  const t = txLayout().cerrarSinGuardar
  return (
    <ConfirmDialog
      title={t.titulo}
      message={pendingClose.kind === 'diff' ? t.mensajeDiff(pendingClose.name) : t.mensajeArchivo(pendingClose.name)}
      confirmLabel={t.titulo}
      cancelLabel={t.cancelar}
      danger
      onConfirm={() => {
        editor.closeEditorTab(pendingClose.id)
        useStoreEditor.setState({ pendingClose: null })
      }}
      onCancel={() => useStoreEditor.setState({ pendingClose: null })}
    />
  )
}

/** Nueva consola con varias conexiones y ninguna obvia: solo las que tienen consola. */
function MenuConexiones({ bd }: Pick<Props, 'bd'>): React.JSX.Element | null {
  const menu = useStoreBd((s) => s.menuConexiones)
  if (!menu) return null
  const conexiones = bd.conexionesBd.porPerfil.get(menu.perfilId) ?? []
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={conexiones
        .filter((c) => motivoSinConsola(c) === null)
        .map((c) => ({
          icon: <IconoMotor motor={c.motor} />,
          label: c.alias,
          onClick: () => void bd.crearConsolaEn(menu.perfilId, c.id)
        }))}
      onClose={() => useStoreBd.setState({ menuConexiones: null })}
    />
  )
}

/** Modales y flotantes de la raíz. */
export function CapaModales({ tabs, perfilUI, editor, bd, sesiones, cambiarZoom }: Props): React.JSX.Element {
  return (
    <>
      <ModalAjustes sesiones={sesiones} cambiarZoom={cambiarZoom} />
      <ImportarDesdeSistema />
      <ModalBusqueda tabs={tabs} perfilUI={perfilUI} editor={editor} />
      <PreguntaModo />
      <CerrarSinGuardar editor={editor} />
      <MenuConexiones bd={bd} />
      <DialogosSsh />
      <PreguntaAskpassSsh />
    </>
  )
}
