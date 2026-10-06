# SSH: el OpenSSH del sistema por ruta fija, una línea que decide Tessera y un known_hosts por conexión

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/` (`binariosSsh.ts`, `lineaSsh.ts`, `huellasSsh.ts`, `clasificacionSalida.ts`,
  `ControladorSsh.ts`) y la sesión SSH de `src/main/terminals/` (`sesionSsh.ts`, `lanzadorSsh.ts`, `TerminalService.ts`)

## Contexto

Medido: el `ssh.exe` del sistema (9.5p2) negocia con el servidor de pruebas; una autenticación fallida sale con
255 y el código remoto pasa tal cual por ConPTY, pero un corte sin exit-status del servidor («closed by remote
host») sale con -1 (4294967295 sin signo; en macOS, 255). Matar el árbol da 1. ssh expande `%` en
`UserKnownHostsFile` e `-i`, y una ruta con espacios va entre comillas dobles, igual por child_process que por
node-pty. Cerrar una terminal tecleaba `^C` y `exit`, que en una sesión remota son órdenes para el otro equipo.

## Decisión

- Motor: el OpenSSH del sistema por ruta FIJA (Windows: `System32\OpenSSH` y, si falta, el de Git for Windows con
  aviso; macOS: `/usr/bin`), nunca el PATH. `TESSERA_SSH_BINARIO` existe solo para las pruebas de interfaz: la app
  empaquetada lo ignora (con aviso en el registro) salvo con la marca propia del arnés e2e (`--tessera-arnes-e2e`).
  `--user-data-dir` no sirve de señal: el relevo de actualización de macOS relanza la app instalada con él.
- Línea: `-F none` y unas `-o` fijas (sin multiplexar, `ConnectTimeout`, `ServerAlive*`), y `--` antes del host
  siempre. Con contraseña no se prueban claves.
- Huellas: un `known_hosts` por conexión (`ssh/huellas/<id>`), con barras normales, `%` doblado y entre comillas;
  la carpeta se crea al arrancar, porque ssh no la crea. Sin `HostKeyAlias`: se colaría en el prompt de la
  contraseña. Humano, `accept-new`; agente, estricto (solo hosts que ya confirmó un humano).
- Sesión: ssh corre DIRECTO en un pty del host (sin shell delante, cwd en HOME), aunque el proyecto sea de Docker;
  no recibe el entorno de BD ni hereda `SSH_ASKPASS`. Cerrar y reconectar matan el árbol sin teclear nada, por la
  cola de muertes. Hibernar el perfil no la cierra; el cierre de la app y la caída del renderer, sí. «Reconectar»
  vuelve a preparar con los datos vigentes de la conexión.
- Motivo de salida: solo con 255 (en Windows, también -1, que un comando remoto no puede dar) y solo si las últimas
  líneas sin ANSI traen un mensaje del cliente OpenSSH a principio de línea (huella cambiada, autenticación,
  inalcanzable o cortada, algoritmos); un corte vale también detrás del prompt remoto en la última línea, que es
  donde ssh lo escribe. Sin mensaje no hay motivo: el 255 pudo darlo el remoto. Gana el mensaje más reciente.
  El renderer solo trata como fallo de ssh el 255 o una salida con motivo: un -1 de Windows sin motivo dice «La
  sesión terminó», porque también es como llega un `exit` normal cuyo código perdió ConPTY. El corte real se
  reconoce aquí, por su texto, y llega con motivo.

## Descartes

- Una biblioteca SSH en JavaScript: le faltan algoritmos, no lee la configuración del usuario, no admite PKCS#8 y
  el agente no podría usarla.
- Un `ssh_config` generado: otro archivo que mantener para lo que caben unas pocas `-o`.
- El `~/.ssh/config` del usuario: un `Host *` colaría multiplexado, `ProxyCommand` u otro destino.
- Buscar frases sueltas en toda la cola: el «Permission denied» de un `cat` remoto culpaba a la contraseña de un
  corte de red.
