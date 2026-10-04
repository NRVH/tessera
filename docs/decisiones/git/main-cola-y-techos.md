# Los procesos de git van por una sola cola, con techo solo en las lecturas

- **Estado:** vigente
- **Ámbito:** `src/main/git/adaptadores/procesoGit.ts`, `adaptadores/colaGit.ts` y `estado.ts`

## Contexto

Abrir una contenedora con cientos de repos lanza un `git status` por repo, y en Windows cada
proceso cuesta. Sin tope, 400 repos dejaron el bucle de eventos del main sin atender el IPC 3 s
seguidos. Y un `git` colgado (unidad de red caída, VPN, un remoto que pide credenciales) retenía su
plaza para siempre: con 16 así, git quedaba muerto para todos los perfiles.

## Decisión

- Una ÚNICA cola para todo el proceso (`TOPE_GIT = 16`, instancia de módulo en `procesoGit.ts`).
  Medido con 400 repos: tope 8, 7,7 s y 200 ms de parón; **16, 5,0 s y 42 ms**; 32, 3,4 s y 253 ms;
  sin tope, 3,2 s y 3.065 ms. El tope compra latencia, no rendimiento: ni se baja para «ir más
  rápido» ni se sube «porque hay más núcleos».
- Prioridad `VISIBLE` > `PRONTO` > `FONDO`: lo que se ve va antes que el relleno de fondo.
  `multiStatus` usa un ámbito por contenedora; al cambiar de proyecto se tira lo que aún no ha
  nacido (`setProjectRoot` cancela el viejo y reabre el nuevo) y un cancelado no se pinta como error.
- Techos de tiempo, decididos por el ÁMBITO y no por la prioridad: 60 s en lo interactivo, 20 s
  en el abanico. `killSignal: 'SIGKILL'`.
- **Lo que escribe no lleva techo.** En Windows matar un `git commit`, `add`, `restore` o
  `checkout` es un `TerminateProcess`: git no limpia y deja `.git/index.lock`, y desde entonces toda
  escritura de ese repo falla. Un commit con un hook que corre pruebas pasa de 60 s sin problema.
  `ESCRITURAS` es una lista explícita: un verbo nuevo que escriba entra ahí antes de usarse.
- Las lecturas van con `--no-optional-locks` (delante del subcomando): sin él, un `status` toma
  `index.lock` para refrescar su caché y matarlo dejaría el mismo problema.
- Quedan FUERA de la cola `cat-file --batch` y el `rev-parse --show-toplevel` del repo activo.
- `multiStatus` gotea cada repo por `STATUS_PARCIAL` según responde y devuelve al final la lista
  completa; usa un solo proceso por repo (`--branch` trae la rama en la cabecera).

## Descartes

- Cancelar matando el proceso: abortar lo que ya corre no ahorra nada; el ahorro está en lo que
  aún no ha nacido.
- Un único techo intermedio: o corta un `git log` legítimo o es largo de más para el abanico.
