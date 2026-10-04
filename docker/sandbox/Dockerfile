# Imagen base del sandbox de los agentes: un contenedor por perfil, con los proyectos
# montados en /workspace. La construye `SandboxManager` con esta carpeta como contexto.
# node:lts (Debian) ya incluye node, npm y git -> dependencias minimas.
FROM node:lts

# --- Identidad neutra -------------------------------------------------------
# Creamos un usuario generico "agente" con su propio home. Asi, dentro del
# contenedor, nada delata el nombre de usuario real del host.
RUN groupadd --gid 1001 agente \
 && useradd  --uid 1001 --gid 1001 --create-home --shell /bin/bash agente

ENV HOME=/home/agente

# --- CLIs de agente ---------------------------------------------------------
# Se instalan como root (antes de USER agente) con npm global: el prefix del
# node:lts es /usr/local, asi que los binarios quedan en /usr/local/bin, que YA
# esta en el PATH de cualquier usuario (incluido agente/uid 1001). No se invoca
# ni se autentica ningun agente aqui; el login es por-perfil en runtime.
#   - claude: Claude Code CLI oficial de Anthropic (@anthropic-ai/claude-code).
#   - codex:  Codex CLI oficial de OpenAI (@openai/codex). Metodo estable (npm),
#             asi que se instala junto a claude; el diseno ya soporta 2 agentes.
RUN npm install -g @anthropic-ai/claude-code @openai/codex \
 && npm cache clean --force

# --- Escalada acotada al contenedor -----------------------------------------
# El agente necesita instalar sus propias herramientas (LibreOffice para
# convertir Office->PDF, poppler para PDF->PNG, las libs de sistema de
# Chromium...). Sin esto, como uid 1001 y sin sudo, `apt-get` responde
# "Permission denied" y `npm i -g` tampoco puede escribir en /usr/local: el
# agente quedaba encerrado en un sandbox donde apt existe pero no sirve.
#
# sudo NOPASSWD es escalada DENTRO del contenedor, no en el host: el contenedor
# del perfil se lanza sin --privileged, sin --cap-add y con las capabilities por
# defecto de Docker, que NO incluyen CAP_SYS_ADMIN. Ese root no puede montar, ni
# salir de su namespace, ni ver el daemon. Y dentro del perfil no gana nada
# nuevo: uid 1001 ya leia la .ssh montada (esta en su propio $HOME) y ya escribia
# en /workspace.
#
# Se probo la alternativa de correr el CLI como --user root y se retiro: cambia
# HOME a /root (rompe el mapeo de credenciales de /agent-config, que se resuelve
# por CLAUDE_CONFIG_DIR/CODEX_HOME), deja ficheros root en /home/agente que el
# preludio ssh de la siguiente sesion como uid 1001 no puede sobrescribir, y
# rompe la identidad neutra que declara este mismo fichero.
#
# Esta capa va DESPUES del `npm install -g` a proposito: asi anadirla no
# invalida la capa cara de los CLIs y el rebuild incremental son segundos.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sudo ca-certificates \
 && echo 'agente ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/010-agente \
 && chmod 0440 /etc/sudoers.d/010-agente \
 && rm -rf /var/lib/apt/lists/*

# --- Paquetes extra horneados (opcionales) ----------------------------------
# Lo que el agente instale en caliente con sudo se PIERDE al recrear el
# contenedor (hibernar, cerrar Tessera, "Actualizar agentes": todos hacen
# `docker rm`). Para lo recurrente, Tessera pasa aqui la lista que el usuario
# configuro en Ajustes. Vacia por defecto: quien no lo necesite no paga ni
# tamano de imagen ni tiempo de build.
ARG EXTRA_APT=""
RUN if [ -n "$EXTRA_APT" ]; then \
      apt-get update \
   && apt-get install -y --no-install-recommends $EXTRA_APT \
   && rm -rf /var/lib/apt/lists/* ; \
    fi

# Las libs de sistema de Chromium van APARTE y no como lista apt: cuales son
# depende de la version de Playwright y las sabe el propio Playwright. Listarlas
# a mano aqui seria una copia que se queda vieja en silencio.
#
# Y ademas XVFB, que Playwright NO instala. Sin el, un contenedor no tiene
# servidor grafico y `headless: false` no puede arrancar: Chromium muere con
# "Missing X server or $DISPLAY". Con `xvfb-run` el navegador corre HEADED de
# verdad (no el headless shell), asi que `slowMo` y `recordVideo` se comportan
# igual que en un escritorio; la ventana existe, solo que en una pantalla
# virtual que no mira nadie. Es lo que permite que una suite de evidencia
# escrita para Windows corra tal cual dentro del sandbox.
#
# `xauth` va explicito: es una RECOMENDACION de xvfb, no una dependencia, asi que
# `--no-install-recommends` lo deja fuera y `xvfb-run` muere con "xauth command
# not found" antes de arrancar el navegador. Comprobado en el build de prueba.
ARG PLAYWRIGHT_DEPS="0"
RUN if [ "$PLAYWRIGHT_DEPS" = "1" ]; then \
      npx --yes playwright install-deps chromium \
   && apt-get install -y --no-install-recommends xvfb xauth \
   && rm -rf /var/lib/apt/lists/* ; \
    fi

# --- El home vuelve a ser del agente ----------------------------------------
# TODAS las capas de arriba corren como root con ENV HOME=/home/agente, asi que
# npm y npx siembran ahi sus cachas con propietario root:root. Consecuencia, y
# estaba pasando desde el primer dia: el uid 1001 no podia usar `npx` en absoluto
# ("EACCES ... /home/agente/.npm/_cacache", con npm sugiriendo un chown). Se veia
# poco porque casi nada de dentro llamaba a npx; ahora el contexto que Tessera le
# escribe al agente le dice explicitamente que instale los navegadores con
# `npx playwright install`, asi que dejarlo roto no es una opcion.
#
# Se BORRAN las cachas en vez de solo chownearlas: son de root, no le sirven de
# nada al agente, y adelgazan la imagen. El chown final es la red de seguridad
# para cualquier capa root futura que vuelva a escribir en el home.
RUN rm -rf /home/agente/.npm /home/agente/.cache /home/agente/.npmrc \
 && chown -R agente:agente /home/agente

# --- Ruta neutra ------------------------------------------------------------
# /workspace es el unico punto donde se montara la carpeta del proyecto.
RUN mkdir -p /workspace && chown agente:agente /workspace
WORKDIR /workspace

# --- Sello de la imagen -----------------------------------------------------
# `ensureImage` compara estas dos etiquetas contra lo que espera el codigo y
# reconstruye sola la imagen si no cuadran. Sin esto, quien ya tuviera
# `tessera-sandbox-base` construida no veria nunca los cambios de este fichero
# hasta pulsar "Actualizar agentes" a mano, y el codigo estaria dando por hecha
# una capacidad (sudo) que su imagen no tiene.
#   - version: subir A MANO al cambiar algo de este Dockerfile. Tiene un GEMELO,
#              `SANDBOX_IMAGE_VERSION` en shared/sandboxExtras.ts, y si los dos no
#              coinciden la imagen se reconstruye en bucle sin arreglar nada. Por
#              eso `test-sandbox-extras.mts` LEE este fichero y los compara.
#   - extras:  lo elige el usuario en Ajustes; se sella para detectar cambios.
LABEL tessera.sandbox.version="4"
LABEL tessera.sandbox.extras="${EXTRA_APT}|${PLAYWRIGHT_DEPS}"

USER agente
