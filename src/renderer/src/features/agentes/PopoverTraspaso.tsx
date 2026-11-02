// =============================================================================
// «Continuar con <otro agente>…»: el botón de la cabecera y su popover, con las mismas tarjetas que el selector de
// cuenta (la del sistema y las de Docker del otro agente). Elegir una pide el traspaso y pone a la vista ese
// agente con una conversación nueva; si está trabajando, antes se pregunta.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import './cuentaAgente.css'
import { useEffect, useRef, useState } from 'react'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { AYUDA, BotonAyuda } from '../academy'
import { agentTargetKey } from '../pestanas'
import { isWorking } from './agentActivity.ts'
import type { PestanaAgente } from './agentesDelProyecto'
import { continuarEn, type DestinoContinuar } from './continuarEn'
import { IconoContenedor, IconoEquipo, IconoPasarA } from './iconosAgentPane'
import { ANCHO_POPOVER, Tarjeta, cerrarConEscape, conMayuscula, useCierre, usePosicionPopover } from './PopoverCuenta'
import { nombreVisible, vistaSelectorCuenta } from './selectorCuenta.ts'
import { useStoreAgentes } from './store'
import { txPane } from './textosPane.ts'
import { txTraspaso } from './textosTraspaso.ts'
import type { AnclaCuenta } from './useEstadoAgentPane'
import type { ModeloAgentPane } from './useAgentPane'

/** Los agentes de serie del proyecto a los que se puede pasar: los de las pestañas, menos este. */
export function destinosTraspaso(m: ModeloAgentPane): PestanaAgente[] {
  if (m.p.lugar !== 'proyecto' || m.p.mosaico || m.p.pestanasAgente.some((x) => x.id === m.p.target.agente && x.manual)) return []
  return m.p.pestanasAgente.filter((x) => !x.manual && x.id !== m.p.target.agente)
}

/** Las cuentas de Docker del otro agente en este perfil; null mientras llegan. */
function useCuentasDe(profileId: string, agente: string): AgentAccount[] | null {
  const [lista, setLista] = useState<AgentAccount[] | null>(null)
  useEffect(() => {
    let vivo = true
    window.tessera.agentAccounts
      .list({ profileId, agente: agente as AgentKind })
      .then((l) => vivo && setLista(l))
      .catch(() => vivo && setLista([]))
    return () => {
      vivo = false
    }
  }, [profileId, agente])
  return lista
}

/** Las tarjetas de un agente de destino: su equipo y sus cuentas de Docker. */
function SeccionDestino({
  m,
  destino,
  onElegir,
  onCerrar
}: {
  m: ModeloAgentPane
  destino: PestanaAgente
  onElegir: (d: DestinoContinuar) => void
  onCerrar: () => void
}): React.JSX.Element {
  const t = txPane().menus
  const cuentas = useCuentasDe(m.p.target.profileId, destino.id)
  const sistema = nombresSistema(window.tessera.plataforma)
  const vista = vistaSelectorCuenta(cuentas ?? [], null, 'disponible')
  const agente = destino.id as AgentKind
  return (
    <section className="cuenta-seccion" aria-label={txTraspaso().elegirDestino(destino.nombre)}>
      <div className="cuenta-pop-cabecera">
        <div className="cuenta-pop-titulo">{txTraspaso().elegirDestino(destino.nombre)}</div>
        <BotonAyuda destino={AYUDA.continuarCon} alAbrir={onCerrar} />
      </div>
      {vista.nativa && (
        <>
          <div className="cuenta-seccion-titulo">{t.enTuEquipo}</div>
          <Tarjeta
            icono={<IconoEquipo />}
            nombre={conMayuscula(sistema.tuEquipo)}
            detalle={t.nativaDetalle(sistema.tuEquipo)}
            actual={vista.nativa.actual}
            onElegir={() => onElegir({ agente, modo: 'nativo', accountId: null })}
          />
        </>
      )}
      <div className="cuenta-seccion-titulo">{vista.nativa ? t.enDocker : t.cuentas}</div>
      {cuentas === null && <p className="cuenta-vacio">{txTraspaso().cargando}</p>}
      {cuentas !== null && vista.docker.length === 0 && <p className="cuenta-vacio">{t.sinCuentasDockerContinuar}</p>}
      {vista.docker.map((f) => (
        <Tarjeta
          key={f.cuenta.id}
          icono={<IconoContenedor />}
          nombre={nombreVisible(f.cuenta, t.predeterminada)}
          detalle={t.dockerDetalle}
          actual={false}
          onElegir={() => onElegir({ agente, modo: 'docker', accountId: f.cuenta.id })}
        />
      ))}
    </section>
  )
}

/** El popover, alineado por la derecha bajo su botón (encima si no cabe). */
function PopoverTraspaso({ m, destinos, ancla, onCerrar }: { m: ModeloAgentPane; destinos: PestanaAgente[]; ancla: AnclaCuenta; onCerrar: () => void }): React.JSX.Element {
  const raiz = useRef<HTMLDivElement>(null)
  const [confirmar, setConfirmar] = useState<{ destino: DestinoContinuar; nombre: string } | null>(null)
  useCierre(raiz, () => {
    if (!confirmar) onCerrar()
  })
  const pos = usePosicionPopover(raiz, ancla, 0)
  const { target } = m.p
  const pasar = (destino: DestinoContinuar): void => {
    const sesion = m.s.sessionId
    onCerrar()
    if (sesion) void continuarEn(target, sesion, destino)
  }
  const elegir = (destino: DestinoContinuar, nombre: string): void => {
    const clave = agentTargetKey(target.profileId, target.projectHostPath, destino.agente)
    // Cortarle un turno en marcha al agente de destino no se hace sin preguntar.
    if (isWorking(useStoreAgentes.getState().activity, clave)) setConfirmar({ destino, nombre })
    else pasar(destino)
  }
  const t = txTraspaso()
  return (
    <EnCapaFlotante>
      <div
        ref={raiz}
        className="cuenta-pop"
        role="menu"
        aria-label={destinos.length === 1 ? t.pasarAAria(destinos[0].nombre) : t.pasarAAria(destinos.map((d) => d.nombre).join(', '))}
        style={{ left: pos.left, top: pos.top, width: ANCHO_POPOVER }}
        onKeyDown={(e) => {
          if (!confirmar) cerrarConEscape(e, onCerrar, m)
        }}
      >
        {destinos.map((d) => (
          <SeccionDestino key={d.id} m={m} destino={d} onElegir={(destino) => elegir(destino, d.nombre)} onCerrar={onCerrar} />
        ))}
      </div>
      {confirmar && (
        <ConfirmDialog
          danger
          title={t.trabajandoTitulo(confirmar.nombre)}
          message={t.trabajandoMensaje(confirmar.nombre)}
          confirmLabel={t.seguir}
          cancelLabel={t.cancelar}
          onConfirm={() => pasar(confirmar.destino)}
          onCancel={() => setConfirmar(null)}
        />
      )}
    </EnCapaFlotante>
  )
}

/** El botón de la cabecera: solo con otro agente de serie en el proyecto y una sesión viva que pasar. */
export function BotonPasarA({ m }: { m: ModeloAgentPane }): React.JSX.Element | null {
  const [ancla, setAncla] = useState<AnclaCuenta | null>(null)
  const destinos = destinosTraspaso(m)
  if (destinos.length === 0) return null
  const t = txTraspaso()
  const nombres = destinos.map((d) => d.nombre).join(', ')
  return (
    <>
      <button
        type="button"
        className="btn btn-icon pasar-btn"
        disabled={!m.s.sessionId || m.s.actualizando}
        onMouseDown={(e) => {
          if (ancla) e.stopPropagation()
        }}
        onClick={(e) => {
          if (ancla) return setAncla(null)
          const r = e.currentTarget.getBoundingClientRect()
          setAncla({ right: r.right, top: r.top, bottom: r.bottom })
        }}
        aria-haspopup="menu"
        aria-expanded={ancla !== null}
        title={destinos.length === 1 ? t.pasarATitulo(nombres) : t.pasarA(nombres)}
        aria-label={t.pasarAAria(nombres)}
      >
        <IconoPasarA />
      </button>
      {ancla && <PopoverTraspaso m={m} destinos={destinos} ancla={ancla} onCerrar={() => setAncla(null)} />}
    </>
  )
}
