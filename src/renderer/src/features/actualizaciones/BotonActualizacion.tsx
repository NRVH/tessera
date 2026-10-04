// =============================================================================
// Botón de actualización de la barra de título: siempre visible, del mismo material
// que el engranaje (`.titlebar-btn`); el color existe solo en un punto de 5 px y la
// etiqueta se despliega al pasar el ratón con el mecanismo de `.boton-reinicio-etiqueta`.
// Qué pintar lo decide `vistaUpdate.ts` (puro); los efectos, `useBotonActualizacion.ts`.
// Los avisos terminales no se auto-cierran por temporizador y este componente no lee la
// plataforma. Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { useRef, useState } from 'react'
import type { UpdateState } from '../../../../shared/update-ipc'
import { useAhora } from '../../comun/useAhora'
import { useCerrarFueraOEscape } from '../../comun/usePopoverBarra'
import { glifo } from './iconosUpdate'
import { Popover } from './PopoverActualizacion'
import { TICK_ULTIMO_CHEQUEO_MS } from './textoUpdate'
import { useCerrarSinContenido, useDescartarAlCerrar, useEstadoUpdate } from './useBotonActualizacion'
import { decidirVistaUpdate, tieneContenido, type VistaUpdate } from './vistaUpdate'

/** Las noticias que el usuario debe llegar a leer se anuncian también por voz; el resto es ruido. */
function AnunciosUpdate({ state }: { state: UpdateState }): React.JSX.Element {
  return (
    <span className="solo-lectores" aria-live="polite">
      {state.avisoAplicada ? `Tessera se actualizó a ${state.avisoAplicada.hasta}.` : ''}
      {state.status === 'ready' ? `La versión ${state.newVersion} está preparada.` : ''}
      {state.status === 'available'
        ? `La versión ${state.newVersion ?? 'nueva'} está disponible para descargar.`
        : ''}
    </span>
  )
}

function BotonBarra({
  state,
  vista,
  abierto,
  onClick
}: {
  state: UpdateState
  vista: VistaUpdate
  abierto: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`titlebar-btn boton-actualizacion tono-${vista.tono}${abierto ? ' active' : ''}`}
      onClick={onClick}
      disabled={vista.deshabilitado}
      title={vista.titulo}
      aria-label={vista.titulo}
      aria-busy={state.status === 'checking' || state.status === 'downloading' || state.status === 'installing'}
      aria-expanded={vista.accion === 'abrir' ? abierto : undefined}
    >
      {/* El punto se ancla al GLIFO, no al botón: anclado al botón, al desplegarse la
          etiqueta el borde derecho se va con ella y el punto acaba encima de la última letra. */}
      <span className="boton-actualizacion-glifo">
        {glifo(vista.icono, state.percent)}
        {vista.punto ? <span className="boton-actualizacion-punto" aria-hidden="true" /> : null}
      </span>
      <span className="boton-reinicio-etiqueta">
        <span>{vista.etiqueta}</span>
      </span>
    </button>
  )
}

export function BotonActualizacion(): React.JSX.Element | null {
  const state = useEstadoUpdate()
  const [abierto, setAbierto] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const ahora = useAhora(TICK_ULTIMO_CHEQUEO_MS, abierto)
  const hayContenido = tieneContenido(state)
  useCerrarSinContenido(hayContenido, setAbierto)
  useCerrarFueraOEscape(abierto, setAbierto, wrapRef)
  useDescartarAlCerrar(abierto, state)

  if (!state || state.status === 'disabled') return null
  const vista = decidirVistaUpdate(state)

  const alPulsar = (): void => {
    if (vista.accion === 'instalar') void window.tessera.update.install()
    else if (vista.accion === 'comprobar') void window.tessera.update.check()
    else if (vista.accion === 'abrir') setAbierto((v) => !v)
  }

  return (
    <div className="boton-actualizacion-wrap" ref={wrapRef}>
      <BotonBarra state={state} vista={vista} abierto={abierto} onClick={alPulsar} />
      <AnunciosUpdate state={state} />

      {abierto && hayContenido ? (
        <Popover
          state={state}
          ahora={ahora}
          copiado={copiado}
          setCopiado={setCopiado}
          cerrar={() => setAbierto(false)}
        />
      ) : null}
    </div>
  )
}
