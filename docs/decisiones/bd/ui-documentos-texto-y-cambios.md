# Documentos en el renderer: el texto se lee de forma léxica, los cambios van por `_id` y cada modo de consulta recuerda lo suyo

- **Estado:** vigente
- **Ámbito:** `documentos/tokensDocs.ts`, `documentos/camposDocs.ts`, `documentos/coleccionDocs.ts`, `documentos/consolaDocs.ts`

## Contexto

Un documento cruza al renderer como TEXTO en notación del shell (lo escribe el serializador del
trabajador; ver [documentos-controlador.md](documentos-controlador.md)) y el renderer no carga
`bson`. Para pintarlo, editar una celda y armar «Enviar» hace falta leerlo, pero solo por su forma.

## Decisión

- **Lectura léxica, nunca interpretación.** Un tokenizador pequeño (cadenas, números, regex,
  constructores como `ObjectId(…)`, puntuación) basta para colorear, sangrar y sacar los campos de
  primer nivel. Vale igual para EJSON relajado que para la notación del shell. Lo que se envía es
  el texto tal cual: quien lo interpreta, sin evaluar, es el trabajador, que es la autoridad y
  devuelve el error. Lo mismo vale para partir la consola en sentencias (`consolaDocs.ts`), con un
  divisor propio: el de SQL (`shared/sql/divisorSql.ts`) no sabe de regex, plantillas ni llaves
  abiertas, y enseñárselo metería JavaScript en un léxico que comparten cuatro motores.
- **Cambios pendientes por `_id`** (EJSON canónico), nunca por posición: recargar o pedir más
  páginas no los pierde. Un documento tiene como mucho un cambio (actualizar campos, reemplazar o
  borrar) y los nuevos van aparte. `cambiosDeEdicion` sale en el orden de la interfaz y
  `edicionDeCambios` es su inversa: tras un envío sin transacción que paró en el cambio N, lo
  pendiente es exactamente `cambios.slice(aplicados)`.
- **Dos modos de consulta** (guiado y JSON), y cada uno recuerda lo último que aplicó: al cambiar
  de modo se vuelve a pedir con lo aplicado del que se ve, para que la tabla diga lo mismo que la
  barra visible. El orden de la cabecera vale en los dos y es excluyente con el orden de texto:
  ordenar por la cabecera vacía el texto y aplicar un texto no vacío vacía la cabecera.

## Consecuencias

Si el texto no se entiende, el panel lo enseña tal cual y la celda no se edita (se edita el
documento entero). El tipo de una celda editada sale de su primer token solo para colorearla
mientras está pendiente; tras «Enviar» se recarga y manda el del servidor.

## Descartes

- Un parser de verdad en el renderer: duplicaría al trabajador y sumaría una dependencia para leer.
- Traducir un modo de consulta al otro: de un JSON cualquiera a filas guiadas no hay vuelta general.
