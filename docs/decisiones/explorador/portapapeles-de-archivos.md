# El portapapeles de archivos del explorador arbitra entre una copia interna y el del sistema sin sondear

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/explorador/fileClipboard.ts`, `portapapelesArbol.ts` y `clipboard:probe` del main

## Contexto

Copiar y cortar en el árbol tiene dos fuentes: la INTERNA (lo copiado dentro de Tessera, la única
que puede expresar «cortar» sobre una ruta del proyecto) y la DEL SISTEMA (ficheros del gestor de
archivos o un bitmap, que sondea el main). Si se copia en Tessera y después otra cosa en el
sistema, debe ganar lo último. Electron no avisa de cambios del portapapeles, y sondearlo con un
temporizador gasta CPU para algo que solo importa al pegar.

## Decisión

- Al copiar dentro de Tessera se deja además la ruta absoluta como TEXTO en el portapapeles del
  sistema y se guarda como MARCA. Al pegar: ficheros o imagen del sistema, gana el sistema; la
  marca intacta, gana lo interno; otro texto, lo interno está caduco y se descarta.
- La marca se compara RECORTADA a `MAX_TEXTO_SONDEO`: el sondeo devuelve como mucho ese número de
  caracteres y con unos 27 ficheros la marca entera lo supera. Sin recortar, la igualdad no casaba,
  «Pegar» desaparecía y el corte pendiente se limpiaba sin ningún error.
- El estado vive en un singleton de módulo y no en un `useState` del árbol: `FileTree` se remonta
  con `key={projectHostPath}` al cambiar de pestaña de proyecto y el portapapeles debe sobrevivir.
  La comprobación de `projectHostPath` impide pegar en el proyecto equivocado.

## Consecuencias

- Copiar un archivo en el árbol y pegar en el editor pega su ruta.
- El arbitraje es puro (sin React ni DOM) y se prueba entero en `test-file-clipboard.mts`.

## Descartes

- Escribir los ficheros en el portapapeles del sistema al copiar, para pegarlos en el gestor de
  archivos: exige serializar a mano el formato binario de lista de ficheros, que Electron no
  expone. Mucha superficie de fallo para una dirección que casi nadie usa.
