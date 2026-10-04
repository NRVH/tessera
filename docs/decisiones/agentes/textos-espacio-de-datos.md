# El agente del espacio de datos se nombra «el agente de datos», nunca «este proyecto»

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/textosMontajeBases.ts` (y su eco en `src/tdb/tdb.cjs` y `main/db/briefingAgente.ts`)

## Contexto

La cabecera del agente vive en dos sitios: el agente de cada proyecto y el de la vista Bases de
datos. Por dentro el segundo es un target de proyecto más (una carpeta por perfil), pero para el
usuario no es un proyecto: no sale en la banda de pestañas y la vista lo llama «el agente de
datos». Decirle «en este proyecto» lo mandaba a buscar un proyecto que no había abierto.

## Decisión

- Una sola función decide cada texto con `esEspacioDeDatos`: selector de montaje, rótulo del
  historial y lugar del modal. Repartirlos acaba con uno que dice «agente de datos» y otro que
  se quedó en «este proyecto».
- En un proyecto los textos no cambian ni un carácter: el test los fija contra los literales.
- No se nombra el proyecto (el montaje es de la carpeta, no de la pestaña) ni el nombre viejo
  del espacio («consola de datos»).
- En el espacio de datos el modal de historial no enseña su carpeta: es el ID del perfil.
- Los `aria-label` no dicen dónde y no pasan por aquí; tampoco las casillas del mosaico, que
  sólo enseñan targets de proyecto.

## Consecuencias

- Los mensajes de `tdb` y el aviso de arranque del agente hacen la misma distinción en el main;
  cambiar la expresión aquí obliga a cambiarla allí.
