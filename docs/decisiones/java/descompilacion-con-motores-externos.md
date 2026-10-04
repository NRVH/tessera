# Una clase se descompila extrayéndola con sus internas a un temporal y lanzando el motor como subproceso corto, sin que el jar del usuario entre en el classpath de la JVM

- **Estado:** vigente
- **Ámbito:** `src/main/java/Decompiler.ts`, `decompilerArgs.ts`, `JavaService.ts`

## Contexto

Los dos motores (CFR y Vineflower) son jars que corren en una JVM del equipo del usuario, sobre
clases que vienen de un jar del proyecto, a veces anidado (`app.war!/WEB-INF/lib/x.jar`), o de un
blob de git sin ruta de disco. Lo que se pasa al lanzador de Java decide si esto es un visor o un
vector de ejecución de código.

## Decisión

- Se extraen a un temporal la clase Y sus internas (`Foo$*.class`) con su ruta de paquete completa,
  y se lanza el motor sobre ese árbol: CFR solo integra las internas que encuentra al lado, y
  Vineflower con un `.class` suelto devuelve código inválido (`return new 1(this);`) con salida 0.
- El jar del usuario NUNCA va en `-cp`/`-classpath`: va como argumento posicional o en
  `--extraclasspath`/`-e=`, que para el motor son entrada de análisis. El entorno se limpia de
  `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS` y `CLASSPATH`: un `-javaagent` heredado
  es ejecución de código dentro de nuestra JVM.
- Subproceso endurecido: tope de tiempo, tope de salida y semáforo de dos JVM (cientos de MB de RSS
  cada una). `-Dfile.encoding` y `stdout.encoding` en UTF-8, sin lo cual la «ó» sale en Cp1252 por
  un pipe de Windows; a CFR, `--hideutf false`. El delimitador del `--extraclasspath` es el de la
  plataforma (`delimitadorPath`), no un `;`: CFR parte por el `File.pathSeparator` de la JVM del host.
- Nunca se rechaza por un fallo del motor: se devuelve `estado` y `mensaje`. El origen de los bytes
  es una unión discriminada (`disco` | `bytes` con sus hermanas), no una ruta opcional: una ruta
  vacía escribiría las internas de ningún sitio en silencio.
- El contexto de tipos son los jars del mismo directorio (tope 64); medido, no cuesta nada.

## Consecuencias

Mover el jar a `-cp` es un cambio de una línea que convierte el visor en ejecución de código. Un
motor que se atraganta con una clase es normal, no excepcional, y así lo ve el usuario.

## Descartes

- `--jarfilter`/`--only=` contra el jar: ninguno direcciona un jar anidado, `--only=` sale con 1 sin
  producir nada, y si el filtro de CFR no casa vuelca el jar entero por stdout.
- `--disable-@files` en el prefijo de la JVM: rompe en 11 y 17 («Unrecognized option») y no protegía
  de nada: los argumentos son rutas absolutas de un temporal y nunca empiezan por `@`.
