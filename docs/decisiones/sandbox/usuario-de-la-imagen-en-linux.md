# En Linux la imagen del sandbox se hornea con el uid del usuario del equipo, y Docker sin root se rechaza

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/gestor/usuarioImagen.ts`, `gestor/imagen.ts`, `gestor/diagnostico.ts`,
  `docker/sandbox/Dockerfile`

## Contexto

El agente corre dentro del contenedor como `agente` (uid 1001) sobre el proyecto montado. En Windows y macOS
la capa de archivos de la VM de Docker no aplica los dueños del anfitrión, así que el uid da igual. En Linux
Docker monta la carpeta tal cual: con el usuario del equipo en uid 1000, el agente no podría escribir en el
proyecto ni en `.git`, y lo que creara quedaría con un dueño que el usuario no puede borrar sin `sudo`.

## Decisión

- En Linux, `docker build` recibe `AGENTE_UID` y `AGENTE_GID` con los del usuario del equipo, y el
  Dockerfile crea `agente` con ellos. Si ese uid o gid ya existe en la imagen base (el `node` de `node:lts`
  es 1000:1000), se retira antes. Root (uid 0) no se hornea: se queda el 1001.
- La etiqueta `tessera.sandbox.usuario` sella el uid:gid. Solo se compara en Linux: en Windows y macOS una
  imagen anterior a la etiqueta sigue valiendo y no paga un rebuild que no cambiaría nada. Por eso no se
  sube `SANDBOX_IMAGE_VERSION`.
- Docker sin root (`docker info` con `name=rootless`) se detecta en la sonda del daemon y se explica: el
  auxiliar privilegiado que monta los proyectos en caliente (`nsenter -t 1`) entra en el espacio de nombres
  del usuario y no en el del daemon. Se propone el modo nativo o el Docker del sistema.

## Consecuencias

- Cambiar de usuario en el mismo equipo rehornea la imagen.
- La regla de «solo Docker con root» deja fuera a quien use rootless; es una decisión del usuario.

## Descartes

- `--user uid:gid` al arrancar sin rehornear: el HOME de la imagen y las cachés de los CLI siguen siendo de
  1001, y habría que arreglarlas con permisos en cada arranque.
- ACL para el 1001 sobre cada proyecto: toca los permisos de las carpetas del usuario y lo creado sigue siendo
  de otro dueño.
- Soportar rootless con otro camino de montajes: otra arquitectura entera para un caso minoritario.
