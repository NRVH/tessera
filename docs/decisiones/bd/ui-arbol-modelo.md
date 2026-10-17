# El árbol de BD se aplana en puro, pide lo que falta desde un solo sitio y usa claves de tupla por NUL

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/arbolBd*.ts`, `useArbolBd.ts`, `nivelBasesBd.ts`

## Contexto

El lateral es una lista virtual: `aplanarArbolBd` recibe lo cargado ([ui-arbol-cache-meta](ui-arbol-cache-meta.md)),
lo expandido y la búsqueda, y devuelve las filas en orden de pintado. El catálogo suele estar tras una VPN.

## Decisión

- **Orden:** conexión → consolas → (bases) → esquemas visibles → una carpeta por tipo en el
  orden de `catalogo.carpetas` → objetos → carpetas de detalle → hojas. La carpeta ES el tipo,
  sin agrupaciones intermedias; las de cuenta 0 se omiten antes de pedir la lista. PUBLIC
  (Oracle) es un pseudo-esquema que solo enseña sinónimos; sistema y pseudo van al final.
- **Qué se ve** lo decide la conexión (`resolverVisibles`), no el `visible` de la respuesta.
- **Carga perezosa desde UN sitio:** un nodo expandido sin datos pinta un marcador `loading` con
  su `CargaBd`, y tras cada render `useArbolBd` recoge `cargasPendientes` y las pide; así la cubren
  todas las vías de desplegar (clic, teclado, restaurar, «Mostrar en el árbol», búsqueda). Sin
  bucles: la caché deduplica y un error lleva su carga para «Reintentar», nunca se reintenta solo.
  Lo obsoleto se refresca solo en un contenedor DESPLEGADO (por la clave de la CARGA, `cargaDeFila`)
  y nunca con la búsqueda activa, que no sale al servidor.
- **La búsqueda filtra solo lo cargado** y fuerza abiertos los antepasados SIN tocar
  `expandidos`: al borrarla, el árbol queda como estaba. Las carpetas no se buscan. Las filas
  ajenas usan la regla exportada (`normalizarBusqueda`, `coincidenciaDe`), nunca una copia.
- **Claves = tuplas unidas por NUL** (escrito como escape), con el tipo de nodo delante; todas
  salen de `claveBd`, también la de una ajena, porque la caché y la poda las leen por posición.
  Con nivel «Bases», la posición del esquema lleva un ÁMBITO `base␁esquema` (`ambitoEsquema`).
- **Un árbol por familia** (`switch` con `nunca` sobre la familia del descriptor): documentos y
  claves montan el suyo con filas y cargas propias, sin pedir nada del catálogo SQL.

### El nivel «Bases»

SQL Server tiene varias bases por servidor y en él no se cambia el esquema de una sesión, sino la
base (`USE`). El árbol pinta un nivel «Bases» cuando la conexión no fija una (`tieneNivelBases`,
en `nivelBasesBd.ts`), y de ahí salen dos preguntas que se contestan una sola vez.

- **Un solo popover del «N de M»** para esquemas y bases: misma aritmética (`shared/dbEsquemas`),
  misma casilla tri-estado y mismo gesto; cambian la clave de caché, la carga, el canal que
  guarda y los textos. Los de esquemas son los de siempre al byte.
- **El selector de la consola** elige la BASE en un motor con nivel «Bases» (el main la aplica
  con `USE` por `CONSOLA_ESQUEMA` y relee `DB_NAME()`); con base fija no se pinta; en los demás,
  el esquema. Decide por `catalogo.nivelBases` del descriptor con `nunca`, no por el nombre del
  motor. Oracle, PostgreSQL y SQLite no ven nada distinto: las pruebas fijan sus textos.

## Consecuencias

Cambiar el separador o la posición de un elemento de la clave rompe en silencio la caché y la poda.

## Descartes

- Un elemento más en la tupla para la base: movía el tipo y el nombre en todas las claves.
- Pedir en el manejador del clic que despliega: se perdería lo desplegado por las otras vías.
- Un popover aparte para las bases: unas 300 líneas copiadas que acabarían divergiendo.
