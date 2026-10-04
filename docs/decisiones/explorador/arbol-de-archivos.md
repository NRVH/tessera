# El árbol de archivos es un solo componente con el estado en hooks y las operaciones en funciones

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/explorador/` (`FileTree.tsx`, `useArbol.ts`, `useCadenasArbol.ts` y los módulos `*Arbol.ts`)

## Contexto

`FileTree` virtualiza el árbol, selecciona varias filas, arrastra, corta y pega, y se remonta
con `key={projectHostPath}` al cambiar de proyecto. Sus efectos comparten registros (las
cargas en vuelo, la cola de indexado) y varias carreras se arreglaron tras verlas en vivo.

## Decisión

- Todo el estado sigue siendo de `FileTree`: `useArbol` compone hooks parciales en el orden
  histórico de sus efectos y devuelve un `Arbol`. Las operaciones, el portapapeles, el menú y el
  teclado son funciones planas que reciben ese `Arbol` y no guardan estado. Se importan en un solo
  sentido: `operacionesArbol` es la base y no importa de las capas superiores.
- Los efectos de carga comparten `loadingChains` y una cola de 8 `listDir` para todo el árbol,
  con un flag `mountedRef` en lugar de un `cancelled` por efecto: aquél dejaba carpetas «cargando…»
  para siempre. El refresco no vacía `loadingChains` (así no se pide dos veces la misma carpeta).
- Un refresco cancela la cola pendiente y NO se lanza tras un movimiento con conflictos: el
  main no tocó el disco y sería re-listar todo para nada.
- `arrastrarFuera` apaga `arrastrados` cuando resuelve `startDrag`: es la única señal exacta de
  fin del arrastre nativo (Esc dentro de la ventana no dispara `dragend` ni `drop`).
- El menú sondea el portapapeles al abrir y descarta respuestas tardías con un contador de
  generación; su objetivo se congela al abrir para que la etiqueta prometa lo que se borra.
- Sobre un archivo, `dragover` siempre para la propagación, también al rechazar: si burbujeara,
  el panel prometería un movimiento a la raíz que el `drop` de la fila descarta.

## Consecuencias

- Mover un estado a un hijo que se monte o remonte por su cuenta pierde su valor; mover un
  efecto a otro hook cambia su orden. Las deps de los hooks incluyen los setters recibidos por
  parámetro (estables) porque el linter no sabe que lo son.

## Descartes

- Subir la selección a la carpeta al colapsarla (lo que hacen otros árboles): con un archivo
  marcado dentro, el `Supr` siguiente ofrecía borrar la carpeta entera. Colapsar es navegación.
