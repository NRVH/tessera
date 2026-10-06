# Los diálogos comparten un hook de foco y teclado, y el de confirmar resuelve Enter y foco sin destruir por reflejo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/`: `useDialogo.ts`, `pilaDialogos.ts`, `ConfirmDialog.tsx`, `PromptDialog.tsx`

## Contexto

Los modales difieren en su cáscara (tarjeta con o sin cabecera, cierre bloqueado durante un proceso) y
coinciden en el comportamiento: Esc, devolver el foco a quien abrió y, opcionalmente, atrapar Tab. Un
componente `<Modal>` común acabaría con una variante y varios slots para parecerse a todos.

## Decisión

- Es un hook (`useDialogo`), no un componente. Se llama arriba del todo, antes de cualquier efecto que
  mueva el foco: los efectos corren en orden de declaración y este apunta a quién tenía el foco al montar.
- La devolución del foco guarda la cadena de ancestros, no solo el elemento: quien abre un borrado es la
  fila que desaparece al confirmar, y sin la cadena el foco caía en `<body>` y el Escape del árbol dejaba
  de llegar. Se enfoca el primer ancestro conectado con `tabIndex >= 0`, con `preventScroll`.
- Los diálogos abiertos forman una pila (`pilaDialogos.ts`): el hook apila al montar y desapila al
  desmontar, sea o no `cerrable`, y solo la cima atiende Esc; sin ella un Esc cerraba también el de
  debajo. La cima se fija con el primer manejador que ve cada evento, porque React desmonta la cima
  cerrada en una microtarea entre dos manejadores de `window` y el de debajo, si va detrás, se vería cima.
- `ConfirmDialog` pasa `onConfirm`/`onCancel` por ref y no por dependencias: los llamadores los crean en
  línea, y con ellos como dependencias cualquier repintado del padre relanzaba el foco inicial y lo
  devolvía a «Cancelar» aunque el usuario ya estuviera en «Eliminar».
- Enter sobre un botón del diálogo lo resuelve el propio botón. Fuera de ellos solo confirma lo que no
  destruye: un diálogo `danger` no tiene «Enter por defecto» y su foco inicial va a «Cancelar».

## Consecuencias

- Mover `useDialogo` por debajo del efecto del foco inicial rompe la devolución del foco.
- Interceptar siempre Enter con `preventDefault` anula el clic del botón y un Enter reflejo borra.
- Un modal con su propio Esc en `window` no entra en la pila y se cierra aunque tenga otro encima.

## Descartes

- Trampa de Tab en `ConfirmDialog`: con «Cancelar» antes que «Eliminar», Shift+Tab caía en el botón
  destructivo y un Enter después borraba. `PromptDialog` sí la lleva: no tiene botón destructivo.
- `focus({ focusVisible: true })` en el caso destructivo: el anillo de acento sobre «Cancelar» se leía como
  la acción señalada. Decide la heurística del navegador (lo fija `e2e/explorador-seleccion.spec.ts`).
