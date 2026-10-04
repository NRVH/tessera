# La vista previa de la búsqueda tiene su propio Monaco, siempre montado y tapado por una capa

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/busqueda/VistaPreviaBusqueda.tsx`, `usePreviaBusqueda.ts` y el cuerpo del modal (`CuerpoResultados.tsx`)

## Contexto

La previa enseña el archivo de la fila seleccionada en un editor de solo lectura, centrado en la
coincidencia. La fila cambia con cada flecha del teclado y el modal se vacía y se llena con cada
lanzamiento de búsqueda.

## Decisión

- El modelo es propio y se reemplaza al cambiar de archivo; no se pide al registro de buffers. Ese
  registro acopla la vida del modelo a una pestaña que el usuario puede cerrar por detrás del
  modal (Monaco lanzaría con un modelo ya dispuesto) y su `acquire`/`release` exigiría un vaivén de
  refcount por pulsación.
- El host de Monaco NUNCA se oculta ni se desmonta: ocupa siempre el cuerpo y lo tapa una capa por
  encima. Con `display:none` el editor nace midiendo 0x0 y se queda sin pintar ninguna línea, sin
  error en consola. Lo mismo vale para el divisor y la previa del modal cuando no hay filas.
- La cabecera de la previa se renderiza siempre y se oculta con `hidden`: React reconcilia por
  posición, y meterla en un `&&` remontaba el div del editor y se llevaba el DOM de Monaco.
- Lo cargado solo se enseña si es de la fila pedida (`alDia`): mientras el archivo nuevo viaja, no
  se pinta el anterior bajo la cabecera del nuevo.
- Si el proyecto activo cambia mientras una lectura viaja, la respuesta se descarta: vendría
  resuelta contra otra raíz.
- Una clase compilada se decide por la extensión y no por el origen de la coincidencia: de ello
  dependen a la vez el visor (descompilar) y el mensaje de espera.
- La expresión se compila una vez, fuera del bucle de líneas; las decoraciones paran en `MAX_COINCIDENCIAS`.

## Consecuencias

- Los efectos de la previa (crear editor, cargar, instalar modelo, resaltar) siguen en ese orden.
- Un cambio que desmonte el host o la cabecera reabre el fallo de las líneas sin pintar.

## Descartes

- Reusar `textModels.peek(key)` para enseñar el buffer vivo de una pestaña abierta.
- Un ternario que cambia el árbol cuando no hay filas: una creación y una destrucción de Monaco
  por pulsación.
