# El estado de la ventana vive en stores por dominio y sus efectos se ejecutan desde App

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/App.tsx`, `features/*/store.ts` y los hooks `use*App`/`use*` que llama App

## Contexto

`App` guardaba todo el estado de la ventana y registraba todos sus efectos. Al partirla no puede
cambiar el ORDEN de esos efectos (React corre los de los hijos antes que los del padre), ni cuántos
commits produce un cambio: varios efectos leen dos estados y deciden con lo que ven en ese commit.

## Decisión

- Un store Zustand por dominio (`create` y selectores, sin `persist` ni `immer`). Los espejos en
  ref de estado pasan a `getState()` en callbacks y efectos.
- **El estado que cruzan los efectos comparte vía.** Un store avisa con `useSyncExternalStore`
  (en React 18, vía SÍNCRONA); un `useState` o `useReducer` actualizado fuera de un evento (tras
  un `await`, en IPC, un temporizador o un efecto) va en la NORMAL. Mezclados, UN commit se
  vuelve DOS y el efecto de en medio decide a medias, a veces sin vuelta atrás (el destino del
  mosaico descartado, la cuenta borrada re-elegida): fue una regresión, no un coste aceptable.
  Por eso viven en stores las pestañas (`useTabs`, mismo reducer), las del editor, la vista de
  BD y el estado de git. Lo que lee un solo hook (el ancho de la ventana) sigue en `useState`;
  lo local que se escribe junto a un store (las cuentas de un pane) va en un store del componente.
- Tras un `await`, dos stores se escriben en el MISMO turno: escribir tras el `return` de quien
  despacha es otra microtarea y otro commit (`alAbrir`, `elegir` de `loadAccounts`).
- Los efectos que tenía `App` se registran DESDE `App`, por hooks en un orden fijo. Los
  componentes de layout solo pintan.
- `fijarAmbito` (caché de blobs) va en el render de App: los panes de diff piden antes que App.
- El maximizado del agente se pinta coherente (`maximizadoCoherente`); el crudo, en `useLayoutEffect`.
- `buildSettings` lee de los stores con las mismas claves, formas y esperas de siempre.

## Consecuencias

- Mover un efecto a un hijo o reordenar los hooks de `App` cambia el orden; y un `useState` nuevo
  que un efecto cruce con un store reabre la carrera (va al store de su dominio).

## Descartes

- Un store espejo de `useTabs` alimentado por un efecto: pinta un frame con el proyecto viejo.
- `flushSync` en cada sitio: arregla el síntoma donde se ve y deja la carrera en los demás.
