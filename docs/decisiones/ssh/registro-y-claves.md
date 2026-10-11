# Las conexiones SSH tienen su propio registro, con grupos de un nivel, y lo que no se entiende no se toca

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/` (`ConexionesSsh.ts`, `registroSsh.ts`, `conservarAlEditarSsh.ts`, `validacionSsh.ts`,
  `mensajesRegistroSsh.ts`, `copiaIlegibleSsh.ts`, `configOpenSsh.ts`, `exportarOpenSsh.ts`,
  `controlador/archivosOpenSsh.ts`, `ipc.ts`, `componer.ts`) y `src/shared/ssh-ipc.ts`

## Contexto

Las conexiones SSH son del perfil, como las de BD, y varias versiones de Tessera van a escribir el mismo archivo.
El registro de BD ya pagó lo que cuesta reescribir sin mirar (conexiones borradas, versión bajada, ediciones a
mano perdidas), pero no se puede generalizar: `tdb` copia sus textos y `test-shim` fija su salida.

## Decisión

- Archivo propio, `userData/ssh-connections.json` (con `.bak` e `.ilegible`), con dos listas: `grupos` y
  `conexiones`. Calca las reglas del de BD sin compartir su código: se lee una vez al arrancar; lo que no se
  entiende (una forma desconocida, un id repetido, una clave o un valor que esta versión no gobierna) se conserva
  en su sitio; un formato que no se sabe escribir bloquea las escrituras; cada escritura es una copia que solo se
  adopta si persiste; un archivo cambiado por fuera no se pisa; ningún error lleva rutas del host.
- El id nombra archivos (`ssh/huellas/<id>`, `ssh/claves/<id>`): solo `[A-Za-z0-9_-]` y único sin distinguir
  mayúsculas. Una entrada con otro id es ajena.
- Grupos de un nivel. Alias y nombre de grupo, únicos en el perfil sin distinguir mayúsculas (con las ajenas); el
  alias no lleva «:», que los agentes pondrán delante de una ruta. Borrar un grupo manda sus conexiones conocidas a
  «Sin grupo»; uno desconocido se enseña como «Sin grupo», sin reescribir el disco ni perderlo al editar.
- Host y usuario acaban en la línea de `ssh`: se rechazan el `-` inicial, los espacios, `%` y `${`; en el host,
  además, `@`, `/`, los corchetes y un `:puerto`. Se vuelven a mirar al abrir: el archivo se edita a mano.
- `disponibleAgentes`: solo `true` cuenta, se escribe siempre explícito y vale `true` en un alta.
- Los ARCHIVOS de una conexión se borran solo al borrarla a ella o a su perfil, y si ninguna otra entrada cita su id.
  Al arrancar se podan solo ENTRADAS de perfiles que no existen: si se resembraran, se perdería una clave importada.
- Al renderer no llega ni un secreto ni una ruta: de la clave, su nombre; del `known_hosts`, las huellas.
- Editar host, puerto o usuario descarta la contraseña guardada (iría a otra máquina); la frase de una clave se queda.

## Claves

- El archivo de clave se importa como una copia protegida en `ssh/claves/<id>`: ver `claves-importadas.md`. Con el mismo
  método, una clave nueva del formulario gana a la guardada; sin una nueva, se conserva.

## Importar desde OpenSSH

- «Importar desde OpenSSH…» (enlace en la cabecera del formulario de alta, solo con el formulario vacío, y cabecera del riel; no en el
  lanzador, que es para conectarse) abre el diálogo en el MAIN (`~/.ssh/config` si
  existe) y da de alta en «Sin grupo» cada `Host` de UN nombre concreto, con su nombre como alias: `HostName` (o el
  nombre), `Port` (22), `User` y el primer `IdentityFile`. El primer valor de cada directiva gana, como en OpenSSH.
- Sin `User`, el bloque se salta. Usar el usuario local, como haría `ssh`, metería en el registro un nombre que en
  Windows puede ser de dominio o llevar espacios y que la validación rechaza; saltarlo y contarlo es predecible.
- El `IdentityFile` entra por el mismo camino que el formulario (copia protegida y `ssh-keygen`); si no es una clave
  válida, la conexión entra con «Claves del sistema» y se avisa. Nunca contraseñas.
- No se importan: los `Host` con comodines, negación o varios patrones, los `Match`, lo de antes del primer `Host`,
  el resto de directivas (`ProxyJump`, `LocalForward`…) ni los `Include`, que no se siguen. Un alias que ya existe se
  salta. Todo se cuenta por motivo en un aviso.
- Con varios `Host`, una revisión antes del alta: cada fila con su casilla, nombre, usuario, credencial y GRUPO (todas
  nacen en «Sin grupo»). Cualquier reparto vale sin salir del diálogo: cada selector ofrece «Nuevo grupo…», que crea el
  grupo y lo pone en esa fila, y «Poner las marcadas en el grupo» es el atajo para el caso de casi todas al mismo
  (enseña «Varios grupos» si no lo comparten). Una fila desmarcada queda bloqueada (solo se puede marcar) y el atajo
  no la toca: editar lo que no se va a importar haría creer que se guarda. Un grupo borrado mientras se revisa cae a «Sin grupo» en vez de fallar el alta,
  y el aviso final cuenta el reparto.
- Esos selectores llevan `<button>` con `<selectedcontent>` dentro (la salida que deja «select-con-lista-propia»): un
  nombre de grupo largo se recorta con «…» y la flecha sigue a la vista. La fila se recoloca por el ancho de la lista
  (consulta de contenedor), no de la ventana, porque el zoom y la densidad lo cambian sin cambiar la ventana.
- Descartado: seleccionar varias filas (Mayús/Ctrl+clic) para darles un grupo. Competiría con la casilla de importar y
  el selector por fila más el atajo ya cubren cualquier reparto.

## Exportar a OpenSSH

- «Exportar a OpenSSH…» (cabecera del riel: todas las del perfil; menú de varias marcadas: esas) es el camino de
  vuelta de importar: un `config` que «Importar desde OpenSSH…» lee igual. El diálogo de guardar y la escritura
  están en el MAIN; al renderer vuelven nombres y cuentas, nunca rutas.
- Un bloque `Host` por conexión, por grupos (comentario `# Grupo:`), con `HostName`, `User`, `Port` si no es el 22,
  `ProxyJump` y los túneles como los abre la pestaña (los locales y el SOCKS en 127.0.0.1). Los bastiones de una
  conexión exportada entran aunque no se marcaran: sin ellos el `ProxyJump` no llevaría a ningún sitio.
- El nombre del `Host` es el alias con lo que OpenSSH leería como patrón o como otro argumento (espacios,
  comodines, comas, comillas) cambiado por `-`, y único sin distinguir mayúsculas, como compara OpenSSH; si cambia,
  el alias va en un comentario encima.
- Contraseñas y frases, nunca: OpenSSH no tiene dónde guardarlas, y escribirlas en claro en un archivo de texto
  sería peor que teclearlas. El aviso final cuenta cuántas se pedirán.
- Las claves: la copia protegida se copia a una carpeta NUEVA `<archivo>-claves` (o `-claves-2`…: una que ya
  existe no se toca) y el `IdentityFile` la apunta con `~/` si está bajo el home (barras normales y `%` doblado),
  más `IdentitiesOnly yes`, como en la línea de la pestaña. La carpeta, las claves y el `config` nacen solo para el
  usuario con los mismos permisos que las copias de Tessera: el ssh del sistema rechaza una clave, o un `config`,
  con permisos de más. El `config` se escribe en un temporal y se renombra encima del elegido; si algo falla, la
  carpeta recién creada se borra.
- Se propone `config-tessera` en `~/.ssh`: al lado del `config` del usuario sin pisarlo, y un `Include` de ese
  nombre basta para usarlo.

## Descartes

- Guardar las conexiones SSH en el registro de BD: mezclaría dos formatos que `tdb` lee a su manera.
- Generalizar el registro de BD para los dos: cambiaría textos que `tdb` copia y salidas que fijan sus pruebas.
- Aplicar a cada `Host` concreto los valores de los `Host *` y de lo global: es la semántica completa de OpenSSH,
  pero nadie la pidió y un `Host *` con `User` metería ese usuario en conexiones que no lo declaran.
