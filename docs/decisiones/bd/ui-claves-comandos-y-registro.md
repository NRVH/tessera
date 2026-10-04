# La consola de claves ejecuta un comando por línea, lleva un registro propio y colorea con un Monarch sin estados

- **Estado:** vigente
- **Ámbito:** `claves/consolaClaves.ts`, `claves/monacoConsolaClaves.ts`

## Contexto

Redis no tiene sentencias: es un comando por línea. El main decide la política y clasifica (ver
[claves-controlador.md](claves-controlador.md)); el renderer solo parte, envía y pinta.

## Decisión

- **Un comando por línea**, sin divisor como el de SQL o el del shell de documentos. Se ignoran las
  líneas en blanco y las que empiezan por `#`; un `#` en medio no es comentario (`SET a #1` es un
  valor legítimo). Se envía la línea sin blancos y su `desplazamiento` es el de su primer carácter,
  para que la `posicion` de un error de sintaxis caiga en su sitio.
- **Qué se ejecuta:** con selección, todas las líneas que toca, enteras (una selección que acaba al
  principio de una línea no la incluye); con cursor, su línea, o el comando de justo encima si
  está en blanco; más arriba no se busca, para no ejecutar algo que no está a la vista.
- **La respuesta se pinta como la consola de línea de comandos de Redis** (`(integer) 1`, `(nil)`,
  listas numeradas), con dos diferencias buscadas: el UTF-8 válido se enseña legible y no escapado
  byte a byte, y los informes de texto (`INFO`, `CLIENT LIST`…) van en crudo, línea a línea.
- **Registro propio, no la «Salida» de las otras consolas.** Allí cada línea es una entrada
  inmutable con su hora; aquí el comando se pinta al empezar y se completa al volver (sus ms junto
  al eco, la respuesta debajo). Se reutilizan la hora, los enlaces «ir a la posición», la acción
  «Forzar» y su CSS. Topes: 500 entradas, 5 000 líneas (se van las más viejas), 500 líneas por
  respuesta y 10 000 caracteres por línea: un `SMEMBERS` enorme no puede montar cien mil filas.
- **Lenguaje `tessera-redis`**: un Monarch propio sin estados (Monaco no trae uno de línea de
  comandos). Las cadenas acaban en su comilla o en el fin de línea: el estado de cadena habitual
  arrastraría una comilla sin cerrar a las líneas de debajo. Sin `extensions`, para que el editor
  de archivos no coloree un `.redis` distinto según se haya abierto antes una consola.
- **Las marcas del margen son `MarcasConsolaDocs`** (no saben del motor) y las acciones son
  propias, porque las etiquetas de la consola de documentos hablan de «sentencias».

## Consecuencias

El autocompletado de comandos y de claves queda pendiente.
