# Borrar por patrón en Redis enseña lo que borra y borra exactamente eso, con `UNLINK` por la consola

- **Estado:** vigente
- **Ámbito:** `claves/borradoClaves.ts`, `claves/DialogoBorrarClaves.tsx`, `arbolMenu.tsx`

## Contexto

Limpiar una familia de claves (`cache:*`, un prefijo de sesión) con un `KEYS` + `DEL` a mano es lo peor que
se puede hacer a un servidor, y una consola con `SCAN` es lo bastante incómoda como para que se haga mal. Es
destructivo y no se deshace.

## Decisión

- **Vista previa primero, y se borra lo que se vio.** El diálogo recoge las claves que casan con `SCAN`
  (sin repetir, por su base64), enseña cuántas son y las primeras, y solo con «Borrar N claves» envía los
  `UNLINK` de ESAS claves. Nunca se vuelve a escanear: lo que aparezca después no se borra.
- **`UNLINK` y no `DEL`**: libera la memoria en segundo plano y no bloquea al servidor con una clave grande.
  Va en comandos de 200 claves (y de 256 KiB de texto como mucho), de uno en uno, por una sesión propia de la
  consola de Redis del main (`visor-borrar-…`, que no entra en el historial).
- **La política es la del main, no la del diálogo.** La solo lectura impuesta rechaza el primer lote y no se
  borra nada. La marca de producción: el diálogo lleva la franja y su botón dice «Borrar en producción»; ese
  botón es la confirmación y viaja como `confirmado`. Si el servidor rechaza un lote, se para ahí y se dice
  cuántas se habían borrado. Tessera informa y pide confirmar; no prohíbe al humano.
- **Con tope y con Stop.** La recogida llega a 100 000 claves como mucho (la vista previa lo dice y se borrarán
  esas; si quedan más, se repite) y se puede detener, igual que el borrado entre dos lotes. Cerrar el diálogo
  durante el borrado no es posible: se sale con «Detener».
- **El patrón es el del filtro del árbol** (`patronDeFiltro`): con comodines de Redis tal cual, sin ellos el
  texto en cualquier parte. Se abre desde la base (con el filtro actual) y desde una carpeta (su prefijo,
  escapado). Un patrón que casa con todo (`*`) se avisa en la vista previa.
- **Al terminar con algo borrado**, el árbol de la conexión se vuelve a pedir.

## Descartes

- Un `SCAN` + `UNLINK` en el main con un solo canal: duplicaría la política de la consola y haría que el
  diálogo no pudiera enseñar nada antes.
- Pedir que se escriba el número de claves para confirmar: la vista previa con el recuento y el botón rojo
  (o el de producción) ya obligan a mirar; escribir un número se hace sin leer.
- `KEYS pattern`: bloquea el servidor mientras recorre todo.
