# Imagen del sandbox de los agentes

Esta carpeta es el **contexto del `docker build`** de la imagen `tessera-sandbox-base`, la que
usan los contenedores de los perfiles. La construye `SandboxManager` (`src/main/sandbox/`) la
primera vez que hace falta y la reconstruye sola cuando cambia su sello (ver más abajo). Viaja
dentro del instalador porque la app la construye en el equipo del usuario.

## Qué garantiza el aislamiento

El aislamiento no vive en la imagen sino en cómo se lanza el contenedor:

| Objetivo | Mecanismo |
|---|---|
| Montar **solo** las carpetas de los proyectos del perfil | un `-v` por proyecto, bajo `/workspace/<proyecto>` |
| Ruta neutra observable | `/workspace` como único punto de montaje |
| Usuario neutro | `agente` (uid 1001), creado en el [Dockerfile](Dockerfile) |
| Nada más del disco del host se monta | los demás montajes son de configuración: credenciales del agente y `.ssh` de solo lectura |

Como el contenedor es Linux y no se monta ninguna unidad del host, la ruta real del proyecto
sencillamente **no existe** dentro: no es cuestión de ocultarla, es que nunca entra.

## La imagen

- Base `node:lts` (node, npm y git), con los CLI de los agentes instalados con `npm -g`.
- `sudo` sin contraseña **dentro** del contenedor, para que el agente instale sus herramientas;
  el contenedor se lanza sin `--privileged` ni capacidades extra.
- Paquetes opcionales horneados (`EXTRA_APT`, `PLAYWRIGHT_DEPS`) que el usuario elige en Ajustes.

## El sello

`LABEL tessera.sandbox.version` tiene un gemelo, `SANDBOX_IMAGE_VERSION` en
`src/shared/sandboxExtras.ts`: al cambiar algo del Dockerfile se suben **los dos**.
`test-sandbox-extras.mts` lee este fichero y comprueba que coinciden.

## Pruebas

Los `test-*.mts` del sandbox y de las terminales montan un proyecto de prueba en
`proyecto-demo/` (un repositorio git cualquiera con un `package.json`). No está versionado:
se crea a mano antes de correrlos y git lo ignora.
