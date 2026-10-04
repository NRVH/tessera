# Entre los barriles de las features no hay ciclos: lo que solo compone App va en `app.ts`

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/*/index.ts` y `app.ts`, `App.tsx`, `scripts/calidad/test-ciclos.mts`

## Contexto

Con F5 una feature importa otra solo por su `index.ts`, y ese barril arrastra todo lo que
exporta. Dos features que se importan entre sí cierran un ciclo que engloba a todo lo que cuelga
de ambos barriles: en el renderer había uno de 77 módulos y 9 features (agentes, ajustes, bd,
editor, explorador, git, layout, mosaico, pestanas). Era inocuo solo mientras ningún módulo del
ciclo usara al cargarse un binding del ciclo que no fuera `function`; un `const`, una `class` o un
`memo()` nuevo usados al cargar dejaban la ventana en blanco, y eso solo se ve en la app empaquetada.

Medido: casi todas las aristas que cerraban el ciclo salían de módulos que solo importa
`App.tsx` (los hooks `use*App`, `usePersistenciaAjustes`, el shell de `layout`, `ColumnaAgente`,
`AreaEditor`, `CentroBd`). Son la capa de composición, importan de media aplicación, y estaban
en el barril aunque ninguna otra feature los usara. Quitándolos quedaba un único ciclo de 8
módulos: el historial de archivo de git pinta `DiffEditorPane` del editor, y el editor usa el
modelo de diffs de git.

## Decisión

- Cada feature tiene, si hace falta, un `app.ts`: lo que solo compone `App.tsx`. El `index.ts`
  queda como API entre features. Los tipos de esos hooks (`UseTabs`, `EditorApp`…) siguen en el
  `index.ts` como `export type`, que no crean arista en ejecución: esbuild los borra y la
  guardia no los cuenta. F5 ya impide que otra feature importe un `app.ts`.
- git ↔ editor se rompe por inversión: `HistorialArchivo` recibe el visor de diff por la prop
  `VisorDiff` (tipada con `import type` + `typeof DiffEditorPane`), y se la pasa
  `FranjaInferior` de layout, que es quien compone el panel. Es el mismo componente: no cambia
  qué se pinta ni cómo se reconcilia.
- `test:ciclos` arma también el grafo de features (A depende de B si algo que arrastra el
  `index.ts` de A importa de B) y falla con un ciclo de más de `MAX_FEATURES_EN_CICLO` features
  (hoy 1: ninguno).

## Consecuencias

- Hoy no hay ningún ciclo de módulos en el renderer. Los módulos se evalúan siempre después de
  sus dependencias; el CSS empaquetado salió idéntico byte a byte.
- Un hook nuevo que solo monte App va al `app.ts`. Si una feature empieza a necesitar algo de
  otra que ya la necesita, la guardia lo para: se pasa por parámetro o prop, o se mueve la pieza
  a la feature de la que realmente es.

## Descartes

- Importar el módulo concreto de la otra feature en vez del barril: lo prohíbe F5, y el ciclo
  seguiría siendo de módulos.
- `App.tsx` importando cada módulo suelto de las features: rompía el ciclo igual, pero sin un
  sitio que diga qué es composición; `app.ts` lo nombra y F5 lo protege.
- Mover el modelo de diffs de git al editor o el visor a git: los dos son de donde están, y la
  dependencia de git en el visor es solo de composición.
- Partir los stores en features aparte: movía decenas de módulos para lo que resolvía un barril.
