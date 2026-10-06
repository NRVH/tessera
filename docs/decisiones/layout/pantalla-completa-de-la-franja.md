# La franja inferior se maximiza con un solo estado coherente, solo con CSS y sin desmontar nada

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/layout/` (`layoutCentro.ts`, `usePantallaCompletaFranja.ts`, `useAtajoPantallaCompleta.ts`), `styles.css` (`.shell.franja-pantalla-completa`), `util/atajos.ts` y `e2e/{git,terminal}-pantalla-completa.spec.ts`

## Contexto

Git·Log y la terminal se turnan en el hueco de abajo y los dos piden más sitio a veces. A pantalla
completa el editor queda tapado, y con él las pestañas que se abren sin mirar: `Mod+N` o la
búsqueda global abrían una pestaña que nadie veía.

## Decisión

- Un solo estado, `franjaPantallaCompleta: 'gitlog' | 'terminal' | null`, efímero (no se persiste).
  Se pinta el valor COHERENTE (`pantallaCompletaCoherente`, pura): vale mientras ese panel está a
  la vista y no hay mosaico. Nunca lo enciende y es un punto fijo, así que el hook lo aplica en
  cada render. La X, cambiar de panel, la vista de datos, el mosaico o un perfil sin ese panel lo
  apagan, y al volver el panel se abre en la franja.
- Solo CSS y sin desmontar: la fila de arriba sale del flujo con su tamaño y se apaga con
  `content-visibility` + `visibility`, como en el mosaico. Ni el editor ni los agentes de arriba
  reciben un resize. El panel maximizado SÍ cambia de tamaño y el pty de la terminal visible se
  redimensiona por su observador (espera de 120 ms): es lo buscado.
- Salidas: el botón de restaurar (`fijo`: no se esconde en reposo), cualquier apertura de una
  pestaña del editor (`useAbrirPestana`, su único punto) y elegir una vista lateral del riel. Las
  dos últimas valen también para Git·Log, que antes dejaba abrir pestañas tapadas. Moverse por
  los commits no abre nada ni sale (`aperturaDesdeGit`).
- Atajo `Mod+Shift+↩`, solo con el foco DENTRO de la franja y sin mosaico (allí el mismo acorde
  amplía una casilla), en fase de captura: xterm lo convertiría en un CR. Se traga la
  autorrepetición y respeta un modal abierto.

## Descartes

- Un estado por panel: dos booleanos que pueden valer a la vez y hay que coordinar. Un valor
  nullable lo impide por construcción.
- Desmontar la fila de arriba: mataría las sesiones del agente y perdería el scroll del editor.
- Atajo con cualquier foco: pisaría `Mod+Shift+↩` de la consola SQL y del editor de código.
- Persistirlo: arrancaría con un modo cuyo panel puede no estar a la vista.
