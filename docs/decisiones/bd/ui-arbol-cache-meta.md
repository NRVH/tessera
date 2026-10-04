# La caché de catálogo del renderer es un módulo que solo invalida el evento del main, marcando obsoleto

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/cacheMetaBd*.ts`

## Contexto

El árbol, el popover de esquemas y el autocompletado leen el catálogo sin cruzar el IPC en cada
render ni en cada tecla. La autoritativa vive en el main ([explorador-cache-catalogo](explorador-cache-catalogo.md));
esta es su copia, y lo ya pedido (por VPN, a veces segundos) tiene que sobrevivir a que el
lateral se desmonte al cambiar de vista.

## Decisión

- **Es un módulo, no estado de React;** la API del main se inyecta (`new CacheMetaBd(api)`).
- **La única invalidación es `dbx:ev:catalogo`,** que el main emite antes de responder a lo que
  la causó. Nadie invalida a mano: dos caminos acaban discrepando.
- **Invalidar marca obsoleto, no borra:** lo obsoleto se sigue pintando y quien lo pinta pide
  el refresco (borrar hacía parpadear el árbol justo tras un CREATE TABLE). Los errores
  afectados sí se borran; si un refresco falla, el dato viejo se tira y queda el error.
- **Vuelos deduplicados por clave;** si llega una invalidación con uno en vuelo, su respuesta
  nace obsoleta y una petición nueva no se engancha a la vieja. Escribe solo la última.
- **El detalle se pide por partes y se fusiona** solo con lo que sigue fresco; el árbol ve la
  entrada cuando trae todas sus partes.
- **Errores del índice de nombres y de los públicos se recuerdan 30 s** (el autocompletado
  pregunta en cada tecla); los del árbol no caducan solos.
- **Las claves ajenas se invalidan con cualquier DDL de la conexión** (las que entran en una
  tabla las declara otra, quizá de otro esquema), y las vuelve a pedir quien las usa
  (`fksObsoletas`): no tienen fila del árbol que las recargue.
- **Con nivel «Bases»,** la invalidación de un esquema alcanza a ese esquema en todas las bases
  (el evento no dice de cuál): de más solo cuesta un viaje.
- **Claves de Redis:** el recorrido de una base se acumula con la misma deduplicación e
  invalidación; el patrón de cada base vive aquí, y cambiarlo tira lo recorrido y el vuelo.

## Consecuencias

Lo de una conexión borrada se queda hasta cerrar la app: es poco y podarlo exigiría otro camino
de invalidación.
