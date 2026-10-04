# El área de BD monta los panes de todos los perfiles en keep-alive y cerrar pregunta al pane

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbArea*.tsx`, `useArea*.ts`, `propsBd.ts`

## Contexto

Cambiar de pestaña, de perfil o de vista no puede perder el texto de una consola, su deshacer, su
sesión con la transacción abierta ni el scroll de una rejilla. Y quien sabe si una pestaña se
puede cerrar (ejecutando, transacción pendiente, cambios sin enviar) es su pane, no la tira.

## Decisión

- Mismo molde que el editor (`editor/panes-en-keep-alive.md`): los panes de TODAS las pestañas
  de TODOS los perfiles se montan a la vez y solo se VE el de la pestaña activa del perfil que se
  mira; el resto queda con `display:none`. `visible` = perfil que se ve ∧ pestaña activa ∧ vista
  'db' fuera del mosaico. Un pane no pide datos ni crea Monaco antes de su primer `visible`
  (Monaco creado a 0 px no se recupera).
- Cada pane va en su caja `.db-pane` con su `ErrorBoundary`, y se oculta la caja.
- Un pane NO se desmonta porque su conexión o su consola falten un instante en las listas: se
  recuerda la última conocida por `paneKey`; lo borrado de verdad lo poda `useBdApp`.
- El pane sale de la FAMILIA de la conexión: SQL (datos, fuente, DDL, consola), documentos
  (colección, consola del shell) o claves (visor de lectura, consola de comandos). Lo que no
  cuadre, que podría llegar restaurado, se dice («Pestaña no disponible») en vez de montarse.
- Cerrar una consola, una tabla o una colección pregunta a su pane (`solicitarCierreConsola`,
  `solicitarCierreDatos`); un «Cancelar» para el gesto entero («Cerrar todas», izquierda,
  derecha). Tras cerrar alguna consola se vuelven a listar (una vacía se borra sola).
- Al salir de la app pregunta el main (`bd/explorador-salida-de-la-app.md`); el área solo pone
  NOMBRE a cada pestaña que edita (`etiquetarDatos`). Mod+W solo con el foco DENTRO del área
  (`tabIndex -1`): fuera, en la terminal, Ctrl+W es «borrar palabra».

## Consecuencias

Desmontar un pane por una lista en vuelo tira el texto sin guardar de una consola. Los diálogos de
un pane oculto van por portal: dentro de un `display:none` su promesa colgaría.

## Descartes

- El estado de la vista en el área: el lateral se desmonta al cambiar de vista y el árbol
  necesita el mismo estado; vive en `useBdApp`.
