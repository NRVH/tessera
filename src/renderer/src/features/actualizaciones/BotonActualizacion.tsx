// =============================================================================
// Botón de actualización de la barra de título: siempre visible, del mismo material
// que el engranaje (`.titlebar-btn`); el color existe solo en un punto de 5 px y la
// etiqueta se despliega al pasar el ratón con el mecanismo de `.boton-reinicio-etiqueta`.
// Qué pintar lo decide `vistaActualizacion.ts` (puro); los efectos, `useBotonActualizacion.ts`.
// Los avisos terminales no se auto-cierran por temporizador y este componente no lee la
// plataforma. Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { useRef, useState } from 'react'
import type { EstadoActualizacion } from '../../../../shared/update-ipc'
import { useAhora } from '../../comun/useAhora'
import { useCerrarFueraOEscape } from '../../comun/usePopoverBarra'
import { glifo } from './iconosActualizacion'
import { Popover } from './PopoverActualizacion'
import { txActualizaciones } from './textos.ts'
import { TICK_ULTIMO_CHEQUEO_MS } from './textoActualizacion'
import { useCerrarSinContenido, useDescartarAlCerrar, useEstadoActualizacion } from './useBotonActualizacion'
import { decidirVistaActualizacion, tieneContenido, type VistaActualizacion } from './vistaActualizacion'

/** Las noticias que el usuario debe llegar a leer se anuncian también por voz; el resto es ruido. */
function AnunciosActualizacion({ estado }: { estado: EstadoActualizacion }): React.JSX.Element {
  const t = txActualizaciones().anuncios
  return (
    <span className="solo-lectores" aria-live="polite">
      {estado.avisoAplicada ? t.actualizada(estado.avisoAplicada.hasta) : ''}
      {estado.fase === 'ready' ? t.preparada(estado.newVersion) : ''}
      {estado.fase === 'available' ? t.disponible(estado.newVersion ?? t.nueva) : ''}
    </span>
  )
}

function BotonBarra({
  estado,
  vista,
  abierto,
  onClic
}: {
  estado: EstadoActualizacion
  vista: VistaActualizacion
  abierto: boolean
  onClic: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`titlebar-btn boton-actualizacion tono-${vista.tono}${abierto ? ' active' : ''}`}
      onClick={onClic}
      disabled={vista.deshabilitado}
      title={vista.titulo}
      aria-label={vista.titulo}
      aria-busy={estado.fase === 'checking' || estado.fase === 'downloading' || estado.fase === 'installing'}
      aria-expanded={vista.accion === 'abrir' ? abierto : undefined}
    >
      {/* El punto se ancla al GLIFO, no al botón: anclado al botón, al desplegarse la
          etiqueta el borde derecho se va con ella y el punto acaba encima de la última letra. */}
      <span className="boton-actualizacion-glifo">
        {glifo(vista.icono, estado.percent)}
        {vista.punto ? <span className="boton-actualizacion-punto" aria-hidden="true" /> : null}
      </span>
      <span className="boton-reinicio-etiqueta">
        <span>{vista.etiqueta}</span>
      </span>
    </button>
  )
}

export function BotonActualizacion(): React.JSX.Element | null {
  const estado = useEstadoActualizacion()
  const [abierto, setAbierto] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const envolturaRef = useRef<HTMLDivElement>(null)
  const ahora = useAhora(TICK_ULTIMO_CHEQUEO_MS, abierto)
  const hayContenido = tieneContenido(estado)
  useCerrarSinContenido(hayContenido, setAbierto)
  useCerrarFueraOEscape(abierto, setAbierto, envolturaRef)
  useDescartarAlCerrar(abierto, estado)

  if (!estado || estado.fase === 'disabled') return null
  const vista = decidirVistaActualizacion(estado)

  const alPulsar = (): void => {
    if (vista.accion === 'instalar') void window.tessera.actualizacion.instalar()
    else if (vista.accion === 'comprobar') void window.tessera.actualizacion.comprobar()
    else if (vista.accion === 'abrir') setAbierto((v) => !v)
  }

  return (
    <div className="boton-actualizacion-wrap" ref={envolturaRef}>
      <BotonBarra estado={estado} vista={vista} abierto={abierto} onClic={alPulsar} />
      <AnunciosActualizacion estado={estado} />

      {abierto && hayContenido ? (
        <Popover
          estado={estado}
          ahora={ahora}
          copiado={copiado}
          setCopiado={setCopiado}
          cerrar={() => setAbierto(false)}
        />
      ) : null}
    </div>
  )
}
