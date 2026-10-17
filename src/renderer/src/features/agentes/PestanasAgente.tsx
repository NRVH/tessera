// =============================================================================
// El selector de agente de la cabecera: pestañas con contorno (se arrastran para ordenar, «›» con
// las que no caben y un «+» para añadir) o, con el ajuste «Lista», un desplegable. El clic derecho
// muestra u oculta cualquier agente del perfil y edita, copia o elimina los manuales. Fuera de un
// proyecto (terminal, datos) solo sirve para elegir. El CSS elige nombre completo o corto por ancho.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import './selectorAgentes.css'
import { useState } from 'react'
import { ContextMenu, type ContextMenuEntry } from '../../comun/ContextMenu'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { esAgenteManual, type DefinicionAgente, type IdAgente } from '../../../../shared/agentesManuales'
import { useStoreAjustes } from '../ajustes'
import { agentesDelPerfil, todasDelProyecto, type PestanaAgente } from './agentesDelProyecto'
import { soltarSobre } from './ordenAgentes.ts'
import { fijarOrdenAgentes, useStoreAgentes } from './store'
import { ConfirmarBorradoAgente } from './ConfirmarBorradoAgente'
import { useFuenteAgentes } from './useAgentesDelProyecto'
import { useFilaPestanas } from './useFilaPestanas'
import { menuDeFila, menuDeLista, menuDeNoCaben, type ContextoMenus } from './menusSelectorAgentes'
import { ModalAgenteManual } from './ModalAgenteManual'
import { txPane } from './textosPane.ts'
import { txSelector } from './textosSelectorAgentes.ts'

interface PropsPestanas {
  pestanas: readonly PestanaAgente[]
  activo: IdAgente
  profileId: string
  hostMode: boolean
  /** Sin «+» ni menús ni arrastre (el agente de la terminal y el de datos): solo elegir. */
  soloElegir?: boolean
  onSelect: (id: IdAgente) => void
}

/** `origen` distingue el botón que abrió el menú: pulsar ese mismo botón lo cierra. */
type Menu = { x: number; y: number; items: ContextMenuEntry[]; origen?: 'noCaben' | 'lista' }
type Modal = { inicial: DefinicionAgente | null } | null

/** Abre Configuración en la categoría «Agentes». */
function abrirGestion(): void {
  useStoreAjustes.setState({ settingsOpen: true, ajustesCategoria: 'agentes' })
}

/** El estado de los menús y modales del selector, y el contexto con el que se arman sus menús. */
function useSelector(p: PropsPestanas) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [borrando, setBorrando] = useState<DefinicionAgente | null>(null)
  const fuente = useFuenteAgentes()
  const ctx: ContextoMenus = {
    profileId: p.profileId,
    visibles: p.pestanas,
    todas: todasDelProyecto(fuente, p.profileId, p.hostMode),
    ocultos: fuente.ocultosPorPerfil[p.profileId] ?? [],
    activo: p.activo,
    onSelect: (id) => {
      if (id !== p.activo) p.onSelect(id)
    },
    onEditar: (d) => setModal({ inicial: d }),
    onBorrar: setBorrando,
    onAnadir: () => setModal({ inicial: null }),
    onGestionar: abrirGestion
  }
  const abrirEn = (e: React.MouseEvent, items: ContextMenuEntry[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  const alternarBajo = (el: HTMLElement, origen: 'noCaben' | 'lista', items: ContextMenuEntry[]): void => {
    if (menu?.origen === origen) {
      setMenu(null)
      return
    }
    const r = el.getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom + 4, items, origen })
  }
  const soltar = (id: IdAgente, destino: IdAgente): void => {
    const orden = soltarSobre(agentesDelPerfil(fuente, p.profileId).map((x) => x.pestana.id), id, destino)
    if (orden) fijarOrdenAgentes(p.profileId, orden)
  }
  return { menu, setMenu, modal, setModal, borrando, setBorrando, ctx, abrirEn, alternarBajo, soltar }
}

type Selector = ReturnType<typeof useSelector>

function Pestana({ p, x, s, f }: { p: PropsPestanas; x: PestanaAgente; s: Selector; f: ReturnType<typeof useFilaPestanas> }): React.JSX.Element {
  const activa = x.id === p.activo
  const clases = ['agent-switch-btn', activa && 'active', esAgenteManual(x.id) && 'manual', f.arrastrado === x.id && 'arrastrando', f.sobre === x.id && 'destino']
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      data-agente={x.id}
      className={clases.filter(Boolean).join(' ')}
      onClick={() => s.ctx.onSelect(x.id)}
      onContextMenu={p.soloElegir ? undefined : (e) => s.abrirEn(e, menuDeFila(s.ctx, x))}
      title={txPane().cabecera.cambiarA(x.nombre)}
      aria-label={x.nombre}
      {...(p.soloElegir ? {} : f.arrastre(x.id))}
    >
      <span className="agent-switch-full">{x.nombre}</span>
      <span className="agent-switch-short" aria-hidden="true">
        {x.corta}
      </span>
    </button>
  )
}

function Pestanas({ p, s }: { p: PropsPestanas; s: Selector }): React.JSX.Element {
  const clave = p.pestanas.map((x) => `${x.id}:${x.nombre}`).join('|')
  const f = useFilaPestanas(p.activo, clave, s.soltar)
  return (
    <>
      <span
        ref={f.fila}
        className="agent-switch-fila"
        role="tablist"
        aria-label={txPane().pestanas.aria}
        onWheel={f.alRodar}
        onContextMenu={p.soloElegir ? undefined : (e) => s.abrirEn(e, menuDeFila(s.ctx, null))}
      >
        {p.pestanas.map((x) => (
          <Pestana key={x.id} p={p} x={x} s={s} f={f} />
        ))}
      </span>
      {f.desborda && (
        <button
          type="button"
          className="agent-switch-icono"
          title={txSelector().noCaben}
          aria-label={txSelector().noCaben}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => s.alternarBajo(e.currentTarget, 'noCaben', menuDeNoCaben(s.ctx, f.noCaben()))}
        >
          ›
        </button>
      )}
    </>
  )
}

function Lista({ p, s }: { p: PropsPestanas; s: Selector }): React.JSX.Element {
  const actual = p.pestanas.find((x) => x.id === p.activo)
  return (
    <button
      type="button"
      className="agent-lista-btn"
      aria-haspopup="menu"
      aria-label={txSelector().elegir}
      title={txSelector().elegir}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => s.alternarBajo(e.currentTarget, 'lista', menuDeLista(s.ctx, p.soloElegir === true))}
      onContextMenu={p.soloElegir ? undefined : (e) => s.abrirEn(e, menuDeFila(s.ctx, null))}
    >
      <span className="agent-lista-nombre">{actual?.nombre ?? p.activo}</span>
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function PestanasAgente(p: PropsPestanas): React.JSX.Element {
  const s = useSelector(p)
  const lista = useStoreAgentes((st) => st.selectorAgentes) === 'lista'
  return (
    <span className="agent-switch">
      {lista ? <Lista p={p} s={s} /> : <Pestanas p={p} s={s} />}
      {!p.soloElegir && !lista && (
        <button
          type="button"
          className="agent-switch-icono"
          title={txSelector().anadirTitulo}
          aria-label={txPane().pestanas.masAria}
          onClick={() => s.setModal({ inicial: null })}
        >
          +
        </button>
      )}
      {/* En la capa flotante: dentro del título del panel heredarían sus mayúsculas y su peso, y la
          contención de la cabecera (container query) desplazaría lo que es `position: fixed`. */}
      {s.menu && (
        <EnCapaFlotante>
          <ContextMenu x={s.menu.x} y={s.menu.y} items={s.menu.items} onClose={() => s.setMenu(null)} />
        </EnCapaFlotante>
      )}
      {s.modal && (
        <EnCapaFlotante>
          <ModalAgenteManual profileId={p.profileId} hostMode={p.hostMode} inicial={s.modal.inicial} onCerrar={() => s.setModal(null)} />
        </EnCapaFlotante>
      )}
      {s.borrando && (
        <EnCapaFlotante>
          <ConfirmarBorradoAgente d={s.borrando} profileId={p.profileId} nativo={p.hostMode} onCerrar={() => s.setBorrando(null)} />
        </EnCapaFlotante>
      )}
    </span>
  )
}

