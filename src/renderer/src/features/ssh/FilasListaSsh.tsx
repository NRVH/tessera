// =============================================================================
// Las clases de fila de la lista de conexiones SSH: la cabecera de un grupo (chevron, nombre y
// recuento), una conexión (alias, usuario@host[:puerto], pestañas abiertas, un ojo tachado si los
// agentes no la ven, icono del método y «⋯») y el rótulo de una sección («Recientes»).
// Grupos y conexiones son `treeitem` de un `tree`: el foco real está en el filtro y la fila activa se
// nombra con `aria-activedescendant`. Presentación pura: lo que pasa al pulsar lo decide quien las pinta.
// =============================================================================

import { ChevronArbol } from '../../comun/iconosArbol'
import { destinoSsh, type FilaConexion, type FilaGrupo, type FilaSeccion } from './listaSsh'
import { IconoArchivoClave, IconoClavesSistema, IconoContrasena, IconoSinAgentes } from './iconosSsh'
import type { SshMetodo } from '../../../../shared/ssh-ipc'

/** Lo que comparten las dos filas. */
interface PropsFila {
  id: string
  activa: boolean
  alto: number
  onPulsar: () => void
  /** Abre el menú de la fila en esa posición (clic derecho o «⋯»). */
  onMenu: (x: number, y: number) => void
}

/** El icono del método de autenticación, el mismo que en el conmutador del formulario. */
function IconoMetodo({ metodo }: { metodo: SshMetodo }): React.JSX.Element {
  if (metodo === 'contrasena') return <IconoContrasena />
  return metodo === 'clave' ? <IconoArchivoClave /> : <IconoClavesSistema />
}

/** El texto con que se anuncia el método. */
const TEXTO_METODO: Record<SshMetodo, string> = {
  contrasena: 'Contraseña',
  clave: 'Archivo de clave',
  sistema: 'Claves del sistema'
}

/** Lo que se dice de una conexión que el usuario no dejó disponible para los agentes. */
const NO_AGENTES = 'No disponible para los agentes'

/** La cabecera de un grupo: plegable, con el recuento de lo que enseña. */
export function FilaGrupoSsh({ fila, ...p }: PropsFila & { fila: FilaGrupo }): React.JSX.Element {
  return (
    <div
      id={p.id}
      role="treeitem"
      aria-level={1}
      aria-expanded={fila.abierto}
      aria-selected={p.activa}
      aria-label={`${fila.nombre}, ${fila.total} ${fila.total === 1 ? 'conexión' : 'conexiones'}`}
      className={`ssh-fila ssh-fila-grupo${p.activa ? ' activa' : ''}`}
      style={{ height: p.alto }}
      // Sin robar el foco al filtro: se sigue tecleando tras pulsar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onPulsar}
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
    <span className="ssh-abiertas" title={`${n} ${n === 1 ? 'pestaña abierta' : 'pestañas abiertas'}`} aria-hidden="true">
      {n}
    </span>
  )
}

/**
 * Una conexión. `abiertas` = las pestañas SSH abiertas de esta conexión; `enSesion`, que la pestaña que se
 * ve es de ella (`aria-current` y una barra a su izquierda, aparte del cursor de la lista).
 */
export function FilaConexionSsh({
  fila,
  abiertas,
  enSesion = false,
  ...p
}: PropsFila & { fila: FilaConexion; abiertas: number; enSesion?: boolean }): React.JSX.Element {
  const c = fila.conexion
  const destino = destinoSsh(c)
  const sufijo = abiertas > 0 ? `, ${abiertas} ${abiertas === 1 ? 'abierta' : 'abiertas'}` : ''
  const oculta = !c.disponibleAgentes
  const prefijo = fila.reciente ? 'Reciente, ' : ''
  return (
    <div
      id={p.id}
      role="treeitem"
      aria-level={fila.nivel}
      aria-selected={p.activa}
      // Solo la fila del grupo: la de «Recientes» repite la misma conexión y un lector diría dos «actual».
      aria-current={enSesion && !fila.reciente ? 'true' : undefined}
      aria-label={`${prefijo}${c.alias}, ${destino}, ${TEXTO_METODO[c.metodo]}${sufijo}${oculta ? `, ${NO_AGENTES.toLowerCase()}` : ''}`}
      className={`ssh-fila ssh-fila-conexion nivel-${fila.nivel}${p.activa ? ' activa' : ''}${enSesion ? ' en-sesion' : ''}`}
      style={{ height: p.alto }}
      title={`${c.alias}\n${destino}\n${TEXTO_METODO[c.metodo]}${oculta ? `\n${NO_AGENTES}` : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onPulsar}
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
      <button
        type="button"
        className="ssh-fila-mas"
        tabIndex={-1}
        aria-label={`Más acciones de ${c.alias}`}
        title="Más acciones"
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          p.onMenu(r.left, r.bottom + 2)
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
    </div>
  )
}
