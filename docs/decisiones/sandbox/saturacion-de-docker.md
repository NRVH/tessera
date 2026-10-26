# Si la memoria de Docker se satura, Tessera para un contenedor según la política del usuario, con aviso previo y constancia

- **Estado:** vigente
- **Ámbito:** `src/shared/saturacionDocker.ts`, `src/main/agents/terminalAgente/saturacion.ts` (`VigiaSaturacion`), `cupo.ts` (`pararPor`, `candidatos`), `registroParadas.ts`, `SandboxManager.medirMemoria`, `shared/agent-terminal-ipc.ts` (`SATURACION_*`, `REGISTRO_PARADAS`), `renderer/src/features/agentes/useSaturacionDocker.ts`, los ajustes `saturacionUmbral`, `saturacionSegundos` y `avisarAntesDeParar` y su grupo en «Contenedores Docker»

## Contexto

El límite de contenedores (`limite-de-contenedores.md`) solo actúa al abrir un agente, y el usuario puede
ponerlo en rojo o quitarlo. Con muchos agentes trabajando a la vez, la memoria de Docker se agota sin
que nadie abra nada: el sistema mata un proceso cualquiera, a veces la máquina virtual entera, y el
usuario culpa a Tessera. Tessera no decide qué sacrificar: aplica lo que el usuario eligió y lo dice.

## Decisión

- **Saturado = por encima del umbral durante un tiempo.** Mientras corre algún contenedor de cuenta, el
  main suma cada 5 s la memoria de todos los contenedores (`docker stats`, de Tessera o no: satura la
  suma) contra la de Docker (`docker info`). Por encima del umbral del usuario (80–95 %, 90 % de serie)
  durante sus segundos (15 s–2 min, 30 s de serie) está saturado; un pico no basta. Sin medida no se
  decide nada: Docker que no responde no es Docker que se recuperó.
- **Qué se para:** la misma política del límite (un contenedor sin agentes primero; después los últimos,
  los primeros o los de más tiempo sin uso). Nunca uno a la vista, uno manual ni uno abriéndose; eso
  también vale ya al hacer sitio por el límite. Si protege los que trabajan y no queda otro, se para uno
  trabajando: con Docker sin memoria caería uno igual, y sin elegir.
- **Aviso previo de serie:** dice qué se parará y espera 30 s, con «Parar otro», que vale para ese aviso.
  Si la memoria baja, se cancela. Sin aviso, se para al cumplirse el tiempo.
- **Parar es hibernar:** cada agente recibe su salida (`parado-por-saturacion`) y «Reabrir» retoma la
  conversación. Tras cada parada hay un respiro de 20 s para que la memoria baje; si sigue saturado, es
  la misma racha y se actúa sin volver a esperar el tiempo.
- **Constancia:** cada parada (por el límite o por la saturación) se anuncia con su regla y se apunta en
  `logs/paradas-contenedores.jsonl` (las 200 últimas), que la sección enseña en «Últimas paradas». Si el
  límite está en rojo, el aviso lo recuerda.
- **El renderer manda** los ajustes, la política y qué proyectos se ven (`SATURACION_VIGIA`); sin eso el
  vigía no mide ni actúa.

## Consecuencias

- `test:saturacion-docker` fija la lectura de `docker stats` y cada paso del vigía; `test:registro-paradas`,
  la constancia; el escenario 11 de `test:escenarios-multicuenta`, el recorrido con contenedores reales y
  la medida falsa.
- Mientras haya contenedores de cuenta, `docker stats` corre cada 5 s (unos 1–2 s de Docker cada vez).

## Descartes

- Leer la memoria de la máquina virtual de Docker por dentro: necesita un contenedor privilegiado y no
  existe igual en Linux, donde Docker usa la memoria del equipo.
- Parar a ciegas el más pesado: es justo el que suele estar haciendo la tarea larga que el usuario protege.
