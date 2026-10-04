# Las versiones se publican en las Releases de GitHub desde Actions, como borrador hasta tener las dos plataformas

- **Estado:** vigente
- **Ámbito:** `electron-builder.yml` (`publish`), `.github/workflows/release.yml`, `scripts/parchearMinimoMac.mjs`, `scripts/sistemaMinimo.mjs`, `scripts/estado-feeds.mjs`

## Contexto

Tessera tiene una versión (`package.json`) y dos conjuntos de ficheros, uno por plataforma, que
electron-builder solo sabe producir en su propio sistema. Las apps instaladas se actualizan solas
leyendo `latest.yml` (Windows) o `latest-mac.yml` (macOS) en una URL fija. electron-builder no
escribe `minimumSystemVersion` en `latest-mac.yml`, y el relevo de macOS sustituye el bundle
entero: un Mac por debajo del mínimo de Electron acabaría con una app que no arranca.

## Decisión

- El feed es el proveedor `generic` contra `https://github.com/NRVH/tessera/releases/latest/download`.
  No `github`: con él electron-builder no escribe `url:` en `app-update.yml`, `resolverFeed()` se
  queda sin base y el relevo de macOS cae a la descarga manual. «latest» ignora borradores y
  prereleases, y los ficheros llegan por redirecciones 302 que `net.request` sigue solo.
- Se publica empujando la etiqueta `vX.Y.Z` al repo público. Actions compila Windows y macOS en
  paralelo (`npm run release:win` / `release:mac`, los mismos guiones que en local) y un último
  trabajo crea la release como BORRADOR, sube los dos conjuntos, comprueba que están los dos
  manifiestos y el mínimo de macOS, y solo entonces la marca como publicada y «latest». Si falta
  algo, falla sin publicar.
- El mínimo de macOS se copia del Info.plist del artefacto al manifiesto, TRADUCIDO a Darwin
  (`parchearMinimoMac.mjs`): electron-updater compara con `os.release()` por `semver.lt`, macOS
  11–15 son Darwin 20–24 (+9) y desde la 26, Darwin 25 (−1). Un «12.0» tal cual es semver
  inválido: electron-updater lo traga y deja pasar la actualización.
- macOS se firma ad-hoc (`identity: '-'`) y Windows va sin firmar. El .dmg instala y el .zip es lo
  que aplica el relevo; los dos se publican.
- `npm run feeds:estado` lee los manifiestos PUBLICADOS, avisa si al de macOS le falta el mínimo y,
  con `--estricto`, sale 1 si falta publicar, 3 si el feed va por delante del repo y 2 si no se
  pudo comprobar.

## Descartes

- Publicar cada plataforma por su cuenta en la misma release: una «latest» con el canal de una sola
  da un 404 a la otra en cada comprobación.
- El proveedor `github`: además de lo de `url:`, pasa por la API y su límite de peticiones anónimas.
- Firmar con Developer ID y notarizar: es de pago; el relevo propio funciona con firma ad-hoc.
