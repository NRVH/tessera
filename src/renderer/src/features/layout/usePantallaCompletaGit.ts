// =============================================================================
// Git·Log a pantalla completa: el valor que se pinta (`pantallaCompletaGitCoherente`)
// y la corrección del store cuando deja de valer, para que no resucite la próxima vez
// que se abra Git. Efímero: no se persiste. Lo compone App.tsx, que pone la clase en
// `.shell`; ocultar lo demás es solo CSS, así que nada se desmonta.
// =============================================================================
import { useLayoutEffect } from 'react'
import { pantallaCompletaGitCoherente, type SalidaLayoutCentro } from './layoutCentro'
import { useStoreLayout } from './store'

/** ¿Se pinta Git·Log a pantalla completa? Corrige el store antes de pintar si ya no vale. */
export function usePantallaCompletaGit(franja: SalidaLayoutCentro['franja'], mosaico: boolean): boolean {
  const pedida = useStoreLayout((s) => s.gitPantallaCompleta)
  const coherente = pantallaCompletaGitCoherente({ pedida, franja, mosaico })
  useLayoutEffect(() => {
    if (coherente !== useStoreLayout.getState().gitPantallaCompleta) {
      useStoreLayout.setState({ gitPantallaCompleta: coherente })
    }
  })
  return coherente
}
