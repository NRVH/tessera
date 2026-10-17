// =============================================================================
// Bloque «Tessera» de la categoría Actualizaciones: versión actual, línea de
// estado, última comprobación y los botones del ciclo (buscar, instalar, descartar
// avisos). Comparte el `UpdateState` del main con el botón de la barra de título.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { textoUltimoChequeo } from '../../../actualizaciones'
import { ESCENAS, type Escena } from './escenasUpdate'
import { txBloquesUpdate } from '../../textosSistema.ts'
import { lineaEstadoUpdate } from './textosUpdate'
import { useUpdateAjustes, type UpdateAjustes } from './useUpdateAjustes'

function InfoUpdate({ u, statusLine }: { u: UpdateAjustes; statusLine: string }): React.JSX.Element {
  const { state, status, busy, version, ahora, isDev } = u
  const esError = status === 'error' || Boolean(state?.avisoFallo)
  const t = txBloquesUpdate().update
  return (
    <div className="settings-update-info">
      <span className="settings-update-version">{t.versionActual(version)}</span>
      <span className={`settings-update-status${esError ? ' error' : ''}`}>
        {busy && <span className="settings-update-spinner" aria-hidden="true" />}
        {statusLine}
      </span>
      {/* `ultimoChequeoMs` viene del main y cuenta también las comprobaciones automáticas. */}
      <span className="settings-update-status">
        {state?.ultimoChequeoMs == null && isDev
          ? t.sinFeed
          : textoUltimoChequeo(state?.ultimoChequeoMs ?? null, ahora)}
      </span>
    </div>
  )
}

function BotonDescartar({ u }: { u: UpdateAjustes }): React.JSX.Element | null {
  const { state, descartar } = u
  const fallo = state?.avisoFallo ?? null
  if (!fallo && !state?.avisoAplicada) return null
  const t = txBloquesUpdate().update
  return (
    <button
      className="btn btn-ghost"
      onClick={() => descartar(fallo ? 'fallo' : 'aplicada')}
      title={fallo ? t.descartarFallo : t.descartarAviso}
    >
      {fallo ? t.descartar : t.entendido}
    </button>
  )
}

function BotonPrincipal({ u }: { u: UpdateAjustes }): React.JSX.Element {
  const { state, status, busy, check, install } = u
  const t = txBloquesUpdate().update
  if (status === 'ready') {
    return (
      <button className="btn primary" onClick={install} title={t.instalarTitulo}>
        {t.reiniciarInstalar}
      </button>
    )
  }
  if (status === 'available') {
    // Aquí no hay instalador que lanzar: el botón abre la descarga y la app sigue tal cual.
    return (
      <button className="btn primary" onClick={install} title={t.descargarTitulo}>
        {t.descargar(state?.newVersion ?? '').trim()}
      </button>
    )
  }
  return (
    <button className="btn btn-ghost" onClick={check} disabled={busy}>
      {status === 'error' ? t.reintentar : t.buscar}
    </button>
  )
}

function AccionesUpdate({ u }: { u: UpdateAjustes }): React.JSX.Element {
  const { status, busy, isDev, check, devPreview } = u
  const t = txBloquesUpdate().update
  return (
    <div className="settings-update-actions">
      <BotonDescartar u={u} />
      <BotonPrincipal u={u} />
      {/* En `available` comprobar sigue teniendo sentido: quizá ya hay una versión más
          nueva que la anunciada. En `ready`, `check()` sale temprano. */}
      {status === 'available' ? (
        <button className="btn btn-ghost" onClick={check} disabled={busy}>
          {t.buscar}
        </button>
      ) : null}
      {isDev ? (
        <select
          className="settings-update-escena"
          aria-label={t.estadoSimulado}
          defaultValue="ciclo"
          onChange={(e) => devPreview(e.target.value as Escena)}
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
export function BloqueUpdate(): React.JSX.Element {
  const u = useUpdateAjustes()
  const statusLine = lineaEstadoUpdate({
    state: u.state,
    status: u.status,
    version: u.version,
    isDev: u.isDev
  })
  return (
    <div className="settings-update">
      <InfoUpdate u={u} statusLine={statusLine} />
      <AccionesUpdate u={u} />
    </div>
  )
}
