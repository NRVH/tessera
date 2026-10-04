// =============================================================================
// DbTabsPestana: una pestaña de la tira de BD, sobre las clases de la tira del editor.
// Título `NOMBRE [ALIAS]` recortado por el centro, un solo indicador en el hueco del
// aspa (cede su sitio al aspa al pasar el ratón), la franja del entorno al pie y el
// arrastre para reordenar. Clic central cierra. La monta `DbTabs`.
// Decisiones: docs/decisiones/bd/ui-area-tira-de-pestanas.md
// =============================================================================

import type { DbMotor } from '../../../../shared/db-ipc'
import { IconoClaveKv, IconoColeccion, IconoConsola, IconoDdl, IconoMotor, IconoObjetoBd } from './iconosBd'
import { MarcaEntorno } from './MarcaEntorno'
import { recortarCentro, type DbTab, type IndicadorPestana, type TituloPestana } from './dbTabsModel'
import type { ArrastrePestanas } from './useArrastrePestanas'

/** Máximo de caracteres del nombre antes de recortarlo por el centro. */
const NOMBRE_MAX = 32
/** Máximo del alias entre corchetes: acompaña, no compite con el nombre. */
const ALIAS_MAX = 20

/** Qué dice cada indicador, para el tooltip (el color solo no es accesible). */
const TEXTO_INDICADOR: Record<IndicadorPestana, string> = {
  ejecutando: 'Ejecutando…',
  cargando: 'Cargando…',
  txPendiente: 'Transacción pendiente',
  sinEnviar: 'Cambios sin enviar',
  sesionPerdida: 'Sesión perdida',
  error: 'Error'
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

/** El dibujo del indicador en el hueco del aspa. */
function Indicador({ tipo }: { tipo: IndicadorPestana }): React.JSX.Element {
  if (tipo === 'ejecutando' || tipo === 'cargando') {
    return <span className="db-tab-giro" aria-hidden="true" />
  }
  return <span className={`db-tab-punto db-tab-punto-${tipo}`} aria-hidden="true" />
}

/** El icono de una pestaña: tipo de objeto, guion del DDL o marca del motor de la consola. */
function IconoPestana({ tab, motor }: { tab: DbTab; motor: DbMotor | undefined }): React.JSX.Element {
  const p = tab.pane
  if (p.kind === 'consola') return motor ? <IconoMotor motor={motor} /> : <IconoConsola />
  if (p.kind === 'fuente' && p.modo === 'ddl') return <IconoDdl />
  // Una colección y una clave llevan el icono de su fila del árbol.
  if (p.kind === 'coleccion') return <IconoColeccion />
  if (p.kind === 'clave') return <IconoClaveKv />
  return <IconoObjetoBd tipo={p.tipo} />
}

/** El hueco del aspa: el indicador en reposo y el aspa, que ocupa su sitio al pasar el ratón. */
function HuecoAspa({
  nombre,
  indicador,
  onCerrar
}: {
  nombre: string
  indicador: IndicadorPestana | null
  onCerrar: () => void
}): React.JSX.Element {
  return (
    <span className="editor-tab-slot">
      {indicador && (
        <span className="db-tab-indicador">
          <Indicador tipo={indicador} />
        </span>
      )}
      <button
        className="editor-tab-close"
        aria-label={`Cerrar ${nombre}`}
        title="Cerrar"
        // El aspa no arrastra la pestaña: un arrastre que empieza en ella es un
        // clic que se escapó, no un gesto de reordenar.
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onClick={(e) => {
          // Cerrar no es seleccionar.
          e.stopPropagation()
          onCerrar()
        }}
      >
        <CloseIcon />
      </button>
    </span>
  )
}

/** Las clases de la pestaña: activa, con indicador, arrastrándose, raya y producción. */
function clasePestana(
  id: string,
  activa: boolean,
  indicador: IndicadorPestana | null,
  arrastre: ArrastrePestanas,
  entorno: TituloPestana['entorno']
): string {
  const { raya, arrastrada, ultima } = arrastre
  const rayaAntes = raya !== null && raya.antesDe === id
  const rayaDespues = raya !== null && raya.antesDe === null && id === ultima
  return (
    `editor-tab db-tab${activa ? ' active' : ''}${indicador ? ' con-indicador' : ''}` +
    `${arrastrada === id ? ' arrastrando' : ''}${rayaAntes ? ' soltar-antes' : ''}${rayaDespues ? ' soltar-despues' : ''}` +
    `${entorno === 'produccion' ? ' db-tab-produccion' : ''}`
  )
}

/** Apunta el nodo de la pestaña al montarse y lo quita al desmontarse. */
function registrarNodo(nodos: Map<string, HTMLDivElement>, id: string, el: HTMLDivElement | null): void {
  if (el) nodos.set(id, el)
  else nodos.delete(id)
}

interface DbTabsPestanaProps {
  tab: DbTab
  activa: boolean
  titulo: TituloPestana | undefined
  indicador: IndicadorPestana | null
  motor: DbMotor | undefined
  arrastre: ArrastrePestanas
  /** Nodos de las pestañas por id (traer la activa a la vista, el hueco tras la última). */
  refs: React.MutableRefObject<Map<string, HTMLDivElement>>
  onActivar: (id: string) => void
  onCerrar: (ids: string[]) => void
  onMenu: (x: number, y: number, id: string) => void
}

/** Una pestaña de la tira (ver la cabecera). */
export function DbTabsPestana({
  tab,
  activa,
  titulo,
  indicador,
  motor,
  arrastre,
  refs,
  onActivar,
  onCerrar,
  onMenu
}: DbTabsPestanaProps): React.JSX.Element {
  const nombre = titulo?.nombre ?? tab.id
  const alias = titulo?.conexion ?? ''
  const tooltip = `${titulo?.tooltip ?? nombre}${indicador ? ` · ${TEXTO_INDICADOR[indicador]}` : ''}`
  const entorno = titulo?.entorno
  return (
    <div
      ref={(el) => registrarNodo(refs.current, tab.id, el)}
      role="tab"
      aria-selected={activa}
      className={clasePestana(tab.id, activa, indicador, arrastre, entorno)}
      title={tooltip}
      draggable
      onDragStart={(e) => arrastre.empezarArrastre(e, tab.id)}
      onDragOver={(e) => {
        e.stopPropagation()
        arrastre.sobrevolar(e, tab.id)
      }}
      onDrop={(e) => {
        e.stopPropagation()
        arrastre.soltar(e)
      }}
      onDragEnd={arrastre.terminarArrastre}
      onClick={() => onActivar(tab.id)}
      onMouseDown={(e) => {
        // Botón central: sin esto Windows arranca el autodesplazamiento.
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onCerrar([tab.id])
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY, tab.id)
      }}
    >
      <span className="editor-tab-icon db-tab-icono" aria-hidden="true">
        <IconoPestana tab={tab} motor={motor} />
      </span>
      <span className="editor-tab-name db-tab-nombre">{recortarCentro(nombre, NOMBRE_MAX)}</span>
      {alias !== '' && <span className="db-tab-conexion">[{recortarCentro(alias, ALIAS_MAX)}]</span>}
      {/* La franja del entorno, al pie de la pestaña (area.css). */}
      <MarcaEntorno entorno={entorno} compacta />
      <HuecoAspa nombre={nombre} indicador={indicador} onCerrar={() => onCerrar([tab.id])} />
    </div>
  )
}
