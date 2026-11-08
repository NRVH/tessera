# La configuración viaja en un archivo cifrado con una frase (o, si se pide, sin ella) y al importarla se fusiona

- **Estado:** vigente
- **Ámbito:** `src/main/configuracion/`, `src/shared/copiaConfiguracion.ts`, `src/shared/seleccionCopia.ts`, `src/shared/destinoCopia.ts`, `src/shared/copia-configuracion-ipc.ts`, `src/shared/elementosCopia.ts`, `src/shared/sustitucionesCopia.ts`, `src/main/db/copiaConexiones.ts`, `src/main/ssh/controlador/copiaSsh.ts`, `src/main/agents/configAgente/copiaConfigCompartida.ts`, `src/main/agents/configAgente/copiaArchivosAgentes.ts`, `src/renderer/src/features/ajustes/copia/`

## Contexto

Los secretos se guardan con el almacén del sistema (DPAPI, el Llavero, el keyring), atado al equipo
y al usuario: copiar el `userData` a otro equipo deja todas las contraseñas ilegibles. Hace falta
llevar perfiles, conexiones con sus secretos, agentes definidos a mano y ajustes entre equipos de
cualquier sistema.

## Decisión

- **Un archivo `.tessera`:** cabecera legible (versión, fecha, sistema, versión de Tessera y
  parámetros del cifrado) y el contenido entero cifrado con una frase (8 caracteres como mínimo):
  clave con scrypt (N=2^17) y AES-256-GCM, con la cabecera como datos autenticados. Al leer se acotan
  N, r y p, y una versión más nueva se rechaza. Sin historial el archivo es de la versión 1; con el
  historial de conversaciones, de la 2, que lo añade en trozos detrás del contenido y se sigue leyendo
  junto con la 1 ([historial-en-la-copia.md](historial-en-la-copia.md)). Al abrir, antes de cargar
  nada se mira que el archivo empiece como una copia; el archivo entero de la 1 y la primera línea de
  la 2 (la cabecera con el contenido) tienen el mismo tope, 64 MiB, y pasarlo es «demasiado grande».
  De la 2 solo se guarda, mientras está abierta, el hash de su primera línea.
- **Sin frase, solo si se pide:** la frase va de serie; marcar la casilla «Exportar sin frase»
  la quita y dice en rojo que contraseñas y claves quedan legibles para cualquiera que tenga el
  archivo. Entonces `cifrado: null` y el contenido en claro. El main solo lo acepta con la petición
  explícita (`sinFrase`): una frase vacía o corta sigue siendo un error. Quien mueve la configuración
  entre sus propios equipos decide si el riesgo le compensa. Al importar uno así no se pide frase: se
  avisa de que no está cifrado ni protegido contra cambios y hay que pulsar «Continuar». Como
  cualquiera pudo cambiarlo (un agente con sus órdenes, unos ajustes, unas reglas, que son
  instrucciones para los agentes), NADA viene marcado de serie, sustituir unas reglas tampoco, y el
  aviso sigue sobre la lista; lo que se marque pasa por la misma validación que un alta a mano, y lo
  que ya existe no se toca.
- **Exportar:** se eligen perfiles y apartados (SSH, bases, agentes, contexto de los agentes, archivos de las
  cuentas de Docker, reglas de los agentes nativos, ajustes y, desmarcado de serie, el historial de conversaciones). Los secretos se
  descifran con el almacén de este equipo y viajan en claro DENTRO del contenido cifrado; uno que
  aquí no se descifra viaja sin él y se dice. No viaja lo que es del equipo: verificación, driver
  elegido, caché del catálogo, orden.
- **Importar = añadir y fusionar:** cada perfil del archivo va a un destino que se elige en la lista:
  «Perfil nuevo» o «Añadir a «<perfil de aquí>»». De serie, el perfil de aquí con el mismo id; si no,
  el del mismo nombre (sin distinguir mayúsculas ni espacios de los extremos); si no, uno nuevo. Así el
  mismo perfil creado a mano en dos equipos (mismo nombre, otro id) se reúne en vez de duplicarse.
  - **A un perfil de aquí:** ese perfil no cambia de nombre, color ni ajustes; recibe las conexiones,
    los agentes Docker y el historial del perfil del archivo que le falten (la misma regla de «ya
    existe», contra el destino), con el perfil dueño cambiado por el suyo. De las reglas: si el de
    aquí no tiene, se traen (una casilla); si son iguales, nada; si son distintas, se elige «Mantener
    las de aquí» (de serie) o «Sustituir por las del archivo», con el mismo diff que la revisión de
    una propuesta de reglas. La carpeta `.ssh` del perfil del archivo no se trae ni se revisa.
  - **El id de un perfil nombra carpetas** (sus capas de configuración, el buzón del puente, sus cuentas): uno con
    separadores de ruta, «..» o caracteres de control no tiene forma válida y no se importa.
  - **A un perfil nuevo:** se crea con su id; si ese id ya lo usa un perfil de aquí, con uno libre
    (`<id>-2`…) y las carpetas de sus agentes bajo el id nuevo, para no compartir las del otro.
  - Las conexiones conservan su id (así siguen valiendo los enlaces de grupo, bastión y túnel) y
    pasan por la misma validación que un alta a mano; una con el id ya presente no se toca. Un grupo
    SSH que ya se llama igual en el perfil de destino se reutiliza. Las claves SSH se reconocen por su
    contenido y se protegen como una elegida a mano. Primero SSH, luego bases (una base puede ir por
    túnel). El renderer decide los destinos y crea los perfiles; el main reasigna a cada conexión,
    grupo e historial el id de su destino antes de darlos de alta.
- **Se elige qué se importa:** tras la frase, una lista de casillas con cada perfil (y su destino) y
  debajo sus reglas, conexiones SSH, de bases de datos, agentes, archivos de cuentas e historial por cuenta; los agentes
  nativos, el historial nativo y los ajustes aparte. Todo viene
  marcado, ajustes incluidos (salvo lo que sustituye algo de aquí y las reglas nativas): se desmarca lo que no se quiere, una casilla o todas de una vez (la
  casilla «Todo · N de M», al principio de la lista, con su estado a medias). Lo que ya existe (mismo
  id) sale sin casilla, con una píldora «Ya existe». Un perfil entra si se marca él o algo suyo, o si
  se eligió sustituir sus reglas. Cambiar el destino rehace lo que ya existe y marca lo del perfil
  como de serie. Solo se importa lo marcado.
- **Las dependencias no se rompen:** una SSH que salta por un bastión y una base que va por el túnel
  de una SSH necesitan la otra. Marcar una marca también lo que necesita, y desmarcar lo necesario
  desmarca lo que depende de ello; las dos cosas se avisan en la lista. Si aun así llega una
  selección incompleta, el main importa exactamente lo elegido y la validación de siempre salta la
  que no tiene su bastión o su túnel, con su motivo. El grupo SSH viaja con sus conexiones: solo
  entran los grupos de las conexiones elegidas (y los vacíos del archivo, con su perfil).
- **Los secretos no cruzan al renderer:** el main guarda lo descifrado hasta dar de alta las
  conexiones; al renderer solo llegan perfiles, agentes y ajustes, que fusiona él (es su dueño), y
  de las conexiones lo justo para elegirlas: id, nombre, grupo, de cuál dependen y si ya están aquí.
- **Ajustes:** solo preferencias de uso. Fuera los tamaños de los paneles, lo que cuelga de un
  proyecto o una ruta, el estado de la vista por perfil y lo que instala algo en el sistema.
- **El contexto global de los agentes** viaja en su propio apartado, con sus reglas y su configuración de Docker, junto
  con la configuración de Docker de cada perfil elegido ([contexto-de-los-agentes.md](../agentes/contexto-de-los-agentes.md));
  las reglas de cada perfil van con el perfil. Solo viaja lo que tiene contenido. No viajan las carpetas de
  documentos (rutas de este equipo), las sesiones iniciadas ni las propuestas pendientes. Al importar, la configuración
  de cada perfil cuelga de él y el global va aparte. Frente a la del destino: si allí no hay, se trae y viene marcada; si es igual, «Igual», sin casilla; si es
  distinta, se puede marcar y la casilla dice que la sustituye, pero no la marcan ni la selección de serie, ni la
  casilla del perfil, ni cambiar el destino (que además la desmarca), porque la global cambia los agentes de todos
  los perfiles. «Todo» sí la marca. Sustituir deja la configuración como la del archivo, con la sintaxis comprobada y la
  versión anterior a salvo, sin tocar las carpetas de documentos de este equipo. Las reglas globales no tienen versión
  anterior: solo se sustituyen si el archivo trae unas, y la casilla avisa de que entonces las de aquí no se recuperan; si un archivo no se puede escribir,
  se avisa para revisarlo. Puede llevar tokens de servidores MCP o variables de entorno, así que el aviso
  de exportar sin frase también la nombra. El renderer recibe solo el estado de cada capa, no su contenido.
- **Los archivos que el usuario escribe a sus agentes viajan por archivo:** de cada cuenta de Docker de los perfiles
  exportados, los dos archivos que escribe el usuario (`CLAUDE.md` y `settings.json`, o `AGENTS.md` y `config.toml`), y
  de los agentes nativos solo las instrucciones (`CLAUDE.md`, `AGENTS.md`): su configuración técnica guarda rutas de
  ese equipo. Ninguna ruta absoluta viaja, y el destino de los nativos lo resuelve cada equipo con lo que ya los
  localiza. Tampoco viaja nada más de la carpeta de una cuenta, credenciales y estado del CLI incluidos, y el bloque
  que Tessera escribe en las instrucciones se quita al exportar y al comparar, porque es de cada equipo y se rehace
  al abrir cada sesión.
  - **Una cuenta de Docker no es de fiar:** la carpeta se monta con escritura en su contenedor, así que se lee y se escribe sin
    seguir enlaces, con el tope de tamaño y la sintaxis comprobada del editor ([configuracion-editable.md](../agentes/configuracion-editable.md));
    un archivo bloqueado se dice, no se sigue. Al leer el archivo, lo que no tiene forma, excede el tope o no pasa la sintaxis
    no se escribe y se dice. El id de una cuenta o un perfil se valida como el de un perfil: sin separadores, «..» ni
    caracteres de control.
  - **Frente a este equipo:** si aquí falta, casilla marcada de serie en las cuentas y sin marcar en los nativos; si es igual, «Igual», sin
    casilla (los finales de línea y el bloque de Tessera no cuentan); si es distinto, una elección que de serie mantiene
    el de aquí, con el mismo diff de las reglas. El contenido de los archivos no cruza al renderer salvo el de un archivo
    distinto al pedir ver sus diferencias. Lo que cambió aquí desde la lista no se pisa sin haber elegido sustituirlo.
  - **Qué cuenta le corresponde en el destino:** la predeterminada con la predeterminada; las demás por su id, por si
    aquí se renombró, y si no por el nombre, porque la misma cuenta creada en otro equipo tiene otro id. La cuenta que no
    existe aquí se elige para crearla, sin sesión; sin marcarla no se ofrecen sus archivos ni se escriben. Lo de un perfil
    que no se importa no se escribe en ninguna cuenta.
  - **Las reglas nativas no vienen marcadas de serie**, ni con la casilla de un perfil, porque cambian lo que hacen los
    agentes de todo el equipo; «Todo» sí las marca, como el contexto global, porque es un gesto explícito sobre toda la lista.
  - **Sin cambio de versión del archivo:** lo que no se conoce se ignora al leerlo y el apartado es opcional, de modo que
    una versión anterior de Tessera lee un archivo nuevo sin él y una nueva lee uno antiguo. Cambiar la versión
    obligaría a rechazar archivos que se leen bien.
- **Antes de escribir, si la importación sustituye algo que ya existe**, un aviso (`Modal` con `severidad="advertencia"`, el foco en
  «Volver a la lista», que conserva la selección) lista cada cosa con qué es y dónde: reglas de un perfil, configuración de Docker,
  contexto global, archivos de cuentas y reglas nativas. Los ajustes no entran: su casilla ya dice que los sustituye.
  Tessera guarda la versión anterior de los archivos (`.tessera-anterior`, también en los nativos y las capas de
  Docker); las reglas del perfil y las globales no tienen versión anterior, y el aviso lo dice en cada una. Si solo se crean
  archivos, no hay aviso, y el resultado enumera lo creado y lo sustituido.
- **Lo que depende del equipo se importa y se marca para revisar:** la carpeta `.ssh` de un perfil
  y el archivo de una base SQLite que no existen aquí. Los agentes Docker con órdenes de instalación
  aplican la capa de imagen de su perfil al importar.

## Consecuencias

- Importar dos veces el mismo archivo no duplica nada, salvo si se elige «Perfil nuevo» para un perfil
  que ya entró: entonces se crea otro, vacío de lo que ya existe (las conexiones con el mismo id no se
  repiten).
- Dos perfiles del archivo pueden ir al mismo perfil de aquí; si los dos traen o sustituyen las reglas,
  quedan las del primero de la lista, el que se ve arriba: ninguno pisa al otro en silencio.
- Lo fijan `test:destino-copia` (destino de serie, reglas, ids y agentes reasignados),
  `test:copia-configuracion` (la selección), `test:copia-conexiones` (las conexiones en el perfil de
  destino), `test:config-compartida` (qué capas y archivos de agentes viajan, cómo se comparan y cómo se escriben,
  enlaces incluidos), `test:destino-copia` (qué cuenta de aquí corresponde a una del archivo) y
  `e2e/copia-configuracion.spec.ts`.
- La frase no se guarda en ningún sitio: perderla es perder el archivo.
- Un archivo sin frase es tan sensible como las contraseñas que lleva, y no se puede saber si alguien
  lo cambió: la responsabilidad de guardarlo y borrarlo es de quien lo exportó.
- Una versión anterior de Tessera rechaza un archivo sin frase (no reconoce `cifrado: null`).

## Descartes

- **Copiar los secretos cifrados con el almacén del sistema:** en otro equipo no se descifran.
- **Reemplazar todo al importar:** borra lo que el usuario ya tenía en el equipo nuevo.
- **Emparejar los perfiles solo por id:** el mismo perfil creado a mano en dos equipos tiene ids
  distintos, y lo importado iría a un perfil duplicado en vez de al que el usuario ya usa.
- **Que el perfil de aquí tome nombre y color del archivo:** cambiaría lo que el usuario ya reconoce
  en este equipo; de un perfil existente solo cambian las reglas, y solo si se elige.
- **Sin frase, quitando los secretos:** más seguro, pero obliga a reescribir cada contraseña en el
  otro equipo, que es justo la molestia que quien exporta sin frase quiere evitar.
- **Importar una conexión sin lo que necesita:** quedaría una base sin su túnel o una SSH sin su
  bastión, que no funcionan y que la validación del alta ya rechaza.
- **Los ajustes desmarcados de serie:** quien exporta sus preferencias es para llevárselas; dejarlas
  fuera de serie obligaba a buscarlas al final de la lista. La casilla dice que sustituyen las de
  este equipo.
- **Llevar toda la carpeta de una cuenta:** arrastra credenciales y estado del CLI que no sirven en otro equipo.
- **La configuración técnica de los nativos:** guarda rutas de ese equipo; lo que viaja es lo que el usuario escribe
  para el agente, no cómo está instalado.
- **Pasar al renderer el contenido de todos los archivos para comparar:** puede llevar tokens; basta con su estado, y las
  dos versiones cruzan solo si se piden en un archivo distinto.
