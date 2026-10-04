// =============================================================================
// Consultas de las sesiones nativas (para el botón de actualizar los agentes del equipo)
// y adjuntos: un archivo arrastrado o la imagen del portapapeles se copian al contenedor
// de la sesión, porque el CLI de dentro no puede leer rutas del host; en nativo se usa
// la ruta del host tal cual.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agente, Profile } from '../../profiles/types'
import type { SesionNativa } from '../../../shared/agentes-nativos-ipc'
import type { NucleoAgente, OpenAgentSession } from './tipos'

/** Tope de un archivo arrastrado para copiar al contenedor. */
const MAX_STAGE_BYTES = 64 * 1024 * 1024

/** Sesiones nativas con el proceso vivo; `atrasada` la decide el servicio de los nativos. */
export function sesionesNativas(n: NucleoAgente): Array<Omit<SesionNativa, 'atrasada'>> {
  const out: Array<Omit<SesionNativa, 'atrasada'>> = []
  for (const s of n.sessions.values()) {
    if (!s.host || !n.terminals.estaViva(s.sessionId)) continue
    out.push({
      sessionId: s.sessionId,
      profileId: s.profileId,
      projectHostPath: s.projectHostPath,
      agente: s.agente,
      versionLanzada: s.versionLanzada,
      trabajando: s.activity.state() === 'working',
      esperandoRespuesta: s.activity.esperandoRespuesta(),
      puedeTenerTextoSinEnviar: s.detectorEnvio.puedeTenerTextoSinEnviar()
    })
  }
  return out
}

/**
 * Pids de los ptys de las sesiones nativas de UN agente: instalar un agente solo para
 * las suyas, así que un proceso colgado de la sesión de otro agente bloquea como ajeno.
 */
export function pidsNativos(n: NucleoAgente, agente: Agente): number[] {
  const out: number[] = []
  for (const s of n.sessions.values()) {
    if (!s.host || s.agente !== agente) continue
    const pid = n.terminals.pidDe(s.sessionId)
    if (pid !== null) out.push(pid)
  }
  return out
}

function sesionYPerfil(n: NucleoAgente, sessionId: string): { open: OpenAgentSession; profile: Profile } {
  const open = n.sessions.get(sessionId)
  if (!open) throw new Error(`No existe una sesión de agente con id "${sessionId}".`)
  const profile = n.profiles.get(open.profileId)
  if (!profile) throw new Error(`Perfil desconocido: "${open.profileId}".`)
  return { open, profile }
}

/** Ruta en el contenedor (o en el host, en nativo) de un archivo del host; null si no vale. */
export async function stageFile(n: NucleoAgente, sessionId: string, hostPath: string): Promise<string | null> {
  const { open, profile } = sesionYPerfil(n, sessionId)
  let st
  try {
    st = await stat(hostPath)
  } catch {
    return null // inaccesible: el renderer inyecta la ruta cruda
  }
  if (!st.isFile() || st.size > MAX_STAGE_BYTES) return null
  if (open.host) return hostPath
  const bytes = await readFile(hostPath)
  const containerPath = await n.sandbox.writeFileToContainer(profile, bytes, basename(hostPath), Date.now())
  n.log(`stageFile OK -> ${containerPath} (perfil=${profile.id}, ${bytes.length} bytes)`)
  return containerPath
}

/** Vuelca la imagen del portapapeles para la sesión y devuelve su ruta; null si no hay imagen. */
export async function saveImage(n: NucleoAgente, sessionId: string): Promise<string | null> {
  const { open, profile } = sesionYPerfil(n, sessionId)
  const png = n.portapapeles.leerPng()
  if (png === null) return null
  if (open.host) {
    const hostPath = join(tmpdir(), `tessera-clip-${Date.now()}.png`)
    await writeFile(hostPath, png)
    n.log(`saveImage [NATIVO] OK -> ${hostPath} (${png.length} bytes)`)
    return hostPath
  }
  const containerPath = await n.sandbox.writeFileToContainer(profile, png, `clip-${Date.now()}.png`, Date.now())
  n.log(`saveImage OK -> ${containerPath} (perfil=${profile.id}, ${png.length} bytes)`)
  return containerPath
}
