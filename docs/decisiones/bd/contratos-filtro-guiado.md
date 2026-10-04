# El filtro guiado es un contrato de estructura: el renderer lo arma y el main lo valida otra vez y lo compila

- **Estado:** vigente
- **Ámbito:** `src/shared/filtroGuiado.ts`, `src/main/db/explorador/filtroSql.ts`, `src/main/db/explorador/documentos/filtroDocumentos.ts`

## Contexto

Una barra `WHERE` de texto libre exige saber el dialecto: las comillas dobles son un identificador en Oracle,
y `ESTATUS="NOMINA PROCESADA"` daba ORA-00904 a algo que para el usuario era un texto. La mayoría de las
veces lo que se quiere es «esta columna, este operador, este valor».

## Decisión

- El filtro por defecto es guiado (columna, operador según el tipo de la columna, valor, unidos con Y u O) y
  el `WHERE` libre queda tras el botón «SQL». El orden no es texto: lo da el clic en la cabecera
  (`DbOrdenColumna`).
- El renderer solo manda la estructura; el main la valida otra vez con `validarFiltro` (este módulo: el
  renderer puede mentir) y la compila a SQL con parámetros por dialecto o al documento de filtro de MongoDB.
  Los valores nunca van en el texto de la consulta, así que un `'` o un `"` es un carácter más.
- Semántica (la fijan los compiladores; aquí, para leerla en un sitio):
  - «contiene» y «empieza por» no distinguen mayúsculas y los comodines del usuario son caracteres.
  - «≠» incluye las filas vacías: `<>` a secas las descarta en silencio y eso sorprende.
  - «está vacío» es NULL (o campo ausente) y, en texto, también la cadena vacía.
  - Fechas ISO: una fecha sin hora contra una columna con hora es el día entero (`= 28` es [28, 29), `> 28`
    es desde el 29, `entre 1 y 3` es [1, 4)). «entre» incluye los dos extremos.
- Sin DOM, sin `process`, sin electron: lo importan renderer, main y pruebas con `node` a secas.

## Descartes

- Mandar el SQL ya armado desde el renderer: repartía la gramática de cuatro dialectos entre dos procesos y
  ponía los valores en el texto.
- Que el renderer mande el tipo del motor (`VARCHAR2`, `int8`) y el main decida la categoría: la interfaz
  necesita la categoría antes (qué operadores ofrecer). Una categoría mentida acaba en un error del servidor,
  no en una inyección.

## Consecuencias

SQL: [rejilla-filtro-guiado-sql.md](rejilla-filtro-guiado-sql.md); documentos:
[documentos-filtro-guiado.md](documentos-filtro-guiado.md).
