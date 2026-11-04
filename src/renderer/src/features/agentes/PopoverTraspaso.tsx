// =============================================================================
// «Continuar esta conversación»: el botón de la cabecera y su popover, único lugar desde el que se sigue el
// trabajo en otro sitio. Primero las otras cuentas del mismo agente, que se llevan la conversación entera, y luego
// los otros agentes, que reciben un resumen. Si el agente afectado tiene un turno en marcha, antes se pregunta.
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
import { turnoEnMarcha } from './agentActivity.ts'
import { nombreAgente } from './agentPaneTipos'
import type { PestanaAgente } from './agentesDelProyecto'
import { continuarEn, type DestinoContinuar } from './continuarEn'
import { IconoContenedor, IconoEquipo, IconoPasarA } from './iconosAgentPane'
import { ANCHO_POPOVER, Tarjeta, cerrarConEscape, conMayuscula, puedeSeguirConversacion, useCierre, usePosicionPopover } from './PopoverCuenta'
import { nombreVisible, otrasCuentas, type OtrasCuentas } from './selectorCuenta.ts'
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

/** Las cuentas de Docker de otros agentes en este perfil, por agente; null mientras llegan. */
function useCuentasDe(profileId: string, agentes: string[]): Record<string, AgentAccount[]> | null {
  const [cuentas, setCuentas] = useState<Record<string, AgentAccount[]> | null>(null)
  const clave = agentes.join('\n')
  useEffect(() => {
    let vivo = true
    const pedir = clave === '' ? [] : clave.split('\n')
    void Promise.all(
      pedir.map(async (agente) => {
        const lista = await window.tessera.agentAccounts.list({ profileId, agente: agente as AgentKind }).catch((): AgentAccount[] => [])
        return [agente, lista] as const
      })
    ).then((pares) => {
      if (vivo) setCuentas(Object.fromEntries(pares))
    })
    return () => {
      vivo = false
    }
  }, [profileId, clave])
  return cuentas
}

/** Un grupo de cuentas a las que continuar: el agente, qué se lleva y sus tarjetas. */
function Grupo(p: {
  nombre: string
  lleva: string
  llevaDetalle: string
  agente: AgentKind
  cuentas: OtrasCuentas | null
  onElegir: (d: DestinoContinuar, donde: string) => void
}): React.JSX.Element {
  const t = txPane().menus
  const sistema = nombresSistema(window.tessera.plataforma)
  const { agente, cuentas, onElegir } = p
  return (
    <section className="cuenta-seccion" aria-label={txTraspaso().grupoAria(p.nombre, p.lleva)}>
      <div className="continuar-grupo" title={p.llevaDetalle}>
        <span className="continuar-grupo-agente">{p.nombre}</span>
        <span className="continuar-grupo-lleva">{p.lleva}</span>
      </div>
      {cuentas === null && <p className="cuenta-vacio">{txTraspaso().cargando}</p>}
      {cuentas?.nativa && (
        <Tarjeta
          icono={<IconoEquipo />}
          nombre={conMayuscula(sistema.tuEquipo)}
          actual={false}
          onElegir={() => onElegir({ agente, modo: 'nativo', accountId: null }, sistema.tuEquipo)}
        />
      )}
      {cuentas?.docker.map((c) => {
        const nombre = nombreVisible(c, t.predeterminada)
        return (
          <Tarjeta
            key={c.id}
            icono={<IconoContenedor />}
            nombre={nombre}
            detalle={txTraspaso().detalleDocker}
            actual={false}
            onElegir={() => onElegir({ agente, modo: 'docker', accountId: c.id }, txTraspaso().cuentaCitada(nombre))}
          />
        )
      })}
      {cuentas !== null && !cuentas.nativa && cuentas.docker.length === 0 && <p className="cuenta-vacio">{t.sinCuentasDockerContinuar}</p>}
    </section>
  )
}

/** Un grupo por cada otro agente del proyecto, con todas sus cuentas. */
function GruposOtrosAgentes({ destinos, cuentas, onElegir }: { destinos: PestanaAgente[]; cuentas: Record<string, AgentAccount[]> | null; onElegir: (d: DestinoContinuar, otro: string) => void }): React.JSX.Element {
  const t = txTraspaso()
  return (
    <>
      {destinos.map((d) => {
        const lista = cuentas?.[d.id]
        return (
          <Grupo
            key={d.id}
            nombre={d.nombre}
            lleva={t.llevaResumen}
            llevaDetalle={t.llevaResumenDetalle}
            agente={d.id as AgentKind}
            cuentas={lista ? otrasCuentas(lista, null, false) : null}
            onElegir={(destino) => onElegir(destino, d.nombre)}
          />
        )
      })}
    </>
  )
}

/** Lo que se pregunta antes de continuar, con el destino al que se irá si se confirma. */
interface Confirmacion {
  destino: DestinoContinuar
  titulo: string
  mensaje: string
}

/** Elegir un destino: continúa, o pregunta antes si el agente afectado tiene un turno en marcha. */
function useContinuar(m: ModeloAgentPane, onCerrar: () => void): {
  confirmar: Confirmacion | null
  cancelar: () => void
  pasar: (destino: DestinoContinuar) => void
  elegirMismo: (destino: DestinoContinuar, donde: string) => void
  elegirOtro: (destino: DestinoContinuar, otro: string) => void
} {
  const [confirmar, setConfirmar] = useState<Confirmacion | null>(null)
  const { target } = m.p
  const t = txTraspaso()
  const nombre = nombreAgente(m.p.pestanasAgente, target.agente)
  const pasar = (destino: DestinoContinuar): void => {
    const sesion = m.s.sessionId
    onCerrar()
    if (sesion) void continuarEn(target, sesion, destino)
  }
  // Mismo agente: cerrar su sesión para abrirla en la otra cuenta le corta el turno en marcha.
  const elegirMismo = (destino: DestinoContinuar, donde: string): void => {
    if (turnoEnMarcha(useStoreAgentes.getState().activity, target.key)) {
      setConfirmar({ destino, titulo: t.trabajandoTitulo(nombre), mensaje: t.seguirTrabajandoMensaje(nombre, donde) })
    } else pasar(destino)
  }
  // Otro agente: lo que se corta es el turno que tenga el de destino en este proyecto.
  const elegirOtro = (destino: DestinoContinuar, otro: string): void => {
    const clave = agentTargetKey(target.profileId, target.projectHostPath, destino.agente)
    if (turnoEnMarcha(useStoreAgentes.getState().activity, clave)) {
      setConfirmar({ destino, titulo: t.trabajandoTitulo(otro), mensaje: t.trabajandoMensaje(otro) })
    } else pasar(destino)
  }
  return { confirmar, cancelar: () => setConfirmar(null), pasar, elegirMismo, elegirOtro }
}

/** El popover, alineado por la derecha bajo su botón (encima si no cabe). */
function PopoverTraspaso({ m, destinos, ancla, onCerrar }: { m: ModeloAgentPane; destinos: PestanaAgente[]; ancla: AnclaCuenta; onCerrar: () => void }): React.JSX.Element {
  const raiz = useRef<HTMLDivElement>(null)
  const { confirmar, cancelar, pasar, elegirMismo, elegirOtro } = useContinuar(m, onCerrar)
  const { target, hostMode } = m.p
  const cuentas = useCuentasDe(target.profileId, destinos.map((d) => d.id))
  useCierre(raiz, () => {
    if (!confirmar) onCerrar()
  })
  // Vuelve a medirse también cuando las listas llegan vacías: la tarjeta del equipo sustituye a «Cargando».
  const total = (cuentas ? 1 : 0) + Object.values(cuentas ?? {}).reduce((n, l) => n + l.length, 0) + (m.s.accounts?.length ?? 0)
  const pos = usePosicionPopover(raiz, ancla, total)
  const t = txTraspaso()
  return (
    <EnCapaFlotante>
      <div
        ref={raiz}
        className="cuenta-pop"
        role="menu"
        tabIndex={-1}
        aria-label={t.titulo}
        style={{ left: pos.left, top: pos.top, width: ANCHO_POPOVER }}
        onKeyDown={(e) => {
          if (!confirmar) cerrarConEscape(e, onCerrar, m)
        }}
      >
        <div className="cuenta-pop-cabecera">
          <div className="cuenta-pop-titulo">{t.titulo}</div>
          <BotonAyuda destino={AYUDA.continuarCon} alAbrir={onCerrar} />
        </div>
        {puedeSeguirConversacion(m.p) && (
          <Grupo
            nombre={nombreAgente(m.p.pestanasAgente, target.agente)}
            lleva={t.llevaCompleta}
            llevaDetalle={t.llevaCompletaDetalle}
            agente={target.agente as AgentKind}
            cuentas={m.s.accounts ? otrasCuentas(m.s.accounts, m.currentAccount?.id ?? null, hostMode) : null}
            onElegir={elegirMismo}
          />
        )}
        <GruposOtrosAgentes destinos={destinos} cuentas={cuentas} onElegir={elegirOtro} />
      </div>
      {confirmar && (
        <ConfirmDialog
          danger
          title={confirmar.titulo}
          message={confirmar.mensaje}
          confirmLabel={t.seguir}
          cancelLabel={t.cancelar}
          onConfirm={() => pasar(confirmar.destino)}
          onCancel={cancelar}
        />
      )}
    </EnCapaFlotante>
  )
}

/** Qué dice el botón: lo que ofrece en este pane. */
function etiquetaBoton(mismoAgente: boolean, destinos: PestanaAgente[]): string {
  const t = txTraspaso()
  const nombres = destinos.map((d) => d.nombre).join(', ')
  if (mismoAgente && nombres) return t.continuarEnCuentaOCon(nombres)
  return mismoAgente ? t.continuarEnCuenta : t.continuarCon(nombres)
}

/** El botón de la cabecera: si hay otra cuenta o agente que ofrecer; apagado sin una sesión viva que continuar. */
export function BotonPasarA({ m }: { m: ModeloAgentPane }): React.JSX.Element | null {
  const [ancla, setAncla] = useState<AnclaCuenta | null>(null)
  const apagado = !m.s.sessionId || m.s.actualizando
  // Abierto no puede seguir ofreciendo destinos: sin sesión no hay qué continuar, y a mitad de una actualización
  // el orquestador cuenta con este pane tal como está.
  useEffect(() => {
    if (apagado) setAncla(null)
  }, [apagado])
  const destinos = destinosTraspaso(m)
  const mismoAgente = puedeSeguirConversacion(m.p)
  // En nativo y sin cuentas de Docker no hay otra cuenta del mismo agente a la que ir.
  const hayOtraCuenta = mismoAgente && (!m.p.hostMode || (m.s.accounts?.length ?? 0) > 0)
  if (destinos.length === 0 && !hayOtraCuenta) return null
  const etiqueta = etiquetaBoton(mismoAgente, destinos)
  return (
    <>
      <button
        type="button"
        className="btn btn-icon pasar-btn"
        disabled={apagado}
        onMouseDown={(e) => {
          if (ancla) e.stopPropagation()
        }}
        onClick={(e) => {
          if (ancla) return setAncla(null)
          const r = e.currentTarget.getBoundingClientRect()
          m.cuenta.recargar()
          setAncla({ right: r.right, top: r.top, bottom: r.bottom })
        }}
        aria-haspopup="menu"
        aria-expanded={ancla !== null}
        title={m.s.sessionId ? etiqueta : txTraspaso().sinConversacion}
        aria-label={etiqueta}
      >
        <IconoPasarA />
      </button>
      {ancla && <PopoverTraspaso m={m} destinos={destinos} ancla={ancla} onCerrar={() => setAncla(null)} />}
    </>
  )
}
