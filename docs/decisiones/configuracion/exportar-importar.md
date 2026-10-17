# La configuración viaja en un archivo cifrado con una frase (o, si se pide, sin ella) y al importarla se fusiona

- **Estado:** vigente
- **Ámbito:** `src/main/configuracion/`, `src/shared/copiaConfiguracion.ts`, `src/shared/seleccionCopia.ts`, `src/shared/copia-configuracion-ipc.ts`, `src/main/db/copiaConexiones.ts`, `src/main/ssh/controlador/copiaSsh.ts`, `src/renderer/src/features/ajustes/copia/`

## Contexto

Los secretos se guardan con el almacén del sistema (DPAPI, el Llavero, el keyring), atado al equipo
y al usuario: copiar el `userData` a otro equipo deja todas las contraseñas ilegibles. Hace falta
llevar perfiles, conexiones con sus secretos, agentes definidos a mano y ajustes entre equipos de
cualquier sistema.

## Decisión

- **Un archivo `.tessera`:** cabecera legible (versión, fecha, sistema, versión de Tessera y
  parámetros del cifrado) y el contenido entero cifrado con una frase (8 caracteres como mínimo):
  clave con scrypt (N=2^17) y AES-256-GCM, con la cabecera como datos autenticados. Al leer se acotan
  N, r y p, y una versión más nueva se rechaza.
- **Sin frase, solo si se pide:** la frase va de serie; una casilla desmarcada («Exportar sin frase»)
  la quita y dice en rojo que contraseñas y claves quedan legibles para cualquiera que tenga el
  archivo. Entonces `cifrado: null` y el contenido en claro. El main solo lo acepta con la petición
  explícita (`sinFrase`): una frase vacía o corta sigue siendo un error. Quien mueve la configuración
  entre sus propios equipos decide si el riesgo le compensa. Al importar uno así no se pide frase: se
  avisa de que no está cifrado ni protegido contra cambios y hay que pulsar «Continuar». Como
  cualquiera pudo cambiarlo (un agente con sus órdenes, unos ajustes), NADA viene marcado de serie y el
  aviso sigue sobre la lista; lo que se marque pasa por la misma validación que un alta a mano, y lo
  que ya existe no se toca.
- **Exportar:** se eligen perfiles y apartados (SSH, bases, agentes, ajustes). Los secretos se
  descifran con el almacén de este equipo y viajan en claro DENTRO del contenido cifrado; uno que
  aquí no se descifra viaja sin él y se dice. No viaja lo que es del equipo: verificación, driver
  elegido, caché del catálogo, orden.
- **Importar = añadir y fusionar:** los perfiles se emparejan por id (los que faltan se crean); las
  conexiones conservan su id (así siguen valiendo los enlaces de grupo, bastión y túnel) y pasan
  por la misma validación que un alta a mano; una con el id ya presente no se toca. Un grupo SSH
  que ya se llama igual se reutiliza. Las claves SSH se reconocen por su contenido y se protegen
  como una elegida a mano. Primero SSH, luego bases (una base puede ir por túnel).
- **Se elige qué se importa:** tras la frase, una lista de casillas con cada perfil y debajo sus
  conexiones SSH, de bases de datos y agentes; los agentes nativos y los ajustes aparte. Todo viene
  marcado, ajustes incluidos: se desmarca lo que no se quiere, una casilla o todas de una vez (la
  casilla «Todo · N de M», al principio de la lista, con su estado a medias). Lo que ya existe (mismo
  id) sale sin casilla, con una píldora «Ya existe». Un perfil entra si se marca él o algo suyo. Solo se importa lo marcado.
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
- **Lo que depende del equipo se importa y se marca para revisar:** la carpeta `.ssh` de un perfil
  y el archivo de una base SQLite que no existen aquí. Los agentes Docker con órdenes de instalación
  aplican la capa de su perfil al importar.

## Consecuencias

- Importar dos veces el mismo archivo no duplica nada.
- La frase no se guarda en ningún sitio: perderla es perder el archivo.
- Un archivo sin frase es tan sensible como las contraseñas que lleva, y no se puede saber si alguien
  lo cambió: la responsabilidad de guardarlo y borrarlo es de quien lo exportó.
- Una versión anterior de Tessera rechaza un archivo sin frase (no reconoce `cifrado: null`).

## Descartes

- **Copiar los secretos cifrados con el almacén del sistema:** en otro equipo no se descifran.
- **Reemplazar todo al importar:** borra lo que el usuario ya tenía en el equipo nuevo.
- **Sin frase, quitando los secretos:** más seguro, pero obliga a reescribir cada contraseña en el
  otro equipo, que es justo la molestia que quien exporta sin frase quiere evitar.
- **Importar una conexión sin lo que necesita:** quedaría una base sin su túnel o una SSH sin su
  bastión, que no funcionan y que la validación del alta ya rechaza.
- **Los ajustes desmarcados de serie:** quien exporta sus preferencias es para llevárselas; dejarlas
  fuera de serie obligaba a buscarlas al final de la lista. La casilla dice que sustituyen las de
  este equipo.
