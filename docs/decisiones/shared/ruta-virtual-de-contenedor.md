# Una ruta dentro de un contenedor es POSIX relativa con `!/`, y el corte solo vale tras una extensión de contenedor

- **Estado:** vigente
- **Ámbito:** `src/shared/jarPath.ts`; lo usan el árbol, la búsqueda, el diff de comprimidos y `main/java/`

## Contexto

El árbol expande .jar/.war/.ear/.aar como si fueran carpetas, y sus entradas viajan por los mismos canales
que el disco sin romper «el renderer nunca ve rutas del host». En Windows `!` es legal en nombres de
archivo y de carpeta.

## Decisión

- Ruta virtual: `lib/comunes.jar!/com/ejemplo/Nota.class`, anidable
  (`dist/app.war!/WEB-INF/lib/comunes.jar!/…`) hasta `MAX_ANIDAMIENTO`. Sigue siendo POSIX y relativa a
  la contenedora. `!/` es el separador de las URL `jar:` de Java, el que sale en las trazas: una ruta
  copiada sigue significando algo fuera de Tessera.
- Un `!/` solo corta si el segmento previo termina en una extensión de `EXT_CONTENEDOR`. Con un
  `includes('!/')`, una carpeta real `scripts!` dejaría de poder listarse, crearse o borrarse en toda la app.
- Una CARPETA real llamada `foo.jar` no se distingue por el texto: la desempata el `stat` que el servicio
  de jars hace de todos modos. Este módulo es puro y no toca el disco.
- El parentesco se pregunta a `esDescendiente`, no a `startsWith(base + '/')`: `'lib/x.jar!/com'` no
  empieza por `'lib/x.jar/'`, y colapsar el jar dejaría vivas las claves de dentro.
- Más anidamiento del permitido devuelve `null`: una ruta irrepresentable falla en la puerta, no se
  convierte en otra que sí existe.
- No sabe de plataformas: sus rutas son siempre relativas y POSIX.

## Consecuencias

Quien compare rutas del árbol usa `esDescendiente` y `padreDeRuta`; un `startsWith` nuevo falla en
silencio con las rutas virtuales.

## Descartes

- Un separador imposible en NTFS (`>`, `|`, `?`): sin ambigüedad, pero `x.jar>com/A.class` en un tooltip,
  en «Copiar ruta» o en una pestaña no significa nada para nadie.
- Meter `.zip` en `EXT_CONTENEDOR`: tiene su propio visor de listado y no es un artefacto Java; para
  COMPARAR sí entra (`comprimidos.ts`).
