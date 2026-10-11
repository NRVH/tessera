# Lo de un perfil solo se borra con su orden explícita, nunca porque falte en la lista guardada

- **Estado:** vigente
- **Ámbito:** `src/main/profiles/ordenDeBorrado.ts`, `src/main/profiles/borradoDePerfil.ts`, `src/main/agents/componer.ts` (`SAVE_PROFILES`, `DELETE_PROFILE`), `src/renderer/src/features/pestanas/useAccionesTabs.ts`

## Contexto

El renderer guarda la lista COMPLETA de perfiles en cada cambio (alta, nombre, orden, color). El
borrado de un perfil se deducía de esa lista: el que faltaba se daba por borrado, y con él se
borraban en firme sus conexiones SSH (con sus contraseñas y claves) y su historial de consultas. Al
arrancar, además, se podaban las conexiones SSH, las de bases de datos y el historial de todo perfil
que no estuviera en `profiles.json`. Cualquier guardado incompleto (un estado a medio cargar, un fallo
del renderer, una función futura que reconstruya la lista) o un `profiles.json` resembrado se
llevaba datos sin que nadie hubiera pulsado «borrar», y sin vuelta atrás.

## Decisión

- Un canal propio, `profiles:delete` (`IPC_CHANNELS.DELETE_PROFILE`), que el renderer solo envía al
  borrar un perfil. El main lo apunta en `userData/perfiles-borrados.json`, lo saca de la lista,
  persiste y borra lo suyo (`borrarPerfiles`, con su candado tomado en la misma vuelta). Al terminar,
  lo quita de pendientes.
- `SAVE_PROFILES` nunca borra: a la lista que llega se le devuelven, en su sitio, los perfiles que no
  trae (`listaAGuardar`), y se registra.
- Al arrancar no se poda nada por la lista: se terminan los borrados pendientes cuyo perfil ya no está
  en ella. Los que siguen (la orden no llegó a sacarlos) o se recrearon (mismo id, también con otra
  caja) se olvidan sin tocar nada.
- Las conexiones de bases de datos se borran con el perfil, como las SSH. Antes solo se iban en la
  poda del siguiente arranque.

## Consecuencias

- Si la orden falla al guardar la lista, el perfil sigue en el main y vuelve a aparecer al reabrir: el
  fallo acaba en «no se borró», nunca en «se borró de más».
- Lo que dejó huérfano un cierre sucio ANTES de esta decisión (una conexión de un perfil ya borrado)
  se queda en su archivo sin que nadie lo vea. Un perfil recreado con el mismo nombre volvería a verlo.

## Descartes

- Mantener la deducción y endurecer solo el renderer: el riesgo está en que GUARDAR pueda BORRAR, y
  cualquier camino nuevo que guarde la lista lo heredaría.
- Seguir podando al arrancar con la lista de perfiles: un `profiles.json` que falte se resiembra con
  los perfiles por defecto, y la poda se llevaba las conexiones de todos los demás.
