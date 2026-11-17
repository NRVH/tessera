// =============================================================================
// Bloque «Tessera» de la categoría Actualizaciones: versión actual, línea de
// estado, última comprobación y los botones del ciclo (buscar, instalar, descartar
// avisos). Comparte el `EstadoActualizacion` del main con el botón de la barra de título.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { textoUltimoChequeo } from '../../../actualizaciones'
import { ESCENAS, type Escena } from './escenasActualizacion'
import { txBloquesActualizacion } from '../../textosSistema.ts'
import { lineaEstadoActualizacion } from './textosUpdate'
import { useActualizacionAjustes, type ActualizacionAjustes } from './useActualizacionAjustes'

function InfoActualizacion({ u, lineaEstado }: { u: ActualizacionAjustes; lineaEstado: string }): React.JSX.Element {
  const { estado, fase, ocupado, version, ahora, esDesarrollo } = u
  const esError = fase === 'error' || Boolean(estado?.avisoFallo)
  const t = txBloquesActualizacion().actualizacion
  return (
    <div className="settings-update-info">
      <span className="settings-update-version">{t.versionActual(version)}</span>
      <span className={`settings-update-status${esError ? ' error' : ''}`}>
        {ocupado && <span className="settings-update-spinner" aria-hidden="true" />}
        {lineaEstado}
      </span>
      {/* `ultimoChequeoMs` viene del main y cuenta también las comprobaciones automáticas. */}
      <span className="settings-update-status">
        {estado?.ultimoChequeoMs == null && esDesarrollo
          ? t.sinFeed
          : textoUltimoChequeo(estado?.ultimoChequeoMs ?? null, ahora)}
      </span>
    </div>
  )
}

function BotonDescartar({ u }: { u: ActualizacionAjustes }): React.JSX.Element | null {
  const { estado, descartar } = u
  const fallo = estado?.avisoFallo ?? null
  if (!fallo && !estado?.avisoAplicada) return null
  const t = txBloquesActualizacion().actualizacion
  return (
    <button
      className="btn"
      onClick={() => descartar(fallo ? 'fallo' : 'aplicada')}
      title={fallo ? t.descartarFallo : undefined}
    >
      {fallo ? t.descartar : t.entendido}
    </button>
  )
}

function BotonPrincipal({ u }: { u: ActualizacionAjustes }): React.JSX.Element {
  const { estado, fase, ocupado, comprobar: check, instalarActualizacion } = u
  const t = txBloquesActualizacion().actualizacion
  if (fase === 'ready') {
    return (
      <button className="btn primary" onClick={instalarActualizacion} title={t.instalarTitulo}>
        {t.reiniciarInstalar}
      </button>
    )
  }
  if (fase === 'available') {
    // Aquí no hay instalador que lanzar: el botón abre la descarga y la app sigue tal cual.
    return (
      <button className="btn primary" onClick={instalarActualizacion} title={t.descargarTitulo}>
        {t.descargar(estado?.newVersion ?? '').trim()}
      </button>
    )
  }
  return (
    <button className="btn" onClick={check} disabled={ocupado}>
      {fase === 'error' ? t.reintentar : t.buscar}
    </button>
  )
}

function AccionesActualizacion({ u }: { u: ActualizacionAjustes }): React.JSX.Element {
  const { fase, ocupado, esDesarrollo, comprobar: check, mostrarPreviaDesarrollo } = u
  const t = txBloquesActualizacion().actualizacion
  return (
    <div className="settings-update-actions">
      <BotonDescartar u={u} />
      <BotonPrincipal u={u} />
      {/* En `available` comprobar sigue teniendo sentido: quizá ya hay una versión más
          nueva que la anunciada. En `ready`, `check()` sale temprano. */}
      {fase === 'available' ? (
        <button className="btn" onClick={check} disabled={ocupado}>
          {t.buscar}
        </button>
      ) : null}
      {esDesarrollo ? (
        <select
          className="settings-update-escena"
          aria-label={t.estadoSimulado}
          defaultValue="ciclo"
          onChange={(e) => mostrarPreviaDesarrollo(e.target.value as Escena)}
        >
          {ESCENAS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

/** Bloque de la versión de Tessera: estado real del main, o simulado en desarrollo. */
export function BloqueActualizacion(): React.JSX.Element {
  const u = useActualizacionAjustes()
  const lineaEstado = lineaEstadoActualizacion({
    estado: u.estado,
    fase: u.fase,
    version: u.version,
    esDesarrollo: u.esDesarrollo
  })
  return (
    <div className="settings-update">
      <InfoActualizacion u={u} lineaEstado={lineaEstado} />
      <AccionesActualizacion u={u} />
    </div>
  )
}
