// =============================================================================
// Las clases de fila de la lista de conexiones SSH: la cabecera de un grupo (chevron, nombre y
// recuento), una conexión (alias, usuario@host[:puerto], pestañas abiertas, un ojo tachado si los
// agentes no la ven, icono del método y «⋯») y el rótulo de una sección («Recientes»).
// Grupos y conexiones son `treeitem` de un `tree`: el foco real está en el filtro y la fila activa se
// nombra con `aria-activedescendant`. Presentación pura: lo que pasa al pulsar lo decide quien las pinta.
// =============================================================================

import { ChevronArbol } from '../../comun/iconosArbol'
import { esModPrincipal } from '../../util/atajos'
import type { ModificadoresClicSsh } from './seleccionListaSsh'
import { destinoSsh, type FilaConexion, type FilaGrupo, type FilaSeccion } from './listaSsh'
import { IconoArchivoClave, IconoClavesSistema, IconoContrasena, IconoSinAgentes } from './iconosSsh'
import type { SshMetodo } from '../../../../shared/ssh-ipc'
import { txSsh } from './textos.ts'

/** Soltar sobre una fila: el grupo al que va lo arrastrado lo decide quien la pinta. */
export interface SoltarEnFila {
  onDragOver: (ev: React.DragEvent) => void
  onDrop: (ev: React.DragEvent) => void
}

/** Lo que comparten las dos filas. */
interface PropsFila {
  id: string
  activa: boolean
  alto: number
  /** Con los modificadores del clic: Ctrl (⌘ en Mac) alterna y Mayús marca un rango en el riel. */
  onPulsar: (mods: ModificadoresClicSsh) => void
  /** Abre el menú de la fila en esa posición (clic derecho o «⋯»). */
  onMenu: (x: number, y: number) => void
  /** Es del grupo sobre el que se va a soltar lo arrastrado (la cabecera lo marca más fuerte). */
  enDestino?: boolean
  soltar?: SoltarEnFila
}

const modsDe = (e: React.MouseEvent): ModificadoresClicSsh => ({ mod: esModPrincipal(e), shift: e.shiftKey })

/** El icono del método de autenticación, el mismo que en el conmutador del formulario. */
function IconoMetodo({ metodo }: { metodo: SshMetodo }): React.JSX.Element {
  if (metodo === 'contrasena') return <IconoContrasena />
  return metodo === 'clave' ? <IconoArchivoClave /> : <IconoClavesSistema />
}

/** El texto con que se anuncia el método. */
const textoMetodo = (m: SshMetodo): string => txSsh().metodos[m]

/** La cabecera de un grupo: plegable, con el recuento de lo que enseña. */
export function FilaGrupoSsh({ fila, ...p }: PropsFila & { fila: FilaGrupo }): React.JSX.Element {
  return (
    <div
      id={p.id}
      role="treeitem"
      aria-level={1}
      aria-expanded={fila.abierto}
      aria-selected={p.activa}
      aria-label={txSsh().grupoEtiqueta(fila.nombre, fila.total)}
      className={`ssh-fila ssh-fila-grupo${p.activa ? ' activa' : ''}${p.enDestino ? ' destino' : ''}`}
      style={{ height: p.alto }}
      // Sin robar el foco al filtro: se sigue tecleando tras pulsar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => p.onPulsar(modsDe(e))}
      {...p.soltar}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
    >
      <ChevronArbol abierto={fila.abierto} />
      <span className="ssh-grupo-nombre">{fila.nombre}</span>
      <span className="ssh-grupo-cuenta" aria-hidden="true">
        {fila.total}
      </span>
    </div>
  )
}

/**
 * El rótulo de una sección: fuera del árbol de accesibilidad. Las conexiones de «Recientes» dicen que lo son
 * en su propio nombre, porque aquí no hay nada que leer.
 */
export function FilaSeccionSsh({ fila, alto }: { fila: FilaSeccion; alto: number }): React.JSX.Element {
  return (
    <div className="ssh-fila-seccion" style={{ height: alto }} aria-hidden="true">
      {fila.nombre}
    </div>
  )
}

/** Cuántas pestañas abiertas tiene la conexión, en azul (el azul de la paleta, no el del perfil: es un estado). */
function Abiertas({ n }: { n: number }): React.JSX.Element | null {
  if (n <= 0) return null
  return (
    <span className="ssh-abiertas" title={txSsh().pestanasAbiertas(n)} aria-hidden="true">
      {n}
    </span>
  )
}

/** «⋯»: el menú de la conexión, abierto bajo el botón. */
function BotonMas({ alias, onMenu }: { alias: string; onMenu: (x: number, y: number) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="ssh-fila-mas"
      tabIndex={-1}
      aria-label={txSsh().masAccionesDe(alias)}
      title={txSsh().masAcciones}
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onMenu(r.left, r.bottom + 2)
      }}
    >
      <span aria-hidden="true">⋯</span>
    </button>
  )
}

/** Las clases de la fila de una conexión según su estado. */
function clasesConexion(nivel: 1 | 2, activa: boolean, enSesion: boolean, marcada: 'sola' | 'varias' | undefined, enDestino: boolean): string {
  const clases = ['ssh-fila', 'ssh-fila-conexion', `nivel-${nivel}`]
  if (activa) clases.push('activa')
  if (enSesion) clases.push('en-sesion')
  if (marcada !== undefined) clases.push('marcada')
  if (marcada === 'varias') clases.push('varias')
  if (enDestino) clases.push('en-destino')
  return clases.join(' ')
}

/** El nombre que se anuncia de una conexión: si es de «Recientes», su destino, su método, sus pestañas y si los agentes no la ven. */
function etiquetaConexion(fila: FilaConexion, destino: string, abiertas: number): string {
  const c = fila.conexion
  const t = txSsh()
  const sufijo = abiertas > 0 ? t.abiertasSufijo(abiertas) : ''
  const oculta = c.disponibleAgentes ? '' : t.noAgentesAria
  return `${fila.reciente ? t.reciente : ''}${c.alias}, ${destino}, ${textoMetodo(c.metodo)}${sufijo}${oculta}`
}

/**
 * Una conexión. `abiertas` = las pestañas SSH abiertas de esta conexión; `enSesion`, que la pestaña que se
 * ve es de ella (`aria-current` y una barra a su izquierda, aparte del cursor de la lista).
 */
export function FilaConexionSsh({
  fila,
  abiertas,
  enSesion = false,
  marcada,
  onDoblePulsar,
  onArrastrar,
  ...p
}: PropsFila & {
  fila: FilaConexion
  abiertas: number
  enSesion?: boolean
  /** En el riel: marcada (`'sola'`), marcada junto a otras (`'varias'`, y la que lleva el cursor se contornea) o no. */
  marcada?: 'sola' | 'varias'
  onDoblePulsar: () => void
  /** Si se da, la fila se puede arrastrar (el riel). */
  onArrastrar?: { onDragStart: (ev: React.DragEvent) => void; onDragEnd: () => void }
}): React.JSX.Element {
  const c = fila.conexion
  const destino = destinoSsh(c)
  const oculta = !c.disponibleAgentes
  return (
    <div
      id={p.id}
      role="treeitem"
      aria-level={fila.nivel}
      // En el riel dice lo marcado; en el lanzador, que no marca, la fila del cursor.
      aria-selected={marcada !== undefined || (onArrastrar === undefined && p.activa)}
      // Solo la fila del grupo: la de «Recientes» repite la misma conexión y un lector diría dos «actual».
      aria-current={enSesion && !fila.reciente ? 'true' : undefined}
      aria-label={etiquetaConexion(fila, destino, abiertas)}
      className={clasesConexion(fila.nivel, p.activa, enSesion, marcada, p.enDestino === true)}
      style={{ height: p.alto }}
      title={`${c.alias}\n${destino}\n${textoMetodo(c.metodo)}${oculta ? `\n${txSsh().noAgentes}` : ''}`}
      draggable={onArrastrar !== undefined}
      onDragStart={onArrastrar?.onDragStart}
      onDragEnd={onArrastrar?.onDragEnd}
      {...p.soltar}
      // Sin robar el foco al filtro; en el riel, sin cancelar el arrastre (que necesita el `mousedown`).
      onMouseDown={(e) => {
        if (onArrastrar === undefined) e.preventDefault()
      }}
      onClick={(e) => p.onPulsar(modsDe(e))}
      onDoubleClick={onDoblePulsar}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
    >
      <span className="ssh-alias">{c.alias}</span>
      <span className="ssh-destino">{destino}</span>
      <Abiertas n={abiertas} />
      {oculta && (
        <span className="ssh-sin-agentes" aria-hidden="true">
          <IconoSinAgentes />
        </span>
      )}
      <span className="ssh-metodo" aria-hidden="true">
        <IconoMetodo metodo={c.metodo} />
      </span>
      <BotonMas alias={c.alias} onMenu={p.onMenu} />
    </div>
  )
}
