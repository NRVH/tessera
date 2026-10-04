// =============================================================================
// Bloque «Agentes» de la categoría Actualizaciones: versiones de Claude Code y Codex
// nativos y sus acciones. Comparte el estado del hook de App con el botón de la
// barra de título; la confirmación (qué sesiones se reiniciarán) vive en el panel
// de ese botón, y «Actualizar…» cierra el modal y lo abre.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { ETIQUETA_AGENTE } from '../../../../../../shared/etiquetasAgente'
import { nombresSistema, type NombresSistema } from '../../../../../../shared/nombresSistema'
import { useAhora } from '../../../../comun/useAhora'
import { TICK_ULTIMO_CHEQUEO_MS } from '../../../actualizaciones'
import type { UseActualizacionNativa } from '../../../agentes'
import { lineaEstadoAgentes, resumirAgentes, textoCli, type ResumenAgentes } from './textosAgentes'

function InfoAgentes({
  act,
  r,
  nombres,
  ahora
}: {
  act: UseActualizacionNativa
  r: ResumenAgentes
  nombres: NombresSistema
  ahora: number
}): React.JSX.Element {
  const { estado, comprobando, errorComprobar } = act
  const esError = r.resultado === 'error' || (!r.corriendo && !r.resultado && errorComprobar !== null)
  return (
    <div className="settings-update-info">
      {estado ? (
        r.clis.map((c) => (
          <span key={c.agente} className="settings-update-version">
            {ETIQUETA_AGENTE[c.agente]}: {textoCli(c, nombres.tuEquipo)}
          </span>
        ))
      ) : (
        <span className="settings-update-version">Todavía no se han comprobado los agentes.</span>
      )}
      <span className={`settings-update-status${esError ? ' error' : ''}`}>
        {comprobando || r.corriendo ? <span className="settings-update-spinner" aria-hidden="true" /> : null}
        {lineaEstadoAgentes(r, act, ahora)}
      </span>
      <span className="settings-update-status">
        {`Sólo los agentes que corren en ${nombres.tuEquipo}; los de Docker se actualizan con el botón de su panel.`}
      </span>
    </div>
  )
}

function AccionesAgentes({
  act,
  r,
  onAbrir
}: {
  act: UseActualizacionNativa
  r: ResumenAgentes
  onAbrir: () => void
}): React.JSX.Element {
  const { comprobando } = act
  return (
    <div className="settings-update-actions">
      {/* Con un resultado pendiente, el panel es donde se lee y se descarta. */}
      {r.resultado && !r.corriendo ? (
        <button className="btn btn-ghost" onClick={onAbrir} title="Abre el panel con el detalle de la última actualización.">
          Ver detalle
        </button>
      ) : null}
      {r.hayAlgo && !r.corriendo ? (
        <button
          className="btn primary"
          onClick={onAbrir}
          title="Abre el panel del botón de la barra de título: ahí se ve qué sesiones se reiniciarán y se confirma."
        >
          Actualizar…
        </button>
      ) : null}
      {/* `comprobar` y no `abrir`: `abrir` es la del panel y da su resumen por visto, y
          aquí ese resumen no se enseña, así que no puede retirarle el punto. */}
      <button className="btn btn-ghost" onClick={act.comprobar} disabled={comprobando || r.corriendo}>
        Buscar actualizaciones
      </button>
    </div>
  )
}

/** Tarjeta de los agentes nativos: versiones, línea de estado y acciones. */
export function BloqueAgentes({
  act,
  onAbrir
}: {
  act: UseActualizacionNativa
  onAbrir: () => void
}): React.JSX.Element {
  const ahora = useAhora(TICK_ULTIMO_CHEQUEO_MS)
  const nombres = nombresSistema(window.tessera.plataforma)
  const r = resumirAgentes(act, nombres)
  return (
    <div className="settings-update">
      <InfoAgentes act={act} r={r} nombres={nombres} ahora={ahora} />
      <AccionesAgentes act={act} r={r} onAbrir={onAbrir} />
    </div>
  )
}
