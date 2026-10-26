// =============================================================================
// El semáforo del límite de contenedores de Docker: cuántos aguanta el equipo según la memoria que
// tiene Docker. Verde, todos trabajando a la vez con holgura; amarillo, justo (lentitud, agentes
// parados, cierres); rojo, excesivo. Cuenta lo que cuesta un contenedor con su agente trabajando,
// no uno ocioso. Puro: lo prueba `test-semaforo-contenedores.mts`.
// Decisiones: docs/decisiones/sandbox/limite-de-contenedores.md
// =============================================================================

const GB = 1024 ** 3

/** Lo que ocupa un contenedor con su agente trabajando a pleno; un agente va de 0,3 a 1,5 GB. */
export const MEMORIA_POR_CONTENEDOR_TRABAJANDO = 1.5 * GB
/** Lo que ocupa uno con su agente a medio gas: el borde del amarillo. */
export const MEMORIA_POR_CONTENEDOR_JUSTO = 1 * GB

/** Valor guardado de «Sin límite». */
export const SIN_LIMITE = 0

export type ColorSemaforo = 'verde' | 'amarillo' | 'rojo'

export interface CortesSemaforo {
  /** Hasta cuántos, verde. */
  verdeHasta: number
  /** Hasta cuántos, amarillo; por encima, rojo. */
  amarilloHasta: number
  /** El tope de la barra (ya en rojo); después de él, «Sin límite». */
  maximo: number
}

/**
 * Los cortes para la memoria que tiene Docker. Verde: el 70 % de la memoria con todos trabajando a
 * pleno (el resto es del propio Docker y del sistema). Amarillo: el 90 % a medio gas. La barra sigue
 * en rojo un buen tramo para que se vea hasta dónde llega el riesgo.
 */
export function cortesSemaforo(memoriaBytes: number): CortesSemaforo {
  const mem = Number.isFinite(memoriaBytes) && memoriaBytes > 0 ? memoriaBytes : 0
  // Nunca menos de 2: la terminal Docker del perfil cuenta y no se para, y con 1 no cabría ni un agente.
  const verdeHasta = Math.max(2, Math.floor((mem * 0.7) / MEMORIA_POR_CONTENEDOR_TRABAJANDO))
  const amarilloHasta = Math.max(verdeHasta + 1, Math.floor((mem * 0.9) / MEMORIA_POR_CONTENEDOR_JUSTO))
  const maximo = Math.max(amarilloHasta + Math.ceil(amarilloHasta / 2), 8)
  return { verdeHasta, amarilloHasta, maximo }
}

/** El color de un límite; `SIN_LIMITE` es rojo, como cualquier exceso. */
export function colorDe(limite: number, cortes: CortesSemaforo): ColorSemaforo {
  if (limite === SIN_LIMITE || limite > cortes.amarilloHasta) return 'rojo'
  return limite > cortes.verdeHasta ? 'amarillo' : 'verde'
}

/** El límite que vale: el guardado, o el recomendado (el último verde) si no hay ninguno. */
export function limiteEfectivo(guardado: number | undefined, cortes: CortesSemaforo): number {
  return guardado === undefined || !Number.isInteger(guardado) || guardado < 0 ? cortes.verdeHasta : guardado
}

/** ¿Cabe un contenedor más? `vivos` son los que corren ahora (los del perfil también cuentan). */
export function hayCupo(vivos: number, limite: number): boolean {
  return limite === SIN_LIMITE || vivos < limite
}

/** Qué parar primero si hay que hacer sitio. */
export type PrimeroEnPararse = 'ultimos' | 'primeros' | 'inactivos'

/** La política del usuario para hacer sitio; viaja con cada apertura en Docker. */
export interface PoliticaCupo {
  limite: number
  primero: PrimeroEnPararse
  /** Los que están trabajando no se paran mientras haya otro. */
  protegerTrabajando: boolean
}

export const POLITICA_POR_DEFECTO: Omit<PoliticaCupo, 'limite'> = { primero: 'ultimos', protegerTrabajando: true }

/** Los tres ajustes del cupo leídos de un archivo de ajustes: lo que no valga, al de serie (y el límite, fuera). */
export function normalizarCupo(obj: Record<string, unknown>): {
  limiteContenedores?: number
  primeroEnPararse: PrimeroEnPararse
  protegerTrabajando: boolean
} {
  const l = obj.limiteContenedores
  const primero = obj.primeroEnPararse
  return {
    ...(typeof l === 'number' && Number.isInteger(l) && l >= 0 && l <= 999 ? { limiteContenedores: l } : {}),
    primeroEnPararse: primero === 'ultimos' || primero === 'primeros' || primero === 'inactivos' ? primero : POLITICA_POR_DEFECTO.primero,
    protegerTrabajando: typeof obj.protegerTrabajando === 'boolean' ? obj.protegerTrabajando : POLITICA_POR_DEFECTO.protegerTrabajando
  }
}

/** Lo que se sabe de un contenedor de cuenta para decidir si se para. */
export interface ContenedorCandidato {
  id: string
  /** Cuándo se abrió su primer agente (epoch ms); sin agentes, null. */
  abiertoEn: number | null
  /** Última entrada o salida de cualquiera de sus agentes. */
  ultimaActividad: number | null
  trabajando: boolean
  /** Lo lleva un agente manual: Tessera no sabe retomar su conversación, no se para. */
  protegido: boolean
}

/**
 * El contenedor a parar para hacer sitio, o null si ninguno se puede. Primero uno sin agentes (no se
 * pierde nada); después, según la política: los últimos abiertos, los primeros o los que llevan más
 * sin actividad. Nunca `excluido` (el que se está abriendo) ni uno protegido; uno trabajando, solo si
 * la política no los protege.
 */
export function elegirAParar(
  candidatos: readonly ContenedorCandidato[],
  politica: Omit<PoliticaCupo, 'limite'>,
  excluido: string
): string | null {
  const validos = candidatos.filter((c) => c.id !== excluido && !c.protegido)
  const vacio = validos.find((c) => c.abiertoEn === null)
  if (vacio) return vacio.id
  const elegibles = validos.filter((c) => !(politica.protegerTrabajando && c.trabajando))
  if (elegibles.length === 0) return null
  const clave = (c: ContenedorCandidato): number =>
    politica.primero === 'ultimos' ? -(c.abiertoEn ?? 0) : politica.primero === 'primeros' ? (c.abiertoEn ?? 0) : (c.ultimaActividad ?? 0)
  return [...elegibles].sort((a, b) => clave(a) - clave(b) || a.id.localeCompare(b.id))[0].id
}
