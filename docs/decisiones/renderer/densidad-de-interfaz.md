# La densidad de la interfaz se calcula en un solo módulo, con una base y superficies que la heredan

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/theme/densidad.ts` y las raíces de panel que publican `--ui-font`

## Contexto

El zoom global escala todo (editor, terminales y chrome). Hacía falta encoger solo las listas
para que quepan más filas, sin tocar el tamaño al que se lee el código. Además la lista virtual
necesita el alto de fila en JS antes de montar nada: si el CSS y el JS discreparan, el scroll
quedaría descuadrado sin ningún error que lo avise.

## Decisión

- Las alturas se calculan en `densidad.ts` y se usan en los dos sitios (variables CSS y lista
  virtual). No hay constantes de alto duplicadas a mano entre TS y CSS.
- Hay una BASE (`uiFontSize`, gobierna todo el chrome) y superficies con voz propia
  (explorador, git, bases de datos) que la heredan o fijan la suya. `0` significa «igual que la
  base», para que un campo ausente y uno a 0 signifiquen lo mismo en un JSON escrito por
  versiones viejas.
- Se resuelve ANTES de normalizar (`resolverTamano`): normalizar primero convertiría el 0 en el
  predeterminado y la superficie dejaría de seguir a la base.
- Las variables CSS cascadean: cada superficie republica las MISMAS tres variables
  (`--ui-font`, `--ui-row-h`, `--ui-head-h`) en su raíz; no hay variables por superficie.
- La raíz de cada superficie con tamaño propio DEBE declarar `font-size: var(--ui-font)`. Los
  descendientes heredan el valor ya calculado del `body`, no la variable, y sin esa
  declaración la fila crece pero la letra se queda en el tamaño de la interfaz.
- Los rótulos de cabecera salen de la base, no de la superficie (`fontTitulo`): con el tamaño
  de cada vista, un mismo rótulo salía de un cuerpo distinto en cada columna.
- El modal de búsqueda deriva su tamaño del ancho de la ventana (`fontBusqueda`), sin ajuste.

## Consecuencias

`test-densidad.mts` fija la coherencia entre las alturas y las variables. Una superficie nueva
con tamaño propio hereda estas reglas o rompe el scroll de las listas virtuales.

## Descartes

- Un único número para toda la app: se quedó corto, porque cada vista pide una densidad distinta.
- Variables CSS por superficie (`--git-font`, `--explorer-font`): obligaban a tocar cada regla.
