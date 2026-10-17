// =============================================================================
// Las piezas que se mantienen montadas aunque no se vean (`vivosRecientes`) y la capa que las
// oculta sin perder lo que tienen: la que se ve no añade caja (`display: contents`); la oculta
// conserva la suya fuera del flujo, invisible e `inert` (con `display: none` el navegador
// descartaría su desplazamiento). Y un contenedor que, enseñado una vez, se queda (`useYaVisto`).
// Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================
import { useMemo, useState } from 'react'
import { ContextoCapaVisible, useCapaVisible } from './capaVisible'
import { conVisto, soloExistentes, MAX_VIVOS, type ConUso, type Vivo } from './vivosRecientes'

/**
 * Lo montado, en orden de entrada: `actual` como lo último visto y lo demás que siga en `existen`,
 * con tope. Se ajusta en el render, sin efecto: la pieza de lo que se acaba de abrir existe ya en el
 * commit en que se ve.
 */
export function useVivosRecientes<T extends Vivo>(
  actual: T | null,
  existen: ReadonlySet<string> | null,
  mismo?: (a: T, b: T) => boolean
): readonly T[] {
  const [lista, setLista] = useState<readonly ConUso<T>[]>([])
  const conActual = actual ? conVisto(lista, actual, MAX_VIVOS, mismo) : lista
  const siguiente = existen ? soloExistentes(conActual, existen) : conActual
  if (siguiente !== lista) setLista(siguiente)
  return useMemo(() => siguiente.map((v) => v.pieza), [siguiente])
}

/** `inert` como atributo: React 18 no lo trae en sus tipos y solo lo pasa al DOM como cadena. */
const INERTE = { inert: '' } as Record<string, string>

/**
 * `true` desde la primera vez que `visible` lo es: lo que no se ha enseñado nunca no se monta, y lo
 * enseñado se queda montado (en una `CapaViva`) aunque deje de verse. Se ajusta en el render, sin
 * efecto: la pieza existe ya en el commit en que se enseña.
 */
export function useYaVisto(visible: boolean): boolean {
  const [visto, setVisto] = useState(visible)
  if (visible && !visto) setVisto(true)
  return visto || visible
}

/**
 * La capa de una pieza viva: se ve, o se oculta conservando su caja. Dice a lo que lleva dentro si
 * se ve (`useCapaVisible`): un `memo` deja quieta a la pieza oculta, pero el contexto sí le llega.
 * Dentro de otra capa oculta tampoco se ve, aunque sea la elegida de las suyas: su caja no cambia (la
 * oculta ya la de fuera), pero lo de dentro deja de actuar igual.
 */
export function CapaViva({ visible, children }: { visible: boolean; children: React.ReactNode }): React.JSX.Element {
  const fueraSeVe = useCapaVisible()
  return (
    <div className={visible ? 'capa-viva' : 'capa-viva oculta'} aria-hidden={!visible} {...(visible ? {} : INERTE)}>
      <ContextoCapaVisible.Provider value={visible && fueraSeVe}>{children}</ContextoCapaVisible.Provider>
    </div>
  )
}
