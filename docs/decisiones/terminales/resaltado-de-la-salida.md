# La terminal de shell resalta logs y salidas metiendo colores ANSI en el flujo, con niveles en forma de etiqueta

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/terminales/resaltadoSalida.ts` y su prueba, `montajeXterm.ts`, `sesionXterm.ts`, `useXtermPane.ts`, el ajuste `terminalResaltado`

## Contexto

En una terminal casi todo es una orden, su salida o un log. Los programas que colorean lo suyo ya se
leen bien; un log volcado o seguido en vivo, una compilación con tubería o una prueba de red llegan
sin color, y cientos de líneas grises esconden el error.

## Decisión

- **Colores convencionales.** Error en rojo y aviso en amarillo, la LÍNEA entera, porque son pocas y
  tienen que destacar. Info en azul y lo que fue bien en verde, solo su ETIQUETA o su dato: pintar
  entero lo más frecuente lo convierte en fondo y el rojo deja de destacar. Depuración, atenuada;
  IPs (también IPv6) y URLs, en cian; los códigos HTTP, por su clase (2xx verde, 4xx amarillo, 5xx
  rojo).
- **La forma de un registro y de un archivo de configuración, cada parte en su color**, para que un
  `cat` o un `tail -f` se lean con estructura y no como un bloque gris: fechas y horas en magenta; el
  programa con su pid de un registro del sistema (`systemd[1]:`); las rutas absolutas; la clave de
  `clave=valor` y las de YAML y JSON; los comentarios `# …`, atenuados. Y las palabras clave en
  cualquier caja, solo la palabra: lo que falla (`failed`, `denied`, `unreachable`, `timed out`…) en
  rojo, lo que avisa en amarillo y lo que fue bien (`successfully`, `completed`) en verde; tras un
  cero («0 failed») no cuentan.
- **Formatos generales, no de un producto:** los niveles de los registros del sistema y de las
  bibliotecas de log habituales; compiladores (`archivo:12:5: error`, `error TS2345`,
  `error[E0308]`); trazas (`Exception`, `Caused by:`, `Traceback`, marcos `at …(X.java:42)`);
  gestores de paquetes (`ERR!`, `E:`); compilar y probar (`BUILD SUCCESS/FAILURE`, `PASS/FAIL`,
  `✓ ✗`, «N passed, M failed»); conectividad (`Connection refused`, `Request timed out`,
  `Permission denied`, también en español). Un «timed out» suelto no: sale en resúmenes.
- **Un nivel solo cuenta como etiqueta:** en mayúsculas sueltas, entre `<>`/`[]` o como `level=`.
  «no error found» o `MY_ERROR_CODE` no pintan nada; una excepción necesita nombre de clase y dos
  puntos (o acabar la línea): `class FooError extends` es código, no un error.
- **Colores ANSI en el flujo, antes de escribir en xterm**, en un solo paso por línea. El texto no
  cambia: copiar, buscar y guardar dan el original, y el color es un atributo más de la celda, así
  que sobrevive al scroll, a las líneas partidas y al dibujo por GPU sin coste por coincidencia.
- **El estado se sigue en el propio flujo, por terminal** (`EstadoResaltado`), y no en el búfer de
  xterm, que va por detrás de lo que aún está en cola: si está en la pantalla alternativa, si el
  programa dejó un color o estilo encendido (aunque lo apague líneas después) y si el trozo anterior
  acabó a media línea. Se sigue también con el interruptor apagado, para que encenderlo parta del
  estado de verdad.
- **No se toca:** una línea que ya trae color o que cae dentro de un color abierto por el programa,
  la pantalla alternativa (editores, paginadores y monitores a pantalla completa), una línea de más
  de 2000 caracteres, el contenido de una secuencia de cadena (imágenes, títulos) aunque esté sin
  cerrar, ni la continuación de una línea partida entre dos trozos (su principio podría ser media
  secuencia). En una línea sin terminar, su última palabra no cuenta: podría estar cortada.
- Las secuencias de control del pty de Windows (cursor, reinicios `ESC[m`, posicionar) se toleran:
  mover el cursor a otra fila o columna corta la línea, y tras cada reinicio se vuelve a poner el
  color de una línea entera. Nunca queda un color abierto al final de una línea.
- **Solo la terminal de shell**, local y SSH: la del agente pinta su propia interfaz. Interruptor en
  Configuración › Terminales, activado por defecto, que vale desde el siguiente trozo sin recrear nada.

## Consecuencias

- La continuación de una línea partida entre dos trozos del pty queda sin pintar; es raro en logs,
  que llegan en trozos de muchas líneas.
- Medido en la prueba: 10 000 líneas de log en unos 35 ms.
- Añadir una regla es añadir un patrón en `resaltadoSalida.ts` con su caso en la prueba, positivo y
  negativo.

## Descartes

- **Decoraciones de xterm** (como el buscador): una por coincidencia, con su marcador y su elemento,
  ligadas a la fila; con miles de líneas por segundo y líneas partidas cuestan mucho más que un
  atributo de celda, y no cambian el resultado.
- **Pintar las líneas de info enteras:** la pantalla de un log normal quedaría azul.
- **Colorear números, texto entre comillas, `true`/`false`, MAC o UUID:** aportan poco a la lectura
  y suman color donde no hace falta.
- **Adivinar el formato de un archivo volcado para colorear su sintaxis entera:** lo que pasa por la
  terminal no dice qué es y se equivocaría a menudo. Para eso está el resaltado del editor del
  servidor (`nano`, `vim`) o del propio editor de Tessera.
