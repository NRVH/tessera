# Registro de cambios

Todos los cambios relevantes de Tessera se documentan en este archivo. El formato se basa en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/), y Tessera sigue el
[versionado semántico](https://semver.org/lang/es/).

Cada versión agrupa sus cambios en secciones, en este orden y solo las que tengan algo: Novedades,
Interfaz, Rendimiento y estabilidad, Instalación y actualizaciones, Correcciones y Seguridad. Una
sección larga se divide en grupos por área.

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
