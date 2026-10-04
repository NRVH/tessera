# El diff edita el buffer compartido del registro y no recrea Monaco por cada cambio

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/editor/DiffEditorPane.tsx` y sus módulos `diffEditor*`, `useDiffEditor`, `DiffCabecera`

## Contexto

Un mismo pane de diff se reutiliza entre targets y convive con la pestaña normal del archivo.
Monaco falla en silencio si se le recrean modelos o se le mide mal, y un guardado equivocado
destruye un archivo.

## Decisión

- **Lado derecho editable = modelo del registro** (`textModels`), no un blob: editar en el
  diff se ve en la pestaña, hay un solo punto sucio y Ctrl+S en cualquiera limpia los dos.
  Solo lo es en la vista de Cambios; índice e historial son de solo lectura.
- **Limpieza asimétrica:** el modelo original es local y se dispone en el pane; el modificado
  compartido no se dispone nunca ahí (lo suelta el cleanup de la corrida que lo adquirió).
  Se mira si el modelo INSTALADO es compartido, no si lo es la corrida nueva.
- **Fail-safe:** el editor arranca en solo lectura y se abre a edición solo tras instalar el
  buffer. Un buffer truncado o binario degrada con aviso: guardarlo perdería el resto.
- **`contenidoEnMemoria` apaga siempre la edición** (diff de una entrada de un comprimido):
  sin eso, Ctrl+S escribiría texto sobre el binario. Se usa el mismo pane en vez de un segundo
  `createDiffEditor`, cuyas ~200 líneas copiadas divergían.
- **Layout con dimensiones explícitas** y guarda `> 0`: con `automaticLayout: false`, un
  `layout()` sin argumentos no remide el alto (el widget observa un div propio) y el diff queda
  recortado; oculto con display:none la caja es 0×0 y quedaría a 5 px.
- **El host de Monaco no se desmonta** al haber un aviso: se oculta. Los avisos y el
  `sobreElHost` entran por props para no recrear el editor en cada fila que se pincha.
- **La lupa del scrollbar se calla con el colapso encendido:** el eje del scrollbar deja de ser
  proporcional a la línea y enseñaría un trozo equivocado. Se descartó invertir
  `getTopForLineNumber` por búsqueda binaria: es lo más delicado del módulo y no compensa.
- El número de diferencias es `null` hasta que Monaco calcula; sin saberlo no se dice
  «Sin diferencias» sobre un diff viejo aún pintado.

## Consecuencias

Los efectos conservan su orden (montaje, carga, recarga, foco, relayout, colapso) y el estado
mutable vive en una instancia estable (`InstanciaDiff`). «Saltar al fuente» no es exacto fuera
de la vista de Cambios: la línea es de la revisión vieja. Se acepta.
