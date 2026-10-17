// =============================================================================
// El historial de un archivo abierto en la franja, POR PROYECTO de cada perfil: cada proyecto vuelve
// con el suyo y el de uno no se ve en otro, ni el mismo camino abierto en otro perfil. Efímero.
// Puro: lo prueba `test-historial-por-proyecto.mts`.
// =============================================================================

/** Ruta POSIX relativa del archivo cuyo historial se ve, por `claveHistorial`. */
export type HistorialPorProyecto = Readonly<Record<string, string>>

/** Clave del historial de un proyecto de un perfil. */
export function claveHistorial(perfil: string, proyecto: string): string {
  return `${perfil}|${proyecto}`
}

/** `mapa` con el historial de `path` en `clave`; el MISMO objeto si ya era ese. */
export function conHistorial(mapa: HistorialPorProyecto, clave: string, path: string): HistorialPorProyecto {
  return mapa[clave] === path ? mapa : { ...mapa, [clave]: path }
}

/** `mapa` sin el historial de `clave`; el MISMO objeto si no tenía. */
export function sinHistorial(mapa: HistorialPorProyecto, clave: string): HistorialPorProyecto {
  if (!(clave in mapa)) return mapa
  const { [clave]: _cerrado, ...resto } = mapa
  return resto
}
