// =============================================================================
// El aviso de arranque de un agente nativo: el de bases tal cual, como PREFIJO exacto, y detrás el de SSH.
// Puro. Lo usan la apertura y la recarga nativas (`terminalAgente/apertura.ts` y `recarga.ts`); en el
// contenedor no hay `tssh`, así que allí sigue solo el de bases.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

/**
 * Une los dos avisos. El de bases no cambia ni un byte (lo fijan sus pruebas al carácter); sin ninguno de
 * los dos, `null`, que no añade nada a la línea de arranque.
 */
export function briefingCompuesto(bd: string | null, ssh: string | null): string | null {
  if (!ssh) return bd
  if (!bd) return ssh
  return `${bd}\n\n${ssh}`
}
