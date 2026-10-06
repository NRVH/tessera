# El agente del espacio de datos se nombra «el agente de datos», nunca «este proyecto»

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/textosMontajeBases.ts` (y su eco en `src/tdb/tdb.cjs` y `main/db/briefingAgente.ts`)

## Contexto

La cabecera del agente vive en tres sitios: el agente de cada proyecto, el de la vista Bases de
datos y el de la terminal a pantalla completa. Por dentro los dos últimos son un target de proyecto
más (una carpeta por perfil), pero para el usuario no son un proyecto: no salen en la banda de
pestañas y cada uno se llama por la vista donde vive, «el agente de datos» y «el agente de la
terminal». Decirle «en este proyecto» lo mandaba a buscar un proyecto que no había abierto.

## Decisión

- Una sola función decide cada texto con `lugar: 'proyecto' | 'datos' | 'terminal'`: selector de
  montaje, rótulo del historial y lugar del modal. Repartirlos acaba con uno que dice «agente de
  datos» y otro que se quedó en «este proyecto».
- En un proyecto y en el espacio de datos los textos no cambiaron ni un carácter al pasar del
  booleano al lugar: el test los fija contra los literales.
- No se nombra el proyecto (el montaje es de la carpeta, no de la pestaña) ni el nombre viejo
  del espacio («consola de datos»).
- En el espacio de datos y en el agente de la terminal el modal de historial no enseña su carpeta:
  es el ID del perfil.
- Los `aria-label` no dicen dónde y no pasan por aquí; tampoco las casillas del mosaico, que
  sólo enseñan targets de proyecto.

## Consecuencias

- Los mensajes de `tdb` y el aviso de arranque del agente hacen la misma distinción en el main;
  cambiar la expresión aquí obliga a cambiarla allí.
- El agente de la terminal no monta bases en su primera versión: sus textos de montaje existen y
  están probados, pero su selector no se pinta (`agentes/agente-de-la-terminal.md`).
