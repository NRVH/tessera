// =============================================================================
// «Continuar esta conversación»: el botón de la cabecera y su popover, único lugar desde el que se sigue el
// trabajo en otro sitio. Primero las otras cuentas del mismo agente, que se llevan la conversación entera, y luego
// los otros agentes, que reciben un resumen. Si el agente afectado tiene un turno en marcha, antes se pregunta.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import './cuentaAgente.css'
import { useEffect, useRef, useState } from 'react'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import type { TipoAgente } from '../../../../shared/agent-terminal-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { AYUDA, BotonAyuda } from '../academy'
import { claveDestinoAgente } from '../pestanas'
import { turnoEnMarcha } from './actividadAgente.ts'
import { nombreAgente } from './tiposPaneAgente'
import type { PestanaAgente } from './agentesDelProyecto'
import { continuarEn, type DestinoContinuar } from './continuarEn'
import { IconoContenedor, IconoEquipo, IconoPasarA } from './iconosPaneAgente'
import { ANCHO_POPOVER, Tarjeta, cerrarConEscape, conMayuscula, puedeSeguirConversacion, useCierre, usePosicionPopover } from './PopoverCuenta'
import { nombreVisible, otrasCuentas, type OtrasCuentas } from './selectorCuenta.ts'
import { useStoreAgentes } from './store'
import { txPane } from './textosPane.ts'
import { txTraspaso } from './textosTraspaso.ts'
import type { AnclaCuenta } from './useEstadoPaneAgente'
import type { ModeloPaneAgente } from './usePaneAgente'

/** Los agentes de serie del proyecto a los que se puede pasar: los de las pestañas, menos este. */
export function destinosTraspaso(m: ModeloPaneAgente): PestanaAgente[] {
  if (m.p.lugar !== 'proyecto' || m.p.mosaico || m.p.pestanasAgente.some((x) => x.id === m.p.target.agente && x.manual)) return []
  return m.p.pestanasAgente.filter((x) => !x.manual && x.id !== m.p.target.agente)
}

/** Las cuentas de Docker de otros agentes en este perfil, por agente; null mientras llegan. */
function useCuentasDe(perfilId: string, agentes: string[]): Record<string, CuentaAgente[]> | null {
  const [cuentas, setCuentas] = useState<Record<string, CuentaAgente[]> | null>(null)
  const clave = agentes.join('\n')
  useEffect(() => {
    let vivo = true
    const pedir = clave === '' ? [] : clave.split('\n')
    void Promise.all(
      pedir.map(async (agente) => {
        const lista = await window.tessera.cuentasAgente.listar({ profileId: perfilId, agente: agente as TipoAgente }).catch((): CuentaAgente[] => [])
        return [agente, lista] as const
      })
    ).then((pares) => {
      if (vivo) setCuentas(Object.fromEntries(pares))
    })
    return () => {
      vivo = false
    }
  }, [perfilId, clave])
  return cuentas
}

/** Un grupo de cuentas a las que continuar: el agente, qué se lleva y sus tarjetas. */
function Grupo(p: {
  nombre: string
  lleva: string
  llevaDetalle: string
  agente: TipoAgente
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
          onElegir={() => onElegir({ agente, modo: 'nativo', cuentaId: null }, sistema.tuEquipo)}
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
            onElegir={() => onElegir({ agente, modo: 'docker', cuentaId: c.id }, txTraspaso().cuentaCitada(nombre))}
          />
        )
      })}
      {cuentas !== null && !cuentas.nativa && cuentas.docker.length === 0 && <p className="cuenta-vacio">{t.sinCuentasDockerContinuar}</p>}
    </section>
  )
}

/** Un grupo por cada otro agente del proyecto, con todas sus cuentas. */
function GruposOtrosAgentes({ destinos, cuentas, onElegir }: { destinos: PestanaAgente[]; cuentas: Record<string, CuentaAgente[]> | null; onElegir: (d: DestinoContinuar, otro: string) => void }): React.JSX.Element {
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
            agente={d.id as TipoAgente}
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
function useContinuar(m: ModeloPaneAgente, onCerrar: () => void): {
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
    const sesion = m.s.sesionId
    onCerrar()
    // Por si las dos copias divergieron: el diálogo nombra cada lado.
    const nombreDe = (id: string | null | undefined): string => {
      const c = id ? m.s.cuentasCargadas?.find((x) => x.id === id) : undefined
      return c ? nombreVisible(c, txPane().menus.predeterminada) : ''
    }
    const lados = {
      origen: { modo: m.p.modoNativo ? ('nativo' as const) : ('docker' as const), nombre: m.p.modoNativo ? '' : nombreDe(m.cuentaActual?.id) },
      destino: { modo: destino.modo, nombre: nombreDe(destino.cuentaId) }
    }
    if (sesion) void continuarEn(target, sesion, destino, { lados })
  }
  // Mismo agente: cerrar su sesión para abrirla en la otra cuenta le corta el turno en marcha.
  const elegirMismo = (destino: DestinoContinuar, donde: string): void => {
    if (turnoEnMarcha(useStoreAgentes.getState().actividad, target.key)) {
      setConfirmar({ destino, titulo: t.trabajandoTitulo(nombre), mensaje: t.seguirTrabajandoMensaje(nombre, donde) })
    } else pasar(destino)
  }
  // Otro agente: lo que se corta es el turno que tenga el de destino en este proyecto.
  const elegirOtro = (destino: DestinoContinuar, otro: string): void => {
    const clave = claveDestinoAgente(target.profileId, target.projectHostPath, destino.agente)
    if (turnoEnMarcha(useStoreAgentes.getState().actividad, clave)) {
      setConfirmar({ destino, titulo: t.trabajandoTitulo(otro), mensaje: t.trabajandoMensaje(otro) })
    } else pasar(destino)
  }
  return { confirmar, cancelar: () => setConfirmar(null), pasar, elegirMismo, elegirOtro }
}

/** El popover, alineado por la derecha bajo su botón (encima si no cabe). */
function PopoverTraspaso({ m, destinos, ancla, onCerrar }: { m: ModeloPaneAgente; destinos: PestanaAgente[]; ancla: AnclaCuenta; onCerrar: () => void }): React.JSX.Element {
  const raiz = useRef<HTMLDivElement>(null)
  const { confirmar, cancelar, pasar, elegirMismo, elegirOtro } = useContinuar(m, onCerrar)
  const { target, modoNativo } = m.p
  const cuentas = useCuentasDe(target.profileId, destinos.map((d) => d.id))
  useCierre(raiz, () => {
    if (!confirmar) onCerrar()
  })
  // Vuelve a medirse también cuando las listas llegan vacías: la tarjeta del equipo sustituye a «Cargando».
  const total = (cuentas ? 1 : 0) + Object.values(cuentas ?? {}).reduce((n, l) => n + l.length, 0) + (m.s.cuentasCargadas?.length ?? 0)
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
            agente={target.agente as TipoAgente}
            cuentas={m.s.cuentasCargadas ? otrasCuentas(m.s.cuentasCargadas, m.cuentaActual?.id ?? null, modoNativo) : null}
            onElegir={elegirMismo}
          />
        )}
        <GruposOtrosAgentes destinos={destinos} cuentas={cuentas} onElegir={elegirOtro} />
      </div>
      {confirmar && (
        <DialogoConfirmar
          peligro
          severidad="advertencia"
          titulo={confirmar.titulo}
          mensaje={confirmar.mensaje}
          etiquetaConfirmar={t.seguir}
          etiquetaCancelar={t.cancelar}
          onConfirmar={() => pasar(confirmar.destino)}
          onCancelar={cancelar}
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
export function BotonPasarA({ m }: { m: ModeloPaneAgente }): React.JSX.Element | null {
  const [ancla, setAncla] = useState<AnclaCuenta | null>(null)
  const apagado = !m.s.sesionId || m.s.actualizando
  // Abierto no puede seguir ofreciendo destinos: sin sesión no hay qué continuar, y a mitad de una actualización
  // el orquestador cuenta con este pane tal como está.
  useEffect(() => {
    if (apagado) setAncla(null)
  }, [apagado])
  const destinos = destinosTraspaso(m)
  const mismoAgente = puedeSeguirConversacion(m.p)
  // En nativo y sin cuentas de Docker no hay otra cuenta del mismo agente a la que ir.
  const hayOtraCuenta = mismoAgente && (!m.p.modoNativo || (m.s.cuentasCargadas?.length ?? 0) > 0)
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
        title={m.s.sesionId ? etiqueta : txTraspaso().sinConversacion}
        aria-label={etiqueta}
      >
        <IconoPasarA />
      </button>
      {ancla && <PopoverTraspaso m={m} destinos={destinos} ancla={ancla} onCerrar={() => setAncla(null)} />}
    </>
  )
}
