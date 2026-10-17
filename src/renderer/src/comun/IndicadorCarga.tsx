// =============================================================================
// El aviso de carga común de los paneles: `IndicadorCarga` pinta una fase (`cargaDiferida.ts`) y
// `EsperaCarga` la calcula y ocupa el sitio del contenido mientras toca. Va como línea, nunca
// centrado: centrarlo haría saltar el layout al llegar los datos. La caja existe desde que empieza
// la espera, vacía hasta los 250 ms, para que el lector de pantalla anuncie el texto al aparecer.
// Decisiones: docs/decisiones/renderer/carga-diferida.md
// =============================================================================

import './indicadorCarga.css'
import { cargaOcupa, type FaseCarga } from './cargaDiferida'
import { txCarga } from './textosCarga.ts'
import { useCargaDiferida } from './useCargaDiferida'

/** `linea`: estado de un panel, con «tarda» debajo. `fila`: una fila de árbol, de una sola línea. */
export type VarianteCarga = 'linea' | 'fila'

interface PropsAviso {
  /** Lo que se carga («Cargando cambios…»). */
  texto: string
  /** Por qué puede tardar, si se sabe; se añade al aviso de que tarda. */
  motivo?: string | null
  variante?: VarianteCarga
  /** Las clases del sitio (`git-state`, `tree-row muted`…), que ponen el margen y el color. */
  className?: string
  style?: React.CSSProperties
  /** Sin `role="status"` ni `aria-live`: el aviso va dentro de una fila que ya es una opción de lista. */
  sinAnuncio?: boolean
}

function textoTardando(motivo: string | null | undefined): string {
  return motivo ? txCarga().tardandoPor(motivo) : txCarga().tardando
}

/** El aviso en una fase dada; en `nada` deja su caja vacía. */
export function IndicadorCarga({
  fase,
  texto,
  motivo,
  variante = 'linea',
  className,
  style,
  sinAnuncio = false
}: PropsAviso & { fase: FaseCarga }): React.JSX.Element {
  const tardando = fase === 'tardando' ? textoTardando(motivo) : null
  const clases = `carga-diferida carga-diferida-${variante}${className ? ` ${className}` : ''}`
  return (
    <div
      className={clases}
      style={style}
      role={sinAnuncio ? undefined : 'status'}
      aria-live={sinAnuncio ? undefined : 'polite'}
      data-carga={fase}
      title={variante === 'fila' && tardando !== null ? `${texto} ${tardando}` : undefined}
    >
      {/* Un span propio: el contenedor es flex y la elipsis solo recorta un bloque. */}
      {fase !== 'nada' && variante === 'fila' && <span className="carga-diferida-texto">{tardando ?? texto}</span>}
      {fase !== 'nada' && variante === 'linea' && (
        <>
          {texto}
          {tardando !== null && <span className="carga-diferida-tardando">{tardando}</span>}
        </>
      )}
    </div>
  )
}

/**
 * El aviso mientras `cargando` (y su mínimo visible) y, si no, `children`. Solo cumple el mínimo
 * si sigue montado al acabar la carga: donde el padre lo quita con los datos, se va con ellos.
 */
export function EsperaCarga({
  cargando = true,
  children,
  ...aviso
}: PropsAviso & {
  cargando?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  const fase = useCargaDiferida(cargando)
  if (cargaOcupa(cargando, fase)) return <IndicadorCarga fase={fase} {...aviso} />
  return <>{children}</>
}
