# Mover en lote es todo o nada, y arrastrar varios archivos fuera de la app usa el arrastre nativo

- **Estado:** vigente
- **Ámbito:** `src/main/files/FileService.ts` (`moveMany`, `startDrag`), `files:move` y `files:startDrag` en `src/shared/files-ipc.ts`, `src/renderer/src/features/explorador/arrastreArbol.ts`, `arrastreFila.ts`

## Contexto

La selección múltiple del árbol hace que mover, pegar y borrar operen sobre listas. Un lote a medias
deja al usuario sin saber qué se movió; y el arrastre HTML5 solo sabe entregar UN archivo al gestor
de archivos del sistema.

## Decisión

- `files:move` recibe `{srcs[], destDir}` y es TODO O NADA: si algún nombre ya existe en el destino
  no se mueve nada y se avisa con los nombres. Sin `overwrite`: pisar el destino de un arrastre
  interno borra trabajo sin red. Pegar y borrar también van en lista: un lote es una llamada, un
  refresco y un aviso.
- `moveMany` valida la lista ENTERA antes de tocar el disco, incluidos dos orígenes con el mismo
  nombre, que la comprobación de existencia no ve (al mirar el segundo, el primero aún no se ha
  movido) y que perdería un archivo en silencio.
- Con un archivo, el arrastre sale por `DownloadURL`, que convive con el arrastre interno. Con varios,
  `files:startDrag`: el main resuelve las rutas con la guarda de siempre, descarta las que ya no
  existen (el arrastre aborta entero si falta una) y llama a `webContents.startDrag`.
- Mover DENTRO del árbol no se pierde con el arrastre nativo: al pasar sobre la ventana vuelve como
  un drop de ficheros, y el `dragover` mira lo arrastrado por el propio árbol ANTES que los ficheros
  externos.
- El fantasma (lo que se arrastra) se dibuja en un canvas con los colores vivos del panel, porque
  `startDrag` quiere una imagen y la lista virtual no tiene en el DOM las filas fuera de la vista. Si
  la imagen llegara vacía, el main usa una mínima: una imagen vacía aborta el arrastre.
- `startDrag` BLOQUEA el hilo principal hasta que el sistema termina el arrastre. Llamarlo sin un
  ratón de verdad (desde una automatización) cuelga la app: este camino se prueba a mano.

## Consecuencias

`test:move-many` fija el todo o nada y los orígenes homónimos.

## Descartes

- Un bucle de movimientos sueltos: N llamadas, N refrescos y un estado a medias si uno falla.
- `DownloadURL` con varios valores: Chromium solo admite uno y se perdían los demás sin aviso.
