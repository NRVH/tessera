// =============================================================================
// El apartado «Historial de conversaciones» del diálogo de exportar: desmarcado de serie; al marcarlo,
// cuántas conversaciones y cuánto ocupan por agente y cuenta de los perfiles elegidos, la casilla aparte
// del historial nativo de este equipo, el total y, por encima de 1 GiB, un aviso. La cuenta la hace el main.
// Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================
import { useEffect, useState } from 'react'
import { AVISO_HISTORIAL_BYTES, type FuenteHistorial } from '../../../../../shared/copia-configuracion-ipc'
import { formatoBytes } from '../../../util/formatoBytes'
import { Casilla } from './camposCopia'
import { detalleFuente, etiquetaFuente, totalHistorial } from './etiquetasHistorial'
import { txCopia } from './textosCopia.ts'

type Previa = { tipo: 'cargando' } | { tipo: 'lista'; fuentes: FuenteHistorial[] } | { tipo: 'error'; motivo: string }

/** La vista previa del historial, pedida de nuevo cada vez que cambian los perfiles o la casilla nativa. */
function usePreviaHistorial(activo: boolean, perfiles: readonly string[], nativo: boolean): Previa {
  const [previa, setPrevia] = useState<Previa>({ tipo: 'cargando' })
  const clave = perfiles.join('\n')
  useEffect(() => {
    if (!activo) return
    let vigente = true
    setPrevia({ tipo: 'cargando' })
    window.tessera.copiaConfiguracion
      .previaHistorial({ perfiles: clave === '' ? [] : clave.split('\n'), nativo })
      .then((fuentes) => vigente && setPrevia({ tipo: 'lista', fuentes }))
      .catch((e: unknown) => vigente && setPrevia({ tipo: 'error', motivo: e instanceof Error ? e.message : String(e) }))
    return () => {
      vigente = false
    }
  }, [activo, clave, nativo])
  return previa
}

function Lista({ fuentes, nombres }: { fuentes: FuenteHistorial[]; nombres: ReadonlyMap<string, string> }): React.JSX.Element {
  const t = txCopia().exportar
  if (fuentes.length === 0) return <p className="dbc-ayuda">{t.historialVacio}</p>
  const total = totalHistorial(fuentes)
  return (
    <>
      <ul className="copia-detalle" data-testid="copia-historial-previa">
        {fuentes.map((f) => (
          <li key={f.id}>
            {etiquetaFuente(f, f.perfil === null ? undefined : nombres.get(f.perfil))}: {detalleFuente(f)}
          </li>
        ))}
      </ul>
      <p className="dbc-ayuda">{t.historialTotal(total.conversaciones, formatoBytes(total.bytes))}</p>
      {total.bytes > AVISO_HISTORIAL_BYTES && <div className="dbc-error" role="note">{t.historialGrande(formatoBytes(total.bytes))}</div>}
    </>
  )
}

export interface PropsHistorialExportar {
  perfiles: ReadonlyArray<{ id: string; nombre: string }>
  elegidos: readonly string[]
  activo: boolean
  nativo: boolean
  sinFrase: boolean
  onActivo: () => void
  onNativo: () => void
}

export function HistorialExportar(p: PropsHistorialExportar): React.JSX.Element {
  const t = txCopia().exportar
  const elegidos = p.perfiles.filter((x) => p.elegidos.includes(x.id)).map((x) => x.id)
  const previa = usePreviaHistorial(p.activo, elegidos, p.nativo)
  const nombres = new Map(p.perfiles.map((x) => [x.id, x.nombre]))
  return (
    <fieldset className="copia-lista" aria-label={t.historial}>
      <Casilla etiqueta={t.historial} marcada={p.activo} onCambio={p.onActivo} />
      {p.activo && (
        <div className="copia-hijos">
          <p className="dbc-ayuda">{t.historialAyuda}</p>
          <Casilla etiqueta={t.historialNativo} marcada={p.nativo} onCambio={p.onNativo} />
          {previa.tipo === 'cargando' && <p className="dbc-ayuda">{t.historialCargando}</p>}
          {previa.tipo === 'error' && <div className="dbc-error">{t.historialNoSeLeyo(previa.motivo)}</div>}
          {previa.tipo === 'lista' && <Lista fuentes={previa.fuentes} nombres={nombres} />}
          {p.sinFrase && <div className="dbc-error" role="note">{t.historialSinFrase}</div>}
        </div>
      )}
    </fieldset>
  )
}
