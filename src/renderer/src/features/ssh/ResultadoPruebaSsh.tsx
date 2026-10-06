// =============================================================================
// El resultado de «Probar» una conexión SSH en su diálogo, en una región `status` que se anuncia sola:
// «Conectó en N ms» con la huella del servidor, o el motivo con una pista de qué mirar; con la huella
// cambiada, en rojo y con «Olvidar la huella guardada…». Los textos son de `pistasPruebaSsh` (puro);
// la plataforma llega por `window.tessera.plataforma`. Sin rutas: el main ya las quitó.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import type { SshResultadoPrueba } from '../../../../shared/ssh-ipc'
import { lineasHuella, textoResultadoPrueba } from './pistasPruebaSsh'

/** Lo que recibe el resultado. */
export interface PropsResultadoPruebaSsh {
  probando: boolean
  resultado: SshResultadoPrueba | null
  /** El host de la conexión probada: decide alguna pista (la red local). */
  host: string
  onOlvidarHuella: () => void
}

/** El resultado de «Probar», o nada si aún no se ha probado. */
export function ResultadoPruebaSsh({ probando, resultado, host, onOlvidarHuella }: PropsResultadoPruebaSsh): React.JSX.Element | null {
  if (!probando && resultado === null) return null
  if (probando || resultado === null) {
    return (
      <div className="dbc-prueba ssh-prueba" role="status" aria-live="polite">
        Probando…
      </div>
    )
  }
  const t = textoResultadoPrueba(resultado, host, window.tessera.plataforma)
  const huellaCambiada = !resultado.ok && resultado.motivo === 'ssh-huella-cambiada'
  return (
    <div className={`dbc-prueba ssh-prueba ${resultado.ok ? 'ok' : 'falla'}`} role="status" aria-live="polite">
      <div className="dbc-prueba-linea">
        <span aria-hidden="true">{resultado.ok ? '✓' : '✗'}</span>
        <span className="dbc-prueba-mensaje">{t.titulo}</span>
      </div>
      {t.pista !== null && <div className="ssh-prueba-pista">{t.pista}</div>}
      {resultado.aviso !== undefined && <div className="ssh-prueba-pista">{resultado.aviso}</div>}
      {lineasHuella(resultado).map((linea) => (
        <div key={linea} className="dbc-prueba-servidor">
          {linea}
        </div>
      ))}
      {t.detalle !== null && <div className="dbc-prueba-servidor">{t.detalle}</div>}
      {huellaCambiada && (
        <div className="ssh-prueba-botones">
          <button type="button" className="btn danger" onClick={onOlvidarHuella}>
            Olvidar la huella guardada…
          </button>
        </div>
      )}
    </div>
  )
}
