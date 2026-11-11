// =============================================================================
// El registro en disco de las tareas delegadas sin terminar: lo que hace falta para reanudarlas si Tessera o el equipo se
// apagan a mitad. Vive en los datos de Tessera, fuera de todo contenedor, para que nada de lo que escriba un agente
// delegado decida qué se reanuda ni dónde. Un archivo dañado o una entrada con otra forma se ignoran.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { readFileSync } from 'node:fs'
import { AGENTES_DELEGABLES, type VistaTarea } from '../../../shared/delegacion-ipc.ts'
import { writeFileAtomicSync } from '../../util/atomicWrite.ts'

export interface EntradaRegistro {
  vista: VistaTarea
  accountId: string
  projectHostPath: string
  /** El nombre del archivo con la orden en la carpeta de la cuenta, para borrarlo tras un corte. */
  archivoOrden: string | null
}

export interface RegistroTareas {
  leer: () => EntradaRegistro[]
  escribir: (entradas: EntradaRegistro[]) => void
}

const ID_TAREA = /^[0-9a-f]{8}$/
/** Lo que escribe `ServicioDelegacion`: su id de tarea, un guion y una marca de tiempo. */
const NOMBRE_ORDEN = /^[0-9a-f]{8}-\d+\.md$/
const texto = (v: unknown): v is string => typeof v === 'string' && v !== ''

export function entradaValida(v: unknown): v is EntradaRegistro {
  if (v === null || typeof v !== 'object') return false
  const e = v as Partial<EntradaRegistro>
  const t = e.vista
  if (!t || !texto(e.accountId) || !texto(e.projectHostPath)) return false
  if (e.archivoOrden !== null && !(typeof e.archivoOrden === 'string' && NOMBRE_ORDEN.test(e.archivoOrden))) return false
  return (
    typeof t.id === 'string' && ID_TAREA.test(t.id) &&
    texto(t.origen) && texto(t.profileId) && texto(t.cuenta) &&
    (AGENTES_DELEGABLES as readonly string[]).includes(t.agente) &&
    (t.estado === 'en-marcha' || t.estado === 'interrumpida') &&
    typeof t.soloLectura === 'boolean' && typeof t.resumen === 'string' &&
    typeof t.inicio === 'number' && typeof t.ultimaActividad === 'number' && Array.isArray(t.actividad)
  )
}

/** Cómo vuelve una tarea tras un apagado: la que seguía en marcha, como interrumpida en ese momento. */
export function trasApagado(vista: VistaTarea, ahora: number): VistaTarea {
  return vista.estado === 'en-marcha' ? { ...vista, estado: 'interrumpida', fin: ahora } : vista
}

export function crearRegistroTareas(ruta: string): RegistroTareas {
  return {
    // No existir o estar dañado es «sin tareas»; cualquier otro fallo (un bloqueo pasajero) se lanza, para no escribir encima.
    leer: () => {
      let contenido: string
      try {
        contenido = readFileSync(ruta, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
      }
      try {
        const datos: unknown = JSON.parse(contenido)
        return Array.isArray(datos) ? datos.filter(entradaValida) : []
      } catch {
        return []
      }
    },
    escribir: (entradas) => writeFileAtomicSync(ruta, JSON.stringify(entradas))
  }
}
