// =============================================================================
// El botón de maximizar de la cabecera de un panel de la franja. Solo, es un icono; con `menu`, es el botón
// dividido «Maximizar | ▾»: la principal maximiza como siempre y la flecha abre «Pantalla completa» (con su
// acorde) y las entradas que añade quien lo aloja, como desacoplar el panel en una ventana.
// Depende de `BotonDivididoMenu` y de `util/atajos`.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { etiquetaAcorde } from '../util/atajos'
import { BotonDivididoMenu } from './BotonDivididoMenu'
import { IconoMaximizar } from './iconosPanel'
import type { EntradaMenuContextual } from './MenuContextual'
import { txComun } from './textos.ts'

/** Lo que la ventana principal añade al menú de la flecha de maximizar. */
export interface MenuMaximizar {
  /** Nombre accesible y tooltip de la flecha; no puede contener el de la principal. */
  etiquetaFlecha: string
  /** Entradas que siguen a «Pantalla completa». */
  entradasExtra: EntradaMenuContextual[]
}

export function BotonMaximizarPanel({ etiqueta, titulo, claseBoton, menu, alMaximizar }: {
  etiqueta: string
  titulo: string
  /** La clase del botón simple, la de los demás de la cabecera del panel. */
  claseBoton: string
  menu?: MenuMaximizar
  alMaximizar: () => void
}): React.JSX.Element {
  if (menu === undefined) {
    return (
      <button className={claseBoton} onClick={alMaximizar} title={titulo} aria-label={etiqueta}>
        <IconoMaximizar />
      </button>
    )
  }
  return (
    <BotonDivididoMenu
      etiquetaPrincipal={etiqueta}
      tituloPrincipal={titulo}
      iconoPrincipal={<IconoMaximizar />}
      onPrincipal={alMaximizar}
      etiquetaFlecha={menu.etiquetaFlecha}
      tituloFlecha={menu.etiquetaFlecha}
      entradas={[
        { label: txComun().pantallaCompleta, icon: <IconoMaximizar />, acorde: etiquetaAcorde('pantallaCompleta'), onClick: alMaximizar },
        ...menu.entradasExtra
      ]}
    />
  )
}
