# Registro de cambios

Todos los cambios relevantes de Tessera se documentan en este archivo. El formato se basa en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/), y Tessera sigue el
[versionado semántico](https://semver.org/lang/es/).

Cada versión agrupa sus cambios en secciones, en este orden y solo las que tengan algo: Novedades,
Interfaz, Rendimiento y estabilidad, Instalación y actualizaciones, Correcciones y Seguridad. Una
sección larga se divide en grupos por área.

## [0.82.0] - 2026-10-26

### Novedades

- **Límite de contenedores de Docker, con semáforo.** En Configuración › Contenedores Docker eliges
  cuántos contenedores pueden correr a la vez con una barra que se colorea según la memoria que tiene
  Docker en tu equipo: verde, holgado; amarillo, justo, con riesgo de lentitud y cierres; rojo, alguno
  fallará a medio proceso. Por defecto, el recomendado. Al llegar al límite, abrir otro agente en Docker
  hiberna primero un contenedor sin agentes y, si no hay, el que diga tu política: los últimos que
  abriste, los primeros o los que llevan más sin uso, sin tocar los que están trabajando si así lo
  pides. Te avisa de qué paró y con qué regla, y su conversación sigue al volver.

- **Cada agente elige su cuenta, nativa o de Docker, y los proyectos dejan de tener modo.** El botón de
  cuenta de la cabecera del agente, un equipo o un contenedor en el color del perfil según dónde corre, abre un selector con dos
  apartados: la cuenta de tu equipo y las de Docker, cada una en su tarjeta con la que usa marcada, sus
  acciones de renombrar, cerrar sesión y eliminar al pasar por ella, y «Nueva cuenta de Docker…» al pie.
  El selector sigue abierto mientras confirmas una acción, para seguir con otra cuenta.
  Cerrar sesión o eliminar una cuenta espera en su diálogo hasta que termina, y si falla lo dice ahí; si
  otro agente abierto la usa, el diálogo lo avisa y ese agente se reabre con login o con otra cuenta. En un mismo proyecto puedes tener Claude
  Code con la cuenta de tu equipo y Codex con una de Docker, y cambiar en un clic; Tessera recuerda con
  qué cuenta trabaja cada agente en cada proyecto. Cada cuenta de Docker corre en su propio contenedor,
  así que dos cuentas del mismo agente trabajan a la vez sin pisarse. Todo lo demás corre en tu equipo:
  la terminal de abajo es siempre la tuya, y desaparecen el modo de la pestaña del proyecto, la pregunta
  al abrirlo y el ajuste del modo por defecto. Si usabas proyectos en Docker, sus agentes siguen con la
  cuenta que tenían. Los agentes que defines a mano corren donde elijas al crearlos; en Docker también
  tienen varias cuentas.

- **Si Docker se queda sin memoria, Tessera para un agente con tu regla en vez de dejar que caiga
  cualquiera.** Cuando la memoria de Docker pasa del umbral que eliges (90 % de serie) durante el tiempo
  que fijas (30 s de serie), te avisa de qué agente parará y espera 30 s, con la opción de elegir otro; si
  baja, no para nada. Usa la misma política del límite, nunca toca el agente que estás mirando y su
  conversación sigue al volver. En Configuración › Contenedores Docker, «Últimas paradas» dice qué paró
  Tessera, cuándo y con qué regla.

- **Ventanas de agente: el agente de tu equipo en una ventana aparte, sin perfil ni proyecto.** Como
  abrir una terminal y escribir `claude`: Claude Code, Codex o tus agentes nativos arrancan en tu
  carpeta de usuario con un chat nuevo, con el historial de conversaciones, el chat nuevo, el anillo de contexto y el
  pegado de imágenes de siempre. Se abre desde «Nueva ventana de agente», al pie de la lista de la ▾
  del «+» de las terminales; en Windows también desde la Jump List (clic derecho en el icono de la
  barra de tareas), aunque Tessera esté cerrada, y sus ventanas llevan su propio icono y su propio
  grupo en la barra; en macOS desde el menú del Dock y el menú Ventana; en Linux desde el clic
  derecho en el lanzador. Puedes abrir varias.
- **Cerrar la ventana principal ya no cierra tus ventanas de agente.** Su agente sigue trabajando y
  Tessera termina al cerrar la última ventana; la principal vuelve a abrirse desde el icono, la Jump
  List o el Dock. «Actualizar los agentes de tu equipo» también reinicia las sesiones de las ventanas
  de agente retomando su conversación, y tras «Reiniciar para actualizar» Tessera las vuelve a abrir
  donde estaban.
- **Con poca memoria en el equipo, Tessera hiberna antes los agentes que no estás usando.** El plazo
  baja a 2 minutos con las mismas protecciones de siempre (nunca el que estás mirando ni uno que
  trabaja), te avisa una vez con un botón para hibernarlos ya, y si un agente se cae por falta de
  memoria, su terminal lo dice. Al volver a un proyecto, su agente retoma la conversación. Con el
  ajuste en «Nunca», no hiberna.
- **El agente de base de datos también puede correr en Docker.** Lo eliges en su botón de cuenta, como
  en cualquier otro agente, y sigue viendo las bases que le montes.

### Interfaz

- **La red del contenedor se llama por lo que es: «propia» o «la de tu equipo».**
- **El agente de base de datos se puede maximizar.** Su botón de maximizar tapa las tablas y consolas
  abiertas sin cerrarlas y le da al agente todo el ancho junto al árbol de conexiones; «Restaurar»
  las devuelve tal como estaban. Sin ninguna abierta, el agente ocupa todo el espacio, como en Archivos.
- **El icono de la vista sigue con el color del perfil mientras escribes en su agente.** «Archivos» o
  «Conexiones a bases de datos» no se apagan al pasar al agente del proyecto, ni «Terminal», a
  pantalla completa, al pasar al agente de la terminal. Los de Git siguen igual: allí no hay agente.
- **El lanzador de conexiones SSH es más corto.** Se quitan «Conexiones recientes» (los grupos y el
  buscador ya llevan a cada una) y «Actividad de los agentes…»: lo que hacen los agentes con `tssh`
  sigue apuntado en `logs/ssh.log`, sin la orden ni las rutas.
- **El pie de cada agente dice de un vistazo de qué perfil es y dónde vive.** El rótulo «Agente de la
  terminal», «Agente de base de datos» o el nombre del proyecto va ahora relleno del color del perfil,
  así que al volver a un perfil se reconoce en qué agente se estaba trabajando.

### Rendimiento y estabilidad

- **Los agentes en Docker se recuperan solos cuando Docker falla.** Tessera
  vigila sus contenedores: si uno muere, lo sabe al momento y lo recrea con reintentos espaciados, en
  vez de dos seguidos que fallaban mientras Docker Desktop arrancaba. Si Docker se cae, la sesión
  espera y vuelve sola en cuanto responde, sin pulsar «Reintentar». Y si Docker se queda sin memoria y el
  sistema para un agente, lo dice así en lugar de «el agente terminó».

### Correcciones

- **Cerrar la terminal local ya no deja el panel vacío si queda una pestaña SSH.** Con una pestaña SSH
  que venía del arranque anterior, cerrar la local dejaba la pestaña en la cabecera sin enseñarla, y
  con el agente de la terminal abierto este ocupaba todo el sitio. Ahora pasa a verse la SSH y se
  conecta.
- **Los agentes a pantalla completa ya no tienen una segunda barra de desplazamiento.** Claude Code a
  pantalla completa se desplaza solo, pero la terminal le añadía la suya: una barra que no movía nada
  o que, arrastrada hasta abajo, tapaba las últimas filas y el cuadro del prompt hasta que el agente
  se repintaba. Ahora, como en una terminal del sistema, mientras un programa usa toda la pantalla
  (un agente, `vim`, `less`) la terminal no enseña barra, en todos los sitios donde se abre una.
- **Cuando un agente termina, el aviso nombra el botón que hay.** Decía «Usa Reiniciar» y el botón
  del pie se llama «Reabrir».
- **Eliminar un agente manual de Docker borra también sus cuentas y su carpeta.** Se quedaban en el
  perfil, y definir otro agente con el mismo nombre las recuperaba con la sesión iniciada. El diálogo
  de borrado lo avisa; los archivos de los proyectos no se tocan.

### Seguridad

- **En modo Docker, cada cuenta de agente trabaja en su propio contenedor.** Las credenciales de una
  cuenta ya no están al alcance de los agentes de otra. El contenedor de una cuenta se para solo a los 2 minutos de
  cerrar su último agente, para que no consuma si no lo usas. Las cuentas de Codex inician sesión
  por navegador, como siempre, aunque tu empresa tenga desactivado el inicio por código: el enlace sale
  en la terminal y Tessera lleva la vuelta del navegador al contenedor de esa cuenta, también cuando es
  Codex quien la pide porque tu sesión caducó. Se inicia sesión
  en una cuenta a la vez; si otra está a medias, Tessera te dice cuál. Ningún contenedor abre puertos a
  tu equipo.

## [0.81.0] - 2026-10-16

### Novedades

- **Tessera en inglés.** Toda la interfaz, los diálogos del sistema y las órdenes `tdb` y `tssh`
  hablan español o inglés. De serie, el idioma de tu equipo (inglés si no es ninguno de los dos); lo
  cambias en Configuración › Apariencia › Idioma, y se aplica al reiniciar Tessera, que puedes hacer
  desde ahí mismo.

- **Audio y vídeo en el editor.** Abrir un `.mp4`, `.webm`, `.mov`, `.mp3`, `.wav`, `.ogg`, `.flac`
  y similares lo reproduce en su pestaña, sin instalar nada: por ejemplo, la grabación de una prueba
  de interfaz. También desde un diff de git o una revisión anterior. Lo que pasa de 50 MiB o usa un
  formato que no se puede reproducir ofrece abrirlo con la app del sistema, y al cambiar de pestaña
  se pausa.

- **Agentes definidos a mano.** Además de Claude Code y Codex, cualquier agente de terminal: el
  selector de agente es ahora una fila de pestañas con un «+» que abre un formulario con su nombre, su
  comando (tal como lo teclearías) y, si quieres, cómo reanudar la última conversación (por ejemplo
  `--continue`). En los proyectos nativos lo instalas tú y Tessera te avisa si tu shell no lo
  encuentra; en los de Docker escribes también sus órdenes de instalación y Tessera las hornea en la
  imagen de ese perfil, con su progreso, y comprueba que quedó instalado. Cada agente guarda su sesión
  y su configuración en su propia carpeta del perfil, que sobrevive a recrear el contenedor, sin que
  tengas que decir dónde. Los nativos los ven todos los perfiles; los de Docker, solo el suyo. Salen
  en su proyecto y en el mosaico, y como agente de la terminal si lo activas (el contexto de tus
  servidores y bases le llega por `AGENTS.md`). Si tu agente dice en JSON cuánto contexto lleva, con un
  comando o en un archivo, le indicas dónde y en qué campos y Tessera lo enseña en el anillo del pie.
  La definición se copia y se pega como JSON. Un agente definido a mano no tiene historial de
  conversaciones, uso de la cuenta, aviso de fin de turno ni hibernación automática.
- **Tus agentes, a tu manera, en cada perfil.** Las pestañas de agente miden lo que su nombre, se
  reordenan arrastrando y, si no caben, la fila se desplaza con un «›» para las demás. Puedes ocultar
  cualquier agente, de serie o tuyo, mientras quede uno: con clic derecho en las pestañas (donde
  también vuelves a mostrarlos) o en la categoría nueva Configuración › Agentes, que reúne el orden,
  lo oculto, editar y borrar. Si prefieres algo más discreto, el selector puede ser una lista
  desplegable en vez de pestañas.
- **Llevar la configuración a otro equipo.** En Configuración › Exportar e importar: los perfiles que
  elijas con sus conexiones SSH (contraseñas, claves y huellas) y de bases de datos (contraseñas), los
  agentes definidos a mano y tus preferencias, en un archivo cifrado con una frase (o, si lo marcas y
  bajo tu responsabilidad, sin ella: entonces contraseñas y claves van legibles, y Tessera lo avisa al
  exportar y al importar). Vale entre
  Windows, macOS y Linux. Al importar se añade lo que falta y no se toca lo que ya tenías, y te dice lo
  que se saltó y lo que conviene revisar (una carpeta o un archivo que no está en el equipo nuevo).
  Antes de importar eliges qué entra: todo viene marcado (cada perfil con sus conexiones y agentes,
  y aparte las preferencias) y desmarcas lo que no quieras, de una en una o con la casilla «Todo». Los archivos `.tessera` son de Tessera en tu sistema: un doble clic abre Tessera (o la que ya
  tienes abierta) directamente en el importar con ese archivo, pidiendo la frase (o, si se exportó sin ella, avisando
  de que no está cifrado y sin nada marcado de serie). En Windows y macOS
  lo deja hecho la instalación; en Linux, al activar «Abrir con Tessera» en Configuración ›
  Integración con el sistema.
- **El agente de datos y el de la terminal, también en el mosaico.** Si los tienes abiertos, entran
  como cualquier proyecto: al abrir el mosaico si están trabajando, en el selector «N de M» y en el
  menú de cada casilla, como «Bases de datos» y «Terminal» de su perfil, detrás de sus proyectos. El
  botón de ir a su sitio te lleva a la vista de bases de datos o a la terminal a pantalla completa con
  su agente al lado.
- **La terminal resalta los logs y las salidas.** Lo que llega sin color se pinta con los colores de
  siempre: errores en rojo y avisos en amarillo, la línea entera; info en azul y lo que fue bien en
  verde, solo su etiqueta; fechas atenuadas, IPs y URLs en cian y los códigos HTTP por su clase.
  Reconoce los formatos habituales de logs (syslog, log4j, journald, Python, Node, Java), compiladores
  y pruebas, gestores de paquetes y conectividad, también en SSH. Un nivel solo cuenta como etiqueta
  (`[ERROR]`, `<Info>`, `level=warn`), así que «no error found» no se pinta. No cambia el texto (copiar
  y buscar dan el original), no toca lo que ya trae color ni las aplicaciones a pantalla completa como
  `vim`, y se apaga en Configuración › Terminales.
- **Olvidar la huella de un servidor SSH desde su menú.** Si reinstalas un equipo y su huella
  cambia, el menú de la conexión ofrece «Olvidar la huella guardada…»: tras confirmarlo, la próxima
  conexión guarda la nueva. Ya no hace falta abrir la conexión y pulsar «Probar» para llegar a la
  opción, y la terminal que se niega a conectar por la huella dice dónde está.

### Interfaz

- **La consola de SQL pega el texto a los números de línea**, sin el hueco de cuatro o cinco
  caracteres que dejaba la columna de plegar bloques.
- **El clic derecho en el editor abre el menú de Tessera**, en tu idioma y con el mismo aspecto que
  el resto de la app, en los archivos, las comparaciones y las consolas de base de datos: cortar,
  copiar, pegar, seleccionar todo, cambiar todas las apariciones y, según el lenguaje, ir a la
  definición, ver referencias, cambiar el nombre y dar formato.
- **En el modo minimalista, los perfiles se reordenan arrastrándolos en la lista.** El orden es el
  mismo que el de las pestañas del modo normal: lo que cambias en uno se ve en el otro.
- **El pie de cada agente dice dónde vive.** En su esquina derecha, con el icono de su vista: el
  nombre del proyecto, «Agente de base de datos» o «Agente de la terminal». Así, con la terminal a
  pantalla completa, no se confunde su agente con el de un proyecto. El botón de reiniciar va a su
  izquierda.
- **Los archivos `.tessera` tienen su propio icono.** Una hoja con la marca de Tessera, en Windows,
  macOS y Linux: ya no se confunden con la app en una carpeta o en el escritorio.
- **La X de una pestaña de proyecto avisa de que cierra.** Al apuntarla se tiñe de un rojo apagado,
  como el botón de detener de la consola de bases de datos.
- **Una terminal nueva con el agente maximizado, en un clic.** Junto al número de terminales tapadas
  hay un «+» que abre otra y vuelve a enseñar las terminales con la nueva a la vista.

- **Las cargas avisan sin parpadear, y dicen cuándo tardan.** En Git, el explorador y el árbol de
  bases de datos, «Cargando…» solo aparece si la espera pasa de un cuarto de segundo y, una vez
  visible, no destella. Si pasa de cinco segundos, dice que está tardando más de lo habitual y, si lo
  sabe, por qué: cuántos repositorios lleva leídos o que la base aún no responde.

### Correcciones

- **Cada pestaña de Codex corre en su propia terminal en macOS y Linux.** Las versiones recientes de
  Codex arrancan un servidor compartido por cuenta: las órdenes de todas tus pestañas corrían con el
  entorno de la primera (sus bases de datos y su PATH) y cerrar una pestaña no paraba su trabajo.
  Tessera lo arranca ahora sin ese servidor.
- **El anillo de contexto de Claude Code ya no cae a 0 mientras piensa.** Las versiones recientes de
  Claude Code guardan en su historial cada petición entera, que puede ocupar más que lo que Tessera leía
  del final; ahora lee lo que haga falta para encontrar el último turno. Y Haiku 5.5 cuenta con su
  ventana de un millón de tokens.
- **Una huella cambiada en otro equipo ya no se achaca a tu conexión SSH.** Si un agente (o tú en la
  terminal) lanzaba `ssh` desde el servidor hacia otra máquina y esa máquina había cambiado de huella,
  Tessera decía que la huella cambiada era la del servidor y aconsejaba olvidarla, aunque estaba bien.
  Ahora solo lo dice cuando la que cambió es la de la conexión o la de su bastión. Y cuando cambia la del
  bastión, ya no sale «el servidor no responde: ¿falta la VPN?», sino que la huella cambió.
- **Git · Cambios recuerda qué repos dejaste abiertos o cerrados** al cambiar de perfil o de proyecto
  y volver; antes, con varios repos, se desplegaban otra vez todos los que tenían cambios.
- **El punto de un perfil ya no se queda girando** como si despertara mientras trabajas en él: lo
  dejaba así un agente de otra pestaña que esperaba a que volvieras a mirarlo para arrancar.
- **Codex vuelve a reanudar la última conversación del proyecto** al abrirlo, al despertar de la
  hibernación y al volver a un perfil, y su historial vuelve a listarse. Las versiones recientes de
  Codex guardan los mensajes con otra forma y Tessera las daba por vacías.
- **«Aplicar» en el color de un perfil cierra el panel.** Antes se quedaba abierto y no quedaba
  claro si el color se había aplicado. Elegir una muestra sigue tiñendo la pestaña en el acto y deja
  el panel abierto para probar otra.
- **Guardar justo al cambiar de proyecto ya no puede pisar un archivo del otro.** Durante el segundo
  en que Tessera pasa de un proyecto o perfil a otro, un Ctrl+S, un renombrado, un borrado o un
  «Descartar cambios» de git iba a la misma ruta del proyecto nuevo. Ahora cada operación con
  archivos o con git va a su proyecto, también en ese instante.
- **Cerrar Tessera o un agente ya no deja procesos del agente vivos.** En Windows, al cerrar la app
  o una pestaña de proyecto, el agente podía seguir corriendo sin ventana y retenía la carpeta del
  proyecto. Ahora se cierra todo lo que lanzó.
- **Tessera ya no puede quedarse viva sin ventana al cerrarla.** Una terminal cuyo proceso seguía
  vivo al cerrar podía impedir que Tessera terminara: la ventana desaparecía, pero el proceso
  quedaba en segundo plano y podía estorbar a la siguiente actualización. Ahora se rematan todas las
  terminales, también las que se habían reiniciado o cerrado a medias, y si algo aún retuviera la
  salida, Tessera termina sola a los pocos segundos y lo deja anotado.
- **La lista de conexiones SSH de cada perfil vuelve tal cual.** Con la terminal a pantalla
  completa, el filtro, la fila elegida y el desplazamiento del riel son de cada perfil, también si
  en el otro perfil la terminal no estaba a pantalla completa o tenía la franja cerrada.
- **Cambiar de vista lateral no pierde lo que dejaste.** Pasar de Archivos a Git o a Bases de datos
  y volver, en el mismo perfil o en otro que enseñaba otra vista, encuentra el explorador y el árbol
  de bases como estaban: carpetas abiertas, desplazamiento y un diálogo de conexión a medias.
- **El explorador vuelve tal cual lo dejaste.** Al regresar a un proyecto o a un perfil, su árbol
  conserva las carpetas abiertas, el desplazamiento y lo que tenías seleccionado, sin recargarse
  desde cero.
- **Volver a un perfil en bases de datos lo encuentra tal cual.** Sus conexiones y consolas se
  conservan y se refrescan al volver, sin «Cargando…». Su árbol vuelve con lo desplegado, el
  desplazamiento y la búsqueda, y un diálogo de conexión a medio llenar sigue ahí con lo que
  escribiste; nada de eso pasa al otro perfil ni le bloquea el teclado.
- **Git·Log y el estado de los repos salen en cuanto cambias de proyecto.** Ya no esperan a que
  Tessera termine de pasar al proyecto nuevo, y las letras de git del explorador y de las pestañas
  no parpadean al volver a uno. Y comparar dos versiones de un archivo comprimido o
  abrir una clase de Java justo al cambiar de proyecto lee siempre la del suyo.
- **Cada proyecto recuerda su historial de archivo y su Git·Log.** El historial de un archivo ya no
  se cierra al cambiar de proyecto ni se ve en otro, y el log de cada repo conserva su filtro de
  autor y de fecha y las carpetas de ramas que cerraste.
- **Cada perfil recuerda su agente maximizado u oculto.** Antes era de toda la ventana: maximizar
  en un perfil lo maximizaba en todos, y abrir un archivo en otro se lo quitaba al volver.
- **Cambiar de perfil o de proyecto ya no enseña un momento el anterior.** Durante un segundo o dos
  el explorador, las pestañas del editor, el agente de la columna y la terminal seguían en el perfil
  del que venías, y al llegar el nuevo el agente se llevaba el teclado. Ahora todo cambia a la vez,
  al instante.
- **Reanudar una conversación ya no da un salto en la terminal del agente.** La sesión arrancaba
  con un tamaño provisional y el bueno llegaba después, así que Claude Code o Codex pintaban la
  conversación y la repintaban entera; en un proyecto con contenedor, a veces el agente se quedaba
  con el tamaño provisional. Ahora nace con el tamaño de su terminal. Además, la terminal del agente
  deja de tener buscador propio: los agentes dibujan su propia pantalla y Ctrl+F (⌘F) les llega a
  ellos.
- **Los logs y la configuración se leen con color en la terminal, también por SSH.** Antes solo se
  pintaban las líneas con nivel (ERROR, WARN), y un registro del sistema o un `cat` de un `.yml`
  salían casi en blanco. Ahora la hora, el proceso con su PID, las rutas, las IPs (también IPv6) y
  las claves de `clave=valor`, YAML y JSON van en su color, los comentarios atenuados, y palabras
  como `failed`, `unreachable` o `timed out` en rojo aunque vayan en minúsculas. Los editores y
  paginadores a pantalla completa (`nano`, `less`, `vim`) siguen con sus propios colores.

### Seguridad

- **Motor de la app y librerías al día.** Tessera pasa a Electron 43.7.11, con los últimos
  arreglos de seguridad de su navegador, y se actualiza la librería que limpia los documentos de
  Word antes de enseñarlos, junto con otros parches menores.

## [0.80.0] - 2026-10-11

### Novedades

- **Tessera para Linux.** Se publica como AppImage para equipos x64 y se actualiza sola, igual que en
  Windows y macOS. En los proyectos con contenedor, el agente trabaja con tu mismo usuario, así que
  puede escribir en el proyecto y lo que crea es tuyo. «Abrir con Tessera» se activa desde
  Configuración › Integración con el sistema: pone Tessera en el «Abrir con» de las carpetas de tu
  gestor de archivos y en el lanzador de aplicaciones. También puedes pegar en el explorador los
  archivos que copies o cortes en el gestor de archivos. Las bases Oracle anteriores a la 12.1 se
  abren igual que en Windows: «Clientes de base de datos» descarga el Instant Client para Linux.
  Necesita el Docker del sistema (sin root no funciona: Tessera te lo explica y te propone el modo
  nativo) y, para guardar contraseñas, GNOME Keyring o KWallet.

#### Bases de datos

- **MySQL y MariaDB.** Un motor nuevo, al nivel de PostgreSQL y SQL Server: el alta con la base
  opcional, el cifrado (con «Confiar en el certificado del servidor»), el túnel SSH, los entornos y
  pegar una URI `mysql://` o `mariadb://`. En el árbol, las bases están donde los demás motores ponen
  los esquemas, con sus tablas, vistas, rutinas, disparadores y eventos, sus columnas, índices,
  restricciones y claves foráneas, y el DDL tal como lo da el servidor. La consola entiende la
  sintaxis de MySQL (comillas, `#`, los cuerpos `BEGIN … END` y `DELIMITER`), ejecuta con
  transacciones, `USE` y parámetros `?`, enseña los avisos del servidor y varios conjuntos de un
  `CALL`, para con Detener y explica el plan. La rejilla edita por la clave primaria (o un índice
  único), exporta e historia como en los demás, y JSON, ENUM, SET, BIT, BLOB, las fechas con cero,
  los enteros sin signo y la geometría se ven con su valor exacto. Los agentes consultan con `tdb`,
  y una conexión de solo lectura no puede escribir.
- **Conexiones cifradas a PostgreSQL y Oracle.** PostgreSQL cifra con SSL, así que ya conecta a las
  bases en la nube, que lo exigen. Oracle cifra por TCPS (bases 12.1 o posteriores). Como en SQL
  Server, MongoDB y Redis, el certificado se verifica contra las autoridades de confianza de tu
  equipo; en PostgreSQL también puedes confiar en un certificado propio. Si el servidor no admite el
  cifrado, o lo exige y no lo has marcado, el error lo dice y te indica qué casilla tocar.
- **Bases de datos por un túnel SSH.** En la conexión de una base eliges una de tus conexiones SSH
  del perfil (también las que saltan por un bastión) y Tessera llega a la base a través de ella:
  desde el explorador, desde los agentes y al probarla. Funciona con PostgreSQL, Oracle, SQL Server,
  MongoDB y Redis, y el certificado de una base cifrada se sigue verificando contra su nombre real.
  La conexión SSH tiene que tener la huella del servidor confirmada y su contraseña o clave guardada.
- **Pegar una URI de PostgreSQL.** Pegar `postgres://usuario:clave@host:5432/base?sslmode=require` en
  la conexión rellena el servidor, la base, el usuario, la contraseña y el cifrado.
- **Disparadores en PostgreSQL y SQL Server.** El explorador los enseña en cada esquema, con su tabla
  y si están habilitados, y abre su definición y su DDL, como ya hacía con Oracle.
- **MongoDB más completo.** El explorador enseña los índices de cada colección; el resultado de una
  consulta o una colección entera se exporta a JSON o CSV; la consola admite `findOneAndUpdate`,
  `findOneAndDelete`, `findOneAndReplace`, `getIndexes`, `createIndex`, `dropIndex`, `drop`,
  `createCollection`, `renameCollection`, `stats()`, `.hint()`, `.maxTimeMS()` y `.count()`, y
  `explain()` se ve como plan, con lo que examinó y lo que tardó, en el mismo visor que SQL.
- **La consola de MongoDB tiene lo de la consola SQL.** Al ejecutar varias órdenes, cada una que
  devuelve documentos o un valor abre su propia pestaña de resultado (con el nombre de la
  colección), que se puede fijar o cerrar como en SQL; antes solo quedaba la última. Tiene
  historial de lo ejecutado (el botón del reloj o Ctrl+Mayús+H, ⌘⇧H en Mac), que inserta la orden
  elegida en el cursor y guarda las contraseñas tapadas; cada consola enseña y borra solo el
  suyo. Y autocompleta: tras `db.` ofrece las colecciones de la base y sus métodos; tras una
  colección, sus métodos; dentro del filtro de un `find`, los campos de la colección, y con `$`,
  los operadores y las etapas de un `aggregate`.
- **MongoDB: vista previa antes de «Enviar».** Al enviar los cambios de una colección, Tessera
  enseña primero la orden del shell de cada cambio (`updateOne`, `replaceOne`, `insertOne`,
  `deleteOne`) con su `_id`, cuántos son de cada tipo y un botón para copiarlas, igual que ya
  hacía con el SQL de las tablas. En una conexión de producción el botón dice «Ejecutar en
  producción».
- **MongoDB con varios servidores sin DNS SRV.** El host de una conexión acepta los miembros de un
  replica set separados por comas (`h1,h2:27018`), y pegar una URI con varios hosts ya no da error:
  si uno cae, la conexión sigue con los demás.
- **Redis más completo.** La consola guarda el historial de comandos (con las contraseñas tapadas) y
  los completa mientras escribes; el árbol enseña cuánto le queda a cada clave para caducar y se
  filtra por tipo; se crean claves y se editan listas, conjuntos, conjuntos ordenados y streams;
  se borran las claves que casan con un patrón, con vista previa y confirmación, y una clave se
  exporta a un archivo JSON.
- **Redis: editar desde el visor de una clave.** Sin pasar por la consola, puedes:
  - cambiar el valor de un string;
  - añadir, editar y borrar campos de un hash;
  - poner o quitar la caducidad;
  - renombrar la clave y borrarla.

  Cada acción enseña antes el comando exacto que se va a ejecutar, y en una conexión de
  producción el botón dice «Ejecutar en producción». Renombrar a un nombre que ya existe no
  pisa esa clave: te lo dice. Si la clave caduca, cambiarle el valor no le quita la caducidad.
- **Redis Sentinel y Redis Cluster.** Al crear una conexión de Redis eliges a qué te conectas: un
  servidor, Sentinel o Cluster. Con Sentinel das los sentinels y el nombre del maestro (y, si la
  tienen, la contraseña de los sentinels); Tessera les pregunta por el maestro y, tras un failover,
  sigue con el nuevo sin que tengas que reconectar. Con Cluster das uno o varios nodos y Tessera
  descubre el resto: el árbol enseña las claves de todos los maestros, cada comando va al nodo de su
  clave y lo que en Cluster no tiene sentido (cambiar de base, una transacción en la consola,
  comandos con claves de varios slots) se explica en vez de fallar a medias. Funciona igual en el
  explorador, en la consola y para los agentes. Ninguno de los dos va por túnel SSH.

#### SSH

- **Bastiones y túneles en las conexiones SSH.** En «Bastión y túneles», dentro de la conexión,
  «Saltar por» elige otra conexión del perfil por la que pasar para llegar a un equipo que no se
  ve directamente (se pueden encadenar hasta cuatro), cada una con su usuario, su clave o
  contraseña y su huella. La terminal, «Probar», el explorador SFTP y los agentes (`tssh`)
  atraviesan el bastión. Los túneles (local, remoto y SOCKS) se abren con la terminal de la
  conexión y se cierran con ella; los locales solo escuchan en este equipo. Lo que haya que
  contestar a mano en una conexión con bastión se pregunta en un diálogo.
- **SSH pregunta en un diálogo lo que Tessera no contesta sola.** Si el servidor rechaza la
  contraseña o la frase guardada, ya no hay que editar la conexión: un diálogo la pide y la
  conexión sigue. Lo mismo con un segundo factor (un código), que antes hacía fallar la primera
  conexión con contraseña guardada. El explorador SFTP ya se abre sin contraseña guardada (o con
  una que no se puede leer): la pide en ese diálogo. Lo que escribes va al servidor y no se guarda.
- **Las pestañas SSH vuelven al abrir Tessera.** Las que dejaste abiertas (también las del
  explorador SFTP) aparecen en su sitio, con su nombre, al volver a abrir la app. Ninguna se
  conecta sola: cada una se conecta cuando la miras, así que el arranque no pide contraseñas ni
  espera a servidores caídos.
- **«Duplicar» en el menú de una conexión SSH.** Crea al momento una copia con todo lo de la
  original: host, usuario, clave o contraseña guardada, grupo, bastión y túneles. Se llama como
  la original con un número («web (1)», «web (2)»…), que no se acumula al duplicar una copia; para
  cambiar algo, «Editar…». La copia tiene su propia copia de la clave y acepta la huella del
  servidor al conectar.
- **Organizar las conexiones SSH desde el riel, varias a la vez.** Con la terminal a pantalla
  completa, en la lista de conexiones Ctrl+clic (⌘+clic en Mac) marca sueltas y Mayús+clic un
  rango. Arrástralas a otro grupo (o a «Sin grupo»), o suéltalas en «Nuevo grupo…», que aparece
  al pie mientras arrastras, para crear un grupo con ellas dentro. Con varias marcadas, el clic
  derecho ofrece moverlas o eliminarlas, y Supr (⌘⌫ en Mac) las elimina con una sola
  confirmación.
- **Al importar varias conexiones de OpenSSH, cada una a su grupo.** En la revisión, cada fila
  tiene su selector de grupo, así que puedes repartirlas como quieras (una a cada grupo, cinco a
  uno y una a otro…). «Nuevo grupo…» crea un grupo ahí mismo y lo pone en esa fila, y «Poner las
  marcadas en el grupo» las pone todas en uno de golpe. Las filas que no vas a importar quedan
  bloqueadas hasta que las marcas. El aviso final dice cuántas fueron a cada grupo. La revisión
  se recoloca en ventanas estrechas o con zoom alto.
- **Exportar las conexiones SSH a OpenSSH.** El botón «Exportar a OpenSSH…» de la lista de
  conexiones junto a la terminal guarda todas las del perfil en un archivo `config` de OpenSSH, y
  con varias marcadas, el menú exporta solo esas. Cada conexión lleva su servidor, puerto, usuario,
  bastión y túneles, y los bastiones que necesita van también. Las claves se copian, solo para ti, a
  una carpeta junto al archivo. Las contraseñas no se exportan, porque OpenSSH no las guarda: ssh
  las pedirá al conectar. Se propone `config-tessera` en tu carpeta `.ssh`, al lado de tu `config`
  sin tocarlo: con un `Include config-tessera` al principio de este, ssh ya las conoce. Lo exportado
  vuelve a entrar igual con «Importar desde OpenSSH…».
- **Lo que hicieron los agentes por SSH, a la vista.** «Actividad de los agentes…», en el menú de
  una conexión y en el pie de la lista de conexiones, enseña qué pidió cada agente con `tssh` en el
  perfil (una orden, una copia o una prueba), con qué conexión, cómo acabó y cuánto tardó, también
  lo que no se lanzó (una conexión no disponible, una huella sin confirmar). Nunca la orden ni las
  rutas: el registro no las guarda.

#### Agentes, terminal y perfiles

- **El punto de cada agente dice lo que el agente dice, y avisa cuando te espera.** Con Claude Code
  2.1.295 o posterior, Tessera lee el estado que el propio agente informa (trabajando, terminó, te
  espera) en lugar de deducirlo, así que el punto del perfil ya no se queda encendido sin saber si
  terminó. Cuando un agente te pide un permiso o te hace una pregunta, su punto (en la pestaña del
  perfil y en el mosaico) lleva un anillo que parpadea, y vuelve a avisar si dejas esa terminal sin
  contestar. Con versiones anteriores y con Codex sigue funcionando como hasta ahora.
- **El agente de la terminal se puede maximizar sobre las terminales.** Con la terminal a
  pantalla completa y el agente al lado, su botón de maximizar ocupa todo el espacio sin cerrar
  ninguna terminal, y el de restaurar vuelve a enseñarlas. Mientras tanto, sus pestañas quedan
  reducidas a un indicador con cuántas hay («3 terminales»), que también las vuelve a enseñar, igual
  que conectar desde la lista de conexiones.
- **Cada ventana recuerda si estaba maximizada.** La terminal y Git·Log guardan cada una, y en
  cada perfil, si las dejaste maximizadas: al cerrarlas y reabrirlas, al pasar de una a otra o al
  volver de otro perfil, aparecen como las dejaste. Elegir otra vista lateral o abrir un archivo
  las devuelve a su tamaño, sin cerrarlas.
- **Nuevo selector de color de los perfiles.** «Cambiar color» abre un panel bajo la pestaña del
  perfil, en lugar del selector del sistema. Ofrece los colores base, los que hayas fijado y un
  color personalizado por tono y luz (o en hexadecimal) que puedes fijar para usarlo en otros
  perfiles. La pestaña se tiñe al elegir, y Esc deshace. El mismo panel sirve al crear un perfil.

### Interfaz

- **Cada zona de la ventana es una tarjeta.** La barra lateral, el editor, la vista de datos, el
  agente, la terminal, Git·Log y cada casilla del mosaico son ahora paneles redondeados, con un
  hueco entre ellos; la barra de iconos también es su propia tarjeta. Para redimensionar se
  arrastra el hueco, que se ilumina con el color del perfil. Dentro de Git·Log (ramas, commits y
  detalle), de la terminal a pantalla completa (el riel de conexiones SSH) y de la consola de
  base de datos (la consulta y los resultados), cada parte es también una tarjeta con su hueco.
  Las cabeceras ya no llevan una línea que las separe de su contenido, y la terminal es una sola
  superficie del color de la consola.
- **Pestañas en cápsula.** Las del editor, la vista de datos y Git·Log son ahora cápsulas como
  las de la terminal, con la activa rellena del color del perfil. El perfil activo se marca con
  un contorno y un halo de su color, y el proyecto activo con un contorno fino y más tenue.
- **La tira de pestañas del editor es más compacta.** Se distingue del texto por un tono algo
  más oscuro. Los botones de modo de un Markdown (código, dividido, vista previa) están a su
  derecha, así que el documento empieza justo debajo. Cuando las pestañas no caben, una flecha
  lista las que no se ven, y la rueda del ratón desplaza la tira.
- **Barras de desplazamiento iguales en toda la app.** Árboles, listas, rejillas, editor,
  terminales, agente, consolas y diálogos usan la misma pastilla fina y redondeada. Crece al
  pasar el ratón por encima y se oculta cuando el ratón no está en esa zona; mientras la zona se
  desplaza, se ve. Las terminales ya no enseñan la barra del sistema con flechas, y la regla de
  cambios de la vista de diferencias lleva el recuadro redondeado.
- **Modo minimalista de perfiles.** En Configuración, «Apariencia», la banda de perfiles se puede
  cambiar por un selector compacto en el centro de la barra de título, con el perfil activo; al
  pulsarlo salen los demás, y desde su «⋯» se renombran, se cambian de color, se hibernan o se
  eliminan como desde la banda. Sustituye a «Colapsar la banda de perfiles».
- **Los números a la derecha de las listas ya no saltan.** En el detalle de un commit, en
  «Cambios» y en el explorador, el hueco de la barra de desplazamiento queda reservado, así que las
  cifras y las letras de git no se mueven cuando la lista deja de caber.
- **Cada motor con su icono al elegirlo.** En el diálogo de conexión, la lista de motores enseña el
  icono de cada uno junto a su nombre.
- **Plegar todos los repositorios en «Cambios».** Con una carpeta de varios repositorios, un botón
  junto a «Recargar los cambios» los pliega todos de una vez, para revisar solo el que te interesa
  sin desplazarte por los demás; pulsado otra vez, vuelve a abrir los que tienen cambios.
- **Reconectar una sesión SSH desde la propia terminal.** Cuando una sesión SSH termina o no
  consigue conectar, bajo su terminal sale una franja con lo que pasó y el botón «Reconectar», y
  pulsar Intro en la terminal hace lo mismo. Mientras conecta, junto a «Conectando a…» hay un
  «Cancelar» para no esperar al tiempo de espera. El clic derecho en la pestaña ofrece también
  «Reconectar», «Renombrar» y «Cerrar». La cabecera del panel ya no lleva el botón de reconectar
  en las pestañas SSH (sigue el de reiniciar en las terminales locales), y el cursor ya no se pinta
  encima del «Conectando a…».
- **Los botones dicen qué hacen también en Mac.** Al dejar el ratón sobre un botón de icono sale
  su descripción en un globo de Tessera, igual en Windows y en Mac (en Mac no salía ninguno), y
  también el motivo de un botón desactivado.
- **Iconos de formato al exportar y copiar.** Los menús de «Exportar a archivo» y «Copiar como»
  de la rejilla enseñan junto a cada formato (CSV, TSV, JSON, SQL, Markdown) el mismo icono que
  ese tipo de archivo lleva en el explorador.
- **Ejecutar y Detener se tiñen al apuntarlos.** En las consolas, Ejecutar y Ejecutar todo se
  tiñen de verde y Detener de rojo, con el mismo fondo tenue del resto de botones.
- **Los datos se distinguen de sus cabeceras.** En la rejilla de resultados los nombres de las
  columnas van en el texto claro y los valores en un gris claro; los nombres de tablas, vistas y
  columnas del árbol de bases, también. Lo seleccionado vuelve al claro.
- **Iconos de la barra de título del mismo tamaño.** El del mosaico de agentes y el de actualizar
  los agentes miden ya lo mismo que el de Configuración, con las esquinas más redondeadas.
- **En Mac, la terminal y el editor usan Menlo por defecto.** Ninguna de las letras
  monoespaciadas de la lista viene con macOS, y se acababa en Courier New, fina y difícil de
  leer. Menlo también se puede elegir en Configuración. En Windows no cambia nada.
- **La lista de conexiones SSH junto a la terminal a pantalla completa es una tarjeta separada**, y
  su sitio cuenta los márgenes de las tarjetas: ni la terminal ni el agente quedan por debajo de su
  ancho mínimo. El mosaico con una sola casilla y el aviso de una zona que falló llevan borde de tarjeta.
- **Barras y otros detalles en el color del perfil.** Al arrastrar una barra de desplazamiento,
  su pastilla toma el color del perfil en lugar del azul. El botón «Aplicar y reiniciar el
  contenedor» de la red del contenedor también va en el color del perfil. Al renombrar un
  perfil, el campo ya no lleva un segundo contorno dentro de la pestaña.
- **Las pestañas de un diff llevan dos flechas** en lugar de la palabra «diff», y el botón de
  actualizar los agentes tiene un icono redondeado como el resto de la barra de título.
- **Las conexiones SSH junto a la terminal se abren con doble clic.** Un clic solo elige la
  conexión, para editarla o borrarla sin conectar; el doble clic o Intro la abren. En el lanzador
  de la ▾ sigue bastando un clic.

### Rendimiento y estabilidad

- **En Windows, cerrar terminales ya no va acumulando memoria.** Cada terminal, sesión SSH o
  agente que se cerraba o se hibernaba dejaba unos 7 MB retenidos mientras Tessera siguiera
  abierta, también con el equipo suspendido, y en un día de abrir y cerrar terminales pasaba de
  100 MB. Ahora esa memoria se libera en el momento de cerrarlas.
- **Sin parpadeo al volver a un perfil con la terminal maximizada.** El agente de al lado ya no se
  redibuja al cambiar de perfil.
- **La terminal maximizada con su agente al lado, más estable.** Al abrir un proyecto la columna ya
  no salta un instante; abrir la primera terminal o restaurarlas ya no borra lo escrito en el filtro
  de conexiones; la lista de conexiones, ni ensanchada al máximo, deja al agente por debajo de su
  ancho mínimo; y mientras el agente se prepara, las terminales siguen a la vista.
- **Cerrar Tessera ya no se queda colgado si Docker no responde.** Si Docker pasa 30 segundos sin
  avanzar al detener los contenedores, Tessera lo dice y se cierra, en vez de esperar varios
  minutos; lo que quede lo limpia el siguiente arranque.
- **Un documento JSON enorme de Redis ya no bloquea la conexión.** El visor ya no lo pide entero
  para enseñar el principio: si ocupa más de 16 MB en memoria, dice cuánto ocupa y cómo leerlo por
  partes en la consola.

### Instalación y actualizaciones

- **En Mac, los permisos que le das a Tessera se conservan al actualizar.** La app va firmada con
  un certificado de Tessera que es el mismo en todas las versiones, así que macOS deja de tratar
  cada actualización como otra app: lo que le hayas permitido (Accesibilidad, grabación de
  pantalla, acceso a carpetas), también a lo que corre en sus terminales, sigue valiendo. Con esta
  versión hay que concederlos una última vez. El Llavero aún pedirá permiso una vez tras cada
  actualización: pulsa «Permitir siempre».
- **Actualizar Codex justo tras salir una versión ya no lo deja roto.** Tessera solo ofrece la
  versión nueva cuando el registro ya sirve el binario para tu equipo; hasta entonces dice que
  aún no está lista. Y si una actualización deja Codex sin responder, el botón ofrece
  «Reparar Codex», que lo reinstala sin tener que ejecutarlo.
- **En Windows, «Actualizar ahora» ya no puede cerrar Tessera sin actualizar.** Alguna vez la app
  se cerraba a mitad de la preparación y no pasaba nada más: al volver a abrirla seguía en la
  versión anterior y había que pulsar otra vez. Ahora la ventana de la actualización sale en
  cuanto pulsas el botón y la instalación sigue aunque Tessera se cierre antes de tiempo.
- **Las versiones alpha llevan un registro de salud y guardan un volcado si Tessera se cae.** Cada
  5 minutos anotan, en un archivo de tu equipo, cuánta memoria y cuántos procesos usa Tessera, las
  suspensiones del equipo y los procesos que se caen, y los momentos en que la ventana se atasca:
  cuándo deja de responder y cuánto tarda en volver, los parones del proceso principal con lo que
  estaba haciendo, las teclas y fotogramas que tardan en pintarse y los cambios de monitor. Si
  Tessera se cae, queda un volcado (los diez últimos) que se anota en el registro de fallos al
  volver a abrirla. Sirven para encontrar fugas y atascos con el uso real; no guardan nada de tus
  proyectos ni salen del equipo, y se apagan en Configuración, «Experimental». La versión pública
  no graba nada y no muestra esas opciones.

### Correcciones

- **Dos Tessera con el mismo Docker ya no se cierran los contenedores la una a la otra.** Una
  segunda Tessera con otra carpeta de datos (`--user-data-dir`), o la de otro usuario del mismo
  equipo, quitaba al arrancar y al cerrar los contenedores de la primera y les desmontaba los
  proyectos. Ahora cada una solo toca los suyos. La primera vez que abras esta versión, los
  contenedores de los perfiles se vuelven a crear, como al reiniciar.
- **En Windows, cerrar Tessera ya no deja a veces el proceso vivo.** La ventana desaparecía pero el
  proceso podía seguir en segundo plano, y eso estorbaba al volver a abrirla o al instalar una
  actualización. Ahora las terminales y los agentes se cierran antes de salir.
- **La vista dividida de un Markdown llega al final.** Ir al final del código lleva la vista previa
  hasta el final también cuando las líneas desbordan a lo ancho, y la cabecera y el pie del agente
  tienen el tono de su terminal.
- **Las conexiones de un perfil solo se borran cuando borras el perfil.** Antes, Tessera borraba
  las conexiones SSH y de bases de datos y el historial de consultas de cualquier perfil que
  faltara en la lista guardada. Eso pasaba también si la lista llegaba incompleta por un fallo, o
  si `profiles.json` se perdía y se volvía a crear. Ahora solo se borran al borrar el perfil. Si
  Tessera se cierra a mitad de un borrado, lo termina al volver a abrirse. Y las conexiones de
  bases de datos de un perfil borrado se van en el momento, igual que las SSH, en vez de esperar
  al siguiente arranque.
- **Una conversación nueva sigue siendo nueva al volver de hibernar.** Si abriste una
  conversación nueva o hiciste `/clear` y el agente se hibernó antes de que escribieras nada, al
  volver empieza de cero en vez de reanudar la conversación anterior.
- **Ir a un proyecto de otro perfil despierta solo ese proyecto.** «Abrir con Tessera» y saltar a
  su agente desde el mosaico o las conversaciones despertaban también el que ese perfil tenía
  activo y arrancaban su agente sin que lo pidieras.
- **La consola nueva nace en la base desde la que la abres.** «Nueva consola» sobre una base de
  SQL Server, una base o colección de MongoDB o una base o clave de Redis, y «Abrir consola» desde
  una tabla, colección o clave, abren la consola ya en esa base, y su barra lo dice, en vez de en
  la de la conexión.
- **Detener para de verdad una escritura larga en la consola de MongoDB.** Un `updateMany` o un
  `deleteMany` dejaba de esperarse pero seguía escribiendo en el servidor hasta acabar; ahora se
  detiene allí, y el aviso dice que lo ya escrito se queda. Detener también para un «Cargar más» lento
  de la consola, que antes no se detenía.
- **Una tabla ordenada por una columna que ya no existe deja de atascar la pestaña.** En SQL Server
  el error tapaba la tabla y no había cómo quitar ese orden sin cerrarla; ahora el error sale junto
  al filtro, en todos los motores, con un botón «Quitar el orden».
- **Un filtro o un orden por una columna que ya no existe da error, y señala dónde.** En SQLite el
  filtro salía vacío sin avisar (la columna se leía como un texto); ahora el servidor lo rechaza, y en
  SQLite y SQL Server el error se marca en la condición o en el orden culpable, como ya pasaba en
  PostgreSQL y Oracle.
- **El cierre por inactividad de las consolas también vale para MongoDB y Redis.** El ajuste de
  Configuración solo se aplicaba a las bases SQL; las consolas de MongoDB y Redis se cerraban con el
  plazo de siempre.
- **`use` y `show` en su propia línea, como en mongosh.** En la consola de MongoDB, `use tienda` y
  en la línea siguiente `db.pedidos.find()` ya no dan error: cada uno es su sentencia, sin tener que
  separarlos con `;` o una línea en blanco.
- **Actualizar los agentes espera a que termine la comprobación.** Mientras el panel dice
  «Comprobando…», la acción queda desactivada: antes se podía pulsar con el estado anterior y
  reiniciar una sesión con un borrador sin avisar de que tenía texto sin enviar.
- **En macOS 27, si instalar el cliente de Oracle falla, el error dice la causa** en lugar del
  aviso del sistema de que la herramienta de imágenes de disco está obsoleta.
- **La ayuda de una conexión SQLite vuelve a avisar del bloqueo.** Junto a «Solo lectura para los
  agentes» dice otra vez que, mientras una transacción esté abierta, las demás aplicaciones que usan
  el archivo pueden no poder escribir en él.
- **Una base SQLite en una carpeta sin escritura se abre en solo lectura y lo dice.** El
  explorador ya no ofrece editarla ni el modo Manual para luego fallar: la consola y la rejilla
  explican que es la carpeta y cómo editarla. Si la base tiene cambios sin consolidar en su
  «-wal», o si la escritura falla al crear su diario, el error dice lo mismo en vez de un
  «unable to open database file» (en Mac, «attempt to write a readonly database»).
- **El filtro y el orden ya no ofrecen lo que el servidor rechaza.** En columnas `text`, `ntext` o
  `xml` de SQL Server y `xml` de PostgreSQL el filtro guiado ya no ofrece «=» ni «≠» (siguen
  «contiene», «empieza por» y «está vacío»), y esas columnas, los LOB, `XMLTYPE` y `LONG` de Oracle,
  `image` y los tipos espaciales de SQL Server y `json` y los geométricos de PostgreSQL no se ordenan
  desde la cabecera. Antes las dos cosas acababan en un error.

## [0.76.1] - 2026-10-07

- **La terminal a pantalla completa se queda así al volver de otro perfil.** Cada perfil recuerda
  si tenía la terminal maximizada, así que mirar otro perfil y volver ya no obliga a maximizarla
  de nuevo.
- **Sin terminales, el agente ocupa el sitio.** Con la terminal a pantalla completa y el agente
  al lado, cerrar todas las terminales ya no deja un hueco con «No hay terminales»: la columna se
  queda en su cabecera y en la lista de conexiones, y el agente ocupa el resto.
- **El agente ya no pide aceptar otra vez una huella ya aceptada.** Si aceptas la huella de un
  equipo después de arrancar el agente, el agente comprueba el estado actual de las conexiones
  antes de decir que a una le falta algo.

## [0.76.0] - 2026-10-06

- **Cambios con varios repositorios, rediseñado.** Solo salen los repositorios que tienen
  cambios; los que están al día no ocupan la lista (con más de 50 repositorios en la carpeta se
  siguen enseñando todos). Cada repositorio lleva una casilla para marcar todos sus archivos, su
  nombre sin negrita y, a la derecha y en gris, el número de cambios y la rama. Los archivos
  cuelgan de su repositorio con la carpeta contada desde él, y el encabezado «Cambios» ya no se
  repite cuando es la única sección: sus botones de lote pasan a la cabecera del repositorio.
  En una columna estrecha, los botones de lote se quedan en su icono.
- **Un repositorio enlazado ya no sale dos veces.** Si dentro de la carpeta abierta hay un
  enlace a un repositorio de la misma carpeta, Cambios lo enseña una sola vez, por su carpeta
  real.

## [0.75.0] - 2026-10-06

- **Repositorios anidados en la vista de Git.** Una carpeta que no es un repositorio y agrupa
  varios en subcarpetas (por área, por capa: `mensajeria/back/…`, `mensajeria/front/…`)
  enseña ahora todos los que están hasta cuatro niveles por debajo, cada uno con sus cambios
  e historial; preparar, descartar y hacer commit van al repositorio de cada archivo. No se
  busca dentro de un repositorio ya encontrado, ni en dependencias, compilados o carpetas
  ocultas.
- **Los agentes saben qué es `tdb` aunque no haya bases montadas.** Todo agente que lanza
  Tessera recibe un aviso corto de que `tdb` es el CLI de bases de datos; si le pides algo de
  una base, mira las que hay con `tdb ls` o te pide que la montes.
- **Seguridad**: un enlace dentro de la carpeta abierta ya no deja que Git opere, ni descarte
  archivos, en un repositorio de fuera de ella.

## [0.74.0] - 2026-10-06

- **Conexiones SSH en la terminal.** Cada espacio de trabajo guarda sus conexiones SSH con
  nombre y en grupos, y se abren en pestañas de la terminal que se ven en todos sus proyectos,
  también sin proyecto abierto. Se entra con contraseña, con un archivo de clave (`.pem` u
  OpenSSH, guardado como copia protegida sin tocar el original) o con las claves del sistema.
  La contraseña y la frase de la clave se guardan cifradas y se dan solas al conectar.
  «Probar» comprueba la conexión, y se puede olvidar la huella guardada de un servidor.
- **Importar desde OpenSSH.** El formulario de nueva conexión lee tu `~/.ssh/config` (o el
  archivo que elijas): con un solo `Host` rellena el formulario, y con varios abre una
  revisión para elegir cuáles importar, cambiarles el nombre, el usuario y el grupo, y dejar
  la contraseña o la clave de cada una lista para conectar.
- **Explorador SFTP.** Cada conexión abre un explorador de archivos en una pestaña de la
  terminal: navegar, crear carpetas, renombrar, borrar, y subir y bajar archivos y carpetas
  con progreso, cancelación y confirmación antes de reemplazar. Se puede soltar archivos sobre
  la lista o sobre una carpeta.
- **Terminal a pantalla completa.** Con un botón o con Ctrl+Shift+Enter (⇧⌘↩) la terminal
  ocupa todo el área de trabajo; abrir un archivo o elegir una vista lateral la devuelve a la
  franja. A pantalla completa, las conexiones SSH quedan fijas en un riel plegable a la
  izquierda.
- **Agente de la terminal.** A pantalla completa, a la derecha de la terminal hay un agente
  propio del espacio de trabajo, con su carpeta y su historial, para pedir ayuda con tus
  servidores sin abrir un proyecto. Salir de pantalla completa lo oculta sin cerrarlo.
- **`tssh` para los agentes.** El agente de cualquier proyecto, nativo o Docker, y el agente
  de la terminal usan las conexiones SSH del espacio de trabajo con `tssh`: listar, ejecutar
  comandos y copiar archivos, sin ver nunca la contraseña ni la clave y solo en servidores
  cuya huella ya aceptaste. La casilla «Disponible para los agentes» decide qué conexiones ven.
- **Codex recibe el aviso de bases de datos y de SSH** al arrancar, como Claude Code, y sabe
  salir de su sandbox para usar `tdb` y `tssh`.
- **Cabecera de la terminal**: el «+» abre una terminal al instante y la ▾ abre la lista de
  conexiones, con las recientes arriba. Los botones de la derecha son maximizar, reiniciar y
  ocultar, los tres como iconos con su nombre al pasar el ratón.
- **Seguridad**: lo que se teclea en una terminal deja de quedar escrito en la consola de la
  app.
- Arreglos:
  - Un Esc en un diálogo abierto encima de otro cierra solo ese.
  - Borrar un perfil y recrearlo enseguida con el mismo nombre ya no puede tocar las carpetas,
    las sesiones ni las conexiones del nuevo; las carpetas de los agentes de un perfil borrado
    van a la papelera.
  - En «Buscar en archivos», con la lista de carpetas abierta, las flechas e Intro eligen
    carpeta.
  - MongoDB: cambiar a `srv` o las opciones de la URI corta la contraseña emitida para el
    destino anterior.
  - Oracle: «Ver DDL» funciona contra una 11.2.0.4 con el cliente 23 (el de Mac).

## [0.73.0] - 2026-10-04

- **Vista de Git a pantalla completa.** Un botón en la cabecera de la vista de Git la extiende
  a todo el área de trabajo, tapando el explorador, el editor y el agente sin cerrarlos. Un
  botón fijo la devuelve a la franja inferior tal como estaba. Abrir un archivo o saltar al
  fuente desde ella vuelve a la franja y lo enseña en el editor; recorrer los commits no abre
  nada mientras dura la pantalla completa.
- **Apoya el proyecto.** El repositorio tiene botón «Sponsor» y un enlace de PayPal.

## [0.72.0] - 2026-10-04

- **Pie del agente más limpio.** El uso de la cuenta y el contexto de la conversación se ven
  como dos cápsulas separadas: la de la cuenta agrupa sus ventanas (sesión, semanal y la
  semanal propia de un modelo) en tramos, y la del chat lleva el anillo. La semanal de un
  modelo ocupa una sola letra («F» para Fable); su nombre completo sigue en el desplegable.

## [0.71.1] - 2026-10-04

- **El repositorio, en español por defecto.** El README y los documentos del proyecto (la
  guía para contribuir, la política de seguridad, el código de conducta, las plantillas de
  issues y de pull requests, este registro de cambios y los avisos de terceros) pasan a
  español. El README, la guía para contribuir, la política de seguridad y el código de
  conducta enlazan a su versión en inglés con «Read in English».
- Los issues y los pull requests se siguen aceptando en español o en inglés.
- **Descarga directa.** El README enlaza «Descargar para Windows» y «Descargar para Mac», que
  bajan siempre el instalador de la última versión (`Tessera-Setup.exe` y
  `Tessera-mac-arm64.dmg`).

## [0.71.0] - 2026-10-04

Primera versión pública.

Tessera es un IDE de escritorio para Windows y macOS (Apple Silicon) para quien trabaja en
varios proyectos y con varias cuentas de IA.

- **Espacios de trabajo** con su propio color y sus proyectos.
- **Nativo o Docker, por proyecto.** El modo nativo (el de por defecto) corre el agente en tu
  equipo con la cuenta iniciada en él, la misma en todos los espacios de trabajo. El modo
  Docker lo corre en el sandbox propio del espacio de trabajo, viendo solo los proyectos de
  ese espacio, con una cuenta que pertenece al espacio y nunca se comparte con otro.
- **Agentes lado a lado**, con historial de conversaciones, uso de la cuenta, el contexto de
  la conversación actual, un mosaico de hasta seis agentes e hibernación automática de los
  agentes inactivos.
- **Un IDE completo a su alrededor**: editor Monaco y visores de archivos, explorador de
  archivos, Git con grafo del historial y diffs editables, y terminales.
- **Bases de datos**: Oracle, PostgreSQL, SQL Server, MongoDB, Redis y SQLite, con consolas,
  una rejilla de resultados, edición con confirmación y `tdb` para que los agentes consulten
  sin ver nunca una contraseña.
- **Actualizaciones automáticas** desde las Releases de GitHub en las dos plataformas.

Descarga `Tessera-0.71.0-Setup.exe` para Windows 11 (64 bits) o `Tessera-0.71.0-arm64.dmg`
para macOS 12 o posterior en Apple Silicon. Los instaladores no están firmados con un
certificado de pago: el [README](https://github.com/NRVH/tessera#primer-arranque-de-una-app-sin-firma)
explica cómo abrir Tessera la primera vez en cada sistema.
