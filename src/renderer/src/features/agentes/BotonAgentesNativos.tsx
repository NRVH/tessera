// =============================================================================
// Botón «Actualizar los agentes de tu equipo» de la barra de título: comprueba las
// versiones de los CLIs nativos, instala la nueva donde Tessera sabe y reinicia las
// sesiones nativas afectadas de todos los perfiles. Las de Docker tienen su botón
// en la cabecera del agente. Calca el chasis del botón de actualización de Tessera,
// sin su clase `.boton-actualizacion`; la vista la decide `vistaBotonAgentes.ts`.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { useAhora } from '../../comun/useAhora'
import { useCerrarFueraOEscape } from '../../comun/usePopoverBarra'
import { TICK_ULTIMO_CHEQUEO_MS } from '../actualizaciones'
import { Popover } from './PopoverAgentesNativos'
import type { InfoSesionesAgentes } from './sesionesPopoverAgentes'
import type { UseActualizacionNativa } from './useActualizacionNativa'
import { decidirVistaBotonAgentes, type PuntoBotonAgentes, type VistaBotonAgentes } from './vistaBotonAgentes'

interface Props {
  act: UseActualizacionNativa
  /** ¿Hay algún proyecto ABIERTO en modo nativo? */
  hayProyectoNativo: boolean
  info: InfoSesionesAgentes
  /**
   * Cada vez que CAMBIA, abre el panel: lo usa Configuración › Actualizaciones, cuyo
   * «Actualizar…» trae aquí la confirmación en vez de duplicar la lista de sesiones.
   */
  tokenAbrir?: number
}

/** El punto del botón, en los tonos del semáforo del updater (ver styles.css). */
const TONO: Readonly<Record<Exclude<PuntoBotonAgentes, null>, string>> = {
  aviso: 'acento',
  ok: 'verde',
  error: 'rojo'
}

interface GlifoProps {
  vista: VistaBotonAgentes
  abierto: boolean
  corriendo: boolean
  alPulsar: () => void
}

function BotonGlifo({ vista, abierto, corriendo, alPulsar }: GlifoProps): React.JSX.Element {
  const tono = vista.punto ? ` tono-${TONO[vista.punto]}` : ''
  return (
    <button
      type="button"
      className={`titlebar-btn agentes-nativos-boton${tono}${abierto ? ' active' : ''}`}
      onClick={alPulsar}
      title={vista.titulo}
      aria-label={vista.titulo}
      aria-busy={corriendo}
      aria-expanded={abierto}
      aria-haspopup="dialog"
    >
      <span className="boton-actualizacion-glifo">
        {vista.anillo ? <AnilloIndeterminado /> : <IconoAgentesNativos />}
        {vista.punto ? <span className="boton-actualizacion-punto" aria-hidden="true" /> : null}
      </span>
      <span className="boton-reinicio-etiqueta">
        <span>{vista.etiqueta}</span>
      </span>
    </button>
  )
}

/** El botón de la barra de título que actualiza los agentes nativos y reinicia sus sesiones. */
export function BotonAgentesNativos({
  act,
  hayProyectoNativo,
  info,
  tokenAbrir = 0
}: Props): React.JSX.Element | null {
  const nombres = nombresSistema(window.tessera.plataforma)
  const [abierto, setAbierto] = useState(false)
  // Abierto A PETICIÓN de Configuración: se enseña aunque su regla de visibilidad diga que no.
  const [forzado, setForzado] = useState(false)
  // Sólo abre un token NUEVO: remontarse con el de siempre no reabre el panel.
  const tokenVistoRef = useRef(tokenAbrir)
  useEffect(() => {
    if (tokenAbrir === tokenVistoRef.current) return
    tokenVistoRef.current = tokenAbrir
    setForzado(true)
    setAbierto(true)
  }, [tokenAbrir])
  useEffect(() => {
    if (!abierto) setForzado(false)
  }, [abierto])
  const wrapRef = useRef<HTMLDivElement>(null)
  const { abrir, cerrar, estado, plan, enCurso, resumen, resumenVisto } = act
  const vista = decidirVistaBotonAgentes({ estado, plan, enCurso, resumen, resumenVisto, hayProyectoNativo, nombres })

  // Abrir pide una foto FRESCA y da el resultado por visto; cerrar, venga de donde
  // venga, también si terminó con el popover delante.
  useEffect(() => {
    if (!abierto) return
    abrir()
    return () => cerrar()
  }, [abierto, abrir, cerrar])
  // Un botón que deja de verse no se queda con el popover abierto por debajo.
  useEffect(() => {
    if (!vista.visible && !forzado) setAbierto(false)
  }, [vista.visible, forzado])
  // «Comprobado hace N min» sólo late con el popover abierto.
  const ahora = useAhora(TICK_ULTIMO_CHEQUEO_MS, abierto)
  useCerrarFueraOEscape(abierto, setAbierto, wrapRef)

  if (!vista.visible && !forzado) return null
  const corriendo = act.enCurso !== null && act.enCurso !== 'terminado'
  // Sólo se anuncia por voz lo que el usuario tiene que llegar a saber: el final.
  const anuncio = vista.punto === 'ok' || vista.punto === 'error' ? vista.titulo : ''

  return (
    <div className="boton-actualizacion-wrap agentes-nativos-wrap" ref={wrapRef}>
      <BotonGlifo vista={vista} abierto={abierto} corriendo={corriendo} alPulsar={() => setAbierto((v) => !v)} />
      <span className="solo-lectores" aria-live="polite">
        {anuncio}
      </span>
      {abierto ? (
        <Popover act={act} info={info} nombres={nombres} ahora={ahora} corriendo={corriendo} />
      ) : null}
    </div>
  )
}

// --- Iconos: trazo 1.6 en viewBox 24 y `currentColor`, como el resto de la barra ---

/**
 * El prompt de una terminal (`>_`) con una flecha que SUBE: los CLIs, a la versión
 * nueva. Distinto a propósito de la flecha circular del updater y de la nube del
 * rehorneado Docker, para que dos botones vecinos no digan lo mismo.
 */
function IconoAgentesNativos(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 7.5 8 12l-4.5 4.5" />
      <path d="M10 18.5h4" />
      <path d="M18.5 17.5v-11" />
      <path d="M15.3 9.7 18.5 6.5l3.2 3.2" />
    </svg>
  )
}

/**
 * Anillo indeterminado mientras corre: el mismo dibujo y clases que el del updater,
 * sin porcentaje porque aquí sólo hay fases.
 */
function AnilloIndeterminado(): React.JSX.Element {
  return (
    <svg className="boton-actualizacion-anillo es-indeterminado" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="boton-actualizacion-carril" cx="12" cy="12" r="8.5" />
      <circle
        className="boton-actualizacion-relleno"
        cx="12"
        cy="12"
        r="8.5"
        pathLength={100}
        style={{ strokeDasharray: '25 100' }}
      />
    </svg>
  )
}
