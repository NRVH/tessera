// =============================================================================
// Capa de modales de la raíz, en su orden: Configuración, importar un `.tessera` abierto desde el
// sistema, buscar en archivos, cerrar sin guardar, el menú de elegir conexión, los diálogos de
// las conexiones SSH y, encima de todo, el lector de Tessera Academy (lo abre un ⓘ de cualquiera).
// En la raíz porque un `position: fixed` se resuelve contra cualquier ancestro con
// transform o contain, y la app ya tiene uno vivo.
// =============================================================================
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { MenuContextual } from '../../comun/MenuContextual'
import { LectorAcademy } from '../academy'
import { ImportarDesdeSistema, ModalAjustes } from '../ajustes'
import { ModalBusqueda } from '../busqueda'
import type { UsePestanas } from '../pestanas'
import { useStoreEditor, type EditorApp } from '../editor'
import { IconoMotor, motivoSinConsola, useStoreBd, type BdApp } from '../bd'
import { DialogoHuellaNuevaSsh, DialogosSsh, PreguntaAskpassSsh } from '../ssh'
import type { SesionesNativas } from '../agentes'
import { txLayout } from './textos.ts'
import { PermisosHooksGit } from '../git'

interface Props {
  pestanas: UsePestanas
  perfilUI: string
  editor: EditorApp
  bd: BdApp
  sesiones: SesionesNativas
  cambiarZoom: (nivel: number) => void
}

/** Cerrar perdiendo trabajo: un sin título o el último pane de un diff editable sucio. */
function CerrarSinGuardar({ editor }: Pick<Props, 'editor'>): React.JSX.Element | null {
  const cierrePendiente = useStoreEditor((s) => s.cierrePendiente)
  if (!cierrePendiente) return null
  const t = txLayout().cerrarSinGuardar
  return (
    <DialogoConfirmar
      titulo={t.pregunta(cierrePendiente.nombre)}
      mensaje={cierrePendiente.tipo === 'diff' ? t.mensajeDiff(cierrePendiente.nombre) : t.mensajeArchivo(cierrePendiente.nombre)}
      etiquetaConfirmar={t.titulo}
      etiquetaCancelar={t.cancelar}
      peligro
      onConfirmar={() => {
        editor.cerrarPestana(cierrePendiente.id)
        useStoreEditor.setState({ cierrePendiente: null })
      }}
      onCancelar={() => useStoreEditor.setState({ cierrePendiente: null })}
    />
  )
}

/** Nueva consola con varias conexiones y ninguna obvia: solo las que tienen consola. */
function MenuConexiones({ bd }: Pick<Props, 'bd'>): React.JSX.Element | null {
  const menu = useStoreBd((s) => s.menuConexiones)
  if (!menu) return null
  const conexiones = bd.conexionesBd.porPerfil.get(menu.perfilId) ?? []
  return (
    <MenuContextual
      x={menu.x}
      y={menu.y}
      items={conexiones
        .filter((c) => motivoSinConsola(c) === null)
        .map((c) => ({
          icon: <IconoMotor motor={c.motor} />,
          label: c.alias,
          onClick: () => void bd.crearConsolaEn(menu.perfilId, c.id)
        }))}
      onCerrar={() => useStoreBd.setState({ menuConexiones: null })}
    />
  )
}

/** Modales y flotantes de la raíz. */
export function CapaModales({ pestanas, perfilUI, editor, bd, sesiones, cambiarZoom }: Props): React.JSX.Element {
  return (
    <>
      <PermisosHooksGit />
      <ModalAjustes sesiones={sesiones} cambiarZoom={cambiarZoom} />
      <ImportarDesdeSistema />
      <ModalBusqueda pestanas={pestanas} perfilUI={perfilUI} editor={editor} />
      <CerrarSinGuardar editor={editor} />
      <MenuConexiones bd={bd} />
      <DialogosSsh />
      <DialogoHuellaNuevaSsh />
      <PreguntaAskpassSsh />
      <LectorAcademy />
    </>
  )
}
