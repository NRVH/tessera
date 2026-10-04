# La caché del catálogo es la única autoritativa, sin caducidad por tiempo y con cargas atadas a su generación

- **Estado:** vigente
- **Ámbito:** `CacheCatalogo.ts`

## Contexto

El árbol y el autocompletado piden al diccionario del servidor (a menudo al otro lado de una VPN)
esquemas, objetos, detalle de tablas, fuentes e índice de nombres. El renderer tiene su propia
caché, pero solo se invalida con `dbx:ev:catalogo`, que emite esta clase.

## Decisión

- **Sin TTL:** un catálogo caduca porque alguien hizo un DDL. Los de Tessera invalidan solos; los
  de fuera se ven con «Refrescar».
- **LRU por conexión** (`MAX_ENTRADAS_POR_CONEXION`): acota la memoria con 150 esquemas abiertos.
- Cada entrada guarda su esquema como campo (no partiendo la clave) y su base (nivel «Bases» de SQL
  Server: el mismo `dbo` existe en cada base). Invalidar un esquema sin base lo quita en todas.
  Las claves ajenas entrantes caen con la invalidación de cualquier esquema.
- **`memo` deduplica las cargas en vuelo, pero solo dentro de su generación:** una carga que termina
  después de invalidar su conexión no se guarda, y quien pregunta después de invalidar no se engancha
  a una carga empezada antes (recibiría el dato de antes del DDL y el árbol se quedaría sin la tabla
  recién creada). El coste es, como mucho, una consulta de más.
- Los errores no se cachean. El evento `dbx:ev:catalogo` sale antes de que responda el `invoke`
  que lo causó.

## Consecuencias

No se guarda el índice de autocompletado fusionado (depende de los esquemas visibles y del actual de
cada consola): se guarda por esquema y el controlador fusiona al pedirlo.
