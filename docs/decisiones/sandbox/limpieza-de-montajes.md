# La raíz gestionada solo se borra cuando awk AFIRMA que no queda nada montado debajo

- **Estado:** vigente
- **Ámbito:** `src/main/sandbox/limpiezaMontajes.ts`, `src/main/sandbox/gestor/barrido.ts` (macOS: sin verificar aquí)

## Contexto

Al cerrar la app, al borrar un perfil y al recrear un contenedor se desmonta lo que cuelga de las raíces gestionadas
y se borran con `rm -rf` COMO ROOT en el namespace del daemon. La guarda antigua (`grep -q " $base" mountinfo`) nunca
casaba en macOS: `/Users` es un symlink a `/host_mnt/Users` en la VM y mountinfo escapa el espacio de `Application
Support` como `\040`. El `rm -rf` corría con los binds rw vivos y borraba archivos reales de los proyectos, sin error.

## Decisión

- La base se canoniza con `readlink -f`. Si falla y la ruta EXISTE, se avisa y no se toca nada; si no existe, silencio
  (el segundo cierre de una raíz ya limpia). Sin respaldo «la ruta tal cual»: era el bug reinstalado.
- awk decodifica el campo 5: `\040`, `\011`, `\012` con `gsub`, y `\134` la ÚLTIMA con `split` + concatenación (el
  reemplazo de `gsub` con barras no es unánime entre awk; decodificarla antes haría de `\134040` un espacio).
- Casa `mp == b || index(mp, b "/") == 1`: la base o un descendiente, nunca el vecino `sandbox-mm2`.
- La base entra en awk por `ENVIRON`, nunca por `-v` (procesa escapes del valor).
- Desmonta de más profundo a menos (`LC_ALL=C sort -r`) con `umount -l`, leyendo con `IFS= read -r`.
- Borra `$b` SOLO si una segunda pasada imprime el token positivo `libre`: un awk que no pudo leer la tabla no
  imprime nada, y «nada» acaba en AVISO, no en borrado.
- Solo utilidades de busybox, de la distro de WSL2 y de macOS. Nada de `umount -R` (busybox no lo tiene).
- Varias bases con `set --` entrecomillado; los AVISO del fragmento y un helper que no llegó a correr van al log.

## Consecuencias

El fragmento es un literal que ejecuta `sh` como root: no cambia un byte sin pasar `test:limpieza-montajes`, que lo
EJECUTA sobre un fixture de mountinfo con stubs de `umount`, `rm` y `readlink`. Un punto de montaje con salto de
línea no se desmonta (la guarda sigue siendo segura: AVISO).

## Descartes

- `END { exit !found }`: un awk que no abre mountinfo también sale ≠ 0 y caería en la rama del `rm -rf`.
- Respaldo `readlink -f b || printf b`: con la base sin canonizar el estado sale `libre` sobre binds vivos.
