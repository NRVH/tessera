// =============================================================================
// Las acciones de la cabecera del panel de terminales, a la derecha y en tres grupos separados por un
// filete, de lo que más se usa a lo terminal: reiniciar la terminal local que se ve; maximizar
// o restaurar el panel; y ocultarlo. Las acciones se ocultan en reposo con `visibility`, no `display`,
// salvo restaurar y ocultar a pantalla completa: son las dos salidas del modo. El «+» y la ▾ de las
// conexiones viven en las pestañas, y el conmutador del riel, al otro extremo de la cabecera. El del
// agente de la terminal no está aquí: es el de la barra de estado.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md, docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { IconoMaximizar, IconoRestaurar } from '../../comun/iconosPanel'
import { etiquetaAcorde } from '../../util/atajos'
import { HideIcon, ReloadIcon } from './IconosTerminales'
import type { SalidaBotonReinicio } from './reloadButton'
import { txTerminales } from './textos.ts'

/** Cómo se llama el reinicio del pane que se ve y a qué alcanza. */
export interface AlcanceReinicio {
  /** Nombre completo del botón: su nombre accesible en reposo. */
  etiqueta: string
  /** El final del tooltip: lo que se ve afectado. */
  alcance: string
}

/** El reinicio de una terminal local, el de siempre. */
export function reinicioLocal(): AlcanceReinicio {
  const t = txTerminales()
  return { etiqueta: t.reiniciarTerminal, alcance: t.soloEstaTerminal }
}

/** El reinicio del pane que se ve: su estado, a qué alcanza y qué hace. */
export interface ReinicioPanel {
  boton: SalidaBotonReinicio
  alcance: AlcanceReinicio
  onReload: () => void
}

/**
 * Botón de reinicio del pane que se ve: en reposo, un icono cuadrado como sus vecinos, con el nombre en el
 * tooltip; solo crece para enseñar un estado que contar («Reiniciando…»).
 */
function BotonReinicioTerminal({ reinicio }: { reinicio: ReinicioPanel }): React.JSX.Element {
  const { boton, alcance } = reinicio
  return (
    <button
      className={`btn btn-icon terminal-reload-btn${boton.soloIcono ? ' solo-icono' : ' boton-reinicio'}`}
      onClick={reinicio.onReload}
      disabled={!boton.habilitado}
      title={`${boton.titulo} · ${alcance.alcance}`}
      aria-label={boton.soloIcono ? alcance.etiqueta : boton.etiqueta}
    >
      <ReloadIcon />
      {/* ENVUELTA, no suelta como texto: el CSS la oculta cuando la cabecera se estrecha. */}
      {!boton.soloIcono && <span className="terminal-reload-estado">{boton.etiqueta}</span>}
    </button>
  )
}

/** Un filete entre grupos de acciones: se funde con ellas en reposo. */
function Filete(): React.JSX.Element {
  return <span className="panel-actions-sep" aria-hidden="true" />
}

/** Las acciones de la cabecera: pantalla completa, reinicio y ocultar el panel. */
export function AccionesPanel({
  reinicio,
  onClosePanel,
  pantallaCompleta,
  onPantallaCompleta
}: {
  /** El reinicio del pane que se ve; `null` si no se ve ninguno. */
  reinicio: ReinicioPanel | null
  onClosePanel: () => void
  pantallaCompleta: boolean
  onPantallaCompleta: (pedir: boolean) => void
}): React.JSX.Element {
  const t = txTerminales()
  const etiquetaModo = pantallaCompleta ? t.restaurarPanel : t.maximizarPanel
  // `fijo`: a pantalla completa restaurar y ocultar son las dos salidas del modo y no se esconden en reposo.
  const fijo = pantallaCompleta ? ' fijo' : ''
  return (
    <div className="panel-actions">
      <button
        className={`btn btn-icon${fijo}`}
        onClick={() => onPantallaCompleta(!pantallaCompleta)}
        title={`${etiquetaModo} (${etiquetaAcorde('pantallaCompleta')})`}
        aria-label={etiquetaModo}
      >
        {pantallaCompleta ? <IconoRestaurar /> : <IconoMaximizar />}
      </button>
      <Filete />
      {reinicio && (
        <>
          <BotonReinicioTerminal reinicio={reinicio} />
          <Filete />
        </>
      )}
      {/* OCULTAR, no cerrar: las sesiones siguen vivas (por eso un guion y no una ✕). */}
      <button
        className={`btn btn-icon${fijo}`}
        onClick={onClosePanel}
        title={t.ocultarPanelTitulo}
        aria-label={t.ocultarPanelEtiqueta}
      >
        <HideIcon />
      </button>
    </div>
  )
}
