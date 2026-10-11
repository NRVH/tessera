# SSH: el bastión es otra conexión del perfil y los túneles viven con la terminal de la conexión

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/` (`saltosSsh.ts`, `controlador/lineaSaltos.ts`, `adaptadores/configSaltos.ts`, `lineaSsh.ts`,
  `validacionSsh.ts`, `fichasAskpass.ts`, `controlador/askpassSsh.ts`, `controlador/puenteTssh.ts`, `ControladorSsh.ts`)
  y el formulario de `features/ssh/` (`CamposSaltoTunelesSsh.tsx`, `borradorSsh.ts`) (macOS: sin verificar)

## Contexto

Hay equipos a los que solo se llega pasando por otro (un bastión), y servicios que solo escuchan dentro del
servidor (una base en `localhost:5432`). Medido con el ssh 9.5 de Windows y el servidor de pruebas: con
`ProxyJump`, ssh lanza el salto con `-F <archivo>` SIN comillas (una ruta con espacios se parte) y sin ninguna de
las `-o` de la línea, así que el bastión no tendría su `known_hosts` ni su clave. Un `ProxyCommand` propio con la
ruta entre comillas funciona, igual con el ssh del sistema (lo lanza sin shell, con las reglas de comillas dobles
de Windows) que con el de Git (lo pasa a `/bin/sh`, como el de macOS).

## Decisión

- **Bastión** = otra conexión del mismo perfil (`saltoId`), con su usuario, su clave o contraseña y su huella. Se
  pueden encadenar hasta 4; al guardar se rechaza un círculo o un hueco, y al conectar se vuelve a comprobar
  (el archivo se edita a mano). Borrar un bastión no toca a las que saltan por él: al abrirlas, un error dice qué
  editar.
- Cómo: una configuración generada en `ssh/saltos/<uuid>.conf` con un bloque por bastión (`tessera-salto-N`) que
  lleva las mismas opciones que su propia línea, y cada salto como `ProxyCommand` hacia el siguiente con el mismo
  ssh (nunca uno del `PATH`) y `-W [%h]:%p`. Una por conexión abierta, porque cada una cita su propia ruta; solo
  lleva rutas y opciones, y las de más de una hora se barren al escribir otra.
- Secretos: el ssh del bastión hereda el entorno, así que pregunta por el mismo programa de contraseñas. La ficha
  lleva la conexión y sus bastiones; cada pregunta se atribuye a la primera conexión que la contestaría (por su
  `usuario@host` o la ruta de su clave), y el secreto se da una vez por conexión. En la pestaña, con bastión, lo que
  Tessera no contesta va siempre al diálogo, como en el explorador SFTP: un bastión no tiene terminal.
- **Túneles** (`-L`, `-R`, `-D`) guardados en la conexión: se abren con su terminal y se cierran con ella. Los
  locales y el SOCKS escuchan solo en `127.0.0.1`. «Probar», el explorador SFTP y `tssh` no los abren.
- **Agentes**: `tssh` salta por el bastión de una conexión disponible aunque el bastión no lo esté (lo eligió el
  usuario), pero exige su huella confirmada por una persona y su secreto legible. Nunca abre túneles (la línea del
  agente y la de cada bastión llevan `ClearAllForwardings`).

## Descartes

- `ProxyJump`: ver el contexto. Un `ProxyCommand` anidado en la línea (sin archivo): cada salto encadenado
  añadiría otra capa de comillas de dos sistemas distintos.
- Bastión como texto libre (`usuario@host:puerto`): no tendría secreto guardado ni huella gestionada.
- Túneles en segundo plano sin terminal: un ciclo de vida propio (reconexión, cierre de la app) para un caso que
  la pestaña ya cubre.
- `ExitOnForwardFailure`: un puerto ocupado cerraría la terminal entera; ssh avisa en ella y sigue.
