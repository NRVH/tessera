# Redis a Sentinel y a Cluster: una topología en la conexión, el cursor compuesto y lo que se dice

- **Estado:** vigente
- **Ámbito:** `src/shared/topologiaRedis.ts`, `src/tdb/topologiaRedis.cjs`, `src/tdb/clusterRedis.cjs`, `src/tdb/sesionRedis.cjs`, `src/renderer/src/features/bd/DbConexionTopologia.tsx`

## Contexto

Una conexión de Redis iba a un servidor. Sentinel da el maestro por su nombre y lo cambia en un failover;
Cluster reparte las claves por slots entre varios maestros y redirige (MOVED, ASK). Lo que el explorador y
`tdb` hacen con un servidor tiene que seguir valiendo, y lo que no tiene sentido se dice.

## Decisión

- **Un campo, `topologiaRedis`** (ausente = un servidor), y la lista de servidores en el `host` de siempre,
  separada por comas como el replica set de MongoDB. Una lista sin topología se rechaza: el cliente usaría
  solo el primero. Ni Sentinel ni Cluster van por túnel SSH (el cliente llega a servidores que el túnel no
  lleva): el formulario apaga el selector y el main lo rechaza, como MongoDB con varios servidores.
- **La contraseña de los sentinels**: ninguna, la misma que Redis, o una propia. La propia va con la de Redis
  en un sobre cifrado (el mismo secreto de siempre), así que el puente, el entorno y la huella no cambian;
  solo lo abre `clienteRedis` cuando la topología lo dice. Editar sin tocarlas no recifra.
- **Sentinel**: un intento por sentinel y sin reintentos; si ninguno da el maestro, se dice si no contestan o
  si no vigilan ese nombre. Tras un failover el maestro viejo cierra sus clientes: la sesión no se da por
  perdida y la siguiente operación pregunta otra vez (un MULTI abierto se pierde). Sin el vigilante de
  `+switch-master` del cliente: abriría una conexión más a cada sentinel por sesión.
- **Cluster**: solo la base 0 (el árbol enseña una, la consola no ofrece SELECT). El SCAN recorre los
  maestros en orden de `host:puerto` con un CURSOR COMPUESTO, `maestro·2^64 + cursor`, que sigue siendo un
  número en texto con '0' de principio y fin, así que el árbol, «Cargar más», el borrado por patrón y `tdb`
  no cambian. En la consola, lo que no va a un nodo: DBSIZE y KEYS suman, FLUSHDB y FLUSHALL van a cada
  maestro, INFO trae el de cada uno con su nombre, SCAN usa el cursor compuesto, y DEL, UNLINK, EXISTS,
  TOUCH y MGET se reparten clave a clave. Los demás sin clave van a un maestro cualquiera. MULTI no se
  admite (cada comando puede ir a otro nodo) y CROSSSLOT llega con su explicación. Cancelar es abandonar:
  no hay un `CLIENT ID` al que soltar.

## Descartes

- MULTI fijado a un nodo: solo valdría con claves de un slot, y si no, el error llegaría tras encolar.
- Leer de réplicas: el visor enseñaría datos atrasados sin decirlo. Pegar URI de Sentinel o Cluster: no
  hay un esquema común; el modo se elige en el formulario.

`ControladorClaves` admite cursores de hasta 24 cifras (32 maestros caben).
