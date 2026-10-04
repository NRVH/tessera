# Para citar en una shell hay dos funciones, una por regla (`citarSh` y `citarPowerShell`), y las dos usan comillas simples

- **Estado:** vigente
- **Ámbito:** `src/shared/citarShell.ts` y sus llamadores del main (montajes del sandbox, atajos `tdb`, línea de arranque del agente, git en el contenedor)

## Contexto

Lo que Tessera mete en una línea de shell trae de todo: apóstrofos (`O'Brien`), `$` y acentos graves
(legales en nombres de carpeta en los dos sistemas) y, en macOS, espacios por norma (la raíz del sandbox
cuelga de `~/Library/Application Support`). La misma regla llegó a estar copiada en cinco archivos, y un
arreglo en una copia no llegaba a las otras: la línea nativa del agente citaba con la regla de PowerShell
en una shell POSIX.

## Decisión

- Un solo módulo puro con dos funciones con nombre. Cuál toca lo decide el llamador según la shell que
  RECIBE la línea, no según la plataforma (`lineaArranqueAgente.ts` documenta cómo se decide).
- Comillas simples en las dos: dentro no se expande nada. POSIX resuelve la comilla interna cerrando,
  escapando y reabriendo (`'\''`); PowerShell la duplica (`''`).
- La barra invertida de `'\''` se construye con `String.fromCharCode(92)`. Es el único sitio de
  producción donde vive, y una barra colapsada al editar rompería a la vez montajes, atajos, agente y git,
  con un apóstrofo que desaparece sin error.
- No aplana saltos de línea (viajan tal cual dentro de comillas simples; si el destino no los admite, es
  cosa del llamador, ver `argumentoBriefing`) y no decide plataforma.

## Consecuencias

- `test-citar-shell.mts` y `test-linea-arranque-agente.mts` reescriben las reglas a mano como oráculo
  independiente: no se unifican con este módulo, o el test se probaría consigo mismo.
- Una cita nueva en el main usa estas funciones; no se escribe otra copia.

## Descartes

- Una función «universal»: las dos reglas se confunden sin dar error. `''` en POSIX es cerrar y reabrir
  (el apóstrofo desaparece) y `'\''` en PowerShell deja una barra y rompe la cadena.
- Comillas dobles, que aceptan las dos shells: en las dos expanden `$` y el acento grave, y el briefing
  del agente está lleno de acentos graves.
