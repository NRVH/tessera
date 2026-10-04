# Se enumeran todas las JVM del equipo, de forma perezosa, y el motor lo decide la versión de bytecode de cada clase

- **Estado:** vigente
- **Ámbito:** `src/main/java/JavaRuntime.ts`, `javaVersion.ts`

## Contexto

CFR corre en Java 6+ y Vineflower exige 17+. En un puesto legacy `JAVA_HOME` apunta al JDK 8 que
pide el proyecto y además hay un 17 o un 21 instalados. `java -version` escribe en STDERR en todas
las JVM (el `--version` por stdout existe desde el 9), y la numeración cambió en Java 9:
«1.8.0_202» (el major es el segundo número) frente a «17.0.12».

## Decisión

- Se enumeran TODAS las JVM (registro, carpetas conocidas por plataforma, `JAVA_HOME`, `PATH`) y
  para cada motor se usa la MAYOR que cumple su requisito: una JVM moderna descompila bytecode viejo
  y al revés no. Quedarse con la primera dejaría inaccesible el motor cuya salida es la que el
  usuario reconoce de su IDE, sin que entienda por qué.
- La detección es perezosa (la primera vez que se abre un .class) y se recuerda entre sesiones con
  una huella barata del entorno (`JAVA_HOME`, `PATH`, mtime de las carpetas conocidas). Se sondean
  4 a la vez: con 16 compiten entre ellas, la mediana pasa de 2 s a 5 s y se pierden JVM por tope.
- La versión se lee de stderr más stdout y el major es `primero === 1 ? segundo : primero`; 0
  significa «no lo sé» y quien decide lo trata como «no la uses».
- En «auto» el motor lo decide el major del class file: por debajo de 49 (Java 5) no hay
  `EnclosingMethod` y Vineflower emite `new Foo$1(this)`, que no es Java; gana CFR. Por encima gana
  Vineflower. Si el elegido no tiene JVM que lo arranque, se cae al otro avisando.
- En macOS los JDK son bundles (`<jdk>/Contents/Home/bin/java`) y las rutas conocidas son las de
  Apple, las de Homebrew (`/opt/homebrew/opt` y `/usr/local/opt`) y las que crean herramientas
  multiplataforma (`~/.jdks`, SDKMAN!).

## Consecuencias

Un lector de versión que mire solo stdout devuelve vacío justo para los JDK viejos, que son los que
más importan. El java elegido a mano se persiste en `java-runtime.json` con respaldo `.bak`.

## Descartes

- Más paralelismo en el sondeo: medido con 12 candidatos, no acorta el total y pierde detecciones.
- Elegir el motor por preferencia fija: la salida inválida de Vineflower con bytecode anterior a 49
  está medida, no es una cuestión de gusto.
