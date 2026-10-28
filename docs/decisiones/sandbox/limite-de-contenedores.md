# El usuario fija cuántos contenedores de Docker a la vez, con un semáforo, y al llegar al límite Tessera para otro según su política

- **Estado:** vigente
- **Ámbito:** `src/shared/semaforoContenedores.ts`, `src/main/agents/terminalAgente/cupo.ts` (`conSitio`, `hacerSitio`), `apertura.ts`, `aperturaManual.ts`, `SandboxManager.ts` (`contenedoresVivos`, `recursos`), `shared/sandbox-estado-ipc.ts` (`RECURSOS`), `shared/agent-terminal-ipc.ts` (`cupo`, `PARADA_POR_LIMITE`), los ajustes `limiteContenedores`, `primeroEnPararse` y `protegerTrabajando` y su sección «Contenedores Docker»

## Contexto

Con un contenedor por cuenta (`contenedor-por-cuenta.md`), abrir muchas cuentas a la vez es posible y cada
agente trabajando ocupa de 0,3 a 1,5 GB. Sin tope, unos cuantos de más agotan la memoria de Docker y tumban
agentes, o la máquina virtual entera. Lo que aguanta depende del equipo, y quien decide arriesgarse es el
usuario: Tessera tiene que decírselo claro y no morir por ello.

## Decisión

- **Límite del usuario con semáforo.** Un ajuste por equipo (no se exporta) con una barra coloreada según la
  memoria que tiene Docker (`docker info`): verde, todos trabajando a pleno caben en el 70 %; amarillo, a
  medio gas en el 90 %; rojo, más allá. Hay «Sin límite», también en rojo. Sin ajuste vale el recomendado,
  el último verde. Cuentan todos los contenedores de Tessera.
- **Al llegar al límite, al abrir un agente en Docker** (el cupo viaja en la petición, desde los ajustes):
  se para primero un contenedor de cuenta sin agentes; si no hay, el que diga la política (los últimos
  abiertos, por defecto, que protege las tareas largas; los primeros; o los de más tiempo sin uso). Nunca
  el que se abre, uno a la vista, uno con un agente manual (no se sabe retomar su conversación) y, si así
  se pide, nunca uno trabajando mientras haya otro. La parada y su constancia son las mismas que las de
  la saturación (`saturacion-de-docker.md`). Sus agentes se sueltan como en una hibernación: el renderer los
  marca y se retoman al volver, y un aviso dice qué se paró y con qué regla. Si no se puede parar ninguno,
  la apertura se rechaza explicando por qué.
- **De uno en uno.** Hacer sitio y crear el contenedor van en un solo turno: dos aperturas a la vez no se
  cuelan las dos por el último hueco. Sin límite, o con el contenedor ya vivo, nadie espera.

## Consecuencias

- `test:semaforo-contenedores` fija los cortes, los colores y qué se para con cada política;
  `test:escenarios-multicuenta` lo hace con contenedores reales.
- Un agente parado por el límite pierde lo que estaba haciendo en ese momento; el aviso lo dice.

## Descartes

- Un límite fijo de Tessera: un equipo de 8 GB y uno de 64 GB no aguantan lo mismo, y la responsabilidad del
  riesgo es de quien lo elige.
- Rechazar sin más al llegar al límite: obliga a ir a cerrar a mano algo que la política del usuario ya decide.
