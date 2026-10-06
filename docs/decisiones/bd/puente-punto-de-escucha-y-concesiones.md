# El puente local: `tdb` pregunta en cada invocación, y el punto de escucha cambia según el sistema

- **Estado:** vigente
- **Ámbito:** `src/main/db/dbBridge.ts`, `puntoEscucha.ts` y las operaciones `ssh.*` que se registran en él (macOS: sin verificar aquí)

## Contexto

El ámbito y las contraseñas viajaban como variables del pty, congeladas en el `spawn`: marcar una casilla no
hacía nada hasta reiniciar la sesión del agente. Con el puente, `tdb` pregunta a Tessera en cada invocación y
montar o desmontar aplica al momento, sin perder la conversación.

## Decisión

- Qué mejora y qué no: el nombre del pipe no es secreto y el token vive en el entorno del pty, así que no protege
  frente a otro proceso del mismo usuario. Lo que elimina es la contraseña en el entorno de un proceso de larga
  vida, heredada por git, npm y los servidores MCP y visible en un volcado.
- Un token sirve solo lo montado en su proyecto (o, el de un solo uso, su conexión). Ninguna concesión ve el
  perfil entero. La marca `espacioDatos` es informativa: solo cambia la redacción de los mensajes de `tdb`, y se
  guarda en la concesión y no en la petición, porque lo que dice un proceso de la terminal sobre sí mismo no cuenta.
  La respuesta sigue llevando `consola: false`, que `tdb.cjs` lee.
- Windows: named pipe, objeto del kernel con la ACL por defecto (usuario, SYSTEM, Administradores). POSIX: un
  socket dentro de una carpeta 0700 propia, creada antes: con un socket suelto hay una ventana entre `bind` y
  `chmod`. Se mide la ruta contra `sun_path` (104 bytes en macOS, medido: 104 escucha, 105 da `EINVAL`), con
  límite propio de 100 y nombre de 16 hex; el temporal del usuario primero y `/tmp` de respaldo, nunca
  `userData` (con el nombre de usuario dentro roza el tope). Un `EINVAL` aquí deja el puente sin levantar y la app
  cae al contrato antiguo (contraseñas en el entorno) con una sola línea de rastro.
- Pausar no es parar: el cierre de la app se puede abortar. `pausar()` cierra el punto de escucha y barre la
  carpeta pero conserva nombre, tokens y ámbitos; `reanudar()` vuelve al mismo punto (los ptys vivos siguen
  valiendo) o, si no puede, a uno nuevo y `tdb` dice «Recarga la terminal». La carpeta se recrea SIN `recursive`:
  si ya existe, otro usuario pudo crearla y escuchar dentro le daría el socket. `stop()` es el apagado definitivo.
- El token se compara en tiempo constante; «no autorizado» es el mismo mensaje para inexistente, caducado y gastado.
- Otros dominios registran sus operaciones (`registrarOperacion`) sin tocar `resolve` ni su contrato: con token de SESIÓN (el puente
  la busca y dice de quién es; un token de un solo uso no vale) o con token PROPIO, que valida la operación (`ssh.askpass`, con sus
  fichas efímeras: el token de un agente nunca le sirve). Lo no registrado sigue siendo «operacion desconocida». El ámbito de las de
  `tssh` (`ssh.listar`, `ssh.preparar`…) es el PERFIL entero de la sesión, no lo montado (ver `ssh/tssh-y-agentes.md`).

## Descartes

- `userData` como carpeta del socket, y un nombre fijo de carpeta: obliga a distinguir un cierre sucio de otra
  Tessera viva, ambigüedad que el nombre aleatorio elimina.
