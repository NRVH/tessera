# SSH: los agentes usan las conexiones del perfil con `tssh`, que pregunta a Tessera y nunca ve un secreto

- **Estado:** vigente
- **Ámbito:** `src/tssh/`, `src/main/ssh/` (`controlador/puenteTssh.ts`, `catalogoAgentes.ts`, `briefingSsh.ts`,
  `atajosTssh.ts`, `lineaSsh.ts` en modo agente, `adaptadores/registroTssh.ts`, `controlador/buzonTssh.ts`, `transferenciaBuzon.ts`)
  y `src/main/agents/briefingCompuesto.ts` (macOS: sin verificar)

## Contexto

Los agentes nativos (los de los proyectos y el de la terminal) tienen que revisar equipos o copiar archivos sin que nadie les
dicte credenciales. Medido en Windows: PowerShell 5.1 se come un `--` sin comillas al llamar a un guion, quita las comillas dobles
de un argumento (impares, lo parte), no analiza un apóstrofo tipográfico y lee un `.ps1` sin BOM en ANSI; MSYS convierte todo `/…`.

## Decisión

- `tssh` (`ls`, `run`, `cp`, `doctor`, `help`), hermano de `tdb`: atajos sh, ps1 y cmd en la misma `bin/s<N>`, ya en el PATH de
  las terminales y los agentes nativos. Vocabulario cerrado: ninguna opción llega a ssh. Tras el alias de `run`, la orden empieza
  en la primera palabra que no es una opción de `tssh`, haya `--` o no.
- El puente de `tdb`, con el token de SESIÓN y el PERFIL entero como ámbito: `ssh.listar` (las «Disponible para los agentes» y
  cuántas más, sin nombrarlas), `ssh.preparar`, `ssh.terminar` (revoca la ficha y clasifica un 255) y `ssh.diagnostico`. Una
  excluida contesta lo mismo que una que no existe.
- La línea la decide `lineaSsh` en modo agente: huella estricta (solo equipos que ya aceptó una persona), `BatchMode` si no hay
  secreto, sin redirecciones, `LocalCommand` ni terminal; scp con `-S` del ssh de su carpeta. Con secreto, una ficha del programa
  de contraseñas de 120 s y 3 usos que solo viaja en el entorno del ssh lanzado, nunca en el del agente.
- Cada petición mira solo el perfil de su sesión (`ConexionesSsh.listar(perfil)`).
- Códigos propios, antes de conectar: 2 uso, 3 puente, 4 alias, 5 huella, 6 no se puede usar, 124 tope. Si la orden corre, el suyo.
- Aviso de arranque en nativo: el de bases tal cual (prefijo exacto) y detrás el de SSH, con los textos del usuario sin comillas
  tipográficas ni dobles (`tssh` busca el alias con cualquier comilla). Codex lo recibe por `-c developer_instructions` (ver
  `agentes/sesion-linea-de-arranque.md`).
- `logs/ssh.log`: perfil, subcomando, alias, código y duración; nunca la orden remota ni las rutas.
- Atajos: el sh pide a MSYS que no convierta nada y `tssh` traduce las rutas locales (`/c/…`, y `/tmp/…` con `cygpath`); el ps1
  lleva BOM y no tiene `param` (así recibe `$input`); el cmd escribe la carpeta del usuario con su variable (`%LOCALAPPDATA%`).
- El aviso de arranque y el `CLAUDE.md` del agente de la terminal salen del mismo catálogo y de las mismas frases (`catalogoAgentes`).
- El ssh lanzado no hereda el programa de contraseñas, la ficha, el puente (`TESSERA_DB_PIPE`) ni el token de la sesión
  (`QUITAR_ENV_TSSH`); `tssh` vuelve a quitar el puente aunque una respuesta no traiga la lista.

- Proyectos en modo Docker: `tssh` del contenedor es un cliente del buzón del puente de `tdb` (`src/tssh/tssh-container.cjs`,
  registrado con `registrarPrograma` desde `controlador/buzonTssh.ts`) y el `tssh` real corre en el host con el token de la
  sesión del contenedor: el contenedor no tiene la VPN ni las claves, y las reglas son las mismas que en nativo. La salida va en
  base64 (un binario llega intacto) y al acabar, no en vivo, así que `run` lleva un tope de 10 min si no se pide otro. En `cp`
  los archivos viajan dentro de la petición y de la respuesta (32 MiB y 10 000 archivos por vez) y pasan por una carpeta
  temporal del host que el contenedor no ve: ninguna ruta del contenedor se usa en el host, al leer lo bajado no se sigue
  ningún enlace y un nombre que el host no admite (o `..`) se rechaza. Si no, un enlace dentro del proyecto haría que el agente
  de un contenedor subiera o pisara archivos del usuario.
- Codex: `-c developer_instructions` sustituye la clave, así que unas instrucciones propias en su `config.toml` no se aplican
  mientras Tessera mande un aviso.

## Modelo de amenaza

El agente nativo corre como el usuario: puede leer su `userData`, hablar con el puente y lanzar ssh como lo hace Tessera. El
token del puente y la copia protegida de la clave son higiene, no una frontera: el secreto no está en el contexto del agente,
ni en su entorno, ni en los registros. «Disponible para los agentes» es un contrato que cumple `tssh`, no un cerrojo.

## Descartes

- Pasar opciones a ssh: con `-o HostName=` la contraseña guardada iría a otro destino. Un segundo pipe para SSH: el registro de
  operaciones del puente ya da la sesión y su perfil. Que Tessera lance ssh desde el puente: sus operaciones son síncronas.
