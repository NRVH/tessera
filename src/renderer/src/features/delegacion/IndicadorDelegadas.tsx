// =============================================================================
// Indicador compacto y detalle desplazable; la selección y las operaciones viven en el hook y store.
// Los diálogos y el popover salen a una capa sin recorte; el chip conserva su sitio al confirmar.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import './delegacion.css'
import { createPortal } from 'react-dom'
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { PopoverBarra } from '../../comun/PopoverBarra'
import { Presente } from '../../comun/Presente'
import { ID_CAPA_FLOTANTE } from '../../comun/capaFlotante'
import type { UsoCuentaTarea } from '../agentes'
import { useIndicadorDelegadas } from './useIndicadorDelegadas'

function Estado({ estado }: { estado: 'vacio' | 'fallo' | 'marcha' | 'hecha' }): React.JSX.Element {
  if (estado === 'marcha') return <span className="modal-girando" aria-hidden="true" />
  if (estado === 'fallo') return <span aria-hidden="true">⚠</span>
  return (
    <span className="boton-guardar ok delegadas-confirmacion" aria-hidden="true">
      <span className="boton-guardar-capa exito">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path className="boton-guardar-palomita" d="M3 8.5l3.2 3L13 4.5" pathLength={1} />
        </svg>
      </span>
    </span>
  )
}

/** `UsoCuenta` llega por prop: la pieza es de los agentes, que a su vez pintan este indicador. */
export function IndicadorDelegadas({ origenes, UsoCuenta }: { origenes: readonly string[]; UsoCuenta: typeof UsoCuentaTarea }): React.JSX.Element {
  const m = useIndicadorDelegadas(origenes)
  const t = m.textos
  return (
    <>
      <Presente visible={m.visible} className="delegadas-presencia mov-aparece">
        <div ref={m.envoltura} className={`delegadas-chip delegadas-${m.estado}`} onDoubleClick={(e) => e.stopPropagation()}>
          <button ref={m.boton} type="button" className="delegadas-abrir" title={m.titulo} aria-label={m.titulo} aria-haspopup="dialog" aria-expanded={m.vista.abierto} onClick={m.alternar}>
            <Estado estado={m.estado} />
            <span className="delegadas-etiqueta">{m.etiqueta}</span>
            {m.tiempo && <span className="delegadas-tiempo">{m.tiempo}</span>}
            {!m.unica && <span aria-hidden="true">▾</span>}
          </button>
          {m.unica?.estado === 'en-marcha' && <button type="button" className="delegadas-cancelar" title={m.cancelandoUnica ? t.cancelando : t.cancelar} aria-label={m.cancelandoUnica ? t.cancelando : t.cancelar} disabled={m.cancelandoUnica} onClick={() => m.pedirCancelacion(m.unica!)}>✕</button>}
          {m.vista.abierto && m.visible && createPortal(
            <div ref={m.panel} className="delegadas-ancla" style={{ right: m.vista.derecha, ...(m.vista.arriba ? { bottom: m.vista.borde } : { top: m.vista.borde }) }}>
              <PopoverBarra etiqueta={t.titulo} clase="delegadas-pop">
                <div className="delegadas-lista">
                  {m.filas.map((f) => (
                    <section key={f.tarea.id} className={`delegadas-fila mov-aparece${f.fallo ? ' delegadas-fallo' : ''}`} data-saliendo={f.saliendo ? '' : undefined} aria-hidden={f.saliendo || undefined}>
                      <div className="delegadas-fila-cabecera" title={f.titulo}>
                        <Estado estado={f.estado} />
                        <strong className="delegadas-resumen">{f.tarea.resumen}</strong>
                        <span className="delegadas-tiempo">{f.tiempo}</span>
                        {f.cancelable && <button type="button" className="delegadas-cancelar" title={f.cancelando ? t.cancelando : t.cancelar} aria-label={f.cancelando ? t.cancelando : t.cancelar} disabled={f.saliendo || f.cancelando} onClick={() => m.pedirCancelacion(f.tarea)}>✕</button>}
                      </div>
                      <UsoCuenta perfilId={f.tarea.profileId} agente={f.tarea.agente} cuentaId={f.tarea.accountId} nombre={`${t.agentes[f.tarea.agente]} · ${f.tarea.cuenta}`} />
                      {f.fallo && <>
                        <p>{f.motivo}</p>
                        {f.tarea.detalle && <p>{f.tarea.detalle}</p>}
                        {/* El detalle suele ser la última línea de la actividad: no se repite. */}
                        {f.tarea.actividad.some((l) => l !== f.tarea.detalle) && (
                          <pre className="delegadas-actividad">{f.tarea.actividad.filter((l) => l !== f.tarea.detalle).join('\n')}</pre>
                        )}
                      </>}
                      {f.error && <p role="alert">{f.error}</p>}
                      {f.falloCancelar && <p role="alert">{f.falloCancelar}</p>}
                      {f.descartable && <button type="button" className="delegadas-descartar" disabled={f.saliendo} onClick={() => m.descartar(f.tarea.id)}>{t.descartar}</button>}
                    </section>
                  ))}
                </div>
              </PopoverBarra>
            </div>,
            document.getElementById(ID_CAPA_FLOTANTE) ?? document.body
          )}
          <span className="solo-lectores" role="status">{m.anuncio}</span>
        </div>
      </Presente>
      {m.vista.cancelar && createPortal(
        <DialogoConfirmar titulo={t.cancelarPregunta(m.vista.cancelar.cuenta)} mensaje={t.confirmar(m.vista.cancelar.cuenta)} etiquetaConfirmar={t.cancelar} etiquetaCancelar={t.mantener} peligro severidad="advertencia" onConfirmar={m.confirmar} onCancelar={m.mantener} />,
        document.getElementById(ID_CAPA_FLOTANTE) ?? document.body
      )}
    </>
  )
}
