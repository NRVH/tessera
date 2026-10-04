# El formateo solo cambia blancos y caja, y los textos de la Salida son contrato

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/consola/` (`formateoSql`, `salidaConsola`)

## Contexto

Un formateador es código ajeno que reescribe SQL del usuario; la Salida se lee a diario y el e2e la busca literal.

## Decisión

- **Formatear por sentencia** (`[desde, hastaContenido)`), dejando byte a byte terminadores,
  comentarios, líneas en blanco y SQL*Plus. Solo consultas, DML, SELECT…FOR UPDATE y CREATE
  TABLE/VIEW: PL/SQL, GRANT, ALTER SESSION o `$$…$$` salían peor (medido).
- **La guarda**: el resultado tiene que dar los MISMOS tokens en nuestro léxico (caja aparte,
  comentarios por palabras), seguir siendo una sentencia de la misma clase y no juntar en una
  línea dos cadenas de PG que la continuación unía. Si no, esa sentencia se deja como estaba.
- **Opciones**: palabras clave y tipos en mayúsculas, funciones e identificadores tal cual,
  sangría 4, ancho 100, el espacio ante `(` como lo escribió el usuario, `:"Id"` como parámetro.
- **En el editor**: una parada de deshacer, un reemplazo por sentencia que cambia (las marcas de
  las demás no se mueven), el cursor por caracteres no blancos y el fin de línea del MODELO.
- **sql-formatter por `import()` dinámico** (312 KiB que solo hacen falta al formatear).
- **Salida**: cada frase sale de UNA función de `salidaConsola.ts`, con singular y plural y los
  miles de la rejilla; enlaces y acciones viajan aparte del texto; anillo de 1000 entradas; tope de
  500 líneas del servidor por sentencia; la línea y columna de compilación son las del servidor.

## Consecuencias

- Un texto nuevo de la Salida se añade como función aquí, con su prueba; nunca en un componente.
- Subir sql-formatter exige repasar las omisiones: sus casos están en `test:db-formateo-sql`.

## Descartes

- Formatear el texto entero de una vez: no sabe de SQL*Plus y colapsa los blancos entre sentencias.
- Alineación tabular: se lee bien en capturas y se desalinea con cada edición.
- Expandir la selección a sentencias completas: se formatea exactamente lo seleccionado.
