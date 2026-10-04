# La sesión del agente toma el refcount de su credencial antes de tocar Docker y nunca para el contenedor

- **Estado:** vigente
- **Ámbito:** `src/main/agents/AgentTerminalController.ts` y `src/main/agents/terminalAgente/`

## Contexto

Cada sesión corre el CLI (Claude Code o Codex) en un pty: dentro del contenedor del perfil, con la
carpeta de credenciales de su cuenta montada en `/agent-config/<tipo>` toda la sesión, o nativo en
el host con el login personal. Varias sesiones de la misma (perfil, agente, cuenta) comparten montaje.

## Decisión

- Refcount EXPLÍCITO por `perfil/agente/cuenta` (un solo mapa, `configRefs`), tomado en `open`
  antes del primer `await` de Docker y devuelto si la apertura falla. Derivarlo del mapa de
  sesiones no veía una apertura en vuelo: se desmontaba la credencial bajo ella y el agente
  arrancaba sin login. Se desmonta solo al llegar a 0.
- Cerrar una sesión solo apunta el refcount del contenedor (`agent:<id>`, para no chocar con la
  terminal de abajo): los contenedores paran por hibernar o al cerrar la app.
- Lo primero al cerrar es revocar el token de bases, con la clave con espacio de nombres del agente.
- `reload` vuelve a poner en pie Docker, contenedor, proyecto y credencial antes de relanzar: es
  la vía de recuperación tras una caída. La conversación de la sesión manda sobre la que resuelva
  el renderer; el id del renderer solo cubre una sesión que arrancó sin reanudar.
- El desarme (cerrar el turno, re-anclar con `arm` + `pin` sin heredar la marca de envío, detector
  nuevo, suprimir el volcado) va justo antes de relanzar: si Docker falla antes, sigue armada.
- La clave del ancla usa la ruta COMPLETA del proyecto, la misma que el lector del anillo.
- Aperturas y reinicios nativos esperan el candado de la actualización de su agente; al volver,
  el reinicio comprueba que la sesión sigue en el mapa.
- `detenerVarias` valida todas sin ningún `await` antes de parar la primera: todas o ninguna.
  «Esperando tu respuesta» bloquea igual que «trabajando» (la parada teclea `^C`).
- `HOST_ACCOUNT_ID` vale `'windows-personal'` en los dos sistemas: forma parte de claves persistidas.

## Consecuencias

- Un único estado (`NucleoAgente`) compartido por las piezas; nadie copia los mapas.
- El emisor de eventos y el portapapeles entran inyectados: el servicio carga con `node`.

## Descartes

- Contar referencias recorriendo las sesiones al cerrar: no ve la apertura en vuelo.
