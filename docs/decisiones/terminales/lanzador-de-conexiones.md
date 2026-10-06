# Un solo lanzador de conexiones SSH, la ▾ del botón de nueva terminal, con un solo grupo abierto

- **Estado:** vigente
- **Ámbito:** `features/ssh/` (`LanzadorSsh.tsx`, `PopoverConexionesSsh.tsx`, `listaSsh.ts`, `rielSsh.ts`, `store.ts`),
  `features/terminales/` (`TerminalsPanel.tsx`, `AccionesPanelTerminal.tsx`), `comun/BotonDividido.tsx` y `shared/ajustesTerminal.ts`

## Contexto

La cabecera repetía «crear» en tres sitios (el «+», la ▾ y el botón de conexiones), el reinicio, que mata lo que corre, estaba
pegado a la ▾ (un clic errado lo disparaba) y con cinco grupos y veinte conexiones la lista obligaba a desplazarse.

## Decisión

- Un solo lanzador: el «+» abre la terminal local al instante y la ▾ abre la lista de conexiones (no un menú) con el filtro
  enfocado (unas letras e Intro conectan), «Recientes» arriba, los grupos y, al pie, «Nueva conexión SSH…» y «Nuevo grupo…».
  Es el patrón de las terminales con pestañas: el «+» crea lo de siempre y la ▾ despliega lo demás. Ya no hay botón «Conexiones».
- Cabecera: `[pestañas] [+][▾] … [⟳] │ [agente] [⤢] │ [—]`. El reinicio pasa al grupo de la derecha, separado por filetes, que
  se funden con las acciones en reposo. A pantalla completa el conmutador del riel va al extremo izquierdo.
- En el lanzador solo hay UN grupo abierto: abrir uno cierra el otro, y al abrirlo no hay ninguno (todos, también «Sin grupo»,
  plegados bajo «Recientes»: con ellas a mano, ver todo desplegado era ruido). No se recuerda el último ni se abre el de la
  conexión que se mira. Con filtro el acordeón no cuenta: salen las coincidencias de todos los grupos.
- «Recientes»: las tres últimas conexiones abiertas desde Tessera en el perfil, la más reciente primero (`sshRecientesPorPerfil`),
  podadas si la conexión ya no existe, solo en el lanzador y sin filtro. Siguen también en su grupo, y el teclado salta su rótulo.
  Solo la fila del grupo lleva `aria-current`: la de «Recientes» repite la misma conexión y un lector diría dos «actual».
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
- Toda apertura de una pestaña SSH anota la reciente: pasa por `conectarSsh`, no por cada lista.
- Lo recordado solo se poda con una lista de conexiones de fiar: con un archivo ajeno llega vacía sin que lo esté.
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
- Recordar el último grupo abierto por perfil y abrir el de la conexión que se mira: con las recientes arriba seguía siendo ruido.
  Se retiró `sshGrupoAbiertoPorPerfil`; un archivo que aún lo traiga se lee sin error (el saneado lo ignora y el guardado lo borra).
