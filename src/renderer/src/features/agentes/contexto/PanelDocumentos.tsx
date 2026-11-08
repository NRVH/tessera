// =============================================================================
// Las carpetas de documentos de referencia de un nivel del contexto: añadir con el diálogo del sistema, quitar y,
// por cada una, si existe en este equipo y cuántos documentos tiene. Cada cambio se guarda al momento: no hay
// texto a medias que perder.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import '../configAgente.css'
import { useEffect, useState } from 'react'
import { MAX_CARPETAS_DOCUMENTOS } from '../../../../../shared/documentosPerfil'
import type { ResumenCarpetaDocumentos } from '../../../../../shared/documentos-ipc'
import { normalizarErrorIpc } from '../../../../../shared/dockerErrors'
import { txContexto } from './textosContexto.ts'

/** El nombre de la carpeta, sin la ruta: la ruta va debajo, más tenue. */
const nombreDe = (ruta: string): string => ruta.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ruta

function useResumen(carpetas: readonly string[]): ResumenCarpetaDocumentos[] {
  const [resumen, setResumen] = useState<ResumenCarpetaDocumentos[]>([])
  useEffect(() => {
    let cancelado = false
    window.tessera.documentosPerfil
      .resumen([...carpetas])
      .then((r) => !cancelado && setResumen(r))
      .catch(() => !cancelado && setResumen([]))
    return () => {
      cancelado = true
    }
  }, [carpetas])
  return resumen
}

function Fila(p: { carpeta: string; resumen: ResumenCarpetaDocumentos | undefined; onQuitar: () => void }): React.JSX.Element {
  const t = txContexto()
  const estado = p.resumen === undefined ? t.docsLeyendo : p.resumen.existe ? t.docsCuenta(p.resumen.documentos) : t.docsNoDisponible
  return (
    <li className="gestion-config-fila">
      <span className="gestion-config-nombre">
        <span className="gestion-config-identidad">
          {nombreDe(p.carpeta)}
          <span className={p.resumen && !p.resumen.existe ? 'gestion-config-cuenta config-agente-error' : 'gestion-config-cuenta'}>{estado}</span>
        </span>
        <code className="gestion-config-archivos">{p.carpeta}</code>
      </span>
      <button type="button" className="btn" aria-label={t.docsQuitarDe(nombreDe(p.carpeta))} onClick={p.onQuitar}>
        {t.docsQuitar}
      </button>
    </li>
  )
}

export function PanelDocumentos({ carpetas, onGuardar }: { carpetas: readonly string[]; onGuardar: (lista: string[]) => Promise<void> }): React.JSX.Element {
  const t = txContexto()
  const resumen = useResumen(carpetas)
  const [error, setError] = useState<string | null>(null)
  const lleno = carpetas.length >= MAX_CARPETAS_DOCUMENTOS
  const detalle = (err: unknown): string => normalizarErrorIpc(err instanceof Error ? err.message : String(err))
  // Si no se guarda, la lista sigue como estaba y se dice por qué.
  const guardar = (lista: string[]): void => {
    setError(null)
    onGuardar(lista).catch((err: unknown) => setError(t.docsErrorGuardar(detalle(err))))
  }
  const anadir = (): void => {
    setError(null)
    window.tessera.documentosPerfil
      .elegirCarpeta()
      .then((ruta) => {
        if (ruta) guardar([...carpetas, ruta])
      })
      .catch((err: unknown) => setError(t.docsErrorElegir(detalle(err))))
  }
  return (
    <div className="contexto-panel">
      <p className="dbc-ayuda">{t.documentosAyuda}</p>
      <section className="gestion-config-tarjeta">
        {carpetas.length === 0 ? (
          <p className="ajustes-fila-ayuda gestion-config-nota">{t.docsSinCarpetas}</p>
        ) : (
          <ul className="gestion-config-lista">
            {carpetas.map((c) => (
              <Fila key={c} carpeta={c} resumen={resumen.find((r) => r.carpeta === c)} onQuitar={() => guardar(carpetas.filter((x) => x !== c))} />
            ))}
          </ul>
        )}
      </section>
      <div className="contexto-pie">
        <button type="button" className="btn" disabled={lleno} title={lleno ? t.docsTope(MAX_CARPETAS_DOCUMENTOS) : undefined} onClick={anadir}>
          {t.docsAnadir}
        </button>
      </div>
      {error && (
        <p className="config-agente-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
