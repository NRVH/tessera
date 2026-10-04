// =============================================================================
// repoDePeticion: qué repo viaja en una petición de git del renderer. Regla: nunca preguntes
// sin decir de quién. Con `undefined` el backend usa el repo que tenga apuntado en ese
// instante y el panel de Log podía enseñar la historia de otro perfil bajo la cabecera de
// este. Se cae a la contenedora, como hace `selectGitTargetPath` para la otra vista.
// Decisiones: docs/decisiones/git/log-identidad-y-anclaje.md
// =============================================================================

/**
 * Repo que debe viajar en una petición de historial. `null` = no hay proyecto y
 * por tanto NO hay que preguntar nada (quien llama tiene que cortar, no mandar
 * `undefined`).
 */
export function repoDePeticion(
  repoSeleccionado: string | null,
  projectHostPath: string | null
): string | null {
  return repoSeleccionado ?? projectHostPath
}
