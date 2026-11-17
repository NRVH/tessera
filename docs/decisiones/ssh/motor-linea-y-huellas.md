# SSH: el OpenSSH del sistema por ruta fija, una línea que decide Tessera y un known_hosts por conexión

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/` (`binariosSsh.ts`, `lineaSsh.ts`, `huellasSsh.ts`, `clasificacionSalida.ts`,
  `ControladorSsh.ts`, `controlador/reconocimientoHuella.ts`), la sesión SSH de `src/main/terminales/` (`sesionSsh.ts`,
  `lanzadorSsh.ts`, `ServicioTerminal.ts`) y la huella de un servidor nuevo en el renderer (`features/ssh/huellaNuevaSsh.ts`,
  `storeHuellaNueva.ts`, `DialogoHuellaNuevaSsh.tsx`)

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
  contraseña. Toda línea que se autentica es estricta (`StrictHostKeyChecking=yes`), la de una persona y la de un
  agente: ningún secreto ni clave sale hacia un servidor cuya huella no confirmó una persona.
- Servidor nuevo: antes de «Probar», abrir una terminal o el explorador SFTP, el renderer pide al main que reconozca
  la cadena. Si un servidor no tiene huella guardada de su host y su puerto vigentes (los bastiones primero, en el
  orden en que se llega), el main la trae con una línea propia: `accept-new` sobre un `known_hosts` temporal, solo el
  método `none`, `BatchMode` y sin programa de contraseñas para ese servidor (los bastiones ya confirmados por los que
  se llega a él sí usan el suyo). Del temporal solo se toman las líneas de ese host, rehechas, y se borra. La huella
  queda pendiente en memoria del main con una ficha de un solo uso que caduca a los cinco minutos; el renderer enseña
  la huella y solo devuelve la ficha. Confirmar escribe esas líneas en el `known_hosts` de la conexión (escritura
  atómica, detrás de lo que hubiera) si su host y su puerto no cambiaron; cancelar no escribe nada y no se conecta.
  Si no se pudo traer: «Probar» enseña ese fallo y la terminal y el SFTP conectan igual, porque la línea estricta
  dice por qué no entra. Sin línea nueva pero con el servidor pidiendo credenciales, ssh ya lo conocía por el
  `known_hosts` del sistema y no hay nada que confirmar.
  En ese caso se continúa con el siguiente servidor sin huella de la cadena, dentro del mismo reconocimiento.
  Los servidores conocidos por el sistema se recuerdan solo durante esa llamada; no se escriben huellas ni se
  conceden permisos nuevos por ellos. Así un bastión conocido no oculta un destino nuevo.
- Huella sin confirmar: en las líneas de una persona, «No … host key is known … strict checking» es su propio motivo
  (`ssh-huella-sin-confirmar`), con o sin la ruta del `known_hosts`: su remedio es confirmarla (o, si el servidor
  ofrece ahora otro tipo de clave que el guardado, olvidar la guardada), que no borra nada por sí solo.
- Sesión: ssh corre DIRECTO en un pty del host (sin shell delante, cwd en HOME), aunque el proyecto sea de Docker;
  no recibe el entorno de BD ni hereda `SSH_ASKPASS`. Cerrar y reconectar matan el árbol sin teclear nada, por la
  cola de muertes. Hibernar el perfil no la cierra; el cierre de la app y la caída del renderer, sí. «Reconectar»
  vuelve a preparar con los datos vigentes de la conexión.
- Motivo de salida: solo con 255 (en Windows, también -1, que un comando remoto no puede dar) y solo si las últimas
  líneas sin ANSI traen un mensaje del cliente OpenSSH a principio de línea (huella cambiada, autenticación,
  inalcanzable o cortada, algoritmos); un corte vale también detrás del prompt remoto en la última línea, que es
  donde ssh lo escribe. Sin mensaje no hay motivo: el 255 pudo darlo el remoto. Gana el mensaje más reciente.
  La huella cambiada, en la terminal, el SFTP y `tssh`, solo cuenta si el aviso nombra un archivo de
  `ssh/huellas/` (ssh escribe ahí la ruta de su `known_hosts`, con las barras duplicadas en Windows): un `ssh`
  lanzado en el equipo remoto escribe el mismo aviso con el suyo, y culpar a la conexión llevaría a olvidar una
  huella buena. Para un agente, la única negativa propia sin ruta («No … host key is known», en estricto, cuando
  el servidor ya no ofrece el tipo de clave guardado) sale sin motivo y el agente lee el aviso de ssh tal cual. Con un bastión, a su aviso le sigue el cierre del `ssh` exterior; ese cierre no tapa la huella.
  El renderer solo trata como fallo de ssh el 255 o una salida con motivo: un -1 de Windows sin motivo dice «La
  sesión terminó», porque también es como llega un `exit` normal cuyo código perdió ConPTY. El corte real se
  reconoce aquí, por su texto, y llega con motivo.

## Descartes

- Una biblioteca SSH en JavaScript: le faltan algoritmos, no lee la configuración del usuario, no admite PKCS#8 y
  el agente no podría usarla.
- Un `ssh_config` generado: otro archivo que mantener para lo que caben unas pocas `-o`.
- El `~/.ssh/config` del usuario: un `Host *` colaría multiplexado, `ProxyCommand` u otro destino. Tampoco como
  opción por conexión: la línea dejaría de depender solo de lo guardado (distinta en cada equipo, distinta para el
  agente), y lo útil ya lo cubren «Importar desde OpenSSH», los bastiones y los túneles.
- Reutilizar la conexión abierta (`ControlMaster`): el ssh de Windows no lo admite, y una pestaña colgada arrastraría
  a las demás.
- Reabrir algoritmos antiguos (`diffie-hellman-group1-sha1`, `ssh-rsa` con SHA-1, CBC) para equipos que solo
  ofrecen esos: Tessera usa lo que el cliente del sistema acepta por defecto, y un equipo así se conecta por otra vía.
- Buscar frases sueltas en toda la cola: el «Permission denied» de un `cat` remoto culpaba a la contraseña de un
  corte de red.
- `accept-new` en las líneas de una persona: la contraseña guardada saldría hacia un servidor que nadie comprobó, y
  un servidor que de pronto ofrece otro tipo de clave que el guardado entraría sin aviso.
- Traer la huella con `ssh-keyscan`: es otro binario que buscar en cada plataforma, no sabe saltar por los
  bastiones con sus opciones y su formato de salida no es el que ya lee `huellasSsh.ts`.
- Que el renderer mande la huella o el texto al confirmar: lo que se escribe en el `known_hosts` lo decide el main
  con lo que trajo él; el renderer solo tiene la ficha.
