# Registro de cambios

Todos los cambios relevantes de Tessera se documentan en este archivo. El formato se basa en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/), y Tessera sigue el
[versionado semántico](https://semver.org/lang/es/).

## [0.76.0] - 2026-10-06

- **Cambios con varios repositorios, rediseñado.** Solo salen los repositorios que tienen
  cambios; los que están al día no ocupan la lista (con más de 50 repositorios en la carpeta se
  siguen enseñando todos). Cada repositorio lleva una casilla para marcar todos sus archivos, su
  nombre sin negrita y, a la derecha y en gris, el número de cambios y la rama. Los archivos
  cuelgan de su repositorio con la carpeta contada desde él, y el encabezado «Cambios» ya no se
  repite cuando es la única sección: sus botones de lote pasan a la cabecera del repositorio.
  En una columna estrecha, los botones de lote se quedan en su icono.
- **Un repositorio enlazado ya no sale dos veces.** Si dentro de la carpeta abierta hay un
  enlace a un repositorio de la misma carpeta, Cambios lo enseña una sola vez, por su carpeta
  real.

## [0.75.0] - 2026-10-06

- **Repositorios anidados en la vista de Git.** Una carpeta que no es un repositorio y agrupa
  varios en subcarpetas (por área, por capa: `mensajeria/back/…`, `mensajeria/front/…`)
  enseña ahora todos los que están hasta cuatro niveles por debajo, cada uno con sus cambios
  e historial; preparar, descartar y hacer commit van al repositorio de cada archivo. No se
  busca dentro de un repositorio ya encontrado, ni en dependencias, compilados o carpetas
  ocultas.
- **Los agentes saben qué es `tdb` aunque no haya bases montadas.** Todo agente que lanza
  Tessera recibe un aviso corto de que `tdb` es el CLI de bases de datos; si le pides algo de
  una base, mira las que hay con `tdb ls` o te pide que la montes.
- **Seguridad**: un enlace dentro de la carpeta abierta ya no deja que Git opere, ni descarte
  archivos, en un repositorio de fuera de ella.

## [0.74.0] - 2026-10-06

- **Conexiones SSH en la terminal.** Cada espacio de trabajo guarda sus conexiones SSH con
  nombre y en grupos, y se abren en pestañas de la terminal que se ven en todos sus proyectos,
  también sin proyecto abierto. Se entra con contraseña, con un archivo de clave (`.pem` u
  OpenSSH, guardado como copia protegida sin tocar el original) o con las claves del sistema.
  La contraseña y la frase de la clave se guardan cifradas y se dan solas al conectar.
  «Probar» comprueba la conexión, y se puede olvidar la huella guardada de un servidor.
- **Importar desde OpenSSH.** El formulario de nueva conexión lee tu `~/.ssh/config` (o el
  archivo que elijas): con un solo `Host` rellena el formulario, y con varios abre una
  revisión para elegir cuáles importar, cambiarles el nombre, el usuario y el grupo, y dejar
  la contraseña o la clave de cada una lista para conectar.
- **Explorador SFTP.** Cada conexión abre un explorador de archivos en una pestaña de la
  terminal: navegar, crear carpetas, renombrar, borrar, y subir y bajar archivos y carpetas
  con progreso, cancelación y confirmación antes de reemplazar. Se puede soltar archivos sobre
  la lista o sobre una carpeta.
- **Terminal a pantalla completa.** Con un botón o con Ctrl+Shift+Enter (⇧⌘↩) la terminal
  ocupa todo el área de trabajo; abrir un archivo o elegir una vista lateral la devuelve a la
  franja. A pantalla completa, las conexiones SSH quedan fijas en un riel plegable a la
  izquierda.
- **Agente de la terminal.** A pantalla completa, a la derecha de la terminal hay un agente
  propio del espacio de trabajo, con su carpeta y su historial, para pedir ayuda con tus
  servidores sin abrir un proyecto. Salir de pantalla completa lo oculta sin cerrarlo.
- **`tssh` para los agentes.** El agente de cualquier proyecto, nativo o Docker, y el agente
  de la terminal usan las conexiones SSH del espacio de trabajo con `tssh`: listar, ejecutar
  comandos y copiar archivos, sin ver nunca la contraseña ni la clave y solo en servidores
  cuya huella ya aceptaste. La casilla «Disponible para los agentes» decide qué conexiones ven.
- **Codex recibe el aviso de bases de datos y de SSH** al arrancar, como Claude Code, y sabe
  salir de su sandbox para usar `tdb` y `tssh`.
- **Cabecera de la terminal**: el «+» abre una terminal al instante y la ▾ abre la lista de
  conexiones, con las recientes arriba. Los botones de la derecha son maximizar, reiniciar y
  ocultar, los tres como iconos con su nombre al pasar el ratón.
- **Seguridad**: lo que se teclea en una terminal deja de quedar escrito en la consola de la
  app.
- Arreglos:
  - Un Esc en un diálogo abierto encima de otro cierra solo ese.
  - Borrar un perfil y recrearlo enseguida con el mismo nombre ya no puede tocar las carpetas,
    las sesiones ni las conexiones del nuevo; las carpetas de los agentes de un perfil borrado
    van a la papelera.
  - En «Buscar en archivos», con la lista de carpetas abierta, las flechas e Intro eligen
    carpeta.
  - MongoDB: cambiar a `srv` o las opciones de la URI corta la contraseña emitida para el
    destino anterior.
  - Oracle: «Ver DDL» funciona contra una 11.2.0.4 con el cliente 23 (el de Mac).

## [0.73.0] - 2026-10-04

- **Vista de Git a pantalla completa.** Un botón en la cabecera de la vista de Git la extiende
  a todo el área de trabajo, tapando el explorador, el editor y el agente sin cerrarlos. Un
  botón fijo la devuelve a la franja inferior tal como estaba. Abrir un archivo o saltar al
  fuente desde ella vuelve a la franja y lo enseña en el editor; recorrer los commits no abre
  nada mientras dura la pantalla completa.
- **Apoya el proyecto.** El repositorio tiene botón «Sponsor» y un enlace de PayPal.

## [0.72.0] - 2026-10-04

- **Pie del agente más limpio.** El uso de la cuenta y el contexto de la conversación se ven
  como dos cápsulas separadas: la de la cuenta agrupa sus ventanas (sesión, semanal y la
  semanal propia de un modelo) en tramos, y la del chat lleva el anillo. La semanal de un
  modelo ocupa una sola letra («F» para Fable); su nombre completo sigue en el desplegable.

## [0.71.1] - 2026-10-04

- **El repositorio, en español por defecto.** El README y los documentos del proyecto (la
  guía para contribuir, la política de seguridad, el código de conducta, las plantillas de
  issues y de pull requests, este registro de cambios y los avisos de terceros) pasan a
  español. El README, la guía para contribuir, la política de seguridad y el código de
  conducta enlazan a su versión en inglés con «Read in English».
- Los issues y los pull requests se siguen aceptando en español o en inglés.
- **Descarga directa.** El README enlaza «Descargar para Windows» y «Descargar para Mac», que
  bajan siempre el instalador de la última versión (`Tessera-Setup.exe` y
  `Tessera-mac-arm64.dmg`).

## [0.71.0] - 2026-10-04

Primera versión pública.

Tessera es un IDE de escritorio para Windows y macOS (Apple Silicon) para quien trabaja en
varios proyectos y con varias cuentas de IA.

- **Espacios de trabajo** con su propio color y sus proyectos.
- **Nativo o Docker, por proyecto.** El modo nativo (el de por defecto) corre el agente en tu
  equipo con la cuenta iniciada en él, la misma en todos los espacios de trabajo. El modo
  Docker lo corre en el sandbox propio del espacio de trabajo, viendo solo los proyectos de
  ese espacio, con una cuenta que pertenece al espacio y nunca se comparte con otro.
- **Agentes lado a lado**, con historial de conversaciones, uso de la cuenta, el contexto de
  la conversación actual, un mosaico de hasta seis agentes e hibernación automática de los
  agentes inactivos.
- **Un IDE completo a su alrededor**: editor Monaco y visores de archivos, explorador de
  archivos, Git con grafo del historial y diffs editables, y terminales.
- **Bases de datos**: Oracle, PostgreSQL, SQL Server, MongoDB, Redis y SQLite, con consolas,
  una rejilla de resultados, edición con confirmación y `tdb` para que los agentes consulten
  sin ver nunca una contraseña.
- **Actualizaciones automáticas** desde las Releases de GitHub en las dos plataformas.

Descarga `Tessera-0.71.0-Setup.exe` para Windows 11 (64 bits) o `Tessera-0.71.0-arm64.dmg`
para macOS 12 o posterior en Apple Silicon. Los instaladores no están firmados con un
certificado de pago: el [README](https://github.com/NRVH/tessera#primer-arranque-de-una-app-sin-firma)
explica cómo abrir Tessera la primera vez en cada sistema.
