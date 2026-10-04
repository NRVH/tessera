# En macOS la actualización la aplica un guion `sh` propio, porque Squirrel.Mac no puede con una firma ad-hoc, y el zip se baja y se verifica aquí

- **Estado:** vigente
- **Ámbito:** `src/main/update/relevoMac.ts`, `relevoMacPuro.ts`, `descargaMac.ts`, `descargaManual.ts`, `preparacionMac.ts` (macOS: sin verificar en Windows)

## Contexto

El requisito designado de una firma ad-hoc es el cdhash del propio binario (`codesign -d -r-`); Squirrel valida el
paquete nuevo contra el del que corre, y el nuevo tiene otro cdhash, así que `quitAndInstall` devuelve `false` sin
explicarse. `MacUpdater.doDownloadUpdate` ni siquiera baja un archivo: levanta un proxy HTTP para Squirrel.

## Decisión

- `autoDownload` apagado en Mac; `update-downloaded` no se emite nunca allí. La descarga es propia, con `net` (proxy,
  certificados y redirecciones del sistema), a `<userData>/tessera-updater/pending/<nombre>.parcial`, renombrado
  SOLO cuando el sha512 del feed cuadra. Sin sha512 no hay zip utilizable: se ofrece el `.dmg` (`available`).
  Revalidar es recalcular el hash del archivo en disco: el equivalente del re-hash de electron-updater.
- La promesa de la descarga resuelve siempre: vigía de inactividad de 60 s rearmado por trozo (no un tope total),
  `aborted` de la respuesta (el corte que no emite `error`) y `error` del flujo de escritura. NO se escucha `close`
  de la petición: llega un milisegundo después de `end()` y declaraba cortada toda descarga.
- El guion vive en `<userData>/tessera-updater/`, fuera del bundle que sustituye. Orden: esperar al pid,
  desempaquetar, BUSCAR el `*.app`, verificar la firma, APARTAR el viejo con un rename, poner el nuevo, borrar lo
  apartado. Todo fallo antes de apartar deja el destino intacto; después, devuelve la versión anterior.
- El guion escribe `ok` o `fallo: <motivo>` en una marca de UN solo uso que el arranque consume para
  `avisoFallo.mensaje`: es lo único que puede decir POR QUÉ no se aplicó.
- Solo es aplicable si el CONTENEDOR del `.app` es escribible (`/Applications` de otra cuenta, un `.dmg` montado).
  Se comprueba antes de descargar y otra vez al aplicar; se repite porque el `.app` se puede haber movido.
- No se portan los pre-vuelos de Windows: no hay archivos en uso que borrar (se renombra un directorio), no existe
  MAX_PATH y el supervisor es `/bin/sh`.
- Las descargas pendientes se podan al arrancar, tras sembrar (conservando la del marcador), no al cerrar.

## Consecuencias

`test:relevo-mac` ejecuta el guion de verdad contra un bundle de mentira y hace fallar el último paso (contenedor
en otro volumen sin espacio). Fuera de macOS esos casos se saltan diciéndolo.

## Descartes

- Un módulo común con `stagingRelevo.ts`: una copia de la app que supervisa NSIS y un guion de cuarenta líneas no
  comparten nada más que el momento en que corren.
