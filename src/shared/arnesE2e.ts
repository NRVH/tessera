// =============================================================================
// La marca con la que el arnés de interfaz (`e2e/tessera.ts`) lanza la app empaquetada, y que
// nadie más pasa. La miran el main (lo que solo se permite o se cambia en pruebas) y el arnés.
// No importa nada.
// =============================================================================

/**
 * NO vale `--user-data-dir`: el relevo de actualización de macOS relanza la app instalada justo
 * con él.
 */
export const ARG_ARNES_E2E = '--tessera-arnes-e2e'

/** ¿Lanzó este proceso el arnés de interfaz? */
export function lanzadaPorElArnes(argv: readonly string[]): boolean {
  return argv.includes(ARG_ARNES_E2E)
}
