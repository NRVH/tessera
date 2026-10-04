# Las rutas de «Abrir con Tessera» se encolan crudas en el main y se resuelven contra el disco al recogerlas

- **Estado:** vigente
- **Ámbito:** `src/main/shell/aperturasPendientes.ts`, `src/main/shell/resolverApertura.ts`

## Contexto

Una ruta puede llegar en tres momentos y solo uno tiene un renderer al que hablarle: en frío (sin
ventana aún), con la app abierta (pero quizá recargándose tras un `render-process-gone`) o con el
cierre en curso. Un `webContents.send` directo se pierde en silencio, que es el peor desenlace
para un clic. Y «el renderer nunca ve rutas del host»: lo que vuelve es una contenedora elegida.

## Decisión

- El main solo APUNTA, en una cola sin repetidos; el `send` de aviso es un empujón para no
  sondear y perderlo no cuesta nada. El renderer recoge y VACÍA la cola cuando puede abrir algo;
  una ruta que falla se cuenta y no se reencola.
- Se guardan rutas crudas y se resuelven al recoger: el disco pudo cambiar desde el clic y la
  resolución necesita los proyectos abiertos, que solo se saben cuando el renderer pregunta
  (unidos a los persistidos mientras no haya restaurado, `abiertosEfectivos`).
- La contenedora se elige en el main mirando el disco, en este orden: un proyecto ya abierto que
  la contenga; para un archivo, la raíz del repo git (subiendo hasta un `.git`, carpeta o
  archivo); la carpeta que lo contiene. Para una carpeta no se sube al repo: la carpeta ES el
  proyecto que se señaló.
- `hayRelevoEnMarcha` (¿se está aplicando una actualización?) exige DOS señales: una copia del
  relevo utilizable (`relevoListo()`) y su ejecutable abierto por otro proceso (`openSync` en
  escritura falla con `EBUSY`). Solo `EBUSY` cuenta; no existir o no tener permiso es «no hay
  copia».

## Consecuencias

- Se pueden encolar rutas antes de que exista la ventana; `app/proceso.ts` lo hace al cargar.
- Sin las dos señales hay un falso positivo real: mientras robocopy prepara la copia tras cada
  descarga el fichero también da `EBUSY`, y el marcador de update se guarda justo antes de lanzar
  esa copia. El clic del usuario se quedaría sin ventana en el momento más normal del ciclo.

## Descartes

- Enumerar procesos con PowerShell: corre al cargar el módulo y pagaría su arranque en cada
  lanzamiento. Un fichero de cerrojo: lo escribiría el ciclo de actualización, el más frágil.
