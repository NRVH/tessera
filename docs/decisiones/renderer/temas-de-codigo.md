# El código se pinta con un tema elegible, independiente del marco de la aplicación

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/theme/temasCodigo.ts`, `comun/temaCodigo.ts`, `comun/monacoTema.ts`, `comun/monacoSetup.ts`, `features/ajustes/categorias/TemaCodigo.tsx`, la vista previa de Markdown en `styles.css` y el ajuste `editorTema` de `shared/workspace-state-ipc.ts`

## Contexto

Quien escribe código pasa horas leyendo, y la combinación de colores con la que lee es una
preferencia muy personal: hay paletas de la comunidad que mucha gente ya tiene en la memoria. El
marco de Tessera (riel, cabeceras, barras) es su identidad y tiene su propia escalera de
elevación; cambiarlo con cada paleta lo rompería.

## Decisión

- **El tema es del contenido, no del marco**: se aplica a lo que pinta el contenido de los
  archivos (editor, diffs y su lupa, visores, la vista previa de la búsqueda, los editores de bases de
  datos y los bloques de código de la vista previa de Markdown). El marco, las guías, los bordes y los
  widgets de Monaco conservan los colores de Tessera, así que una paleta nueva no puede romperlo.
  Las terminales no lo usan: ahí los colores los elige cada programa. Los diagramas tampoco: son
  dibujos con la paleta de la interfaz, no código.
- **Un tema solo cambia los colores del texto**: el fondo, la línea del cursor, la selección y los
  números del margen son los de Tessera en todos (`FONDO_TESSERA`). El contenido sigue integrado en el
  marco de la app, sin un rectángulo de otro tono por cada paleta, y lo que va atado al fondo no pierde
  contraste sobre uno que no es el suyo.
- **Un tema es una paleta por papel** (`PaletaCodigo`: fondo, texto, comentario, palabra clave,
  cadena, número, tipo, función, variable, constante, etiqueta, atributo, clave, expresión regular,
  línea del cursor, selección, números de línea, cursor, añadido, quitado, aviso e información), no
  una lista de reglas de Monaco: así cada tema son veinte colores con nombre y la traducción a Monaco
  vive en un solo sitio (`temaMonacoDe`). Todo en hex `#rrggbb`, el único formato que Monaco admite.
- **El de serie es «Tessera»** y se construye desde la paleta de la app.
- **Cada tema cambia de verdad la paleta**: entre dos cualesquiera, al menos la mitad de sus diez
  colores principales se ven claramente distintos (ΔE CIE76 mayor que 25, `papelesQueCambian`). Una
  variante de los mismos tonos, más viva o más apagada, no aporta una elección nueva y no se añade. Las
  excepciones se declaran por par (`PARECIDOS_ADMITIDOS`): un tema muy usado que comparte tonos con
  otro se admite frente a ese, y frente a los demás la regla sigue valiendo.
- **Un solo id de tema en Monaco** (`MONACO_THEME`): los editores lo nombran al crearse, y cambiar de
  tema redefine ese id y lo vuelve a aplicar. El tema de Monaco es global, así que todos los editores
  abiertos cambian a la vez, sin reabrirlos y sin registrar cada uno.
- **El estado vive fuera de Monaco** (`comun/temaCodigo.ts`): el ajuste se aplica al arrancar sin
  cargar Monaco; publica la paleta en variables CSS (`--codigo-*`) para lo que no es Monaco y avisa a
  `monacoSetup.ts`, que se suscribe al inicializarse.
- **Legibilidad comprobada** (`test-temas-codigo.mts`, con el contraste de la WCAG): el texto, al
  menos 4,5 sobre el fondo de Tessera; cada token, 3; los comentarios, 2,3, porque varias paletas los apagan a
  propósito para que no compitan con el código.
- **La vista previa del ajuste** es código de muestra coloreado por Monaco (`colorize`), en la letra del
  editor, y se vuelve a colorear al elegir otro tema: las clases que pone Monaco son índices de la tabla
  de colores de cada tema, no papeles, así que el HTML de un tema no vale para otro. `ensureMonaco`
  activa el tema al definirlo, porque `colorize` pinta con el activo aunque no haya ningún editor. El
  selector enseña junto a ella los cinco colores que distinguen un tema de otro.
- **Lo que no es Monaco lee variables CSS** (`--codigo-texto`, `--codigo-insertado`,
  `--codigo-eliminado`): los bloques de código de la vista previa de Markdown y la lupa del diff. El
  fondo no es variable: es el de Tessera, y los bloques de un documento usan el hundido de la interfaz
  para distinguirse del documento.
- Un id guardado que ya no existe cae al de serie, en el renderer (`esTemaCodigo`); el archivo solo
  acota el texto.

## Consecuencias

- Un tema nuevo es una entrada en `PALETAS_CODIGO` y su nombre; la prueba decide si se puede leer y si
  se distingue de los que ya hay.
- Una superficie nueva que pinte código con Monaco lo sigue sola; una que no sea Monaco usa las
  variables `--codigo-*`.

## Descartes

- Cambiar también el marco con cada tema: obligaría a mantener veinte variables de interfaz por paleta
  y rompería la escalera de elevación de Tessera.
- El fondo de cada paleta en el editor: dejaba un rectángulo de otro tono dentro del marco, y los
  números de línea pensados para ese fondo perdían contraste en las superficies que no lo usan.
- Un tema de Monaco por paleta, elegido en cada editor al crearlo: el de Monaco es global, así que
  el último editor creado impondría el suyo a todos.
- Editores de vista previa reales en el ajuste: cargan Monaco con un modelo y su ciclo de vida para
  enseñar cinco líneas; `colorize` da el mismo resultado sin editor.
