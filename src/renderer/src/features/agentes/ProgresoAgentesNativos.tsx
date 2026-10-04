// =============================================================================
// Bloques del popover de los agentes nativos durante la ejecución (pasos y salida
// de la instalación) y al terminar (resumen pegajoso con «Descartar»).
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import { useEffect, useRef } from 'react'
import type { InstalarResultado } from '../../../../shared/agentes-nativos-ipc'
import type { NombresSistema } from '../../../../shared/nombresSistema'
import { ETIQUETA_AGENTE } from './actualizacionNativa'
import { ordenar, textoEvento, textoSesion, type InfoSesionesAgentes, type PasoTexto } from './sesionesPopoverAgentes'
import type { UseActualizacionNativa } from './useActualizacionNativa'
import { sesiones } from './vistaBotonAgentes'

function Salida({ lineas }: { lineas: string[] }): React.JSX.Element | null {
  const preRef = useRef<HTMLPreElement>(null)
  // Pegada al final mientras llegan líneas.
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [lineas])
  if (lineas.length === 0) return null
  return (
    <details className="agentes-nativos-salida">
      <summary>{`Salida (${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'})`}</summary>
      <pre ref={preRef} className="actualizacion-pop-detalle">
        {lineas.join('\n')}
      </pre>
    </details>
  )
}

/** Los pasos de la ejecución en curso y la salida de la instalación. */
export function BloqueProgreso({
  act,
  info,
  nombres
}: {
  act: UseActualizacionNativa
  info: InfoSesionesAgentes
  nombres: NombresSistema
}): React.JSX.Element {
  const pasos = act.eventos
    .map((ev) => textoEvento(ev, info))
    .filter((p): p is PasoTexto => p !== null)
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">
        {act.forzadoEnCurso ? 'Reiniciando' : 'Actualizando'} los agentes de {nombres.tuEquipo}
      </div>
      <ol className="agentes-nativos-pasos" aria-live="polite">
        {pasos.map((p, i) => (
          <li key={i} className={p.tono ? `tono-${p.tono}` : undefined}>
            {p.texto}
          </li>
        ))}
      </ol>
      <Salida lineas={act.salida} />
      <div className="actualizacion-pop-msg agentes-nativos-aviso">
        No cierres Tessera hasta que termine: puede haber sesiones detenidas esperando a volver.
      </div>
    </section>
  )
}

function BotonDescartar({ act }: { act: UseActualizacionNativa }): React.JSX.Element {
  return (
    <div className="actualizacion-pop-acciones">
      <button type="button" className="btn" onClick={act.descartar}>
        Descartar
      </button>
    </div>
  )
}

/** La compuerta paró antes de tocar nada: no es un fallo, es un «ahora no». */
function ResumenAbortado({ act, motivo }: { act: UseActualizacionNativa; motivo: string }): React.JSX.Element {
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">No se hizo nada</div>
      <div className="actualizacion-pop-msg">{motivo}.</div>
      <BotonDescartar act={act} />
    </section>
  )
}

function InstalacionesResumen({ instalaciones }: { instalaciones: InstalarResultado[] }): React.JSX.Element {
  return (
    <>
      {instalaciones.map((i) => (
        <div key={i.agente} className="actualizacion-pop-versiones">
          <span className="agentes-nativos-cli-nombre">{ETIQUETA_AGENTE[i.agente]}</span>
          <span>{i.antes ?? '—'}</span>
          <span className="actualizacion-pop-flecha" aria-hidden="true">
            →
          </span>
          {i.ok ? <strong>{i.despues ?? '—'}</strong> : <span className="agentes-nativos-error">no se pudo actualizar</span>}
        </div>
      ))}
      {instalaciones
        .filter((i) => !i.ok && i.detalle)
        .map((i) => (
          <div key={`d-${i.agente}`} className="actualizacion-pop-msg">
            {i.detalle}
          </div>
        ))}
    </>
  )
}

/** El resultado pegajoso de la última ejecución. */
export function BloqueResumen({ act, info }: { act: UseActualizacionNativa; info: InfoSesionesAgentes }): React.JSX.Element | null {
  const r = act.resumen
  if (!r) return null
  if (r.abortado !== null) return <ResumenAbortado act={act} motivo={r.abortado} />

  const relanzadas = r.sesiones.filter((s) => s.resultado === 'relanzada').length
  const problemas = ordenar(
    r.sesiones.filter((s) => s.resultado !== 'relanzada'),
    info
  )
  return (
    <section className="actualizacion-pop-bloque">
      <div className="actualizacion-pop-titulo">
        {r.ok ? (act.forzadoEnCurso ? 'Sesiones reiniciadas' : 'Agentes actualizados') : 'La actualización tuvo problemas'}
      </div>
      <InstalacionesResumen instalaciones={r.instalaciones} />
      <div className="actualizacion-pop-msg">
        {relanzadas === 0 ? 'No se reinició ninguna sesión.' : `${sesiones(relanzadas)} ${relanzadas === 1 ? 'reiniciada' : 'reiniciadas'}.`}
      </div>
      {problemas.length > 0 ? (
        <ul className="agentes-nativos-pasos">
          {problemas.map((s) => {
            const t = textoSesion(s, info)
            return (
              <li key={s.sessionId} className={t.tono ? `tono-${t.tono}` : undefined}>
                {t.texto}
              </li>
            )
          })}
        </ul>
      ) : null}
      <Salida lineas={act.salida} />
      <BotonDescartar act={act} />
    </section>
  )
}
