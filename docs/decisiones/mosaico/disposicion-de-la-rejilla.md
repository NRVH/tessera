# La rejilla del mosaico se elige en celdas de terminal, con suelo, banda del 5 % e histéresis

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/mosaico/mosaicoLayout.ts` y su prueba

## Contexto

Un agente necesita unas 80 × 24 celdas (depende de la letra, no del aspecto), y cada cambio de
forma redimensiona todas las terminales y obliga a cada agente a repintar entero.

## Decisión

- **Se puntúa en celdas, la peor tesela manda.** Tesela: `(min(c,80)/80) × (min(f,24)/24)`;
  disposición: la de su tesela más pequeña (maximin). Saturar en 80 × 24 impide que la altura
  sobrante compre el ancho que falta. Basta con puntuar `minimo` porque en todas las formas la
  tesela más estrecha es también la más baja; una forma nueva que rompa eso puntúa tesela a tesela.
- **Cerca del empate, menos filas.** AUTO elige, entre las válidas a ≥ 95 % de la mejor, la de
  menos filas de teselas (se leen en vertical); a igualdad, la que más puntúa y luego `preferible`.
  Consecuencia sabida: `principal` nunca gana en AUTO (la rejilla 2+1 la domina); se pide con preset.
- **Cuadrícula:** ⌈√n⌉ columnas; depende solo de `n`, para pedir el 2×2 aunque AUTO prefiera otra.
- **Suelo duro 50 × 12.** Solo compiten formas cuyas teselas lo pasan; si ninguna, `enfoque`
  (`celdas[i] === null` es «no se pinta», nunca «se desmonta»). Un preset que no llega no se aplica:
  decide AUTO con `presetRespetado: false`. Sin histéresis en el suelo.
- **La última fila se estira:** la rejilla CSS tiene mcm(recuentos por fila) pistas.
- **Histéresis.** Una anterior válida de la misma clase de elección (`origen`, `presetPedido`, `n`)
  se conserva si puntúa ≥ 95 % de la ELEGIDA de cero (no de la mejor). Así un vaivén exigiría que un
  píxel multiplicara el cociente por más de 1/0,95² ≈ 1,108, y un píxel da como mucho 13/12 × 51/50.
- **Sin medir** (0 × 0) se devuelve la forma canónica (la de 1920 × 1080) o la del preset, con
  `puntuacion: 0`, en vez de un destello de una sola tesela.
- **Mismo resultado, mismo objeto** (se devuelve `anterior`). **Flotantes:** suelo con tolerancia
  1e-6 y acotado a un entero finito ≥ 0.

## Consecuencias

4 teselas en un contenedor muy ancho salen en cuatro columnas: es la regla. La saturación, la banda y
la referencia de la histéresis no se tocan sin rehacer la cuenta y los barridos de la prueba.

## Descartes

Puntuar por aspecto, sumar o promediar áreas, el mínimo de los cocientes, saturar en 100 × 40 y
medir la histéresis contra la mejor (cambia la forma vigente por otra que apenas la mejora).
