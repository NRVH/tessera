# La franja inferior se maximiza con un solo estado coherente, solo con CSS y sin desmontar nada

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/layout/` (`layoutCentro.ts`, `usePantallaCompletaFranja.ts`, `useAtajoPantallaCompleta.ts`), `styles.css` (`.shell.franja-pantalla-completa`), `util/atajos.ts`, el maximizado del agente de datos (`features/agentes/ColumnaAgente.tsx`, `features/bd/useDbVista.ts`) y `e2e/{git,terminal}-pantalla-completa.spec.ts`, `e2e/conexiones.spec.ts`

## Contexto

Git·Log y la terminal se turnan en el hueco de abajo y los dos piden más sitio a veces. A pantalla
completa el editor queda tapado, y con él las pestañas que se abren sin mirar: `Mod+N` o la
búsqueda global abrían una pestaña que nadie veía.

## Decisión

- **Lo último que eligió el usuario, por perfil y por ventana.** La verdad es
  `maximizadoPorPerfil` (efímero, no se persiste): cada perfil guarda si la terminal, Git·Log, el
  agente de la terminal y el de datos están maximizados, cada uno lo suyo. El de datos tapa las
  pestañas de BD (el área se esconde sin desmontarse y la columna crece) solo a la vista y con alguna
  pestaña que tapar; lo borran su botón de restaurar y abrir una tabla o una consola (`useDbVista.abrir`).
  Sin pestañas de BD ocupa todo el centro sin pedirlo, como el agente de la columna sin archivos abiertos. Cerrar la ventana y reabrirla, pasar
  de la terminal a Git·Log y volver, cambiar de perfil, el mosaico o la vista de datos NO lo
  borran: al volver, cada ventana está como la dejó. Lo borran el botón de restaurar, el acorde,
  abrir una pestaña del editor y elegir una vista lateral, que es elegir ver esa vista.
- **Lo que se pinta se deriva en el render** (`pantallaCompletaPedidaDe` + `pantallaCompletaCoherente`,
  puras): el panel que está en la franja, si su perfil lo dejó maximizado, fuera de la vista de
  datos y del mosaico. Nada se corrige en un efecto: al cambiar de perfil el primer render ya sale
  bien, y el agente no recibe un resize de ida y vuelta (era un parpadeo visible). El store guarda
  además un ESPEJO de lo que se pinta (`franjaPantallaCompleta`) y del perfil a la vista, solo para
  los manejadores de eventos (atajos, aperturas), que no tienen el perfil.
- Con el agente al lado y sin terminal que enseñar, la columna de la terminal se queda en su
  cabecera y su riel, y el agente ocupa el resto, como cuando el editor no tiene pestañas. Lo decide
  `derivarLayoutCentro` (`terminalPlegada`), con la MISMA columna del agente que pinta el CSS: si lo
  decidiera la preferencia, un agente pedido pero aún preparándose plegaría el panel sin nada al lado.
  App lo lleva a `.shell` (`.terminal-plegada`) y el panel a su `.sin-terminal`; sin `:has()`. Un
  proyecto cuya primera terminal aún no ha nacido (nace en el efecto que sigue al render) cuenta como
  con terminales (`hayTerminalQueEnsenar`): si no, la columna se plegaría y desplegaría en dos commits
  y el pty del agente recibiría dos resize.
- El sitio del riel se mide SIEMPRE en `.shell-main`, que mide lo mismo plegada o no, y se le resta el
  agente si está al lado (`--cc-width` + su divisor; `sitioDelRiel`). Medir el cuerpo de la terminal
  cambiaba de significado al plegar: el render que despliega llevaba la medida de la columna plegada y
  el riel se desmontaba un instante (perdía filtro y foco). Plegada, el vecino del riel es el agente:
  solo cabe mientras le deja su mínimo (`CC_WIDTH_MIN`), y su tope de arrastre tampoco pasa de lo que
  cabría junto a la terminal desplegada, para que restaurarlas no pliegue el riel. El mínimo de la
  columna plegada (su cabecera) es un solo número: el panel lo pasa al CSS como `--columna-plegada-min`.
- Con terminales, el agente de la terminal se puede maximizar sobre ellas como el de la columna
  sobre los archivos, con la misma disposición `.sin-terminal` (`agenteTerminalMaximizadoDe`: pedido,
  junto a la terminal y con alguna que tapar). Tapadas, sus pestañas no se dibujan: en una columna
  estrecha no dejan hacer nada y solo meten ruido, así que quedan reducidas a un chip con su número
  («3 terminales»), como un panel plegado, y la columna tampoco lleva los botones del panel: cada
  nivel de maximizado tiene un solo restaurar a la vista, y dos iconos iguales con efectos distintos
  uno junto al otro se confunden. El del agente baja un nivel; con las terminales de vuelta, el de la
  terminal baja el siguiente. Lo restauran, en el mismo clic para que la terminal llegue
  visible y con el foco, ese chip, el botón del agente y conectar o abrir un SFTP desde el riel. Un
  `exit`, una sesión que se cae o cambiar de perfil no lo tocan. Cerrar el agente lo olvida: el
  siguiente arranca sin maximizar. Tapadas, las terminales no están a la vista y sueltan su contexto
  gráfico. Sin terminales, la cabecera, estrecha, pasa a dos líneas para que el «+» no quede bajo los
  botones.
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
