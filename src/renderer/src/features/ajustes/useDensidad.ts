// =============================================================================
// Densidad de la interfaz: el tamaño efectivo de cada superficie (explorador, git y
// bases de datos) y sus alturas de fila, que las listas virtuales necesitan en JS,
// y la publicación de la densidad base en :root antes del pintado.
// =============================================================================
import { useLayoutEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { altoCabecera, altoFila, fontTitulo, resolverTamano, resolverTamanoBd, variablesCss } from '../../theme/densidad'
import { useStoreAjustes } from './store'

/** Alturas y variables CSS de cada superficie. */
export interface Densidad {
  altoFilaExplorador: number
  altoFilaGit: number
  altoCabeceraGit: number
  altoFilaBd: number
  varsExplorador: Record<string, string>
  varsGit: Record<string, string>
  varsBd: Record<string, string>
}

/** Densidad de cada superficie; publica la base en :root en un efecto de layout. */
export function useDensidad(): Densidad {
  const { uiFontSize, explorerFontSize, gitFontSize, dbFontSize } = useStoreAjustes(
    useShallow((s) => ({
      uiFontSize: s.uiFontSize,
      explorerFontSize: s.explorerFontSize,
      gitFontSize: s.gitFontSize,
      dbFontSize: s.dbFontSize
    }))
  )
  // El mismo número alimenta el `style` del panel y el `itemHeight` de su lista virtual.
  const fuenteExplorador = resolverTamano(uiFontSize, explorerFontSize)
  const fuenteGit = resolverTamano(uiFontSize, gitFontSize)
  const fuenteBd = resolverTamanoBd(uiFontSize, explorerFontSize, dbFontSize)
  const varsExplorador = useMemo(() => variablesCss(fuenteExplorador), [fuenteExplorador])
  const varsGit = useMemo(() => variablesCss(fuenteGit), [fuenteGit])
  const varsBd = useMemo(() => variablesCss(fuenteBd), [fuenteBd])
  // Efecto de layout: al arrancar no se ve un frame con el tamaño por defecto.
  useLayoutEffect(() => {
    for (const [k, v] of Object.entries(variablesCss(uiFontSize))) {
      document.documentElement.style.setProperty(k, v)
    }
    // El rótulo de cabecera va solo en la raíz y en px: como variable, cada panel lo redefiniría.
    document.documentElement.style.setProperty('--ui-font-titulo', `${fontTitulo(uiFontSize)}px`)
  }, [uiFontSize])
  return {
    altoFilaExplorador: altoFila(fuenteExplorador),
    altoFilaGit: altoFila(fuenteGit),
    altoCabeceraGit: altoCabecera(fuenteGit),
    altoFilaBd: altoFila(fuenteBd),
    varsExplorador,
    varsGit,
    varsBd
  }
}
