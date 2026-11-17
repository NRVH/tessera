// =============================================================================
// Contexto de la conversación viva, en el pie del panel del agente: un ANILLO a
// la derecha del uso de cuenta. Barras = límites de la CUENTA; anillo = contexto
// de ESTE chat. El anillo es además el botón de compactar.
// El número no se sondea a reloj: se relee con el mismo aviso `uso.alCambiar`
// que vigila el transcript; el intervalo largo es solo red de seguridad.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FotoContexto } from '../../../../shared/context-ipc'
import { claveUso, type ModoEjecucionUso } from '../../../../shared/usage-ipc'
import type { AgenteConversacion } from '../../../../shared/conversations-ipc'
import { formatoAntiguedad } from '../../util/formatoTiempo'
import { formatoPorcentaje, variableNivelUso } from './formatoUso'
import { txContexto } from './textosContexto.ts'
import { useDespedida } from '../../comun/despedida.ts'
import { useDesplegablePie } from './desplegablePie'

interface PropsControlAnilloContexto {
  agente: AgenteConversacion
  /** Cuenta activa; null = aún no elegida (no hay carpeta que leer). */
  cuentaId: string | null
  modo: ModoEjecucionUso
  /** Proyecto del panel: el contexto es POR CONVERSACIÓN, y cada proyecto tiene la suya. */
  rutaHostProyecto: string
  /** El pane ya está activado, visible y con cuenta: hasta entonces no se consulta nada. */
  habilitado: boolean
  /**
   * Sube cada vez que el pane CAMBIA de conversación (reanudar, nueva, reiniciar). Es un
   * disparador de refresco, no un dato: sin él el anillo enseñaría el chat anterior
   * hasta el siguiente sondeo.
   */
  epocaConversacion: number
  /** ¿Hay sesión viva a la que mandarle el comando? Sin ella el anillo es solo informativo. */
  puedeCompactar: boolean
  /** Manda `/compact` al agente. Lo implementa el pane, que es el dueño del pty. */
  onCompactar: () => void
}

/** Sondeo de RESPALDO (ver cabecera): el refresco bueno llega por `uso.alCambiar`. */
const SONDEO_MS = 60_000

/**
 * Geometría del anillo. `pathLength=100` deja el dasharray en % directos. El radio deja
 * HOLGURA en el cuadro (r + medio trazo = 17 de 18): el grupo del pie va en
 * `overflow: hidden` y el anillo crece al pasar el ratón; si se sube ese `scale`, hay
 * que bajar este radio.
 */
const VIEWBOX_ANILLO = 36
const RADIO_ANILLO = 15

/**
 * Ancho del desplegable (el de `.agent-usage-pop`) y margen mínimo al borde: el anillo
 * vive en el extremo derecho de la ventana y anclarlo sin acotar lo sacaría de ella.
 */
const ANCHO_POPOVER = 240
const MARGEN_POPOVER = 8

/**
 * Cuánto se anuncia «Compactando…» tras pulsar: es el acuse de que el comando salió
 * (el % ya dirá cuándo terminó). Mientras dura, el botón queda bloqueado.
 */
const AVISO_ENVIADO_MS = 6000

type PropsLectura = Omit<PropsControlAnilloContexto, 'puedeCompactar' | 'onCompactar'>

/** Lectura del contexto: al activarse, en bucle de respaldo y con el aviso de fin de turno. */
function useLecturaContexto({
  agente,
  cuentaId,
  modo: mode,
  rutaHostProyecto: projectHostPath,
  habilitado,
  epocaConversacion
}: PropsLectura): { foto: FotoContexto | null; refrescar: () => Promise<void> } {
  const [foto, setFoto] = useState<FotoContexto | null>(null)
  const enCursoRef = useRef(false)

  const refrescar = useCallback(async (): Promise<void> => {
    if (!habilitado || enCursoRef.current) return
    if (mode !== 'host' && !cuentaId) return
    enCursoRef.current = true
    try {
      setFoto(
        await window.tessera.contexto.leer({
          agente,
          accountId: cuentaId ?? '',
          projectHostPath,
          modo: mode
        })
      )
    } catch {
      setFoto(null) // main caído / canal no disponible: anillo apagado
    } finally {
      enCursoRef.current = false
    }
    // `epocaConversacion` no se usa dentro, pero va en las deps: cambiar de conversación
    // tiene que re-ejecutar el efecto que llama a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agente, cuentaId, mode, projectHostPath, habilitado, epocaConversacion])

  useEffect(() => {
    if (!habilitado) return
    void refrescar()
    const id = setInterval(() => void refrescar(), SONDEO_MS)
    return () => clearInterval(id)
  }, [refrescar, habilitado])

  // El aviso viaja por cuenta y se filtra por la propia. La suscripción la abre
  // `BarrasUso`; aquí solo se escucha, sin duplicar ningún vigilante de disco.
  useEffect(() => {
    if (!habilitado) return
    if (mode !== 'host' && !cuentaId) return
    const mine = claveUso({ agente, accountId: cuentaId ?? '', mode })
    return window.tessera.uso.alCambiar((c) => {
      if (c.clave === mine) void refrescar()
    })
  }, [agente, cuentaId, mode, habilitado, refrescar])

  return { foto, refrescar }
}

/** Acuse del comando de compactar: bloquea el botón unos segundos tras pulsarlo. */
function useAcuseCompactar(
  puedeCompactar: boolean,
  onCompactar: () => void
): { enviado: boolean; armado: boolean; compactar: () => void } {
  const [enviado, setEnviado] = useState(false)
  const temporizadorEnviadoRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // El temporizador del acuse no sobrevive al desmontaje (setState sobre un componente muerto).
  useEffect(() => () => {
    if (temporizadorEnviadoRef.current) clearTimeout(temporizadorEnviadoRef.current)
  }, [])

  // Compactar exige sesión viva; el dato de contexto no (se lee del disco), así que el
  // anillo se pinta igual y solo el botón se apaga.
  const armado = puedeCompactar && !enviado

  function compactar(): void {
    if (!armado) return
    onCompactar()
    setEnviado(true)
    if (temporizadorEnviadoRef.current) clearTimeout(temporizadorEnviadoRef.current)
    temporizadorEnviadoRef.current = setTimeout(() => setEnviado(false), AVISO_ENVIADO_MS)
  }

  return { enviado, armado, compactar }
}

/** Anillo de contexto de la conversación viva, con desplegable y acción de compactar. */
export function ControlAnilloContexto(props: PropsControlAnilloContexto): React.JSX.Element | null {
  const { agente, habilitado, puedeCompactar, onCompactar } = props
  const [abierto, setAbierto] = useState(false)
  const [ancla, setAncla] = useState<{ left: number; bottom: number } | null>(null)
  const raizRef = useRef<HTMLDivElement>(null)
  const { foto, refrescar } = useLecturaContexto(props)
  const { enviado, armado, compactar } = useAcuseCompactar(puedeCompactar, onCompactar)
  const anunciarApertura = useDesplegablePie(() => setAbierto(false))

  if (!habilitado) return null

  const porcentaje = porcentajeDe(foto)

  function mostrarPopover(): void {
    const r = raizRef.current?.getBoundingClientRect()
    if (r) {
      const maxIzquierda = window.innerWidth - ANCHO_POPOVER - MARGEN_POPOVER
      setAncla({
        left: Math.max(MARGEN_POPOVER, Math.min(r.left, maxIzquierda)),
        bottom: window.innerHeight - r.top
      })
    }
    anunciarApertura()
    setAbierto(true)
    void refrescar() // al mirarlo de cerca, el dato debe ser de AHORA
  }

  return (
    <div
      className="agent-context"
      ref={raizRef}
      onMouseEnter={mostrarPopover}
      onMouseLeave={() => setAbierto(false)}
      aria-label={txContexto().contexto.ariaChat}
    >
      {/* El área pulsable abarca anillo + %: un blanco de 16 px sería un ejercicio de puntería. */}
      <button
        type="button"
        className={`agent-context-btn${enviado ? ' is-sent' : ''}`}
        onClick={compactar}
        disabled={!armado}
        aria-label={etiquetaBoton(enviado, puedeCompactar, porcentaje)}
      >
        <AnilloContexto porcentaje={porcentaje} />
        <span className="agent-context-pct">{porcentaje === null ? '—' : formatoPorcentaje(porcentaje)}</span>
      </button>

      {abierto && ancla && (
        <PopoverContexto
          agente={agente}
          foto={foto}
          porcentaje={porcentaje}
          ancla={ancla}
          enviado={enviado}
          armado={armado}
          puedeCompactar={puedeCompactar}
        />
      )}
    </div>
  )
}

/**
 * Una conversación VACÍA (nueva o recién limpiada) es un cero, no un dato que falte:
 * el guion se reserva para cuando no hay nada que decir (sin chats o fallo al leer).
 */
function porcentajeDe(foto: FotoContexto | null): number | null {
  if (foto && !foto.noDisponible) return foto.porcentaje
  return foto?.noDisponible === 'no-data' ? 0 : null
}

function etiquetaBoton(enviado: boolean, puedeCompactar: boolean, porcentaje: number | null): string {
  const t = txContexto().contexto
  if (enviado) return t.compactando
  const contexto = t.etiqueta(porcentaje === null ? null : formatoPorcentaje(porcentaje))
  return puedeCompactar ? t.etiquetaCompactable(contexto) : contexto
}

/** El anillo del porcentaje de contexto; lo comparte el de un agente manual (`ContextoManual`). */
export function AnilloContexto({ porcentaje }: { porcentaje: number | null }): React.JSX.Element {
  return (
    <svg className="agent-context-ring" viewBox={`0 0 ${VIEWBOX_ANILLO} ${VIEWBOX_ANILLO}`} aria-hidden="true">
      <circle className="agent-context-track" cx={VIEWBOX_ANILLO / 2} cy={VIEWBOX_ANILLO / 2} r={RADIO_ANILLO} />
      {porcentaje !== null && (
        <circle
          className="agent-context-fill"
          cx={VIEWBOX_ANILLO / 2}
          cy={VIEWBOX_ANILLO / 2}
          r={RADIO_ANILLO}
          pathLength={100}
          style={{
            stroke: `var(${variableNivelUso(porcentaje)})`,
            // Suelo visible: un chat recién abierto se leería como anillo VACÍO, sin dato.
            strokeDasharray: `${Math.max(porcentaje, porcentaje > 0 ? 1.5 : 0)} 100`
          }}
        />
      )}
    </svg>
  )
}

interface PropsPopoverContexto {
  agente: AgenteConversacion
  foto: FotoContexto | null
  porcentaje: number | null
  ancla: { left: number; bottom: number }
  enviado: boolean
  armado: boolean
  puedeCompactar: boolean
}

function PopoverContexto(p: PropsPopoverContexto): React.JSX.Element {
  const { agente, foto, porcentaje, ancla } = p
  const ref = useDespedida<HTMLDivElement>('flotante')
  return (
    <div
      ref={ref}
      className="agent-usage-pop"
      style={{ left: ancla.left, bottom: ancla.bottom }}
      role="tooltip"
    >
      <div className="agent-usage-pop-title">
        {txContexto().contexto.titulo}
        <span className="agent-usage-pop-agent">{nombreAgente(agente)}</span>
      </div>
      <div className="agent-usage-foot">{txContexto().contexto.explicacion}</div>

      {/* La barra se pinta SIEMPRE que haya porcentaje, también el 0 % de un chat vacío:
          es el estado que más se consulta. Lo que desaparece es el detalle que no existe. */}
      {porcentaje === null ? (
        <div className="agent-usage-foot">{textoNoDisponible(foto, agente)}</div>
      ) : (
        <DetalleContexto agente={agente} foto={foto} porcentaje={porcentaje} />
      )}

      {/* La ACCIÓN, siempre al pie: el desplegable se abre al pasar el ratón, así que
          nunca se llega al clic sin haberla leído. */}
      <div className={`agent-context-cta${p.armado ? '' : ' is-off'}`}>
        {textoAccion(p.enviado, p.puedeCompactar, agente)}
      </div>
    </div>
  )
}

interface PropsDetalleContexto {
  agente: AgenteConversacion
  foto: FotoContexto | null
  porcentaje: number
}

function DetalleContexto({ agente, foto, porcentaje }: PropsDetalleContexto): React.JSX.Element {
  /** Snapshot con turno detrás: el único que tiene tokens, modelo y hora que enseñar. */
  const medido = foto && !foto.noDisponible ? foto : null
  const t = txContexto().contexto
  return (
    <>
      <div className="agent-usage-row">
        <div className="agent-usage-row-head">
          <span>{t.ventanaOcupada}</span>
          <span className="agent-usage-pct">{formatoPorcentaje(porcentaje)}</span>
        </div>
        <div className="agent-usage-track">
          <i style={{ width: `${porcentaje}%`, background: `var(${variableNivelUso(porcentaje)})` }} />
        </div>
        {medido && (
          <div className="agent-usage-reset">
            {formatearCantidadTokens(medido.tokensUsados)}
            {t.de}
            {formatearCantidadTokens(medido.tokensVentana)}
            {t.tokens}
            {medido.modelo ? ` · ${medido.modelo}` : ''}
          </div>
        )}
      </div>
      {/* En claude-code el tamaño de ventana sale de una tabla por modelo, no del transcript. */}
      {medido?.ventanaEstimada && (
        <div className="agent-usage-foot">{t.ventanaEstimada}</div>
      )}
      {/* 'heuristica' sale sin sesión y también con ella tras un `/clear` o `/resume` en el
          TUI o si el chat anclado ya no existe: lo único cierto es que no se sabe CUÁL es. */}
      {foto?.anclaje === 'heuristica' && (
        <div className="agent-usage-foot">{t.sinConfirmar}</div>
      )}
      <div className="agent-usage-foot">
        {!medido
          ? textoNoDisponible(foto, agente)
          : medido.compactado
            ? t.compactada(formatoAntiguedad(medido.observadoEn, Date.now()))
            : t.ultimoTurno(formatoAntiguedad(medido.observadoEn, Date.now()))}
      </div>
    </>
  )
}

function nombreAgente(agente: AgenteConversacion): string {
  return agente === 'codex' ? 'Codex' : 'Claude Code'
}

function textoAccion(enviado: boolean, puedeCompactar: boolean, agente: AgenteConversacion): string {
  const t = txContexto().contexto
  if (enviado) return t.comandoEnviado(nombreAgente(agente))
  return puedeCompactar ? t.clicCompactar : t.hazFaltaSesion
}

/** 623 650 -> "624k"; 1 000 000 -> "1M". El número exacto no aporta al leerlo de reojo. */
export function formatearCantidadTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function textoNoDisponible(foto: FotoContexto | null, agente: AgenteConversacion): string {
  const t = txContexto().contexto
  if (!foto) return t.consultando
  switch (foto.noDisponible) {
    case 'no-session':
      return t.sinConversacion
    // El caso corriente es un chat recién vaciado con `/clear`: nombrarlo evita leer avería.
    case 'no-data':
      return agente === 'codex' ? t.vaciaCodex : t.vaciaClaude
    case 'error':
      return t.errorLeer(foto.detalle)
    default:
      return t.sinDatos
  }
}
