# Cada resultado de la consola es una pestaña dueña de su rejilla o su plan, que sigue montada al ocultarse

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbResultados.tsx`, `resultados/DbResultadosRejilla.tsx`, `PlanExplain.tsx`

## Contexto

Bajo la consola SQL hay una «Salida» fija y una pestaña por conjunto de filas o plan. Cada
rejilla pide cosas a su dueño (exportar, releer una celda recortada, traer todas) que dependen
de la sesión de la consola. Qué se sustituye y qué se activa: [ui-rejilla-modelo-resultados.md](ui-rejilla-modelo-resultados.md).

## Decisión

- La tira es propia (`.db-resultados-tabs`) aunque las pestañas sean `.terminal-tab`: la zona
  de la terminal lleva `container-type`, que implica `contain`, y un menú `fixed` dentro de un
  ancestro con contención se posiciona contra él y no contra la ventana. El menú va por portal.
- La chincheta se ve en la pestaña, porque lo no fijado se sustituye en la próxima ejecución.
- Las rejillas ocultas siguen montadas (`visible` a false): volver conserva desplazamiento y
  selección. La memoria la sujetan las filas, no el DOM, y de eso se encarga el presupuesto.
- Cada pestaña tiene SU `useExportarBd`: una exportación por pestaña, y cerrarla la cancela. El
  origen es la CONSULTA entera en la sesión de la consola (ve su transacción) si se puede
  releer, con sus parámetros (sin ellos el main la rechaza); si no (un RETURNING, una llamada),
  lo cargado.
- La clave para el valor completo sale del catálogo y se pide SOLO si hay celdas recortadas y la
  pestaña se ve. En SQL Server el «esquema» de la sesión es la base: una tabla sin esquema no
  ofrece el valor completo.
- «Traer todas» lo corre la consola; al tope de memoria se dice por qué, sin «Volver a
  ejecutar». Los conjuntos extra («Resultado k.2», de un EXEC o un lote) llegan sin lector: ni
  cargan más ni se re-ejecutan. El tooltip dice con qué parámetros se ejecutó.
- Plan: sus metadatos van en la cabecera de resultados, como los de cualquier pestaña (en la
  barra del plan salían repetidos); es un `<table role="treegrid">` y no una lista virtual (decenas
  de pasos, columnas alineadas solas), abierto entero, y copia lo que se VE. Desplegar y plegar
  se deshabilitan CON SU MOTIVO en la vista de texto.

## Consecuencias

`DbResultados` y `PlanExplain` van con `memo`: la consola y `DbArea` repintan por cosas que no
les tocan (diálogos, historial, esquema, transacción, redimensionar), y la Salida lleva hasta mil
filas y cada pestaña su rejilla, también las ocultas; lo que les llega conserva su identidad entre
renders. Están fuera del ciclo de importación: sus piezas no importan de una feature del ciclo.
