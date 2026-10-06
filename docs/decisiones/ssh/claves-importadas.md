# SSH: el archivo de clave se importa como una copia protegida, validada por su contenido y comprobada con ssh-keygen

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/` (`formatoClave.ts`, `controlador/clavesImportadas.ts`, `adaptadores/permisosClave.ts`,
  `lineaSsh.ts`, `ConexionesSsh.ts`), `src/main/util/fichas.ts` y el campo de la clave de `features/ssh/`

## Contexto

Medido en Windows 11 con el ssh 9.5 del sistema: ssh no usa una clave que dé permiso a alguien más que al usuario,
SYSTEM y Administradores, y `%APPDATA%\Tessera` hereda un permiso de más; la clave del usuario vive en una carpeta
sincronizada con permisos abiertos. Windows está en español: los grupos no se pueden nombrar. Con `-i`, ssh busca el
archivo ANTES de expandir `%`: con el `%` doblado no lo encuentra y sigue con las claves de `~/.ssh`.

## Decisión

- Se IMPORTA una copia y el original no se toca. Se lee en el acto (en macOS el permiso del diálogo no dura), con tope
  de 64 KiB, y se valida por su contenido, nunca por la extensión: formato OpenSSH, PEM RSA/EC y PKCS#8, con frase o
  sin ella. Lo demás se rechaza diciendo qué hacer (la pública, .ppk, SSH2, certificados, binarios, DSA). Se guarda solo
  el bloque de la clave, con LF, sin BOM y con salto final: el OpenSSH de macOS no lee CRLF.
- La copia provisional (`ssh/claves/.import-<aleatorio>`) nace protegida: en Windows, `icacls` por SID (de `whoami`) y
  sin herencia, también la carpeta; en macOS, 0700 y 0600, creada en exclusiva. Después `ssh-keygen -y -P ""` (tope de
  5 s, sin `SSH_ASKPASS`) tiene la última palabra: la pública (sin frase; de ahí el tipo), «incorrect passphrase» (con
  frase) o cualquier otro error (este OpenSSH no la lee: se borra y se dice por qué).
- Al renderer llegan una ficha y el nombre, nunca la ruta. La ficha (`util/fichas.ts`) caduca a la media hora y al
  caducar se borra su copia; solo vale para el perfil para el que se eligió o se soltó.
- Al guardar, la copia pasa a `ssh/claves/<id>`; al editar con otra, la vigente espera en `<id>.anterior` hasta que el
  registro confirma. Si el registro falla, todo vuelve a su sitio y la ficha sigue valiendo. Dejar de usar el archivo
  de clave, borrar la conexión o el perfil borra la copia. Al cerrar la app se borran las provisionales de la sesión; al
  arrancar y al importar se barren las provisionales SIN ficha viva y de más de media hora: la copia nace antes que su
  ficha, y por su fecha sola caería la de una ficha viva.
- En la línea: `-o IdentityFile="<copia>"` (barras normales y `%` doblado), `IdentitiesOnly=yes` y solo `publickey`.
  Sin la copia no hay línea: ssh nunca cae a las claves por defecto. La frase se guarda o se teclea (`askpass-y-secretos.md`).

## Descartes

- Usar el archivo original: el ssh del sistema lo rechaza por permisos, y arreglarlos sería tocar algo del usuario.
- `-i`: con un `%` en la ruta, ssh usa sin decir nada otras claves.
- Decidir por la extensión: un `.pem` lo mismo es una clave que un certificado, y las de OpenSSH no llevan extensión.
- Nombrar los grupos en `icacls`: «Administrators» no existe en un Windows en español.
- Dar por «con frase» la PEM o PKCS#8 cifrada que `ssh-keygen -y -P ""` no lee: el ssh de su carpeta solo pide la frase
  ante «incorrect passphrase», que es lo que dan las válidas (medido con OpenSSL 3 y LibreSSL); con otro error, ni pregunta.
