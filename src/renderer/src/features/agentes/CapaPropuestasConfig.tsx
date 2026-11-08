// =============================================================================
// Las propuestas de configuración que dejan los agentes con `tctx config proponer`, en la raíz de la ventana:
// pide las pendientes al montar (en `storePropuestasConfig`), avisa de cada una con «Revisar» y pinta su revisión: el archivo actual del
// nivel frente al propuesto, con el motivo, y Aceptar o Descartar. Aceptar la escribe en su nivel; si falla,
// lo dice y la propuesta sigue pendiente.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================
import '../../comun/formularioModal.css'
import './configAgente.css'
import { useEffect, useState } from 'react'
import { capaDePropuesta, type PropuestaConfig } from '../../../../shared/configAgente-ipc'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { notify } from '../../comun/notifications'
import { AvisoModal, Modal, PieModal } from '../../comun/Modal'
import { DiffReglas, useStorePestanas } from '../pestanas'
import { cerrarPropuestaConfig, refrescarPropuestasConfig, revisarPropuestaConfig, useStorePropuestasConfig } from './storePropuestasConfig.ts'
import { txConfigAgente } from './textosConfigAgente.ts'

const NOMBRE_AGENTE: Record<PropuestaConfig['agente'], string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

/** El archivo actual del nivel de la propuesta, o null mientras se lee. */
function useActual(p: PropuestaConfig): string | null {
  const [actual, setActual] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    window.tessera.configAgente
      .leer({ agente: p.agente, accountId: null, capa: capaDePropuesta(p) })
      .then((l) => vivo && setActual(l?.archivos[p.tipo].contenido ?? ''))
      .catch(() => vivo && setActual(''))
    return () => {
      vivo = false
    }
  }, [p])
  return actual
}

function RevisionPropuesta({ p, nombrePerfil, onCerrar }: { p: PropuestaConfig; nombrePerfil: string; onCerrar: () => void }): React.JSX.Element {
  const t = txConfigAgente()
  const actual = useActual(p)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const resolver = (aceptar: boolean): void => {
    setOcupado(true)
    setError(null)
    window.tessera.configAgente
      .resolverPropuesta(p.id, aceptar)
      .then((r) => {
        if (aceptar && r === null) return setError(t.propuestaRetirada)
        if (r && r.estado !== 'guardado') return setError(t.propuestaNoAplicada)
        onCerrar()
      })
      .catch((err: unknown) => setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err))))
      .finally(() => setOcupado(false))
  }
  const nivel = p.nivel === 'global' ? t.nivelBase : t.nivelPerfil(nombrePerfil)
  return (
    <Modal titulo={t.propuestaTitulo(NOMBRE_AGENTE[p.agente], nivel)} subtitulo={t.propuestaAyuda(p.nivel === 'global', nombrePerfil, p.proyecto ?? null)}
      tamano="xl" className="db-conexion-modal config-agente-modal"
      onCerrar={onCerrar} cerrable={!ocupado} cierraConVelo={false} ocupado={ocupado}
      pie={<PieModal auxiliares={<button type="button" className="btn danger" disabled={ocupado} onClick={() => resolver(false)}>{t.propuestaDescartar}</button>}>
        <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onCerrar}>{t.cancelar}</button>
        <button type="button" className="btn primary" disabled={ocupado || actual === null} onClick={() => resolver(true)}>{t.propuestaAceptar}</button>
      </PieModal>}>
      {p.motivo && <AvisoModal tono="info">{t.propuestaMotivo(p.motivo)}</AvisoModal>}
      <p className="config-agente-ruta">{t.propuestaComparacion(t.configuracion)}</p>
      {actual === null ? <p className="dbc-ayuda">{t.cargando}</p> : <DiffReglas original={actual} modificado={p.texto} />}
      {error && <AvisoModal tono="error">{error}</AvisoModal>}
    </Modal>
  )
}

/** Avisa de las propuestas que llegan y de las pendientes al montar, y pinta la que se revisa. */
export function CapaPropuestasConfig(): React.JSX.Element | null {
  const abierta = useStorePropuestasConfig((s) => s.abierta)
  const perfiles = useStorePestanas((s) => s.tabs.profiles)
  useEffect(() => {
    const avisar = (p: PropuestaConfig): void => {
      const t = txConfigAgente()
      const nivel = p.nivel === 'global' ? t.nivelBase : t.nivelPerfil(useStorePestanas.getState().tabs.profiles.find((x) => x.id === p.profileId)?.nombre ?? p.profileId)
      notify('info', t.propuestaAviso(NOMBRE_AGENTE[p.agente], nivel), undefined, { accion: { etiqueta: t.propuestaRevisar, onClick: () => revisarPropuestaConfig(p) } })
    }
    const quitar = window.tessera.configAgente.onPropuesta((p) => {
      avisar(p)
      void refrescarPropuestasConfig().catch(() => undefined)
    })
    void refrescarPropuestasConfig()
      .then((lista) => lista.forEach(avisar))
      .catch(() => undefined)
    return quitar
  }, [])
  if (!abierta) return null
  const nombrePerfil = perfiles.find((x) => x.id === abierta.profileId)?.nombre ?? abierta.profileId
  return <RevisionPropuesta p={abierta} nombrePerfil={nombrePerfil} onCerrar={cerrarPropuestaConfig} />
}
