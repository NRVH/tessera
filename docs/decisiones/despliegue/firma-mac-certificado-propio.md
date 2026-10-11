# En macOS la app se firma con un certificado propio de Tessera, el mismo en todas las versiones, para que el sistema no la trate como otra app al actualizar

- **Estado:** vigente (puente hasta tener Developer ID de Apple)
- **Ámbito:** `scripts/firmarMac.mjs` (gancho `afterSign`), `electron-builder.yml`, `.github/workflows/release.yml` (trabajo de macOS)

## Contexto

Con firma ad-hoc el requisito designado de la app es el cdhash del binario, distinto en cada versión.
macOS ata a ese requisito los permisos de privacidad (TCC: Accesibilidad, grabación de pantalla,
carpetas protegidas…), y tras cada actualización la app nueva no lo cumple: el permiso sigue marcado
en Ajustes, pero ya no vale, y todo lo que corre en las terminales de Tessera (que heredan sus
permisos) deja de tenerlo sin aviso. Medido al pasar de 0.74.0 a 0.76.1: `UI elements enabled` daba
`false` desde las terminales de Tessera con la casilla marcada, y la grabación de pantalla también
se perdió; volvió solo al quitar la app de la lista y añadirla de nuevo.

## Decisión

- electron-builder sigue firmando ad-hoc (`identity: '-'`) y el gancho `afterSign` vuelve a firmar el
  `.app` entero con el certificado autofirmado de Tessera (RSA 3072, válido hasta 2056, huella
  SHA-1 `4E4C715CC9E361144F6C348068D6C82474309460`), ANTES de que se generen el `.dmg` y el `.zip`. El
  requisito pasa a ser `identifier "com.noe.tessera" and certificate root = H"4e4c…"`, igual en todas
  las versiones. No se usa `mac.identity` con el nombre del certificado porque electron-builder solo
  acepta identidades de confianza (`find-identity -v`) y un autofirmado no lo es.
- El gancho firma solo si `TESSERA_FIRMA_MAC_LLAVERO` apunta a un llavero con el certificado; si no,
  deja la firma ad-hoc (builds locales y pruebas). Con `TESSERA_FIRMA_MAC_OBLIGATORIA=1` falla sin él,
  y tras firmar comprueba `codesign --verify --deep --strict` y que el requisito sea el del
  certificado. El workflow de publicación pone la obligación y mete el `.p12` (secretos
  `TESSERA_MAC_CERT_P12`, en base64, y `TESSERA_MAC_CERT_CLAVE`) en un llavero temporal del runner.
- El certificado y su clave viven fuera del repo, en `~/.tessera-firma-mac/` del Mac que publica (con un
  llavero `firma.keychain-db` para firmar en local), y necesitan una copia de seguridad:
  **perderlo o cambiarlo rompe la continuidad** de los permisos en todos los Mac instalados, igual que
  la firma ad-hoc.

## Consecuencias

- Medido con dos copias de versiones distintas firmadas con un certificado de prueba: el requisito
  designado es idéntico. Una Tessera ad-hoc se actualiza por el relevo a la firmada sin cambios en el
  relevo (`e2e/actualizacion.spec.ts`): `codesign --verify --deep --strict` la acepta.
- **El Llavero sigue preguntando una vez por versión** («Tessera Safe Storage»). Medido: con un
  certificado propio, sin identificador de equipo (`TeamIdentifier=not set`), macOS separa los
  elementos del Llavero por cdhash igual que con ad-hoc. Solo un Developer ID lo resuelve.
- Gatekeeper rechaza la primera apertura de una copia descargada igual que antes (`spctl` dice
  `rejected`, ahora con el certificado de Tessera como `origin`): sigue haciendo falta «Abrir de todos modos».
- La primera actualización desde una versión ad-hoc pierde los permisos una última vez; a partir de
  ahí se conservan.

## Descartes

- **Seguir con ad-hoc:** cada actualización deja sin permisos, en silencio, a quien usa la terminal de
  Tessera para trabajar.
- **Un requisito designado por el nombre del certificado** (`certificate leaf[subject.CN] = …`):
  cualquiera puede fabricar un certificado con ese nombre y heredar los permisos y el acceso al
  Llavero de Tessera. La huella no se puede falsificar.
- **Que el relevo exija a la versión nueva el requisito de la instalada** (`codesign -v -R=…`):
  protegería de publicar por error una versión con otra firma, pero bloquearía para siempre la
  migración prevista a Developer ID, cuya primera versión no cumple el requisito del certificado
  propio. La garantía queda en el build: `TESSERA_FIRMA_MAC_OBLIGATORIA` y la comprobación exacta del
  requisito de la app y de sus procesos auxiliares en el gancho.
- **Firmar una sola vez** (sin la pasada ad-hoc de electron-builder): ahorraría unos segundos por
  build a cambio de reimplementar el orden de firma de todo el bundle. El gancho conserva los
  entitlements y el runtime de esa primera firma (`--preserve-metadata`).
- **Developer ID de Apple:** lo resuelve todo (también el Llavero y Gatekeeper) y es el destino, pero
  cuesta una cuota anual y un alta en el programa de desarrolladores. Con él bastará con quitar el
  gancho, poner la identidad, `hardenedRuntime` y `notarize` (ver el comentario de `electron-builder.yml`),
  y la primera versión con Developer ID volverá a pedir los permisos una vez.
