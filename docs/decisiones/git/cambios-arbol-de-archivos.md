# El árbol de archivos de git es solo el de un commit y se compacta después de construirlo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/modelo/{arbolArchivos,rutasArchivo,arbolRamas}.ts`

## Contexto

La lista de archivos de un commit necesita carpetas, sangría y conteo; la vista de Cambios no.

## Decisión

- Solo el commit usa árbol: enseña qué zonas del proyecto tocó (Cambios es lista plana, ver
  `cambios-lista-y-marcas.md`). Por eso aquí no hay tri-estado ni índice de descendientes (eran
  de las casillas de carpeta que murieron con el árbol de Cambios).
- No se reutiliza el aplanador del explorador: es para carga perezosa (filas de carga y error,
  cadenas descubiertas por IPC) y aquí la lista ya está en memoria. Reusarlo acoplaría el
  explorador al panel de git.
- Se compacta DESPUÉS de construir, nunca al insertar: el resultado no depende del orden de
  llegada. Una cadena compactada tiene una sola clave, la ruta de su hoja, y ocupa UN nivel.
- Aquí se compacta y en el árbol de ramas no: las ramas son un espacio estable y colapsar
  `feature/` movería la fila bajo el cursor. La lista de un commit se reconstruye entera.
- No comparten constructor con el árbol de ramas aunque se parezcan: lo común son ~40 líneas, el
  nodo carpeta es de otro tipo y la clave de orden es otra.
- Las etiquetas de repo se numeran («server (1)», «server (2)») cuando el nombre se repite, y
  no se enseña nunca la ruta del host.

## Consecuencias

- Si vuelven las casillas a un árbol, el tri-estado se reescribe: no queda código que lo soporte.
