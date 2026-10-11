# En Linux, sin llavero del escritorio, Tessera no guarda contraseñas

- **Estado:** vigente
- **Ámbito:** `src/main/db/adaptadores/almacenSeguro.ts`, `src/main/db/adaptadores/cifradoSistema.ts`

## Contexto

Las contraseñas de las conexiones de BD y SSH se cifran con `safeStorage`. En Windows es DPAPI y en
macOS el Llavero: siempre protegen. En Linux, `safeStorage` usa GNOME Keyring (libsecret) o KWallet
según el escritorio; si no encuentra ninguno, cae a `basic_text`, que cifra con una clave fija
escrita en el propio Chromium, y aun así `isEncryptionAvailable()` responde que sí. Cualquiera que
lea el archivo de conexiones descifraría las contraseñas.

## Decisión

- En Linux el cifrado cuenta como disponible solo si el backend es un llavero de verdad
  (`gnome_libsecret`, `kwallet*`). `basic_text` y `unknown` cuentan como no disponible.
- Sin almacén, el registro se niega a guardar la contraseña, como ya hacía en cualquier plataforma
  sin cifrado: «Tessera nunca la guarda en claro». En Linux el mensaje añade el remedio: instalar y
  desbloquear GNOME Keyring o KWallet, o arrancar con `--password-store=gnome-libsecret` en otros
  escritorios.

## Consecuencias

- En un Linux sin llavero se puede crear la conexión, pero no guardar su contraseña.
- Las pruebas de interfaz en Linux necesitan un llavero desbloqueado (en CI, un
  `gnome-keyring-daemon` dentro de una sesión de D-Bus).

## Descartes

- Guardarlas con `basic_text` y un aviso: es casi texto plano en disco, y el aviso se acaba
  ignorando.
- Forzar `--password-store=gnome-libsecret` desde la app: sin el servicio, Chromium vuelve a caer
  en `basic_text` igualmente, y en KDE elegiría el llavero equivocado.
