# Un solo lanzador de conexiones SSH, la ▾ del botón de nueva terminal, con un solo grupo abierto

- **Estado:** vigente
- **Ámbito:** `features/ssh/` (`LanzadorSsh.tsx`, `PopoverConexionesSsh.tsx`, `listaSsh.ts`, `rielSsh.ts`, `store.ts`),
  `features/terminales/` (`TerminalsPanel.tsx`, `AccionesPanelTerminal.tsx`), `comun/BotonDividido.tsx` y `shared/ajustesTerminal.ts`

## Contexto

La cabecera repetía «crear» en tres sitios (el «+», la ▾ y el botón de conexiones), el reinicio, que mata lo que corre, estaba
pegado a la ▾ (un clic errado lo disparaba) y con cinco grupos y veinte conexiones la lista obligaba a desplazarse.

## Decisión

- Un solo lanzador: el «+» abre la terminal local al instante y la ▾ abre la lista de conexiones (no un menú) con el filtro
  enfocado (unas letras e Intro conectan), los grupos y, al pie, «Nueva conexión SSH…» y «Nuevo grupo…».
  Debajo, en su propia fila, «Nueva ventana de agente» (otra ventana y no una conexión del perfil:
  `agentes/ventana-de-agente.md`) con una «i» que explica qué es, porque el nombre solo no lo dice; cierra el lanzador.
  Es el patrón de las terminales con pestañas: el «+» crea lo de siempre y la ▾ despliega lo demás. Ya no hay botón «Conexiones».
- Cabecera: `[pestañas] [+][▾] … [⟳] │ [agente] [⤢] │ [—]`. El reinicio pasa al grupo de la derecha, separado por filetes, que
  se funden con las acciones en reposo. A pantalla completa el conmutador del riel va al extremo izquierdo.
- En el lanzador solo hay UN grupo abierto: abrir uno cierra el otro, y al abrirlo no hay ninguno (todos, también «Sin grupo»,
  plegados: la ventana es pequeña y ver todo desplegado es ruido). No se recuerda el último ni se abre el de la
  conexión que se mira. Con filtro el acordeón no cuenta: salen las coincidencias de todos los grupos.
- No hay sección de conexiones recientes: los grupos y el filtro bastan para llegar a una conexión, y en una ventana
  pequeña una sección más ocupa sitio y mete ruido.
- Las altas: «Nueva conexión SSH…» queda en el pie del lanzador, en el menú de un grupo real (el del lanzador y el del riel) y
  en la cabecera del riel; el botón del estado vacío del riel y la opción del menú de «Sin grupo» se quitaron (sin esa opción,
  «Sin grupo» no tiene menú). Guardar un alta solo guarda, venga de donde venga: conectar es un gesto aparte.
- El riel no cambia: varios grupos a la vez (`sshGruposPlegadosPorPerfil`). La lógica nueva es pura (`listaSsh.ts`).

## Consecuencias

- La ▾ es un botón que abre un diálogo (`aria-haspopup="dialog"`, `aria-expanded`), no un «menu button»; se cierra si cambia
  la pantalla completa o el panel, porque mide su ancla al abrir.
- A pantalla completa con el riel a la vista la ▾ se QUITA del DOM (`sinFlecha` de `BotonDividido`; no se esconde: sin ella no
  queda hueco, parada de Tab ni nombre que anunciar) y vuelve con el riel plegado (`flechaLanzadorVisible`). Si el lanzador está
  abierto cuando el riel pasa a verse, se cierra (`lanzadorSeCierra`); si la ▾ se quita con el foco en ella, este pasa al «+».
- A pantalla completa «Restaurar» y «Ocultar» (y en Git·Log, «Restaurar» y «Cerrar») van `fijo`: son las dos salidas del modo y
  una fija con la otra escondida se leía como una avería.
- El umbral de la cabecera (`@container terminalcab`) pasó de 520 a 560 px de contenedor, medido en la app empaquetada
  (Windows) con la etiqueta del reinicio forzada desplegada y la cabecera de 300 a 900 px: lo fijo de la cabecera mide ~216 px
  sin la etiqueta y ~321 con ella (cuesta ~105), y las pestañas dejan de caber enteras desde su ancho más esos ~321: con 1
  pestaña (59 px) por debajo de ~420 px de cabecera, con 2 (~135) de ~500, con 3 (212) de ~580 y con 5 (364) de ~740; con
  cualquier número la zona de pestañas llega a cero a ~360 px, que es cuando el contenido desbordaría. El relleno de la
  cabecera resta 20 px, así que 560 de contenedor = ~580 de cabecera: hasta tres pestañas, desplegar la etiqueta al apuntar el
  botón no las empuja; con más sí, sea cual sea el umbral (ahí manda el desplazamiento de la tira).

## Descartes

- El cambio mínimo (dejar el botón «Conexiones» y solo mover el reinicio): dos entradas a lo SSH y dos «crear».
- Acordeón también en el riel: es un panel fijo con altura de sobra, y cerrar las demás secciones obliga a ir y volver cuando
  hace falta ver varias a la vez (https://www.nngroup.com/articles/accordions-on-desktop/). El lanzador sirve para elegir UNA.
- Recordar el último grupo abierto por perfil y abrir el de la conexión que se mira: es ruido en una ventana pequeña.
  No hay `sshGrupoAbiertoPorPerfil` ni `sshRecientesPorPerfil`; un archivo que aún los traiga se lee sin error (el saneado los ignora y el guardado los borra).
- Una sección «Recientes» arriba de la lista: duplica filas que ya están en su grupo y obliga al teclado y al lector de pantalla
  a saltarse un rótulo y una fila repetida.
