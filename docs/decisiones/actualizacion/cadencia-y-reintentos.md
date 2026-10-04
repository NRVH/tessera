# La comprobación del feed sigue una cadencia por foco con un solo `setTimeout` rearmable, y un fallo de red pasajero se reintenta en silencio

- **Estado:** vigente
- **Ámbito:** `src/main/update/cadencia.ts`, `chequeo.ts`

## Contexto

Un `setInterval` acumula los disparos vencidos durante la hibernación y los suelta todos al despertar, con la red
de Chromium aún suspendida (`ERR_NETWORK_IO_SUSPENDED`): una píldora roja cada mañana sin actualización rota. Sobre
el ciclo corren tres relojes (cadencia, backoff de red, asentamiento tras despertar) que sin orden se pisan.

## Decisión

- Periodos: 8 s tras arrancar, 5 min con la ventana enfocada, 30 min en segundo plano; al recuperar el foco solo
  se comprueba si el último chequeo tiene más de 2 min. `TESSERA_CADENCIA_*` se honra también empaquetado, con
  suelo de 5 s.
- Un ÚNICO `setTimeout`, rearmado después de cada chequeo; nunca `setInterval`.
- Precedencia del planificador: ocupado (espeja el early-return de `check()`) → sistema suspendido (manda el
  power-monitor) → reintento en cola (el backoff siempre gana) → nunca comprobado → periodo según el foco.
- El foco se cuelga de `app` (`browser-window-focus`/`blur`), no de la ventana: la ventana se recrea y los oyentes
  morirían con ella. El `blur` se difiere con `setImmediate` porque al cambiar entre dos ventanas de la app Windows
  emite `blur` antes de `focus`. La reprogramación por foco no se registra: `log()` es `appendFileSync`.
- Un fallo de red pasajero, o cualquier fallo con el sistema suspendido, en un chequeo AUTOMÁTICO se reintenta a
  30 s, 2 min y 10 min sin pintar nada; agotado, se pinta. El chequeo MANUAL se pinta siempre. `checkForUpdates()`
  rechaza y además emite `error` por el mismo fallo: solo el primero cuenta.
- `suspend` cancela el reintento; `resume` espera 30 s a la red y limpia un `error` previo (no `avisoFallo`).
- `replanificar` difiere `check()` con `setTimeout(…, 0)`: se llama desde dentro de transiciones de estado.
- Un cierre abortado vuelve a cablear el foco y replanifica: `stopAutoUpdate` lo había soltado.

## Consecuencias

`cadencia.ts` es puro y `test:marcador-update` recorre la precedencia entera. `estadoTerminal` y el early-return de
`check()` tienen que seguir diciendo lo mismo.

## Descartes

- Un umbral de re-foco igual al periodo: volver tras diez minutos debe comprobar; volver tras treinta segundos, no.
