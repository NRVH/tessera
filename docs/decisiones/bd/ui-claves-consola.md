# La consola de Redis ejecuta un comando por línea, confirma lo peligroso y la producción de uno en uno, lleva registro propio y completa el nombre del comando

- **Estado:** vigente
- **Ámbito:** `claves/DbConsolaClavesPane.tsx`, `useEstadoConsolaClaves.ts`, `useArchivoConsolaClaves.ts`,
  `useEjecucionClaves.ts`, `loteClaves.ts`, `useCierreConsolaClaves.ts`, `RegistroClaves.tsx`,
  `claves/consolaClaves.ts`, `claves/monacoConsolaClaves.ts`, `claves/autocompletadoClaves.ts`,
  `claves/comandosRedisCatalogo.ts`, `claves/proveedorClavesMonaco.ts`; el protocolo de archivo es el
  común de `consola/archivoConsola.ts` y `consola/useArchivoConsola.ts`

## Contexto

Redis no tiene sentencias: es un comando por línea. El main clasifica los comandos y decide la
política (ver [claves-controlador.md](claves-controlador.md)); lo peligroso se confirma SIEMPRE,
también sin solo lectura. El renderer no clasifica: parte, envía, pinta y pregunta lo que el main
devolvió sin enviar. Un comando puede ser a la vez peligroso y de producción, y el main los devuelve
de uno en uno.

## Decisión

- **Preguntar por comando.** Ante `peligroso` se pregunta «¿Ejecutar FLUSHDB?» y se reenvía con
  `confirmadoPeligroso`; ante `produccion`, la confirmación de las otras consolas y `confirmado`.
  Cada marca se pone SOLO tras el diálogo de su motivo y se reenvía tal cual; como mucho, dos vueltas.
  Si el usuario rechaza, el comando queda «No se envió» y el lote para. Un rechazo por solo lectura
  impuesta se enseña y se para (la casilla `readonly` de la conexión es de los agentes).
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
  El registro conserva su autodesplazamiento en el componente que no se desmonta: el ref de «pegado
  al fondo» sobrevive a vaciar la lista.
- **Stop** cancela por el `peticionId` del comando: el trabajador abandona la conexión o, si el
  comando bloquea (`BLPOP`), lo suelta con `CLIENT UNBLOCK`. Pasado `ESPERA_STOP_MS` el registro
  ofrece «Forzar», que pide confirmación antes de cerrar la conexión.
- **Lenguaje `tessera-redis`**: un Monarch propio sin estados (Monaco no trae uno de línea de
  comandos). Las cadenas acaban en su comilla o en el fin de línea: el estado de cadena habitual
  arrastraría una comilla sin cerrar a las líneas de debajo. Sin `extensions`, para que el editor
  de archivos no coloree un `.redis` distinto según se haya abierto antes una consola.
- **Las marcas del margen son `MarcasConsolaDocs`** (no saben del motor) y las acciones son
  propias, porque las etiquetas de la consola de documentos hablan de «sentencias».
- **Autocompletado**: solo el NOMBRE del comando (y de su subcomando) en la primera palabra de cada
  línea, con su sintaxis al lado, desde un catálogo propio. No se piden las claves: un servidor puede
  tener millones, y navegar por ellas es lo que hace el árbol. No se pregunta al servidor qué comandos
  tiene (`COMMAND`): un usuario sin ese permiso también completa, y completar no es validar.
- **Mismas reglas de orden y de dueños que la consola de MongoDB** (ver
  [ui-documentos-consola.md](ui-documentos-consola.md)): hooks en el orden de sus efectos, modelo del
  hook y editor del pane, portal para diálogos y selector. Comparte con ella lo idéntico.
- **Historial** propio del lenguaje de comandos, descrito en [ui-consola-historial.md](ui-consola-historial.md);
  el botón del reloj y el acorde son los de las otras consolas (⌘⇧H / Ctrl+Mayús+H).

## Consecuencias

El aviso de guardado y de lectura va al registro, no a la Salida. Es el único rasgo propio del archivo
de consola de Redis: el protocolo es el mismo de las tres consolas, con el destino del aviso como
parámetro. Un arreglo de guardar o leer va al común, no a `useArchivoConsolaClaves.ts`.
