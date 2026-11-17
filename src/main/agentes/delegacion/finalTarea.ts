// =============================================================================
// Cómo acabó una ejecución de una tarea delegada, a partir de lo que se leyó de su salida, su código de salida y
// si la paró alguien. Puro.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import type { EstadoTarea, MotivoFallo } from '../../../shared/delegacion-ipc.ts'
import { CODIGO_SIN_CREDENCIAL } from './lineaDelegada.ts'
import type { ResumenSalida } from './salidaDelegada.ts'

export interface FinalTarea {
  estado: Exclude<EstadoTarea, 'en-marcha'>
  motivo?: MotivoFallo
  /** Lo que dijo el agente o Docker, tal cual: el motivo ya da el texto de Tessera. */
  detalle?: string
}

/** Lo que escribe el cliente de Docker cuando pierde el motor o el contenedor; dentro de la tarea, las órdenes van en eventos. */
const SALIDA_DE_DOCKER = /docs\.docker\.com\/go\/debug-cli|error during connect|failed to connect to the docker api|cannot connect to the docker daemon|is not running|no such container/i

/** ¿Pudo cortarla Docker? Solo si el agente no dijo nada propio: ni resultado, ni error, ni falta de sesión o de uso. */
export function puedeSerDocker(r: ResumenSalida | null): boolean {
  return !r || (r.resultado === null && r.error === null && !r.sinCredencial && !r.sinUso)
}

export function salidaDeDocker(r: ResumenSalida | null): boolean {
  return !!r && r.crudas.some((l) => SALIDA_DE_DOCKER.test(l))
}

/**
 * Una parada de Tessera o del usuario manda: lo que escriba el proceso al morir no cuenta. Después, un fallo antes de
 * arrancar o la marca de Codex sin sesión; el resultado del agente; la falta de sesión o de uso que dijo; y si no hay
 * nada, un fallo con lo último que escribió.
 */
export function decidirFinal(
  r: ResumenSalida | null,
  codigo: number | null,
  parada: MotivoFallo | null,
  forzado?: { motivo: MotivoFallo; detalle?: string }
): FinalTarea {
  if (parada) return { estado: 'cancelada', motivo: parada }
  if (forzado) return fallida(forzado.motivo, forzado.detalle)
  if (codigo === CODIGO_SIN_CREDENCIAL) return fallida('sin-credencial', r?.error)
  if (!r) return fallida('agente')
  // Un resultado sin error manda sobre cualquier aviso suelto que se pareciera a una falta de sesión o de uso.
  if (r.resultado !== null && r.error === null) return { estado: 'hecha' }
  if (r.sinCredencial) return fallida('sin-credencial', r.error)
  if (r.sinUso) return fallida('sin-uso', r.error)
  return fallida('agente', r.error ?? r.crudas.at(-1))
}

function fallida(motivo: MotivoFallo, detalle?: string | null): FinalTarea {
  return detalle ? { estado: 'fallida', motivo, detalle } : { estado: 'fallida', motivo }
}
