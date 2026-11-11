// =============================================================================
// Las versiones de los CLI de la imagen de Docker frente a las publicadas. Leerlas ejecuta la imagen, así que se guarda
// la lectura por id de imagen: con Docker apagado se responde con la última, sin encenderlo solo para revisar.
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================
import { readFileSync } from 'node:fs'
import type { EstadoAgentesDocker, SesionDockerEnUso, TareaDockerEnUso, VersionAgenteDocker } from '../../shared/agents-update-ipc.ts'
import { esVersionExacta, extraerVersion, hayVersionNueva } from '../../shared/versionesCli.ts'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'

export interface LecturaImagen {
  idImagen: string
  claude: string
  codex: string
  en: number
}

export interface RegistroLecturaImagen {
  leer: () => LecturaImagen | null
  escribir: (l: LecturaImagen) => void
}

export interface DepsEstadoImagen {
  dockerActivo: () => Promise<boolean>
  /** El id de la imagen de los agentes, o null si aún no existe. */
  idImagen: () => Promise<string | null>
  versionesImagen: () => Promise<{ codex: string; claude: string }>
  ultimas: () => Promise<{ claude: string | null; codex: string | null }>
  uso: () => { cuentas: number; perfiles: number; sesiones: SesionDockerEnUso[]; tareas: TareaDockerEnUso[]; conCapas: boolean; extrasVetados: boolean }
  registro: RegistroLecturaImagen
  ahora?: () => number
}

function lecturaValida(v: unknown): v is LecturaImagen {
  if (v === null || typeof v !== 'object') return false
  const l = v as Partial<LecturaImagen>
  return typeof l.idImagen === 'string' && esVersionExacta(l.claude) && esVersionExacta(l.codex) && typeof l.en === 'number'
}

export function crearRegistroLecturaImagen(ruta: string): RegistroLecturaImagen {
  return {
    leer: () => {
      try {
        const datos: unknown = JSON.parse(readFileSync(ruta, 'utf8'))
        return lecturaValida(datos) ? datos : null
      } catch {
        return null
      }
    },
    escribir: (l) => writeFileAtomicSync(ruta, JSON.stringify(l))
  }
}

/** La lectura vigente: la guardada si la imagen no cambió; sin Docker, la última que hubo. */
async function lecturaVigente(d: DepsEstadoImagen, activo: boolean, ahora: number): Promise<LecturaImagen | null> {
  const guardada = d.registro.leer()
  if (!activo) return guardada
  const idImagen = await d.idImagen()
  if (idImagen === null) return null
  if (guardada?.idImagen === idImagen) return guardada
  const crudas = await d.versionesImagen()
  const claude = extraerVersion(crudas.claude)
  const codex = extraerVersion(crudas.codex)
  if (!claude || !codex) return null
  const lectura = { idImagen, claude, codex, en: ahora }
  d.registro.escribir(lectura)
  return lectura
}

const fila = (instalada: string | null, ultima: string | null): VersionAgenteDocker => ({ instalada, ultima, hayNueva: hayVersionNueva(instalada, ultima) })

/** Nunca lanza: lo que no se pudo saber queda en null. */
export async function leerEstadoAgentesDocker(d: DepsEstadoImagen): Promise<EstadoAgentesDocker> {
  const ahora = (d.ahora ?? Date.now)()
  const dockerActivo = await d.dockerActivo().catch(() => false)
  const [lectura, ultimas] = await Promise.all([
    lecturaVigente(d, dockerActivo, ahora).catch(() => d.registro.leer()),
    d.ultimas().catch(() => ({ claude: null, codex: null }))
  ])
  return {
    ...d.uso(),
    dockerActivo,
    claude: fila(lectura?.claude ?? null, ultimas.claude),
    codex: fila(lectura?.codex ?? null, ultimas.codex),
    leidoEn: lectura?.en ?? null
  }
}
