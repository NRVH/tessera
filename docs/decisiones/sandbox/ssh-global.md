# El SSH del usuario se monta READ-ONLY en todo contenedor y su config se traduce

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/sshSetup.ts`, `gestor/montajes.ts`, `src/main/agents/gitInContainer.ts` (macOS: sin verificar aquí)

## Contexto

El usuario tiene UN `~/.ssh/config` con varios `Host <alias>` cuyas `IdentityFile` apuntan con rutas del host a
`~/.ssh` o a carpetas hermanas. Dentro del contenedor esas rutas no existen.

## Decisión

- GLOBAL (decisión de producto): el mismo SSH para el contenedor de cualquier perfil; el config del usuario ya
  distingue las cuentas por alias. La `.ssh` propia de un perfil (`sshDir`) se monta además, solo en el suyo.
- Del lado host se descubren todas las carpetas que el config referencia y se reescribe el config con rutas
  `/home/agente/<base>/…`; se montan READ-ONLY bajo `/mnt/tessera-ssh/<base>` y el preludio de git las copia a
  `~/<base>` con 600.
- La familia de rutas es un parámetro (`Plataforma`): en macOS las rutas se conservan POSIX. Convertir `/` en `\` sin
  mirar la plataforma dejaba «0 carpetas» y ningún contenedor recibía llaves.
- Si el config (o un `Include`) lleva `UseKeychain`, que el OpenSSH del contenedor trata como FATAL, se antepone
  `IgnoreUnknown UseKeychain` como PRIMERA línea (ssh no lo aplica a lo que va antes). Los patrones de un
  `IgnoreUnknown` del usuario se funden en el nuestro: ssh solo honra el primero.

## Consecuencias

`test:ssh-config` fija la traducción de las dos plataformas; `test:ssh` (con Docker) el montaje y el aislamiento.

## Descartes

- Quitar la línea `UseKeychain`: borrar opciones del usuario es peor que declararlas desconocidas.
