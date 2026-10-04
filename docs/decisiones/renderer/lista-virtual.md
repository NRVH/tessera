# La lista virtual mide su viewport en un efecto de layout y avisa del rango por identidad de `items`

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/VirtualList.tsx` y `src/renderer/src/comun/useVirtualizacion.ts`

## Contexto

`VirtualList` monta solo las filas visibles. `viewport` arranca en 0, así que el primer render monta
`1 + overscan` filas; si la medida llega tras el pintado hay un frame con la lista a medio llenar
(medido en la franja de git: 7 filas de 21, con la mitad de abajo en blanco). Además, al sustituir
`items` sin desmontar (cambiar de proyecto) con todo colapsado, el rango montado vuelve a ser el mismo
`[0, k]`, y el padre se quedaba con los elementos de la lista anterior.

## Decisión

- La primera medida del viewport y el `ResizeObserver` se registran en un `useLayoutEffect`
  (`useMedirViewport`): medida y re-render ocurren antes de pintar.
- `onRangoVisible` se avisa desde un efecto (nunca durante el render) y se compara por
  `[inicio, fin, items]`: la identidad de `items` cuenta como cambio aunque los números no se muevan.
- `scrollToken` existe porque el efecto de revelado depende solo de `scrollToIndex`: pedir dos veces la
  misma fila no cambia la dependencia y no scrollearía.

## Consecuencias

- Pasar la medida a un `useEffect` normal, o comparar solo los números del rango, reabre los dos fallos
  sin dar ningún error.
- El orden de los efectos del componente (layout de medida, limpieza del frame, revelado, aviso de rango)
  es el de la llamada a los hooks en `VirtualList`.

## Descartes

- Un `viewport` inicial estimado con `itemHeight`: una estimación que falla monta de más o deja el mismo
  frame a medias; medir cuesta una lectura de `clientHeight` por montaje.
