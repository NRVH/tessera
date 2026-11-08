// =============================================================================
// Los niveles del contexto a la izquierda del diálogo: el global y cada perfil, que forman la cascada, y aparte,
// separados, los agentes en su equipo, que no la reciben. Las cuentas de Docker no están aquí: son un ámbito de la
// configuración de Docker de su perfil y se eligen en esa sección. La lista se desplaza dentro del diálogo.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import { useEffect, useState } from 'react'
import type { AgentAccount } from '../../../../../shared/agent-accounts-ipc'
import type { AgenteConConfig } from '../../../../../shared/configAgente-ipc'
import { useStorePestanas } from '../../pestanas'
import { IconoEquipo } from '../iconosAgentPane'
import { mismoNivel, nivelDelRiel, type NivelContexto } from './modeloContexto.ts'
import { txContexto } from './textosContexto.ts'

export const AGENTES_CONFIG: readonly { id: AgenteConConfig; nombre: string }[] = [
  { id: 'claude-code', nombre: 'Claude Code' },
  { id: 'codex', nombre: 'Codex' }
]

export const nombreAgente = (a: AgenteConConfig): string => AGENTES_CONFIG.find((x) => x.id === a)?.nombre ?? a

/** Las cuentas de Docker de Claude Code y Codex de un perfil, o `null` mientras se piden. */
export function useCuentasDelPerfil(profileId: string | null): AgentAccount[] | null {
  const [cuentas, setCuentas] = useState<AgentAccount[] | null>(null)
  useEffect(() => {
    if (profileId === null) {
      setCuentas([])
      return
    }
    let cancelado = false
    setCuentas(null)
    Promise.all(AGENTES_CONFIG.map((a) => window.tessera.agentAccounts.list({ profileId, agente: a.id })))
      .then((listas) => !cancelado && setCuentas(listas.flat()))
      .catch(() => !cancelado && setCuentas([]))
    return () => {
      cancelado = true
    }
  }, [profileId])
  return cuentas
}

function Item(p: { activo: boolean; icono?: React.ReactNode; texto: string; detalle?: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" role="tab" aria-selected={p.activo} className={`niveles-item${p.activo ? ' activo' : ''}`} title={p.texto} onClick={p.onClick}>
      {p.icono}
      <span className="niveles-texto">{p.texto}</span>
      {p.detalle && <span className="niveles-detalle">{p.detalle}</span>}
    </button>
  )
}

export function RielContexto(p: { nivel: NivelContexto; onElegir: (n: NivelContexto) => void }): React.JSX.Element {
  const t = txContexto()
  const perfiles = useStorePestanas((s) => s.tabs.profiles)
  const marcado = nivelDelRiel(p.nivel)
  return (
    <nav className="niveles contexto-riel" role="tablist" aria-orientation="vertical" aria-label={t.niveles}>
      <Item activo={marcado.tipo === 'global'} texto={t.global} detalle={t.globalDetalle} onClick={() => p.onElegir({ tipo: 'global' })} />
      <div className="niveles-grupo">{t.perfiles}</div>
      {perfiles.map((perfil) => (
        <Item
          key={perfil.id}
          activo={mismoNivel(marcado, { tipo: 'perfil', profileId: perfil.id })}
          icono={<span className="contexto-punto" style={{ background: perfil.color }} aria-hidden="true" />}
          texto={perfil.nombre}
          detalle={perfil.contextoGlobal === false ? t.sinGlobalCorto : undefined}
          onClick={() => p.onElegir({ tipo: 'perfil', profileId: perfil.id })}
        />
      ))}
      {/* Fuera de la cascada: se separa y se dice, para que no se lea como un nivel más del contexto. */}
      <div className="contexto-riel-equipo">
        <div className="niveles-grupo">{t.enSuEquipo}</div>
        {AGENTES_CONFIG.map((a) => (
          <Item key={a.id} activo={mismoNivel(marcado, { tipo: 'equipo', agente: a.id })} icono={<IconoEquipo />} texto={a.nombre} onClick={() => p.onElegir({ tipo: 'equipo', agente: a.id })} />
        ))}
        <p className="niveles-subtitulo contexto-riel-nota">{t.enSuEquipoNota}</p>
      </div>
    </nav>
  )
}
