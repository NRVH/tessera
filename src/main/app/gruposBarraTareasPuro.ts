// =============================================================================
// Las decisiones, sin Electron, del grupo propio que llevan en la barra de tareas las ventanas de agente y las
// de franja desacoplada: el identificador de cada grupo, el archivo de su icono según la plataforma y qué ejecuta
// el sistema al abrir una entrada anclada. Con su prueba (`test-grupos-barra-tareas.mts`); las usa
// `gruposBarraTareas.ts`.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md, docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { createHash } from 'node:crypto'
import type { Plataforma } from '../../shared/plataforma.ts'

/** Cada grupo es un AppUserModelID aparte: el de Tessera, el de las ventanas de agente y el de las de franja. */
export type GrupoBarraTareas = 'agente' | 'franja'

/** El identificador del grupo: el de Tessera con su sufijo; el de desarrollo lleva `.dev` para no mezclarse con la instalada. */
export function idModeloDeGrupo(grupo: GrupoBarraTareas, empaquetado: boolean): string {
  return `${empaquetado ? 'com.noe.tessera' : 'com.noe.tessera.dev'}.${grupo}`
}

/** Un sufijo estable y opaco mantiene un botón por perfil aunque cambien su nombre y su color. */
export function idModeloDeFranja(perfil: string, empaquetado: boolean): string {
  const sufijo = createHash('sha256').update(perfil).digest('hex').slice(0, 16)
  return `${idModeloDeGrupo('franja', empaquetado)}.${sufijo}`
}

/**
 * El archivo del icono de un grupo en esta plataforma, o null donde no hay (macOS: un solo icono en el Dock, que
 * no cambia por ventana). Windows lo pinta desde un `.ico` suelto en disco; Linux, desde un `.png`.
 */
export function archivoIconoDeGrupo(grupo: GrupoBarraTareas, plataforma: Plataforma): string | null {
  if (plataforma === 'windows') return `tessera-${grupo}.ico`
  if (plataforma === 'linux') return `tessera-${grupo}.png`
  return null
}

/** Lo que Windows ejecuta al abrir una entrada anclada del grupo. */
export interface RelanzamientoDeGrupo {
  /** Argumento que pide el grupo al arrancar Tessera, o null si basta con abrirla. */
  argumento: string | null
  /** Nombre de la entrada anclada. */
  nombre: string
}

/**
 * El comando de relanzamiento, o null en desarrollo, donde el ejecutable es el de Electron y abriría una
 * ventana vacía. Sin argumento, abre Tessera (o trae al frente la que ya corre).
 */
export function comandoDeRelanzamiento(ejecutable: string, relanzamiento: RelanzamientoDeGrupo, empaquetado: boolean): string | null {
  if (!empaquetado) return null
  return relanzamiento.argumento === null ? `"${ejecutable}"` : `"${ejecutable}" ${relanzamiento.argumento}`
}
