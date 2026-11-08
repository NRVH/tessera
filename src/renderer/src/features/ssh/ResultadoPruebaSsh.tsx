// =============================================================================
// El resultado de «Probar» una conexión SSH en su diálogo, en una región `status` que se anuncia sola:
// «Conectó en N ms» con la huella del servidor, o el motivo con una pista de qué mirar; con la huella
// cambiada (o con otro tipo de clave que el guardado), en rojo y con «Olvidar la huella guardada…». Los textos son de `pistasPruebaSsh` (puro);
// la plataforma llega por `window.tessera.plataforma`. Sin rutas: el main ya las quitó.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { useRef } from 'react'
import { Presente, Cruce } from '../../comun/Presente'
import type { SshResultadoPrueba } from '../../../../shared/ssh-ipc'
import { lineasHuella, textoResultadoPrueba } from './pistasPruebaSsh'
import { txFormularioSsh } from './textosFormulario.ts'

/** Lo que recibe el resultado. */
export interface PropsResultadoPruebaSsh {
  probando: boolean
  resultado: SshResultadoPrueba | null
  /** El host de la conexión probada: decide alguna pista (la red local). */
  host: string
  onOlvidarHuella: () => void
}

/** El resultado de «Probar», o nada si aún no se ha probado. */
function ContenidoResultadoPruebaSsh({ probando, resultado, host, onOlvidarHuella }: PropsResultadoPruebaSsh): React.JSX.Element | null {
  if (!probando && resultado === null) return null
  if (probando || resultado === null) {
    return (
      <div className="dbc-prueba ssh-prueba" role="status" aria-live="polite">
        {txFormularioSsh().probando}
      </div>
    )
  }
  const t = textoResultadoPrueba(resultado, host, window.tessera.plataforma)
  // Con otro tipo de clave que el guardado, el remedio es el mismo: olvidar la guardada para confirmar la nueva.
  const huellaCambiada =
    !resultado.ok && (resultado.motivo === 'ssh-huella-cambiada' || (resultado.motivo === 'ssh-huella-sin-confirmar' && resultado.huellas.length > 0))
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
            {txFormularioSsh().olvidarHuellaBoton}
          </button>
        </div>
      )}
    </div>
  )
}

export function ResultadoPruebaSsh(p: PropsResultadoPruebaSsh): React.JSX.Element {
  const ultimo = useRef(p)
  if (p.probando || p.resultado) ultimo.current = p
  const actual = ultimo.current
  return (
    <Presente visible={p.probando || p.resultado !== null} className="mov-despliega">
      <Cruce clave={actual.probando ? 'probando' : actual.resultado?.ok ? 'ok' : 'falla'}>
        <ContenidoResultadoPruebaSsh {...actual} />
      </Cruce>
    </Presente>
  )
}
