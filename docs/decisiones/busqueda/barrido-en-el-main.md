# El barrido de la búsqueda corre en un worker del main, primero nombres y texto y después comprimidos, sin descompilar

- **Estado:** vigente
- **Ámbito:** `src/main/search/` (`SearchService.ts`, `barrido.ts`, `exclusiones.ts`), `src/main/workers/searchWorker.ts`, `src/main/java/poolConstantes.ts`, `src/shared/search-ipc.ts`

## Contexto

Buscar en archivos es CPU síncrona en ráfaga (detección de binarios, codificación, expresiones
regulares por archivo), y el hilo del main bombea los pty de todas las terminales.

## Decisión

- El barrido corre en un `worker_thread`. Cancelar es `worker.terminate()`, no un mensaje: el hilo
  está dentro de un bucle y no lo leería hasta acabar justo lo que se quiere abortar.
- Todo mensaje lleva su id de búsqueda y se filtra en el servicio y en el renderer: al teclear cada
  pulsación cancela la anterior, pero lo ya encolado sigue llegando.
- Orden de fases: primero los NOMBRES de archivo (solo entradas de directorio, sin leer un byte, con
  tope propio y marca de truncado), después el contenido de texto y por último los comprimidos. La
  lista se llena sin esperar al jar más lento.
- Casar un nombre no aplica el tope de tamaño ni la criba de binarios (no hay que leer nada); las
  carpetas no se emiten.
- `.jar` y `.class` se buscan por su POOL DE CONSTANTES, en JS puro, sin descompilar: descompilar
  cada clase haría el barrido de minutos. Una `.class` no tiene línea y la fila no la inventa: enseña
  la constante que casó.
- Exclusiones (`exclusiones.ts`): `.git`, dependencias y metadatos de herramientas; tope de tamaño
  IGUAL al del editor, para que lo encontrado se pueda abrir entero. `target`, `build` o `bin` no se
  saltan (son nombres legítimos) y el `.gitignore` no se respeta: exigiría un repo por cada sub-repo y
  escondería archivos sin decirlo.
- Lo que se puede contestar en la respuesta del invoke no va por un canal aparte: un evento enviado
  desde dentro del handler llega ANTES que la respuesta, y el renderer lo descartaría por no conocer
  aún su id.

## Consecuencias

`test:busqueda` y `test:exclusiones` fijan el barrido; la orquestación del modal está en
`busqueda-en-archivos.md`.

## Descartes

- Barrer en el hilo del main: congela las terminales mientras dura.
- Descompilar para buscar dentro de las clases: medio minuto y varios GB por barrido.
