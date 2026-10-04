# El visor de valor es un Monaco de solo lectura en un modal por portal, que nace cuando su host ya mide

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/VisorValor.tsx`, `rejilla/visorValor.ts`

## Contexto

Una celda puede traer hasta 16 MiB (`DB_VALOR_MAX`) y llegar recortada a la rejilla. El visor la
enseña entera, igual en la pestaña de datos y en los resultados de la consola.

## Decisión

- Monaco y no un `<pre>`: un `<pre>` con 16 MiB es un solo nodo que el navegador maqueta
  entero (segundos de hilo principal, y otra vez con cada cambio de tamaño); Monaco pinta solo
  las líneas visibles, trae buscar, selección y copia de un trozo, y es el mismo visor de solo
  lectura que la pestaña de fuente. `wrappingStrategy: 'simple'` para no medir cada línea.
- Nace en el primer `ResizeObserver` con el host midiendo algo, nunca a 0 px: sin
  `automaticLayout`, uno que nace a cero se queda en 5×5 px para siempre (ver
  [../renderer/reflow-monaco-oculto.md](../renderer/reflow-monaco-oculto.md)). El host no se oculta
  nunca: NULL, la cadena vacía y el binario vacío son una capa opaca encima.
- El valor completo se pide solo si la celda llegó recortada y el dueño sabe pedirlo (la
  pestaña de datos, por la clave). Mientras llega se enseña lo que hay con una línea de estado;
  un fallo sale en línea con «Reintentar», sin tapar lo cargado. Sin forma de pedirlo, la línea
  dice por qué.
- «Copiar» copia el VALOR (el `0x…` en binario, no el volcado), salvo el JSON, que se copia como
  se lee. El volcado hex va sin números de línea y sin partir: partido, el ASCII se descoloca.
- Teclado: `useDialogo` (Esc, trampa de Tab y devolución del foco a la rejilla, que conserva la
  celda activa). Al abrir, el foco entra en el editor. El Esc del buscador de Monaco lo cierra a
  él antes que al modal: Monaco lo consume y no llega a la ventana.
- Por portal desde la rejilla: vive en filas con `transform` y pestañas `display:none`, y el modal
  tiene que ser `fixed` sobre la ventana entera.

## Consecuencias

El conmutador «Formateado / Crudo» usa las clases de las partes de la pestaña de fuente: es
identidad (dice qué se lee), no una acción.
