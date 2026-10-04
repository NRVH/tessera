# El árbol de claves acumula el SCAN por base, no da por vacía una vuelta sin claves y agrupa por `:` sin cambiar el nombre

- **Estado:** vigente
- **Ámbito:** `arbolClaves.ts`, `claves/bytesClaves.ts`

## Contexto

Una conexión de claves cuelga bases numeradas, y de cada base sus claves. Las claves son bytes, y
SCAN no promete nada: puede devolver una clave dos veces y vueltas vacías a media travesía (con
`MATCH`, y hasta sin él en una base grande). El contrato del main está en
[claves-controlador.md](claves-controlador.md).

## Decisión

- **Una vuelta vacía con cursor distinto de `'0'` no es «Sin claves».** `recorrerClaves` sigue
  pidiendo sola hasta `VUELTAS_POR_CLIC` vueltas mientras no llegue ninguna clave; si aun así no
  llega, el árbol lo dice y ofrece «Seguir buscando». No se sigue sin fin: una base de millones con
  un patrón que no casa sería un bucle contra el servidor que nadie pidió.
- **El recorrido se acumula por base** (cursor, claves sin repetir por su base64 y patrón). Un
  fallo de «Cargar más» no tira lo cargado: vuelve el recorrido con `errorMas` y la fila ofrece
  «Reintentar». Solo un fallo de la primera carga es el error de la carga.
- **Sin conteos** (ACL sin `+info`): ninguna base lleva cifra y todas se recorren; pintar un 0
  decía «Sin claves» en bases llenas. Si la petición de bases falla entera, el árbol enseña las
  `basesPorDefecto` del descriptor y, detrás, el error con su «Reintentar».
- **El nombre pintado se calcula una vez**, al llegar la página, y la agrupación en carpetas una
  vez por recorrido (memo por identidad: el recorrido es inmutable).
- **Carpetas por `:`** sobre el nombre pintado; la clave se pinta con su nombre ENTERO, porque es
  lo que se copia, se busca y se escribe en la consola. Una clave y una carpeta pueden llamarse
  igual (`a` y `a:b`): son dos filas.
- **El patrón `MATCH` es por base** y lo guarda la caché (`cacheMetaBd`), no el árbol: sobrevive
  al desmontaje del lateral y a «Refrescar». Con comodines va tal cual; sin ellos se busca el
  texto en cualquier parte (`*texto*`). Un prefijo literal se escapa (`escaparGlob`): `cache:[v2]:`
  sin escapar es una clase de caracteres y casaría claves ajenas.
- **Identidad = base64.** Lo que vuelve al main para pedir una clave es siempre su base64, nunca el
  texto pintado (`pintarBytes` solo enseña).

## Consecuencias

`arbolClaves.ts` es una hoja (solo importa valores de `claves/bytesClaves.ts`) y lo importan las
piezas de `arbolBd.ts`: un valor de `arbolBd*` aquí cerraría un ciclo que revienta al cargar.
