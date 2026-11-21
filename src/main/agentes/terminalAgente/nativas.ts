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
import type { Agente, Perfil } from '../../perfiles/types'
import type { SesionNativa } from '../../../shared/agentes-nativos-ipc'
import type { SesionDockerEnUso } from '../../../shared/agents-update-ipc'
import { ETIQUETA_AGENTE } from '../../../shared/etiquetasAgente'
import type { NucleoAgente, SesionAgenteAbierta } from './tipos'
import { contenedorDe } from './credenciales'

/** Tope de un archivo arrastrado para copiar al contenedor. */
const MAX_STAGE_BYTES = 64 * 1024 * 1024

/** Sesiones nativas con el proceso vivo; `atrasada` la decide el servicio de los nativos. */
export function sesionesNativas(n: NucleoAgente): Array<Omit<SesionNativa, 'atrasada'>> {
  const salida: Array<Omit<SesionNativa, 'atrasada'>> = []
  for (const s of n.sesiones.values()) {
    // Un agente manual no se actualiza desde Tessera: no cuenta para el botón de los nativos.
    if (!s.host || s.manual || !n.terminales.estaViva(s.sesionId)) continue
    salida.push({
      sesionId: s.sesionId,
      perfilId: s.perfilId,
      rutaHostProyecto: s.rutaHostProyecto,
      agente: s.agente as Agente,
      versionLanzada: s.versionLanzada,
      trabajando: s.actividad.estado() === 'working',
      esperandoRespuesta: s.actividad.esperandoRespuesta(),
      puedeTenerTextoSinEnviar: s.detectorEnvio.puedeTenerTextoSinEnviar()
    })
  }
  return salida
}

/** Sesiones vivas en un contenedor, también las de agentes manuales: actualizar la imagen las reinicia a todas. */
export function sesionesDocker(n: NucleoAgente): SesionDockerEnUso[] {
  const salida: SesionDockerEnUso[] = []
  for (const s of n.sesiones.values()) {
    if (s.host || !n.terminales.estaViva(s.sesionId)) continue
    salida.push({
      sesionId: s.sesionId,
      perfilId: s.perfilId,
      rutaHostProyecto: s.rutaHostProyecto,
      nombreAgente: s.manual?.nombre ?? ETIQUETA_AGENTE[s.agente as Agente],
      trabajando: s.actividad.estado() === 'working',
      esperandoRespuesta: s.actividad.esperandoRespuesta()
    })
  }
  return salida
}

/**
 * Pids de los ptys de las sesiones nativas de UN agente: instalar un agente solo para
 * las suyas, así que un proceso colgado de la sesión de otro agente bloquea como ajeno.
 */
export function pidsNativos(n: NucleoAgente, agente: Agente): number[] {
  const salida: number[] = []
  for (const s of n.sesiones.values()) {
    if (!s.host || s.agente !== agente) continue
    const pid = n.terminales.pidDe(s.sesionId)
    if (pid !== null) salida.push(pid)
  }
  return salida
}

/** La sesión y el contenedor donde corre (el de su cuenta), que es adonde se copian los archivos. */
function sesionYPerfil(n: NucleoAgente, sesionId: string): { sesionAbierta: SesionAgenteAbierta; perfil: Perfil } {
  const sesionAbierta = n.sesiones.get(sesionId)
  if (!sesionAbierta) throw new Error(`No existe una sesión de agente con id "${sesionId}".`)
  const perfil = n.perfiles.get(sesionAbierta.perfilId)
  if (!perfil) throw new Error(`Perfil desconocido: "${sesionAbierta.perfilId}".`)
  return { sesionAbierta, perfil: sesionAbierta.host ? perfil : contenedorDe(perfil, sesionAbierta.agente, sesionAbierta.cuentaId) }
}

/** Ruta en el contenedor (o en el host, en nativo) de un archivo del host; null si no vale. */
export async function prepararArchivoSesion(n: NucleoAgente, sesionId: string, rutaHost: string): Promise<string | null> {
  const { sesionAbierta, perfil } = sesionYPerfil(n, sesionId)
  let st
  try {
    st = await stat(rutaHost)
  } catch {
    return null // inaccesible: el renderer inyecta la ruta cruda
  }
  if (!st.isFile() || st.size > MAX_STAGE_BYTES) return null
  if (sesionAbierta.host) return rutaHost
  const bytes = await readFile(rutaHost)
  const rutaContenedor = await n.sandbox.escribirArchivoEnContenedor(perfil, bytes, basename(rutaHost), Date.now())
  n.log(`stageFile OK -> ${rutaContenedor} (perfil=${perfil.id}, ${bytes.length} bytes)`)
  return rutaContenedor
}

/** Vuelca la imagen del portapapeles para la sesión y devuelve su ruta; null si no hay imagen. */
export async function guardarImagen(n: NucleoAgente, sesionId: string): Promise<string | null> {
  const { sesionAbierta, perfil } = sesionYPerfil(n, sesionId)
  const png = n.portapapeles.leerPng()
  if (png === null) return null
  if (sesionAbierta.host) {
    const rutaHost = join(tmpdir(), `tessera-clip-${Date.now()}.png`)
    await writeFile(rutaHost, png)
    n.log(`saveImage [NATIVO] OK -> ${rutaHost} (${png.length} bytes)`)
    return rutaHost
  }
  const rutaContenedor = await n.sandbox.escribirArchivoEnContenedor(perfil, png, `clip-${Date.now()}.png`, Date.now())
  n.log(`saveImage OK -> ${rutaContenedor} (perfil=${perfil.id}, ${png.length} bytes)`)
  return rutaContenedor
}
