// =============================================================================
// Las acciones de la cabecera del panel de terminales, a la derecha y en el orden de las de Git·Log:
// reiniciar la terminal local que se ve, maximizar el panel y ocultarlo. En reposo se pliegan y, al
// pasar el ratón, entran desde la derecha, como en Git·Log (`comun/movimiento.css`). A pantalla
// completa queda solo reiniciar: restaurar y ocultar son del modo y van en el riel. El «+» y la ▾ de las
// conexiones viven en las pestañas. El del agente de la terminal no está aquí: es el de la barra de estado.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md, docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { useUltimoValor } from '../../comun/presencia'
import { IconoMaximizar, IconoOcultarPanel } from '../../comun/iconosPanel'
import { etiquetaAcorde } from '../../util/atajos'
import { IconoRecargarTerminal } from './IconosTerminales'
import type { SalidaBotonReinicio } from './botonReinicio'
import { txTerminales } from './textos.ts'

/** El reinicio del pane que se ve: su estado, su nombre accesible en reposo y qué hace. */
export interface PanelReinicio {
  boton: SalidaBotonReinicio
  etiqueta: string
  onRecargar: () => void
}

/**
 * Botón de reinicio del pane que se ve: en reposo, un icono cuadrado como sus vecinos, con el nombre en el
 * tooltip; solo crece para enseñar un estado que contar («Reiniciando…»).
 */
function BotonReinicioTerminal({ reinicio }: { reinicio: PanelReinicio }): React.JSX.Element {
  const { boton, etiqueta } = reinicio
  const ultimaEtiqueta = useUltimoValor(boton.soloIcono ? null : boton.etiqueta)
  return (
    <button
      className={`btn btn-icon terminal-reload-btn${boton.soloIcono ? ' solo-icono' : ' boton-reinicio'}`}
      onClick={reinicio.onRecargar}
      disabled={!boton.habilitado}
      title={boton.titulo}
      aria-label={boton.soloIcono ? etiqueta : boton.etiqueta}
    >
      <IconoRecargarTerminal />
      {/* ENVUELTA, no suelta como texto: el CSS la oculta cuando la cabecera se estrecha. */}
      <span className={`boton-reinicio-etiqueta terminal-reload-estado${boton.soloIcono ? '' : ' visible'}`}><span>{ultimaEtiqueta}</span></span>
    </button>
  )
}

/**
 * Las acciones de la cabecera, en el orden de las de Git·Log: reiniciar, maximizar y ocultar el panel. A pantalla
 * completa solo el reinicio: restaurar y ocultar son del modo y viven en el riel (`RielActividadPuro`, `RielPantallaCompleta`).
 */
export function PanelAcciones({
  reinicio,
  onCerrarPanel,
  pantallaCompleta,
  onPantallaCompleta
}: {
  /** El reinicio del pane que se ve; `null` si no se ve ninguno. */
  reinicio: PanelReinicio | null
  onCerrarPanel: () => void
  pantallaCompleta: boolean
  onPantallaCompleta: (pedir: boolean) => void
}): React.JSX.Element {
  const t = txTerminales()
  if (pantallaCompleta) {
    return <div className="panel-actions">{reinicio && <BotonReinicioTerminal reinicio={reinicio} />}</div>
  }
  return (
    <div className="panel-actions">
      {reinicio && <BotonReinicioTerminal reinicio={reinicio} />}
      <button
        className="btn btn-icon"
        onClick={() => onPantallaCompleta(true)}
        title={`${t.maximizarPanel} (${etiquetaAcorde('pantallaCompleta')})`}
        aria-label={t.maximizarPanel}
      >
        <IconoMaximizar />
      </button>
      {/* OCULTAR, no cerrar: las sesiones siguen vivas (por eso un guion y no una ✕). */}
      <button
        className="btn btn-icon"
        onClick={onCerrarPanel}
        title={t.ocultarPanelTitulo}
        aria-label={t.ocultarPanelEtiqueta}
      >
        <IconoOcultarPanel />
      </button>
    </div>
  )
}
