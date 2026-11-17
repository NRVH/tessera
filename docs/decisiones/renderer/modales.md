# Todo diálogo de Tessera se cierra con la ✕ de arriba a la derecha y usa la misma carcasa

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/Modal.tsx` (`Modal`, `ModalPie`, `ModalAviso`, `CapaDialogos`), `comun/modal.css`,
  `comun/Segmentado.tsx`, `comun/segmentado.css`,
  `DialogoConfirmar.tsx`, `DialogoPrompt.tsx`, la capa en `App.tsx` y en la ventana de agente, y todo diálogo del renderer

## Contexto

Si cada diálogo tiene su propia cáscara, las cabeceras, los pies y los avisos divergen, y el cierre acaba unas veces
como una ✕ pequeña arriba, otras como un botón «Cerrar» abajo y otras sin ninguno (solo Esc): quien usa la aplicación
tiene que buscar cómo cerrar cada uno. Además, un diálogo montado dentro de un panel con `container-type` o con una
animación de entrada queda colocado respecto a ese panel y no a la ventana.

## Decisión

- **Una carcasa, `Modal`**, para todo diálogo:
  - **Cabecera:** título, ⓘ opcional, subtítulo opcional, un centro opcional (un buscador), acciones de cabecera y,
    en el extremo derecho, **siempre la ✕**: botón de icono de 28 px con «Cerrar (Esc)» de tooltip. Hace lo mismo que
    Esc. Si el diálogo no se puede abandonar (un proceso a medias), la ✕ queda desactivada, no se oculta.
  - **Cuerpo:** lo único que desplaza; cabecera y pie quedan a la vista. Su relleno inferior es el aire hasta el pie,
    igual en todos.
  - **Pie, solo si hay algo que confirmar:** auxiliares a la izquierda, Cancelar y el primario el último a la derecha.
    Un diálogo informativo no lleva pie, y el estado final de un proceso (exportado, instalado) tampoco: se cierra con
    la ✕. Nunca «Cerrar» abajo.
  - **Severidad:** lo que advierte o pide una decisión lleva un sello a la izquierda del título, con forma y color
    propios: `peligro` (octágono rojo: destruye o bloquea), `advertencia` (triángulo ámbar: riesgo o interrupción sin
    pérdida permanente) e `info` (círculo azul: decisión sin riesgo). Una ventana de trabajo no lleva sello: si todo lo
    lleva, deja de llamar la atención. El título dice la consecuencia y el botón nombra la acción, nunca «Aceptar».
    Con sello, el botón destructivo va en rojo y no en el color del perfil.
  - **Avisos** con `ModalAviso` (error, aviso, información, éxito), al final del cuerpo o bajo su campo, nunca en el pie.
  - **Tamaños:** S 420 (confirmar, preguntar un dato), M 560 (formularios), L 960×680 (espacios de trabajo), XL 1120.
- **Su propia capa (`CapaDialogos`)**, después de todo lo que abre diálogos: ningún panel ni otra tarjeta lo recorta ni
  lo desplaza, y uno abierto desde otro queda encima con el velo más ligero. El comportamiento (Esc, foco, trampa de
  Tab, salida animada) sigue siendo el de `useDialogo`.
- La ✕ es para diálogos. Un estado que no se cierra (el cierre de la aplicación) no lleva.
- **Sí o no, con `Interruptor`** (`FilaInterruptor` en un formulario, con su texto como etiqueta; `compacto` en una fila
  o barra baja). **Elegir varios de una lista, con la casilla nativa** que pinta `comun/casillas.css`: conserva el teclado
  y las etiquetas del navegador y se ve como la caja del panel de Git.
- **Opciones excluyentes de texto, con `Segmentado`** (`comun/Segmentado.tsx`), dentro y fuera de los diálogos: la
  elegida sobre el color del perfil atenuado y con el texto en el color normal, porque el color del perfil en el texto
  sobre su propio fondo se lee mal. `compacto` lo ajusta a la altura de una barra de herramientas. Los conmutadores
  de iconos siguen con `btn-active`, y los de entornos y autenticación, con sus radios nativos.

## Consecuencias

- Un diálogo nuevo se escribe con `Modal`; una cáscara propia es un fallo de revisión.
