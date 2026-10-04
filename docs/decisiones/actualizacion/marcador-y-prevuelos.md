# El marcador en `userData` es la memoria del ciclo: se sella síncrono justo antes de ceder el control, después de los pre-vuelos, y agota dos intentos

- **Estado:** vigente
- **Ámbito:** `src/main/update/marcadorUpdate.ts`, `marcadorUpdatePuro.ts`, `decisionInstalar.ts`, `instalacion.ts`

## Contexto

Quien lanza el instalador muere ahí. El arranque siguiente tiene que contestar si la actualización se aplicó, falló
o sigue esperando, y un contador de intentos que no sube en los fallos es un bucle de reinstalación en cada cierre.

## Decisión

- Vive en `<userData>/pending_update.json` (con `.bak`), no junto al instalador: esa carpeta es de electron-updater
  y la vacía al preparar otra descarga. Leerlo nunca lanza (primario, `.bak`, `null`).
- Todo el I/O es SÍNCRONO. El sello es lo último antes de dejar de existir; una escritura asíncrona pendiente de
  `guardarMarcador` (temporal de nombre fijo, `rename` con reintentos) podía pisar el sello con `intentos: 0`.
- La evidencia de éxito es la versión que corre frente a `versionDestino`: `--updated` solo llega con `--force-run`,
  y al aplicar al cerrar no se pide. `esArranqueTrasActualizar()` es solo informativo aquí.
- Si ya había marcador para la MISMA versión destino, se conservan `intentos` y `bloqueado`: sin eso la guarda
  anti-bucle no saltaría nunca. Otra versión destino empieza limpia.
- `MAX_INTENTOS_UPDATE = 2`: las causas conocidas son deterministas y tienen pre-vuelo; el segundo intento cubre
  solo el apagón a media instalación.
- Pre-vuelos ANTES del sello, porque un pre-vuelo que aborta no ha cedido nada: (1) `decidirComoInstalar`: sin motor
  armado o sin instalador en disco se aborta con el motivo real (electron-updater devuelve `false` sin salir si su
  `downloadedUpdateHelper` es `null`); (2) en Windows, liberar la carpeta y MAX_PATH; (3) en macOS, `.app`
  localizable y contenedor escribible. `planDeCierre` repite (1) para el camino automático.
- Los fallos deterministas (sin instalador, ruta pasada de MAX_PATH, sin `.app`) bloquean la aplicación AUTOMÁTICA
  (`bloqueado`); los transitorios (contenedor no escribible, guion que no arranca) no. El botón manual sigue.
- Éxito: se borra al sembrar, no al descartar el aviso (un cierre inesperado lo repetiría en cada arranque). Fallo:
  se borra al descartar. Feed que ya no ofrece la versión: no se borra (queda «Abrir instalador»); se avisa una vez.
- `motor` admite `'nsis' | 'relevo-mac' | 'swap'`; `sanearMarcador` deja `'nsis'` a los marcadores sin campo.

## Consecuencias

`test:marcador-update` fija las decisiones puras; el `existsSync` del instalador lo hace el llamador. El sello va en
la última línea antes de `quitAndInstall` o `app.exit`, también en el camino del relevo.

## Descartes

- Orden de prerelease en `compararVersiones`: el canal publica solo `x.y.z`; una `-rc` lo reabriría.
