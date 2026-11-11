// =============================================================================
// Lectura de las cuentas del perfil para «Uso de las cuentas»: la nativa y las de Docker (privadas y globales) de cada
// agente de serie. Solo lee con la lista abierta y conserva la última lectura; cada cuenta puede fallar sin invalidar
// las demás y una lectura vencida no se publica. Los metadatos de las fijadas se leen también con la lista cerrada.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useEffect, useState } from 'react'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { CuentaFijada } from '../../../../shared/workspace-state-ipc'
import { HOST_ACCOUNT_ID } from './agentPaneTipos'
import { AGENTES_CON_USO, type CuentaUso } from './modeloUsoCuentas'

const RELECTURA_MS = 30_000

type Agente = CuentaFijada['agente']
const NINGUNO: ReadonlySet<Agente> = new Set()

/**
 * Las cuentas del perfil con su uso, mientras `abierta`. `agentesLeidos` son los agentes cuya lista de cuentas de Docker
 * llegó: de los demás no se sabe qué cuentas existen.
 */
export function useLecturaCuentas(profileId: string | null, abierta: boolean): { cuentas: CuentaUso[]; leido: boolean; agentesLeidos: ReadonlySet<Agente> } {
  const [lectura, ponerLectura] = useState<{ perfil: string; cuentas: CuentaUso[]; agentesLeidos: ReadonlySet<Agente> } | null>(null)
  useEffect(() => {
    if (!abierta || !profileId) return
    let vigente = true
    let turno = 0
    const leer = async (): Promise<void> => {
      const numero = ++turno
      const grupos = await Promise.all(AGENTES_CON_USO.map(async (agente) => {
        const [nativa, docker] = await Promise.all([
          window.tessera.usage.get({ agente, accountId: HOST_ACCOUNT_ID, mode: 'host' }).catch(() => null),
          window.tessera.agentAccounts.list({ profileId, agente }).catch(() => null)
        ])
        const filas = await Promise.all((docker ?? []).map(async (cuenta): Promise<CuentaUso> => ({
          agente, accountId: cuenta.id, cuenta,
          snap: cuenta.conSesion === false ? null : await window.tessera.usage.get({ agente, accountId: cuenta.id, mode: 'container' }).catch(() => null)
        })))
        return { agente, leida: docker !== null, cuentas: [{ agente, accountId: null, cuenta: null, snap: nativa }, ...filas] as CuentaUso[] }
      }))
      if (!vigente || numero !== turno) return
      ponerLectura({ perfil: profileId, cuentas: grupos.flatMap((g) => g.cuentas), agentesLeidos: new Set(grupos.filter((g) => g.leida).map((g) => g.agente)) })
    }
    void leer()
    const intervalo = setInterval(() => void leer(), RELECTURA_MS)
    return () => { vigente = false; clearInterval(intervalo) }
  }, [profileId, abierta])
  const actual = !!profileId && lectura?.perfil === profileId
  return { cuentas: actual ? lectura.cuentas : [], leido: actual, agentesLeidos: actual ? lectura.agentesLeidos : NINGUNO }
}

/**
 * Una cuenta de Docker con su uso, releída cada `RELECTURA_MS` mientras se monta quien la enseña; null hasta la primera
 * lectura. Si la cuenta ya no está en la lista (borrada), se enseña sin sus metadatos.
 */
export function useUsoDeCuenta(profileId: string, agente: Agente, accountId: string): CuentaUso | null {
  const [lectura, ponerLectura] = useState<CuentaUso | null>(null)
  useEffect(() => {
    let vigente = true
    let turno = 0
    const leer = async (): Promise<void> => {
      const numero = ++turno
      const [lista, snap] = await Promise.all([
        window.tessera.agentAccounts.list({ profileId, agente }).catch(() => null),
        window.tessera.usage.get({ agente, accountId, mode: 'container' }).catch(() => null)
      ])
      if (vigente && numero === turno) ponerLectura({ agente, accountId, cuenta: lista?.find((c) => c.id === accountId) ?? null, snap })
    }
    void leer()
    const intervalo = setInterval(() => void leer(), RELECTURA_MS)
    return () => { vigente = false; clearInterval(intervalo) }
  }, [profileId, agente, accountId])
  return lectura?.accountId === accountId && lectura.agente === agente ? lectura : null
}

/**
 * Las cuentas de Docker de los agentes que tienen alguna fijada de Docker: su nombre y si tienen sesión, o null mientras
 * no se sepa. Se releen al cambiar las fijadas y al abrir o cerrar la lista, donde se crean, renombran o borran. Mientras
 * llega una relectura, o si falla, vale la anterior del mismo perfil: una cápsula no desaparece por no saber.
 */
export function useCuentasDeFijadas(profileId: string | null, fijadas: readonly CuentaFijada[], abierta: boolean): AgentAccount[] | null {
  const agentes = [...new Set(fijadas.filter((f) => f.accountId !== null).map((f) => f.agente))].sort().join('|')
  const [lectura, ponerLectura] = useState<{ perfil: string; cuentas: AgentAccount[] } | null>(null)
  useEffect(() => {
    if (!profileId || !agentes) return
    let vigente = true
    void Promise.all(agentes.split('|').map((agente) => window.tessera.agentAccounts.list({ profileId, agente: agente as Agente })))
      .then((listas) => { if (vigente) ponerLectura({ perfil: profileId, cuentas: listas.flat() }) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [profileId, agentes, abierta])
  return lectura?.perfil === profileId ? lectura.cuentas : null
}
