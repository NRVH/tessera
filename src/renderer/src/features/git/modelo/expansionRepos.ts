// =============================================================================
// Qué secciones de repo de la vista Cambios abrió o cerró el usuario a mano. Por defecto se abre
// solo el repo que tiene cambios; aquí se guarda solo lo tocado, por ruta del repo, para que al
// volver a un proyecto o a un perfil la lista se vea como se dejó. Efímero.
// Puro: lo prueba `test-expansion-repos.mts`.
// =============================================================================

/** Lo abierto (true) o cerrado (false) a mano, por ruta del repo en el anfitrión. */
export type ExpansionRepos = Readonly<Record<string, boolean>>

/** ¿Está abierta la sección? Lo tocado a mano manda; si no, abierta si tiene cambios. */
export function repoAbierto(mapa: ExpansionRepos, repo: string, tieneCambios: boolean): boolean {
  return mapa[repo] ?? tieneCambios
}

/** `mapa` con `repo` fijado a `abierto`; el MISMO objeto si ya lo estaba. */
export function conRepoAbierto(mapa: ExpansionRepos, repo: string, abierto: boolean): ExpansionRepos {
  return mapa[repo] === abierto ? mapa : { ...mapa, [repo]: abierto }
}

/** Cierra a mano todos los `repos`. */
export function plegarRepos(mapa: ExpansionRepos, repos: readonly string[]): ExpansionRepos {
  return repos.reduce((m, r) => conRepoAbierto(m, r, false), mapa)
}

/**
 * Devuelve los `repos` a lo de por defecto (abiertos los que tienen cambios): abrir también los
 * limpios solo llenaría la lista de secciones vacías. Los repos de otros proyectos no se tocan.
 */
export function reposPorDefecto(mapa: ExpansionRepos, repos: readonly string[]): ExpansionRepos {
  if (!repos.some((r) => r in mapa)) return mapa
  const siguiente = { ...mapa }
  for (const r of repos) delete siguiente[r]
  return siguiente
}
