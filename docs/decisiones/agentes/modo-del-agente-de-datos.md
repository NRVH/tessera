# El agente de datos nace en el modo del proyecto activo y se cambia desde su cabecera

- **Estado:** sustituida por [modo-por-agente.md](modo-por-agente.md)
- **Ámbito:** `features/bd/useEspaciosDatos.ts` (`alternarModoAgenteDb`), `bd/store.ts`, `shared/workspace-state-ipc.ts` (`dbAgenteDockerPorPerfil`), `features/agentes/CabeceraAgentPane.tsx`, `MenusAgentPane.tsx`, `panesCCPanel.ts`, `pestanas/store.ts` (`fijarModoNativo`) y `e2e/conexiones.spec.ts`

## Contexto

Quien trabaja un perfil con cuentas de contenedor quiere que su agente de datos use esa cuenta, como
los agentes de sus proyectos. En contenedor el agente sigue viendo las bases: `tdb` corre en el host
por el buzón del puente ([../bd/puente-buzon-de-docker.md](../bd/puente-buzon-de-docker.md)), así
que el contenedor no necesita la red ni los clientes del usuario.

## Decisión

- La verdad es una preferencia por perfil que se guarda en los ajustes (`dbAgenteDockerPorPerfil`,
  sin entrada = nativo). Al preparar el espacio se lleva al modo de su carpeta (`windowsModeProjects`),
  que es lo que leen el pane, la cuenta, la hibernación y la actualización de los agentes nativos.
- Nace en el modo en que se está trabajando: al abrirse por primera vez en la sesión, si el perfil
  tiene un proyecto activo, la preferencia toma el modo de ese proyecto. Ya abierto conserva el suyo
  aunque se cambie de proyecto (cambiarlo reiniciaría su conversación); sin proyecto, vale el último
  elegido.
- Se cambia desde un glifo de modo en la cabecera de su pane, con el mismo menú de los dos modos que
  la casilla del mosaico. El espacio no tiene pestaña de proyecto, que es donde un proyecto lo cambia.
  El conmutador de proyectos sigue sin tocar esta carpeta: lo pisaría la preparación siguiente.
- Cambiar de modo remonta el pane con la otra clave, como en un proyecto. En contenedor pide la
  cuenta del perfil si no hay ninguna; sus bases montadas son las mismas.
- Sus agentes son los de serie en los dos modos.

## Descartes

- Que el modo de la carpeta fuera la verdad sin preferencia aparte: la preparación no distingue un
  espacio nuevo de uno que el usuario puso en nativo, y forzaría siempre el mismo.
- El cambio desde la casilla del mosaico: se queda para cuando lo tengan también los demás agentes propios.
