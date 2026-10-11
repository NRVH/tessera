# Una sola barra de desplazamiento en toda la app, oculta fuera de su zona

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/styles.css` (bloque «Scrollbars» y el de la terminal), `comun/barrasDesplazamiento.ts`, `BARRAS_MONACO` en `comun/monacoSetup.ts`

## Contexto

Convivían barras de anchos distintos, algunas rectangulares y una siempre visible en el explorador.
El caso peor era el diff: la barra del modificado iba pegada a la regla de resumen del diff, que
también se arrastra, y al agarrar el borde izquierdo parecía que la barra se partía en dos.

Gran parte de la mezcla tenía una sola causa. En Chromium, un `scrollbar-width` o `scrollbar-color`
distinto de `auto` anula todo `::-webkit-scrollbar`, y la hoja los ponía en `*`. Por eso las zonas
nativas pintaban la barra del sistema, y la terminal hasta enseñaba flechas.

## Decisión

- **Un solo juego de variables** (`--sb-size`, `--sb-pad*`, `--sb-thumb*`), del que beben las
  barras nativas y las de Monaco. Es una pastilla redondeada de 6 px que pasa a 10 px al posar el
  cursor o al arrastrar, y toma el acento al arrastrar. El área que se puede agarrar mide siempre
  `--sb-size`, aunque se vea fina.
- **Las propiedades estándar solo en un motor sin `::-webkit-scrollbar`** (`@supports not
  selector(...)`). Lo comprueba `e2e/humo-app.spec.ts`.
- **Oculta fuera de su zona.** La pastilla aparece al entrar el ratón y mientras la zona se desplaza,
  aunque el ratón no esté encima: una escucha de `scroll` en captura le pone `.desplazandose` y se la
  quita a los 800 ms. La terminal queda fuera: desplaza su viewport sola con cada línea de salida y
  la pastilla no se apagaría mientras escribe. En la terminal, el `:hover` va en `.terminal-host`,
  porque el ratón sobre el texto está en una hermana del viewport, no en una hija.
- **Monaco:** la barra mide 12 px (`BARRAS_MONACO`) y su `.slider` se pinta con las mismas variables.
  Quien pase su propio `scrollbar` parte de `BARRAS_MONACO`, porque Monaco reemplaza el objeto entero.
  Sin `overviewRulerBorder`, porque con esa raya la barra se lee como dos.
- **Diff:** conserva su regla de cambios propia (ver `editor/diff-editable.md`), con el recuadro
  de la vista redondeado y de los colores de la pastilla. Al arrastrar, la pastilla toma el color
  del perfil (`--sb-thumb-active` en `.shell`).

## Consecuencias

- Un `scrollbar-width` o `scrollbar-color` nuevo fuera del `@supports` devuelve la barra del sistema
  a esa zona. `scrollbar-width: none`, para esconderla del todo, sí es seguro.
- Cambiar `--sb-size` obliga a cambiar `BARRAS_MONACO` y la franja de la lupa del diff.

## Descartes

- Dejar la pastilla tenue siempre visible: era lo que hacía el explorador, y la barra competía con
  el contenido.
- Quitar la regla de resumen del diff y pintar sus marcas en la barra: se perdía la vista de
  conjunto de los dos lados, y con el recuadro redondeado ya no se lee como una barra partida.
