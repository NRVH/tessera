// =============================================================================
// Saneado del pegado en las terminales (main <-> preload <-> renderer).
// El bracketed paste NO se aplica aquí: lo hace `term.paste()` de xterm solo si la app
// de destino declaró el modo; envolver siempre inyectaría «200~» literal en las demás.
// Aquí solo se normalizan los saltos a LF: el portapapeles de Windows trae CRLF y un CR
// suelto descuadra el cursor.
// =============================================================================

/** CRLF/CR -> LF. Deja el texto con un único tipo de salto de línea. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
