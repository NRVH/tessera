# Registro de cambios

Todos los cambios relevantes de Tessera se documentan en este archivo. El formato se basa en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/), y Tessera sigue el
[versionado semántico](https://semver.org/lang/es/).

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
