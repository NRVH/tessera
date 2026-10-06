# Modo Docker: un buzón de archivos por perfil, y el `tdb` real corre en el host

- **Estado:** vigente
- **Ámbito:** `src/main/db/dockerBridge.ts`, `src/tdb/tdb-container.cjs`, `SandboxManager` (macOS: sin verificar aquí)

## Contexto

El contenedor no debe conectar a ninguna base: no tiene la VPN ni los Instant Clients del usuario, y habría dos
caminos de datos. El puente al host recoge peticiones que el contenedor deja en una carpeta.

## Decisión

- Un buzón de archivos y no un puerto: un bind-mount funciona con red `bridge` y con `--network host`, no depende
  de WSL en modo `mirrored`, no abre puertos y no dispara avisos del firewall.
- El buzón es por perfil, pero dentro de un perfil la frontera es el contenedor entero. Por eso el ámbito y los
  secretos se resuelven siempre en el main a partir del token, y nunca se lee nada de eso del archivo de petición.
- El SQL viaja en la petición (`entrada`), no como ruta: `--stdin` se colgaba 90 s (la entrada del `tdb` del host
  no la cerraba nadie) y `--file` leía una ruta del host. La entrada estándar del `tdb` real se escribe y se cierra
  siempre, y un `--file` que llegue por el buzón se rechaza sin ejecutar nada: dejaría al contenedor leer, y con una
  base de archivo ejecutar, cualquier archivo del usuario.
- Sondeo cada 250 ms con `readdir` asíncrono, no `fs.watch`: el buzón lo escribe el contenedor por el bind mount de
  WSL2 y `ReadDirectoryChangesW` no garantiza esos eventos. Un perfil sale del sondeo cuando su contenedor muere
  (`olvidarPerfil`); sin perfiles se paran los temporizadores.
- El cliente se copia al buzón en cada preparación (se actualiza con Tessera sin rehornear la imagen) y un centinela
  con mtime fresco deja fallar en un segundo si el bind se perdió. El lanzador `sh` lo escribe el host con LF
  explícito (con `core.autocrlf` un shebang llegaría con CR) y con `chmod 755`: en macOS virtiofs conserva el modo
  real y el contenedor daría `permission denied`.
- El contenedor escribe en el buzón, así que el host nunca sigue un enlace de ahí: lo que escribe (clientes,
  lanzadores, centinela, respuestas) lo crea en exclusiva tras quitar lo que hubiera, y una petición que no es un
  archivo normal no se lee. Antes, un enlace llamado `tdb` hacía que el host pisara el archivo al que apuntaba
  (medido también en Windows).
- Otros dominios registran su programa en el mismo buzón (`registrarPrograma`; hoy `tssh`): sus archivos se copian con los
  de `tdb`, su lanzador se escribe igual y sus peticiones llevan `prog`. Sin `prog` es de `tdb`, como las de un cliente de
  antes; un `prog` que no está registrado contesta que se reinicie Tessera. El archivo de una petición pasa de 64 MiB: no se lee.
- Truncar una respuesta en silencio haría creer que se vio todo: por encima de 8 MiB se descarta con un error.
