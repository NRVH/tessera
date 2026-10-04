# El color del perfil es el acento de la aplicación, y lo que codifica un estado se ancla al azul congelado

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/styles.css` (`:root`, `.shell`, `--perfil*`, `--sel-*`, `--confirmar-*`, `.btn`), `App.tsx` (publica `--perfil`), `features/pestanas/colorPerfil.ts`

## Contexto

Con varios perfiles abiertos, una selección o un badge del mismo azul en todos no dice en cuál se
está trabajando, y la salvaguarda de la app es reconocer el perfil de un vistazo. El color del
perfil es una tinta de luminosidad baja (ver `color-de-perfil-cenizo.md`), hecha para rellenar,
no para leerse como letra.

## Decisión

- `App` publica `--perfil` en `.shell` y allí se repinta `--accent: var(--perfil)`: un sitio nuevo
  hereda el perfil sin conocer la regla. `:root` conserva el azul como reserva fuera del shell;
  una variable con `var(--perfil)` se resuelve donde se declara, así que hacen falta las dos.
- Lo que codifica un ESTADO no sigue al perfil: `.git-status-M`, la píldora del diff, el toast de
  información y el aviso de driver se anclan a `--azul`, el azul congelado en `:root`. Con un
  perfil verde, modificado y añadido serían el mismo color.
- Del perfil cuelgan tonos con un trabajo cada uno: `--perfil-claro` (LUM 72, letra sobre fondo
  neutro), `--perfil-sobre-tinte` (letra sobre un relleno del perfil; sin perfil cae a `--fg`),
  `--sel-ceniza` (misma tinta con menos saturación y brillo ×0,88), `--sel-solido` (icono del
  riel con foco) y `--sel-hondo` (control encendido, opaco).
- Los botones de diálogo son tres pesos sin color propio: relleno (primario, letra `--bg-deep`
  sobre `--perfil-claro`), contorno (confirmar destructivo, `--confirmar-*`) y sin cuerpo
  (fantasma). Sin perfil el destructivo vuelve al rojo: con un solo azul, «Eliminar» y «Guardar»
  saldrían iguales.
- El rojo se queda donde es estado (error, archivo borrado) y en `--danger-*`: «Eliminar…» del
  menú contextual, «Descartar N» de Git y «Eliminar» de una conexión.

## Consecuencias

- Las cifras de contraste se midieron contra la paleta de `theme/atomOneDark.ts` barriendo la
  banda entera de la tinta, no solo los ocho colores curados.
- Un azul nuevo o un `color-mix` propio para «lo seleccionado» separa el par de la fila.

## Descartes

- Repintar los usos de `--accent` uno a uno: la lista de excepciones dejaría de ser corta y
  greppable (`--azul`).
- Elegir la letra del primario por luminancia del relleno: la mejor queda en 4,09:1 en la banda.
