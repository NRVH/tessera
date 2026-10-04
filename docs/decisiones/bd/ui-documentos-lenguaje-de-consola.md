# La consola de documentos usa un lenguaje propio de solo coloreado y sus marcas no reutilizan las de la consola SQL

- **Estado:** vigente
- **Ámbito:** `documentos/monacoConsolaDocs.ts`, `documentos/monaco-js-basico.d.ts`

## Contexto

La consola de documentos escribe JavaScript de shell, pero no lo evalúa (el trabajador lo
interpreta; ver [documentos-controlador.md](documentos-controlador.md)). El id `javascript` de
Monaco lleva enganchado el servicio de lenguaje de TypeScript.

## Decisión

- **Lenguaje `tessera-mongosh`**: el Monarch de las basic-languages de `javascript` tal cual (su
  `language` y su `conf` se importan, no se copian, para que una subida de Monaco llegue sola).
  Con el id `javascript`, el primer modelo arranca el trabajador de TypeScript (decenas de MB y un
  arranque visible) y el autocompletado sugiere `document`, `window`, `fetch`: globales del DOM que
  en una consola de base de datos son ruido y mienten. El trabajador ya va en el paquete, así que
  la razón es el coste en marcha y el ruido, no el tamaño. El editor añade `wordBasedSuggestions:
  'off'` para no mezclar palabras de otros modelos abiertos.
- **Acciones propias** con los mismos acordes que la consola SQL; la tecla de Detener cambia por
  plataforma (⌘. en Mac, Ctrl+F2 en el resto) y la plataforma entra por parámetro. No se reutiliza
  `registrarAccionesConsola` porque registra también Commit, Rollback, Explicar, Historial y
  Formatear SQL, que aquí no existen y saldrían en el menú contextual sin hacer nada.
- **Marcas propias** (`MarcasConsolaDocs`) con las clases `db-glifo-*` de la consola SQL, para que
  las dos se lean igual. Las decoraciones son del modelo con `NeverGrowsWhenTypingAtEdges`: siguen
  a su texto y un Intro delante arrastra el glifo. La `posicion` de un error llega ya relativa a
  la consola (el main suma el `desplazamiento`) y se acota a la sentencia viva.

## Consecuencias

La consola de Redis reutiliza `MarcasConsolaDocs`. El autocompletado propio (`db.`, colecciones,
operadores `$`) queda pendiente.

## Descartes

- `MarcasLoteMonaco`: está atado al `Lote` del reducer SQL (pendientes, omitidas, tiempos por
  sentencia) y la consola de documentos ejecuta de una en una, sin reducer.
