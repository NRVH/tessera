# Las claves que se guardan en disco se calculan desde sus tipos y se vigilan contra una lista

- **Estado:** vigente
- **Ámbito:** `src/main/raicesPersistidas.ts`, `scripts/calidad/clavesPersistidas.mts`,
  `scripts/calidad/spreadsPersistidos.mts`, `scripts/calidad/test-claves-persistidas.mts`,
  `scripts/calidad/claves-persistidas.tsv`

## Contexto

Los registros de Tessera conservan las claves que no reconocen, para no perder datos de otra versión.
Por eso, renombrar una propiedad de un tipo que se guarda no da ningún error: compila, las pruebas con
datos nuevos pasan, y quien actualiza encuentra su configuración en el valor por defecto. El tipo que se
guarda rara vez es uno solo: hereda del DTO del IPC (`extends Omit<…>`), reutiliza tipos compartidos y
recibe objetos por spread, así que marcar a mano los tipos «de contrato» deja fuera lo heredado.

## Decisión

- `src/main/raicesPersistidas.ts` declara, por tipo, la forma de cada archivo que se escribe o se
  intercambia con otro programa. Nadie lo importa; un renombrado de sus tipos lo actualiza el compilador.
- `npm run test:claves-persistidas` recorre esos tipos con el compilador (herencia, `Omit`/`Pick`,
  uniones, listas, `Record`, literales) y compara las rutas serializadas
  (`db-connections.json#connections[].tls.cifrar`) con `scripts/calidad/claves-persistidas.tsv`.
  Una ruta que desaparece o cambia de forma es rojo; una nueva, también, hasta que entra en la lista
  (`-- --actualizar`). La lista no depende del nombre de ningún tipo ni de ningún archivo.
- Además, es rojo un spread hacia un tipo persistido que trae una clave que ese tipo no declara: el
  compilador no revisa las claves de un spread, y así se guarda una clave con otro nombre. Se revisan
  todos los miembros de un origen unión. Una clave que el destino no declara solo se exime si es
  persistida y el tipo que la declara está en la herencia del destino: el destino hereda de él, o él
  hereda todo lo persistido del destino (el paso del disco a su DTO). Que los dos tipos se guarden en un
  mismo artefacto no basta: una raíz que agrupa varios tipos los haría parientes a todos.
- Si el destino es una unión discriminada y el literal fija una clave con un valor unitario (un texto o
  número literal, `true`, `false` o `null`), escrito, abreviado o traído por un spread, solo se revisan
  las variantes que lo admiten: las demás tomarían por sobrantes las claves de la elegida. Un valor que
  no es unitario, o que un spread trae opcional, no descarta ninguna variante, y si ninguna lo admite se
  revisan todas.
- Retirar una clave a propósito exige leer su nombre viejo (`retirada`, con el archivo que lo lee) o
  renunciar al dato por escrito (`descartada`, con su motivo).
- La lista va en el mismo commit que los tipos que protege: el hook detiene un commit si la lista tiene
  cambios sin preparar.
- Las raíces cubren los archivos que Tessera guarda (configuración, estado, copias de seguridad y
  registros de actividad), lo que intercambia con otro proceso o programa con un tipo propio, y los formatos de
  otros programas que lee (`ajeno:`), donde lo fijado es lo que se lee. Los mapas planos cuyo contenido
  son datos y los archivos de texto quedan fuera: no tienen claves propias que fijar.
- De lo que se intercambia, se vigilan enteros el diagnóstico (`logs/salud.jsonl`), el encargo del
  relevo, las respuestas de `resolve` y de `ctx.modelos` del puente, y las peticiones y el sobre de las
  respuestas del trabajador de BD; de lo que lleva dentro una respuesta del trabajador, solo el resultado
  de `ejecutar`. De `ctx.tareas`, `ctx.tarea`, `ctx.cuentas`, `ctx.buscar` y `ctx.docs` se vigilan solo
  los elementos (la tarea, la cuenta, la coincidencia, el documento), y de `ctx.delegar`, su tarea, que es
  la misma: su sobre (`ok`, `tareas`, `coincidencias`, `hayMas`…) se arma en un literal sin tipo, que un
  renombrado simbólico no cambia y que la guardia no ve. Las demás operaciones del puente no tienen raíz.
- `test:copias-congeladas` abre las copias de `src/main/configuracion/copias-congeladas/` con su frase
  conocida para fijar la cabecera autenticada, la detección del formato y el historial. Nunca se
  regeneran; cada formato nuevo añade su archivo.

## Consecuencias

- El nombre de una clave guardada no se cambia; el del símbolo en memoria sí, con un adaptador.
- Una raíz que no resuelve, o que desaparece con filas en la lista, es rojo: la guardia no da verde
  sobre lo que no vigila.
- No ve las lecturas por cadena sobre `unknown`, los `.cjs`, las asignaciones sin spread ni los
  lectores que leen un archivo persistido con un tipo propio; eso lo cubren las pruebas del área y las
  de `tdb`.

## Descartes

- Una marca en el JSDoc de cada tipo de contrato: no ve lo heredado ni lo que llega por spread, y se
  desactualiza sin que nada falle.
- Separar en cada almacén una forma en disco con un mapeo propio: cuesta reescribir el código que
  conserva los datos de otras versiones, y el mapeo se puede renombrar igual de mal.
- Revisar también las asignaciones sin spread: da casi solo falsos (variantes de una unión, tipos que
  estrechan con `Pick`).
- Contrastar con las raíces los `JSON.parse` con tipo y las siembras de `e2e/`: sin un vínculo de tipos
  con el archivo, asociarlos por el nombre que aparece en el código no distingue un lector de una
  comprobación de que una clave falta ni de un `JSON.stringify` para comparar, y da casi solo falsos.
