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
- Actualizar los agentes en Docker, desde el botón de la barra de título (`agentes/boton-agentes-nativos.md`), rehornea
  con `--no-cache` (los CLI más recientes), falla de cara si algo va mal, levanta el veto y recrea los contenedores; el
  self-update dentro del contenedor no persiste. Hasta que la imagen nueva está lista no se detiene nada.
- **Ningún build devuelve los CLI a una versión anterior.** La capa de los CLI va al final del Dockerfile y recibe en
  `CLIS_CONSTRUCCION` un valor distinto en cada build: nunca sale de la caché, que guarda los de builds anteriores y,
  en un build incremental (otros extras, otra versión del Dockerfile, otra Tessera en el mismo Docker con otros
  extras), dejaría la imagen con unos CLI más viejos de los que tenía y el aviso de actualización de vuelta. Al ir al
  final, reinstalarlos no rehace las capas caras de los extras. Toda reconstrucción necesita por eso acceso a npm.
- **Las pruebas tienen su propia imagen** (`tessera-sandbox-base:pruebas`, `:pruebas-u<uid>` en Linux): la del arnés
  de interfaz y la de las pruebas que no pasan por el main (`contenedores-propios.md`). Se construyen con sus propios
  extras y nunca rehornean la de la Tessera del usuario que comparte el Docker.
- Las versiones de la imagen se leen ejecutándola, así que la lectura se guarda por id de imagen: con Docker apagado se
  muestra la última y no se enciende solo para revisar. Lo publicado es el `latest` de npm, que es lo que instala la imagen.
- Lo que el contenedor PUEDE (sudo, extras) se lee de su etiqueta, no de los ajustes: un contenedor vivo sigue con la
  imagen con la que nació.
- `docker run --init` (tini cosecha huérfanos) y `--shm-size 1g` con el navegador de pruebas (64 MiB tumban a
  Chromium grabando vídeo).

## Descartes

- Fallar el build automático por un extra roto: dejaba el perfil sin agente por un ajuste que nadie relacionaría.
- `--disable-dev-shm-usage`: es del navegador y exigiría que todo script del agente lo recordara.
