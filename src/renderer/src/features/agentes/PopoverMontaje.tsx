// =============================================================================
// Popover de bases montadas en el proyecto del agente, debajo de la cabecera y dentro
// del pane (así no se despega del botón al redimensionar). Qué se pinta lo decide
// `vistaPopoverMontaje`: cargando, aviso de formato ajeno, vacío o la lista.
// Solo se ofrecen las conexiones PROBADAS; las montadas se listan siempre.
// =============================================================================

import type { DbConexionAjena, DbConnection } from '../../../../shared/db-ipc'
import { destinoLegible } from '../../../../shared/motores/index'
import { nombresSistema } from '../../../../shared/nombresSistema'
import {
  IconoBd,
  IconoMotor,
  nombreMotor,
  NOTA_MONTAJE_FORMATO_AJENO,
  TITULO_FORMATO_AJENO,
  ajenasMontadasPopover,
  filaMontajeAjena
} from '../bd'
import { textosMontajeBases } from './textosMontajeBases'
import type { ModeloAgentPane } from './useAgentPane'

interface PropsLista {
  conexiones: readonly DbConnection[]
  ajenas: DbConexionAjena[]
  montadas: string[]
  onChange?: (ids: string[]) => void
  hostMode: boolean
}

/** Una conexión conocida: interruptor de montaje, marca del motor, alias y destino. */
function FilaConexion({ c, montadas, onChange }: { c: DbConnection } & Pick<PropsLista, 'montadas' | 'onChange'>): React.JSX.Element {
  const marcada = montadas.includes(c.id)
  return (
    <label className={`db-mount-item${marcada ? ' on' : ''}`}>
      {/* El input real se conserva (accesibilidad y teclado); lo que se ve es el
          interruptor de al lado, movido por :checked. */}
      <input
        type="checkbox"
        className="db-sw-input"
        checked={marcada}
        onChange={() => onChange?.(marcada ? montadas.filter((x) => x !== c.id) : [...montadas, c.id])}
      />
      <span className="db-sw" aria-hidden="true">
        <span className="db-sw-knob" />
      </span>
      <span className="db-mount-motor" title={nombreMotor(c.motor)}>
        <IconoMotor motor={c.motor} />
      </span>
      <span className="db-mount-alias">{c.alias}</span>
      <span className="db-mount-dest">
        {c.motor} · {destinoLegible(c, 'breve')}
      </span>
    </label>
  )
}

/** Una AJENA montada: atenuada y solo se puede desmontar (el texto, de `filaMontajeAjena`). */
function FilaAjena({ a, montadas, onChange }: { a: DbConexionAjena } & Pick<PropsLista, 'montadas' | 'onChange'>): React.JSX.Element {
  const fila = filaMontajeAjena(a)
  return (
    <label className="db-mount-item on db-mount-ajena" title={fila.tooltip}>
      <input
        type="checkbox"
        className="db-sw-input"
        checked
        onChange={() => onChange?.(montadas.filter((x) => x !== a.id))}
      />
      <span className="db-sw" aria-hidden="true">
        <span className="db-sw-knob" />
      </span>
      <span className="db-mount-motor" title={fila.motor}>
        <IconoBd className="db-motor" />
      </span>
      <span className="db-mount-alias">{a.alias}</span>
      <span className="db-mount-dest">{fila.destino}</span>
    </label>
  )
}

/** Las conexiones, las ajenas montadas y las notas de cómo se aplica el montaje. */
function ListaMontaje({ conexiones, ajenas, montadas, onChange, hostMode }: PropsLista): React.JSX.Element {
  const sinProbar = conexiones.filter((c) => !c.verificada && !montadas.includes(c.id))
  return (
    <>
      {conexiones
        .filter((c) => c.verificada || montadas.includes(c.id))
        .map((c) => (
          <FilaConexion key={c.id} c={c} montadas={montadas} onChange={onChange} />
        ))}
      {/* La clave lleva la posición: dos ajenas pueden compartir id. */}
      {ajenasMontadasPopover(ajenas, montadas, conexiones).map((a, i) => (
        <FilaAjena key={`ajena|${a.id}|${i}`} a={a} montadas={montadas} onChange={onChange} />
      ))}
      {sinProbar.length > 0 && (
        <p className="db-mount-nota">
          {sinProbar.length}{' '}
          conexión(es) sin probar. Despliégalas en la vista Bases de datos (o pulsa{' '}
          <strong>Probar conexión</strong> en su menú) para poder montarlas.
        </p>
      )}
      {/* `tdb` pregunta en cada invocación: se aplica al momento; el aviso del prompt no. */}
      <p className="db-mount-nota">
        Se aplica <strong>al momento</strong>, sin reiniciar. El agente puede seguir
        nombrando la lista con la que arrancó: pídele un <code>tdb ls</code> y la verá.
      </p>
      {/* En contenedor la consulta la ejecuta Tessera en el anfitrión: por eso llega a
          bases detrás de la VPN sin que el contenedor esté en ella. */}
      {!hostMode && (
        <p className="db-mount-nota">
          Las consultas las ejecuta Tessera en{' '}
          {nombresSistema(window.tessera.plataforma).tuEquipo}: el contenedor no toca
          la base ni necesita la VPN.
        </p>
      )}
    </>
  )
}

/** Cuerpo del popover según lo que decide `vistaPopoverMontaje`. */
function CuerpoMontaje({ m }: { m: ModeloAgentPane }): React.JSX.Element {
  const { vistaMontaje, conexionesMontaje, dbAjenas } = m.montaje
  if (vistaMontaje.tipo === 'cargando') return <div className="db-mount-vacio">Cargando…</div>
  if (vistaMontaje.tipo === 'formato') {
    // Sin ofrecer nada: las montadas se conservan (la poda de arranque se salta) y se dice.
    return (
      <div className="db-mount-aviso" role="status">
        <div className="db-mount-aviso-titulo">{TITULO_FORMATO_AJENO}</div>
        {vistaMontaje.aviso}
        <p>{NOTA_MONTAJE_FORMATO_AJENO}</p>
      </div>
    )
  }
  if (vistaMontaje.tipo === 'vacio') return <div className="db-mount-vacio">{vistaMontaje.texto}</div>
  const { onChangeDbMounted, target } = m.p
  return (
    <ListaMontaje
      conexiones={conexionesMontaje}
      ajenas={dbAjenas}
      montadas={m.p.dbMounted}
      onChange={onChangeDbMounted && ((ids) => onChangeDbMounted(target.profileId, target.projectHostPath, ids))}
      hostMode={m.p.hostMode}
    />
  )
}

/** Popover de montaje; el color del perfil llega ya en tinta como variable. */
export function PopoverMontaje({ m }: { m: ModeloAgentPane }): React.JSX.Element {
  const { p, montaje } = m
  const textosBases = textosMontajeBases(p.esEspacioDeDatos, p.dbMounted.length)
  return (
    <div
      className="db-mount-pop"
      style={{ ['--perfil' as string]: p.accentColor ?? 'var(--accent)' } as React.CSSProperties}
    >
      <div className="db-mount-pop-head">
        <span>{textosBases.titulo}</span>
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => montaje.setShowDbMount(false)}
          aria-label="Cerrar"
          title="Cerrar"
        >
          ✕
        </button>
      </div>
      <CuerpoMontaje m={m} />
    </div>
  )
}
