# Descompiladores de Java

Descompiladores de Java de terceros que Tessera distribuye dentro de su instalador para
enseñar los archivos `.class`. Se redistribuyen sin modificar y corren como un proceso aparte
con un entorno de Java encontrado en el equipo del usuario. Sus textos de licencia están a su
lado y deben viajar con ellos.

| Archivo | Versión | Licencia | SHA-256 | Origen |
| --- | --- | --- | --- | --- |
| `cfr-0.152.jar` | 0.152 | MIT (`LICENSE-cfr.txt`) | `f686e8f3ded377d7bc87d216a90e9e9512df4156e75b06c655a16648ae8765b2` | <https://github.com/leibnitz27/cfr/releases/download/0.152/cfr-0.152.jar> |
| `vineflower-1.12.0.jar` | 1.12.0 | Apache-2.0 (`LICENSE-vineflower.txt`) | `1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d` | <https://github.com/Vineflower/vineflower/releases/download/1.12.0/vineflower-1.12.0.jar> |

- **CFR** — Copyright (c) 2011-2019 Lee Benfield, <https://www.benf.org/other/cfr>. Corre con
  Java 6 o posterior.
- **Vineflower** — una bifurcación mantenida del descompilador Fernflower,
  <https://vineflower.org>. Necesita Java 17 o posterior.

Ninguno de los dos jar trae su propio archivo de licencia, y por eso los textos se guardan
aquí. Para actualizar un motor, reemplaza el jar, actualiza esta tabla (versión, suma de
comprobación y URL) y las rutas de `src/main/java/`. Cómo se elige el motor para cada clase, y
por qué el jar del usuario nunca entra en el classpath de la JVM, está registrado en
`docs/decisiones/java/`.
