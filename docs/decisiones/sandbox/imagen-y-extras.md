# La imagen se pone al día sola por sello y se degrada sin extras antes que dejar el perfil sin agente

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/gestor/imagen.ts`, `gestor/contenedores.ts`, `sandbox/actualizarImagenAgentes.ts`

## Contexto

La imagen `tessera-sandbox-base` hornea los CLI de agente y los paquetes extra que el usuario pide en Ajustes (texto
libre). `ensureImage` está en el camino crítico de abrir una sesión.

## Decisión

- La imagen está al día si sus DOS etiquetas (versión del Dockerfile y sello de extras) coinciden; si no, build
  incremental (sin `--no-cache`) con el progreso por `onLog` hacia la UI (en la app empaquetada no hay consola).
- Si el build falla CON extras (un nombre de paquete mal escrito basta), se construye SIN ellos y ese sello queda
  vetado hasta que cambie la lista o un build con ellos salga bien. El bloque de memoria dice lo que hay de verdad.
- «Actualizar agentes» rehornea con `--no-cache` (los CLI más recientes), falla de cara si algo va mal, levanta el
  veto y recrea los contenedores; el self-update dentro del contenedor no persiste.
- Lo que el contenedor PUEDE (sudo, extras) se lee de su etiqueta, no de los ajustes: un contenedor vivo sigue con la
  imagen con la que nació.
- `docker run --init` (tini cosecha huérfanos) y `--shm-size 1g` con el navegador de pruebas (64 MiB tumban a
  Chromium grabando vídeo).

## Descartes

- Fallar el build automático por un extra roto: dejaba el perfil sin agente por un ajuste que nadie relacionaría.
- `--disable-dev-shm-usage`: es del navegador y exigiría que todo script del agente lo recordara.
