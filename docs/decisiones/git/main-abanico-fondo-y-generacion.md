# El relleno de fondo del abanico de estado tiene su propio tope y lo de una generación superada no nace

- **Estado:** vigente
- **Ámbito:** `src/main/git/adaptadores/colaGit.ts`, `adaptadores/procesoGit.ts`, `estado.ts`

## Contexto

Volver a una contenedora con decenas de repos pide el estado de todos: uno o dos se ven y el resto
es relleno de fondo. El fondo competía por las mismas 16 plazas que lo visible, y una tanda nueva de
la MISMA contenedora no descartaba lo encolado de la anterior, cuyas respuestas el renderer tira.

## Decisión

- `ColaGit(tope, topeFondo)`: un trabajo `FONDO` solo arranca si hay menos de `topeFondo` de fondo
  en vuelo. `VISIBLE` y `PRONTO` siguen con todo el tope, y la prioridad y el orden no cambian.
- `TOPE_FONDO = 4`. Medido con 60 repos y 6 corridas alternadas por tope (mediana del tiempo; parón
  máximo del bucle de eventos): tope 2, 841 ms y 19 ms; **4, 574 ms y 25 ms**; 8, 449 ms y 47 ms;
  16, 453 ms y 102 ms. Como el tope general, compra latencia y no rendimiento.
- `correr(…, vigente)`: al SACAR un trabajo de la cola, si `vigente()` es falso se rechaza con
  `CanceladoError` sin ejecutarse, igual que el de un ámbito cancelado.
- `multiStatus` recuerda la generación de la ÚLTIMA tanda pedida. Cada repo se encola con
  `vigente = () => genVigente === gen` y no se manda `STATUS_PARCIAL` de una generación superada.
  Manda la última y no la mayor: un renderer recargado vuelve a contar desde 1. Sin `gen` no se
  descarta nada.
- No se mata nada que ya corre (ver `main-cola-y-techos.md`): acaba, entra en la respuesta de su
  tanda y el renderer la descarta por generación.

## Consecuencias

- Se sigue preguntando por TODOS los repos: la corrección es la de antes. Lo que cambia es que el
  fondo llega en más tandas, con la semilla pintada mientras tanto.
- Supone que el renderer no pide una generación vieja después de una nueva. Un llamador que lo
  rompa cancelaría la tanda vigente: lo fija `test:estado-abanico`.

## Descartes

- Bajar el tope general: frenaría también lo visible.
- Cancelar por ámbito al llegar cada tanda: tiraría también los repos visibles de la tanda nueva.
