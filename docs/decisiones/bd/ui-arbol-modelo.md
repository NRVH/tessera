# El árbol de BD se aplana en puro, pide lo que falta desde un solo sitio y usa claves de tupla por NUL

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/arbolBd*.ts`, `useArbolBd.ts`

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

## Consecuencias

Cambiar el separador o la posición de un elemento de la clave rompe en silencio la caché y la poda.

## Descartes

- Un elemento más en la tupla para la base: movía el tipo y el nombre en todas las claves.
- Pedir en el manejador del clic que despliega: se perdía lo desplegado por las otras vías.
