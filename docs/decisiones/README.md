# Decisiones de diseño (ADR)

Aquí viven las decisiones de peso de Tessera. El código las cita desde su cabecera
(`Decisiones: docs/decisiones/<dominio>/<tema>.md`) y la guardia `test:cabeceras` comprueba que
la ruta existe. Las reglas generales del código están en
[`../ESTANDAR_CODIGO.md`](../ESTANDAR_CODIGO.md).

## Cuándo una decisión es «de peso»

Cuando revertirla rompería algo que no se ve leyendo el código —un fallo medido, una
plataforma, un dato, la seguridad— o cuando un colaborador sensato la «arreglaría» por error.
Lo demás no se escribe: el porqué de un detalle cabe en una línea junto al código, y la
historia de cómo se llegó a él está en git.

## Dónde

`docs/decisiones/<dominio>/<tema>.md`, sin números (dos personas pueden escribir a la vez sin
chocar). El dominio es el del código (`bd`, `git`, `agentes`, `sandbox`, `editor`,
`calidad`…) y el tema, unas palabras en minúscula separadas por guiones.

## Índice

Una línea por ADR: enlace y la decisión en una frase. Agrupadas por dominio, en orden
alfabético.

### actualizacion

- [actualizacion/cadencia-y-reintentos.md](actualizacion/cadencia-y-reintentos.md) — el feed se
  comprueba con una cadencia por foco y un solo `setTimeout` rearmable, y un fallo de red pasajero
  se reintenta en silencio.
- [actualizacion/ciclo-y-estados.md](actualizacion/ciclo-y-estados.md) — la actualización se
  descarga sin preguntar, se prepara en disco y se aplica al cerrar; todo fallo se ve y nada se
  promete sin motor armado.
- [actualizacion/marcador-y-prevuelos.md](actualizacion/marcador-y-prevuelos.md) — el marcador en
  `userData` es la memoria del ciclo: se sella síncrono tras los pre-vuelos, justo antes de ceder el
  control, y agota dos intentos.
- [actualizacion/relevo-de-macos.md](actualizacion/relevo-de-macos.md) — en macOS la aplica un
  guion `sh` propio, porque Squirrel.Mac no puede con una firma ad-hoc, y el zip se baja y verifica
  aquí.
- [actualizacion/relevo-de-windows.md](actualizacion/relevo-de-windows.md) — en Windows la aplica
  un relevo: una copia de la app fuera de la carpeta de instalación que supervisa al instalador y
  cuenta cómo acabó.

### agentes

- [agentes/actualizacion-nativa.md](agentes/actualizacion-nativa.md) — la actualización de los
  agentes nativos la orquesta el renderer en tres fases con la API de cada pane, localizado por su
  sesión del momento y no por la clave del target.
- [agentes/agente-diferido.md](agentes/agente-diferido.md) — un proyecto que nace para ver un
  archivo desde el sistema nace con el agente sin arrancar y su columna plegada, hasta que se pide.
- [agentes/boton-agentes-nativos.md](agentes/boton-agentes-nativos.md) — el botón de los agentes
  nativos nunca se deshabilita (se deshabilita la acción de dentro, con su motivo) y su resultado
  es pegajoso.
- [agentes/columna-del-agente.md](agentes/columna-del-agente.md) — la columna monta un pane vivo
  por target abierto de todos los perfiles y el mosaico no cambia la forma del árbol.
- [agentes/contexto-ancla-de-conversacion.md](agentes/contexto-ancla-de-conversacion.md) — el
  chat vivo se ancla al que Tessera abrió y a los envíos del usuario, en vez de adivinarse por el
  último evento.
- [agentes/contexto-de-la-conversacion.md](agentes/contexto-de-la-conversacion.md) — el anillo
  mide el chat vivo elegido por el ancla, por la cola del transcript, sin retroceder y con la
  ventana estimada.
- [agentes/conversaciones-cabeza-por-lineas.md](agentes/conversaciones-cabeza-por-lineas.md) — la
  cabeza del transcript se lee por líneas: una línea gigante (una imagen pegada) se compacta o se
  salta, y no descarta la conversación.
- [agentes/conversaciones-criba-por-carpeta.md](agentes/conversaciones-criba-por-carpeta.md) — el
  historial se criba por el nombre de la carpeta de Claude Code y el filtro exacto sigue
  decidiendo por ruta.
- [agentes/conversaciones-nombres-propios.md](agentes/conversaciones-nombres-propios.md) — los
  nombres propios de las conversaciones viven en un JSON de Tessera, una sola instancia, y nunca
  se escriben en el transcript.
- [agentes/cuentas-una-por-perfil-y-agente.md](agentes/cuentas-una-por-perfil-y-agente.md) — una
  cuenta de agente por (perfil, agente), privada del perfil, y solo metadatos en el registro.
- [agentes/hibernacion-por-inactividad.md](agentes/hibernacion-por-inactividad.md) — el agente de
  un proyecto nativo fuera de pantalla se cierra solo tras N minutos sin E/S, matando su árbol sin
  teclear nada, con vetos (trabajando, segundo plano, sin revisar…) y un estado propio en el renderer.
- [agentes/nativos-actualizacion-del-host.md](agentes/nativos-actualizacion-del-host.md) — la
  versión instalada la dice el binario, la última su canal y su método, y un candado retiene las
  aperturas.
- [agentes/nativos-bloqueadores-windows.md](agentes/nativos-bloqueadores-windows.md) — antes de
  reinstalar un CLI en Windows se avisa de quién tiene abierta su carpeta, por raíces y sin
  contar a Tessera.
- [agentes/nativos-ejecucion-en-shell.md](agentes/nativos-ejecucion-en-shell.md) — las sondas y
  órdenes de los agentes nativos van por la shell de las sesiones, con tope propio y muerte del
  árbol.
- [agentes/nativos-orden-por-metodo.md](agentes/nativos-orden-por-metodo.md) — la orden de
  actualización sale de la tabla método × plataforma, y en Windows Codex nunca se actualiza a sí
  mismo.
- [agentes/pane-del-agente-sin-re-render.md](agentes/pane-del-agente-sin-re-render.md) — el pane
  del agente va memoizado y la columna le pasa props de identidad estable, para que la ventana no
  repinte los panes de todos los perfiles.
- [agentes/sesion-del-agente-en-el-main.md](agentes/sesion-del-agente-en-el-main.md) — la sesión
  del agente toma el refcount de su credencial antes de tocar Docker y nunca para el contenedor.
- [agentes/sesion-linea-de-arranque.md](agentes/sesion-linea-de-arranque.md) — la línea de
  arranque del agente es una función pura que entrecomilla el briefing según la shell que la
  recibe.
- [agentes/terminal-del-agente.md](agentes/terminal-del-agente.md) — la terminal del agente abre
  su sesión la primera vez que se mira, vive hasta desmontarse y nada envuelve su nodo.
- [agentes/textos-espacio-de-datos.md](agentes/textos-espacio-de-datos.md) — el agente del
  espacio de datos se nombra «el agente de datos» desde una sola función; en un proyecto los
  textos no cambian.
- [agentes/turnos-actividad-del-agente.md](agentes/turnos-actividad-del-agente.md) — el turno lo
  abre el Enter, lo cierra el transcript y el pty solo dice «trabajando».
- [agentes/turnos-marcas-del-transcript.md](agentes/turnos-marcas-del-transcript.md) — el fin de
  turno se lee del transcript por orden, sin marca no se inventa y los subagentes no cuentan.
- [agentes/uso-de-cuenta.md](agentes/uso-de-cuenta.md) — el uso de cuenta se cachea con suelo de
  red y backoff, y una ventana vencida se pone a 0 % marcada.
- [agentes/uso-ventanas-de-la-cuenta.md](agentes/uso-ventanas-de-la-cuenta.md) — el pie del agente
  enseña las ventanas de uso que trae la cuenta (dos semanales si las tiene), sin dar ninguna por
  supuesta, y una escalera de anchos decide cuáles ceden.
- [agentes/uso-token-de-claude-en-mac.md](agentes/uso-token-de-claude-en-mac.md) — el token de
  Claude Code sale del llavero solo en macOS y en modo host, y el fallo no es lo mismo que la
  ausencia.

### app

- [app/arranque-relevo-e-instancia-unica.md](app/arranque-relevo-e-instancia-unica.md) — el
  proceso decide al cargar si es el relevo o Tessera, y solo Tessera toma el cerrojo de instancia
  única.
- [app/atajos-y-menu.md](app/atajos-y-menu.md) — sin menú en Windows, el mínimo en macOS, y los
  atajos de ventana por `before-input-event`.
- [app/cierre-ordenado.md](app/cierre-ordenado.md) — todo cierre pasa por un único cierre
  ordenado que pregunta antes, apaga en orden y decide la actualización al final.
- [app/ventana-arranque-y-recuperacion.md](app/ventana-arranque-y-recuperacion.md) — la ventana
  nace maximizada en el monitor principal, se muestra aunque no llegue `ready-to-show` y se
  recupera sola.
- [app/ventana-barra-de-titulo.md](app/ventana-barra-de-titulo.md) — la barra de título la pinta
  el renderer y los botones los pone el sistema, alineados con el zoom.

### bd

- [bd/adaptador-oracle-escalada-y-stop.md](bd/adaptador-oracle-escalada-y-stop.md) — Oracle escala
  de thin a thick por el error del servidor y el Stop en thick va con DISABLE_OOB.
- [bd/adaptador-postgres-arranque-de-sesion.md](bd/adaptador-postgres-arranque-de-sesion.md) — las
  opciones de sesión de PostgreSQL van al constructor del cliente y el oyente de error antes de
  conectar.
- [bd/adaptador-redis-cliente-y-marcas.md](bd/adaptador-redis-cliente-y-marcas.md) — el cliente de
  Redis se configura contra los defectos de ioredis y lo que es lectura lo dicen las marcas.
- [bd/adaptador-redis-solo-lectura-y-texto.md](bd/adaptador-redis-solo-lectura-y-texto.md) — en
  Redis el agente solo lee, con una guardia en dos tiempos, y el texto son comandos de redis-cli.
- [bd/adaptador-sqlite-apertura-y-autorizador.md](bd/adaptador-sqlite-apertura-y-autorizador.md) —
  SQLite se abre solo con su guardia puesta, decidida antes de abrir y con mensajes sin rutas.
- [bd/adaptador-sqlite-guardia-y-sentencias.md](bd/adaptador-sqlite-guardia-y-sentencias.md) — en
  SQLite la guardia es el autorizador y las sentencias de un texto se ejecutan una a una.
- [bd/adaptador-sqlserver-conexion-y-exactos.md](bd/adaptador-sqlserver-conexion-y-exactos.md) — SQL
  Server usa tedious fijado y parcheado para devolver los valores exactos.
- [bd/adaptador-sqlserver-solo-lectura.md](bd/adaptador-sqlserver-solo-lectura.md) — en SQL Server
  el solo lectura lo impone Tessera con tres capas, y el tope de filas cancela la petición.
- [bd/catalogo-ddl.md](bd/catalogo-ddl.md) — «Ver DDL» sale de DBMS_METADATA en Oracle, con
  repliegue a ALL_* y el cuerpo de PL/SQL intacto, y se genera desde el catálogo en el resto.
- [bd/catalogo-motores-oracle.md](bd/catalogo-motores-oracle.md) — el catálogo de Oracle sirve a
  la 11.2: binds con nombre, sin FETCH/OFFSET, y las FK en tres consultas con el hint medido.
- [bd/catalogo-motores-postgres.md](bd/catalogo-motores-postgres.md) — el catálogo de PostgreSQL
  oculta las particiones (y sus FK copiadas) y distingue las rutinas por su firma.
- [bd/catalogo-motores-sqlite.md](bd/catalogo-motores-sqlite.md) — el catálogo de SQLite sale de
  las funciones PRAGMA como tablas, que son lecturas para el autorizador, y solo enseña `main`.
- [bd/catalogo-motores-sqlserver.md](bd/catalogo-motores-sqlserver.md) — SQL Server se lee con
  nombres de tres partes entre corchetes y JOIN a `sys.*`, sin USE, sin STRING_AGG y sin las
  funciones de metadatos.
- [bd/celdas-tipos-de-columna-oracle.md](bd/celdas-tipos-de-columna-oracle.md) — el tipo de una
  columna de Oracle no lleva un tamaño de texto que el driver no sabe dar.
- [bd/celdas-valores-exactos-y-topes.md](bd/celdas-valores-exactos-y-topes.md) — las celdas viajan
  como texto exacto, con topes y las fechas de Oracle desde sus bytes.
- [bd/claves-controlador.md](bd/claves-controlador.md) — la consola de Redis confirma siempre lo
  peligroso, la clave viaja en base64 y la lista de comandos vive una vez, compartida con `tdb`.
- [bd/conexiones-archivos-de-base-de-datos.md](bd/conexiones-archivos-de-base-de-datos.md) — la
  ruta de una base de archivo no sale del main y solo se acepta de la carpeta anclada, resuelta
  también con `realpath`.
- [bd/conexiones-campos-opcionales.md](bd/conexiones-campos-opcionales.md) — un motor guarda solo
  los opcionales que declara, y el registro de Oracle y PostgreSQL no cambia ni un byte.
- [bd/conexiones-edicion-y-ganchos.md](bd/conexiones-edicion-y-ganchos.md) — editar una conexión
  se bloquea antes de tocar el registro si hay una transacción pendiente, y los ganchos no
  deshacen nada.
- [bd/conexiones-humo-de-solo-lectura.md](bd/conexiones-humo-de-solo-lectura.md) — el humo
  contra una base real lleva la solo lectura impuesta y un veto de lista blanca por su cuenta.
- [bd/conexiones-que-sobrevive-al-editar.md](bd/conexiones-que-sobrevive-al-editar.md) — cada
  dato aprendido tiene su regla al editar, y cambiar la dirección no conserva nada no gobernado.
- [bd/conexiones-registro-crash-safe.md](bd/conexiones-registro-crash-safe.md) — el registro no
  toca lo que no entiende, `version` nunca baja y cada escritura es todo o nada.
- [bd/conexiones-tdb-como-subproceso.md](bd/conexiones-tdb-como-subproceso.md) — el main nunca
  carga los drivers: «Probar», el agente y las terminales pasan por `tdb` como subproceso.
- [bd/contratos-ajustes-de-bd.md](bd/contratos-ajustes-de-bd.md) — los ajustes de Bases de datos son
  cuatro, con lista cerrada y saneados en un solo módulo.
- [bd/contratos-claves.md](bd/contratos-claves.md) — el contrato de claves explora con SCAN, mueve
  bytes y confirma lo peligroso.
- [bd/contratos-conexiones.md](bd/contratos-conexiones.md) — el contrato de conexiones no lleva
  secretos hacia el renderer y es una hoja sin imports de valor.
- [bd/contratos-documentos.md](bd/contratos-documentos.md) — el contrato de documentos es aparte del
  SQL y sus valores cruzan como texto del shell.
- [bd/contratos-esquemas-visibles.md](bd/contratos-esquemas-visibles.md) — los esquemas visibles se
  cuentan en un módulo compartido, con el esquema por defecto como parámetro.
- [bd/contratos-explorador-sql.md](bd/contratos-explorador-sql.md) — el contrato del explorador SQL:
  respuestas sin excepciones, una sentencia por invoke y filas opacas.
- [bd/contratos-filtro-guiado.md](bd/contratos-filtro-guiado.md) — el filtro guiado es un contrato
  de estructura: el renderer lo arma y el main lo valida otra vez y lo compila.
- [bd/contratos-formatos-de-filas.md](bd/contratos-formatos-de-filas.md) — «Copiar como» y exportar
  comparten un solo serializador de filas.
- [bd/documentos-controlador.md](bd/documentos-controlador.md) — en MongoDB el main valida la forma
  y decide la política, y el renderer solo ve ids de lector del main.
- [bd/documentos-filtro-guiado.md](bd/documentos-filtro-guiado.md) — el filtro guiado de MongoDB
  se compila a texto del shell con los valores escapados, sin campo nuevo en el protocolo.
- [bd/drivers-catalogo-y-matriz-oracle.md](bd/drivers-catalogo-y-matriz-oracle.md) — un pack del
  Instant Client puede cubrir más de lo que Oracle soporta y lo dice; el centinela va por
  plataforma.
- [bd/drivers-descarga-y-plataformas.md](bd/drivers-descarga-y-plataformas.md) — los clientes se
  descargan a `userData`, por plataforma, con plazo de inactividad y no plazo total.
- [bd/drivers-instalar-desde-dmg.md](bd/drivers-instalar-desde-dmg.md) — el cliente de Apple
  Silicon se instala desde el .dmg con huella, montaje propio, `cp -P` y firma verificada.
- [bd/escritura-sql-contrato-por-motor.md](bd/escritura-sql-contrato-por-motor.md) — cada motor
  escribe su SQL de exportar con su propio módulo, tras un contrato y un registro exhaustivo.
- [bd/escritura-sql-oracle-binario-grande.md](bd/escritura-sql-oracle-binario-grande.md) — un
  binario de más de 2000 bytes se escribe como un bloque PL/SQL, no como un literal.
- [bd/escritura-sql-oracle-sqlplus.md](bd/escritura-sql-oracle-sqlplus.md) — el guion de Oracle
  tiene que pasar por SQL*Plus: líneas cortas, sin controles crudos y sin `&`.
- [bd/escritura-sql-sqlite-y-sqlserver.md](bd/escritura-sql-sqlite-y-sqlserver.md) — SQLite y SQL
  Server escriben una sentencia por línea, con las trampas de su cliente resueltas.
- [bd/explorador-cache-catalogo.md](bd/explorador-cache-catalogo.md) — la caché del catálogo no
  caduca por tiempo y sus cargas en vuelo están atadas a su generación.
- [bd/explorador-consolas-persistencia.md](bd/explorador-consolas-persistencia.md) — las consolas
  son archivos del espacio de datos, versionadas por el hash de su contenido.
- [bd/explorador-controlador.md](bd/explorador-controlador.md) — el controlador es una fachada
  sobre módulos, `ipc.ts` es el único con `ipcMain` y un handler nunca lanza.
- [bd/explorador-familias.md](bd/explorador-familias.md) — MongoDB y Redis heredan un núcleo de
  gestor configurado por el constructor, y los caminos SQL rechazan las conexiones ajenas.
- [bd/explorador-historial.md](bd/explorador-historial.md) — el historial de consultas es privado
  de Tessera, en JSON Lines por perfil, y tapa los secretos al anotar.
- [bd/explorador-salida-de-la-app.md](bd/explorador-salida-de-la-app.md) — al cerrar la app el
  diálogo es nativo, pregunta antes por los cambios sin enviar y nunca espera sin plazo.
- [bd/explorador-stop-en-preparacion.md](bd/explorador-stop-en-preparacion.md) — abrir una tabla
  y «Enviar» se apuntan mientras el main los prepara, para que un Stop no se pierda.
- [bd/mongodb-conexion-y-tipos.md](bd/mongodb-conexion-y-tipos.md) — MongoDB: contraseña fuera de la
  URI, tipos numéricos explícitos y cancelar solo donde el driver puede.
- [bd/mongodb-interprete-del-shell.md](bd/mongodb-interprete-del-shell.md) — la consola de MongoDB
  interpreta el shell con una lista blanca y nunca ejecuta JavaScript.
- [bd/mongodb-sesion-lectores-y-enviar.md](bd/mongodb-sesion-lectores-y-enviar.md) — la sesión de
  MongoDB aplica la política, guarda lectores por id y envía todo o nada según haya transacciones.
- [bd/mongodb-tdb-salida-y-guardia.md](bd/mongodb-tdb-salida-y-guardia.md) — `tdb` con MongoDB: una
  sentencia por comando, guardia antes de conectar y un documento por bloque.
- [bd/motores-codigo-por-motor.md](bd/motores-codigo-por-motor.md) — el código por motor vive en
  un registro exhaustivo, lo que falta lanza y los archivos por motor no importan `index.ts`.
- [bd/motores-explicar.md](bd/motores-explicar.md) — el Explain nunca ejecuta la sentencia y no
  estropea la transacción del usuario.
- [bd/motores-sesion-sqlite.md](bd/motores-sesion-sqlite.md) — SQLite edita por el alias del
  rowid, conserva la clase de almacenamiento y espera por archivo.
- [bd/motores-sesion-sqlserver.md](bd/motores-sesion-sqlserver.md) — en SQL Server el «esquema»
  de la consola es la base y «Enviar» espera 10 s a un bloqueo.
- [bd/motores-sintaxis-local.md](bd/motores-sintaxis-local.md) — la gramática local de PG carga
  una vez, sin reintento, y solo un abort del runtime la rompe.
- [bd/puente-atajos-de-tdb.md](bd/puente-atajos-de-tdb.md) — tres atajos `tdb` (sh, PowerShell,
  cmd), versionados por carpeta, en LF y con permisos explícitos.
- [bd/puente-buzon-de-docker.md](bd/puente-buzon-de-docker.md) — en Docker el contenedor deja
  peticiones en un buzón de archivos por perfil y el `tdb` real corre en el host.
- [bd/puente-entorno-de-las-terminales.md](bd/puente-entorno-de-las-terminales.md) — `tdb` va
  siempre en el PATH de las terminales nativas y el único ámbito es lo montado.
- [bd/puente-huella-del-destino.md](bd/puente-huella-del-destino.md) — cada contraseña viaja con
  la huella de su destino, calculada igual en el main y en `tdb`.
- [bd/puente-punto-de-escucha-y-concesiones.md](bd/puente-punto-de-escucha-y-concesiones.md) —
  `tdb` pregunta al puente en cada invocación, por named pipe o por un socket en carpeta 0700.
- [bd/puente-textos-del-agente.md](bd/puente-textos-del-agente.md) — los textos que lee el agente
  distinguen catálogo de montado, dan la regla de producción y dicen quién impone el solo lectura.
- [bd/registro-motores-descriptor.md](bd/registro-motores-descriptor.md) — lo que cambia de un motor
  a otro es un descriptor de datos, en una unión por familia.
- [bd/registro-motores-guardia-de-motores-sueltos.md](bd/registro-motores-guardia-de-motores-sueltos.md) —
  una guardia impide que el código común vuelva a dar por hecho un motor concreto.
- [bd/registro-motores-mongodb-y-redis.md](bd/registro-motores-mongodb-y-redis.md) — los
  descriptores de MongoDB y Redis: sin usuario obligatorio, sin TLS por defecto y solo lectura por
  lista blanca.
- [bd/registro-motores-sqlite.md](bd/registro-motores-sqlite.md) — el descriptor de SQLite: un
  archivo, un proceso por consola y nunca un cursor vivo.
- [bd/registro-motores-sqlserver.md](bd/registro-motores-sqlserver.md) — el descriptor de SQL
  Server: árbol híbrido, solo lectura impuesta por Tessera y sin cursores vivos.
- [bd/rejilla-edicion-identidad.md](bd/rejilla-edicion-identidad.md) — la rejilla solo edita lo
  que identifica con certeza y compara lo que leyó antes de escribir.
- [bd/rejilla-envio-bloqueos.md](bd/rejilla-envio-bloqueos.md) — «Enviar» espera los bloqueos con
  tope, por lotes y antes de escribir nada, y busca la fila culpable por bisección.
- [bd/rejilla-filtro-guiado-sql.md](bd/rejilla-filtro-guiado-sql.md) — el filtro guiado se compila
  a SQL con parámetros y una forma distinta por motor.
- [bd/rejilla-paginado.md](bd/rejilla-paginado.md) — la rejilla pagina con la forma que admite
  cada motor, sin FETCH en Oracle y con el ROWID sin alias de tabla.
- [bd/rejilla-sql-fragmentos.md](bd/rejilla-sql-fragmentos.md) — el WHERE y el ORDER BY del
  usuario se validan con el léxico y van en líneas propias.
- [bd/sesiones-esquema-de-consola.md](bd/sesiones-esquema-de-consola.md) — el esquema de una
  consola se reaplica al abrir, solo se olvida si no existe y un lector queda atado al suyo.
- [bd/sesiones-exportar-con-cursor-vivo.md](bd/sesiones-exportar-con-cursor-vivo.md) — exportar
  lee con un cursor vivo en una sesión efímera propia y escribe a un temporal que se renombra.
- [bd/sesiones-por-motor.md](bd/sesiones-por-motor.md) — lo que cambia por motor en las sesiones
  es una capacidad del descriptor o un método del motor, nunca un `d === 'oracle'`.
- [bd/sesiones-procesos-y-autoridad.md](bd/sesiones-procesos-y-autoridad.md) — un proceso por
  conexión (SQLite, uno por consola), una cola de una plaza por sesión y la autoridad en el main.
- [bd/sesiones-protocolo-del-trabajador.md](bd/sesiones-protocolo-del-trabajador.md) — el proceso
  de sesión es Electron haciendo de Node, habla por el canal de `fork` y no decide nada.
- [bd/sesiones-solo-lectura-impuesta.md](bd/sesiones-solo-lectura-impuesta.md) — el explorador
  obedece la solo lectura que se le impone, no la casilla de la conexión, que es de los agentes.
- [bd/sql-avisos-lexicos.md](bd/sql-avisos-lexicos.md) — los avisos de la consola son léxicos y no
  bloquean: orientan, y decide el servidor.
- [bd/sql-dialectos-como-tabla.md](bd/sql-dialectos-como-tabla.md) — lo que cambia de un motor SQL a
  otro es dato en una tabla de banderas, y un dialecto desconocido lanza con nombre.
- [bd/sql-dml-rejilla-un-constructor.md](bd/sql-dml-rejilla-un-constructor.md) — «Enviar» construye
  su DML con un solo constructor para los dos lados, con binds y nombres citados.
- [bd/sql-lexico-y-divisor-compartidos.md](bd/sql-lexico-y-divisor-compartidos.md) — el léxico y el
  divisor SQL son uno solo para el main y el renderer, y el main vuelve a partir cada sentencia.
- [bd/sql-posicion-error.md](bd/sql-posicion-error.md) — la posición de un error del servidor se
  convierte en un solo sitio, el main, entre tres unidades distintas.
- [bd/sql-solo-lectura-lista-blanca.md](bd/sql-solo-lectura-lista-blanca.md) — la solo lectura del
  clasificador es una lista blanca estricta y un clasificador que duda rechaza.
- [bd/sql-tsql-unidad-entera.md](bd/sql-tsql-unidad-entera.md) — en T-SQL el clasificador mira la
  unidad entera, por tramos, y hereda el más peligroso.
- [bd/tdb-motores-por-datos.md](bd/tdb-motores-por-datos.md) — los motores de `tdb` son datos en
  `motores.cjs`, con paridad contra shared.
- [bd/tdb-registro-como-el-main.md](bd/tdb-registro-como-el-main.md) — `tdb` lee el registro como el
  main y no usa lo que el main no usa.
- [bd/trabajador-ciclo-de-vida.md](bd/trabajador-ciclo-de-vida.md) — el proceso de sesión no toca
  stdout, no muere por una promesa huérfana y sale a mano.
- [bd/trabajador-oracle-sesion.md](bd/trabajador-oracle-sesion.md) — la sesión Oracle fija formato
  por execute, lee con cursor vivo y pone el candado sentencia a sentencia.
- [bd/trabajador-postgres-sesion.md](bd/trabajador-postgres-sesion.md) — la sesión PostgreSQL lee
  con `pg-cursor` y lo cierra en el acto, refija formatos y cancela por CancelRequest.
- [bd/trabajador-redis-cancelar.md](bd/trabajador-redis-cancelar.md) — en Redis cancelar es soltar
  el comando bloqueado o abandonar la conexión.
- [bd/trabajador-sqlite-sesion.md](bd/trabajador-sqlite-sesion.md) — la sesión SQLite es un proceso
  por consola, sin cursor vivo, con el autorizador como guardia.
- [bd/trabajador-sqlserver-sesion.md](bd/trabajador-sqlserver-sesion.md) — la sesión SQL Server lee
  todos los conjuntos en flujo, revierte cada sentencia de solo lectura y corta con attention.
- [bd/transacciones-enviar-todo-o-nada.md](bd/transacciones-enviar-todo-o-nada.md) — «Enviar»
  aplica todo o nada en una sesión efímera propia, con Stop hasta antes del COMMIT.
- [bd/transacciones-maquina-de-estados.md](bd/transacciones-maquina-de-estados.md) — la política
  de transacciones vive en una máquina de estados pura que aplica lo de detrás con el resultado
  real.
- [bd/transacciones-perdidas-y-commit-en-camino.md](bd/transacciones-perdidas-y-commit-en-camino.md)
  — una sesión perdida nunca se re-ejecuta, y con un COMMIT en camino se dice «no se sabe».
- [bd/transacciones-produccion-y-manual.md](bd/transacciones-produccion-y-manual.md) — producción
  informa y pide confirmar cada escritura, y sus consolas nacen en Manual.
- [bd/ui-arbol-cache-meta.md](bd/ui-arbol-cache-meta.md) — la caché de catálogo del renderer es un
  módulo que solo invalida el evento del main, y marca obsoleto en vez de borrar.
- [bd/ui-arbol-colores-de-marca.md](bd/ui-arbol-colores-de-marca.md) — el color de cada motor lleva
  el del tema oscuro en el SVG y el del claro en `arbol.css`, con contraste de gráfico medido.
- [bd/ui-arbol-componente.md](bd/ui-arbol-componente.md) — el lateral de BD solo selecciona al
  clic, busca en lo cargado y llama a sus hooks en un orden fijo de efectos.
- [bd/ui-arbol-filas-y-carga.md](bd/ui-arbol-filas-y-carga.md) — cada fila sabe su carga y su
  única acción, y las conexiones ajenas se explican con un solo criterio.
- [bd/ui-arbol-modelo.md](bd/ui-arbol-modelo.md) — el árbol se aplana en puro, pide lo que falta
  desde un solo sitio y usa claves de tupla unidas por NUL.
- [bd/ui-arbol-nivel-bases.md](bd/ui-arbol-nivel-bases.md) — el nivel «Bases» comparte el popover
  del «N de M» y el selector de consola decide por el descriptor.
- [bd/ui-area-conexiones-y-sesiones.md](bd/ui-area-conexiones-y-sesiones.md) — conocidas y ajenas
  llegan en una petición y un estado por perfil, y las sesiones como foto más cambios.
- [bd/ui-area-estado-de-la-vista.md](bd/ui-area-estado-de-la-vista.md) — la vista de BD no se
  persiste y solo se poda con listas que se entienden (nunca con un formato ajeno).
- [bd/ui-area-iconos.md](bd/ui-area-iconos.md) — los glifos de BD viven en un solo módulo, con
  glifo propio por motor salvo el logo oficial de PostgreSQL sin tocar.
- [bd/ui-area-marca-de-entorno.md](bd/ui-area-marca-de-entorno.md) — el entorno se marca con un
  solo componente, chip o franja, con colores de contraste medido en los dos temas.
- [bd/ui-area-modelo-de-pestanas.md](bd/ui-area-modelo-de-pestanas.md) — las pestañas de BD son un
  reducer puro propio, sin efímeras, con ids JSON de tuplas.
- [bd/ui-area-pestanas-y-panes.md](bd/ui-area-pestanas-y-panes.md) — el área monta los panes de
  todos los perfiles en keep-alive y cerrar pregunta al pane.
- [bd/ui-area-tira-de-pestanas.md](bd/ui-area-tira-de-pestanas.md) — la tira de BD reutiliza la
  del editor, con un indicador por pestaña y un arrastre que solo acepta lo suyo.
- [bd/ui-autocompletado-catalogo.md](bd/ui-autocompletado-catalogo.md) — el catálogo del
  autocompletado es un adaptador sobre la caché del árbol, sin almacén propio.
- [bd/ui-autocompletado-contexto.md](bd/ui-autocompletado-contexto.md) — el contexto sale de una
  pila de niveles sobre el léxico compartido, no de un parser.
- [bd/ui-autocompletado-espera-y-division.md](bd/ui-autocompletado-espera-y-division.md) — un solo
  tope de espera por pregunta, y cada versión del modelo se parte una vez.
- [bd/ui-autocompletado-filtro-y-orden.md](bd/ui-autocompletado-filtro-y-orden.md) — el
  autocompletado filtra por subcadena y ordena por niveles propios; Monaco solo pinta.
- [bd/ui-autocompletado-fks-y-estrella.md](bd/ui-autocompletado-fks-y-estrella.md) — las FKs se
  sugieren tras JOIN y ON, y el `*` solo se expande con todas sus columnas al día.
- [bd/ui-autocompletado-registro.md](bd/ui-autocompletado-registro.md) — un proveedor por lenguaje
  para toda la app, enrutado por la URI del modelo y con el esquema leído al preguntar.
- [bd/ui-claves-arbol.md](bd/ui-claves-arbol.md) — el árbol de claves acumula el SCAN por base, no
  da por vacía una vuelta sin claves y agrupa por `:` sin cambiar el nombre.
- [bd/ui-claves-comandos-y-registro.md](bd/ui-claves-comandos-y-registro.md) — la consola de claves
  ejecuta un comando por línea, con registro propio y un Monarch sin estados.
- [bd/ui-claves-consola.md](bd/ui-claves-consola.md) — la consola de Redis confirma lo peligroso y
  la producción de uno en uno y reenvía cada marca tal cual.
- [bd/ui-claves-pestana.md](bd/ui-claves-pestana.md) — la pestaña de clave lee con una petición
  cancelable, no se registra para descartar y no reutiliza la tabla de documentos.
- [bd/ui-claves-visor.md](bd/ui-claves-visor.md) — el visor de una clave es de solo lectura, sangra
  el JSON sobre el texto y acota lo que pinta.
- [bd/ui-conexion-borrador.md](bd/ui-conexion-borrador.md) — la contraseña es de solo escritura y
  solo viaja lo que el motor declara.
- [bd/ui-conexion-campos.md](bd/ui-conexion-campos.md) — las reglas de los campos son del
  descriptor compartido y el renderer solo añade la presentación.
- [bd/ui-conexion-clientes.md](bd/ui-conexion-clientes.md) — los clientes de base de datos solo se
  enseñan con un motor que los usa, y siempre con salida a mano.
- [bd/ui-conexion-dialogo.md](bd/ui-conexion-dialogo.md) — el diálogo pinta lo que dice el
  descriptor, prueba siempre lo guardado y el main sigue siendo la autoridad.
- [bd/ui-consola-barra-y-pane.md](bd/ui-consola-barra-y-pane.md) — la barra describe a la izquierda
  y actúa con iconos a la derecha, y popovers y diálogos van por portal.
- [bd/ui-consola-estado.md](bd/ui-consola-estado.md) — la consola SQL es un reducer puro aplicado
  de forma síncrona, y la sesión la pinta el main.
- [bd/ui-consola-formato-y-salida.md](bd/ui-consola-formato-y-salida.md) — el formateo solo cambia
  blancos y caja, con guarda por tokens, y los textos de la Salida son contrato.
- [bd/ui-consola-historial.md](bd/ui-consola-historial.md) — el historial filtra en el main e
  inserta en el cursor, nunca desde una lista vieja.
- [bd/ui-consola-lote-stop-y-cierre.md](bd/ui-consola-lote-stop-y-cierre.md) — el lote se confirma
  una vez antes de enviar nada, y Stop y el cierre alcanzan todo lo que está en vuelo.
- [bd/ui-consola-monaco.md](bd/ui-consola-monaco.md) — las marcas viven en el modelo, con tres
  dueños de marcadores y lenguajes propios registrados síncronos.
- [bd/ui-consola-motor.md](bd/ui-consola-motor.md) — `useConsola` es dueño del modelo, aplica un
  reducer síncrono y llama a sus piezas en un orden fijo.
- [bd/ui-consola-popovers.md](bd/ui-consola-popovers.md) — los popovers de esquemas se manejan
  desde el filtro, y el de la consola elige uno y cancela con el clic fuera.
- [bd/ui-datos-pestana.md](bd/ui-datos-pestana.md) — la pestaña de datos es la dueña de la lectura
  y de lo pendiente, y sus acciones asíncronas solo leen un núcleo estable.
- [bd/ui-documentos-coleccion.md](bd/ui-documentos-coleccion.md) — la colección tiene tabla propia,
  panel JSON de texto y un «Enviar» que deja la política al main.
- [bd/ui-documentos-consola.md](bd/ui-documentos-consola.md) — la consola de documentos pregunta
  por cada sentencia rechazada y reenvía la confirmación tal cual.
- [bd/ui-documentos-lenguaje-de-consola.md](bd/ui-documentos-lenguaje-de-consola.md) — la consola
  de documentos usa un lenguaje propio de solo coloreado, sin el servicio de TypeScript.
- [bd/ui-documentos-texto-y-cambios.md](bd/ui-documentos-texto-y-cambios.md) — el documento se lee
  de forma léxica, los cambios van por `_id` y cada modo de consulta recuerda lo suyo.
- [bd/ui-rejilla-editor-y-envio.md](bd/ui-rejilla-editor-y-envio.md) — el editor de celda confirma
  sin robar el foco y el diálogo de «Enviar» no deja reenviar por reflejo.
- [bd/ui-rejilla-filtro-guiado.md](bd/ui-rejilla-filtro-guiado.md) — el filtro guiado es una lista
  de condiciones con desplegables nativos y el texto libre detrás de un botón.
- [bd/ui-rejilla-modelo-cambios.md](bd/ui-rejilla-modelo-cambios.md) — los cambios se nombran por
  su posición en lo cargado y viajan en un orden fijo que el cliente no altera.
- [bd/ui-rejilla-modelo-exportar.md](bd/ui-rejilla-modelo-exportar.md) — exportar lo escribe el
  main, y el renderer sigue su progreso con un solo oyente para todas.
- [bd/ui-rejilla-modelo-memoria.md](bd/ui-rejilla-modelo-memoria.md) — las filas en memoria de
  todas las rejillas comparten un tope global de celdas.
- [bd/ui-rejilla-modelo-panes.md](bd/ui-rejilla-modelo-panes.md) — las pestañas de datos deciden
  con el descriptor del motor y cada error dice su siguiente paso.
- [bd/ui-rejilla-modelo-pintado.md](bd/ui-rejilla-modelo-pintado.md) — la rejilla es propia,
  virtual en los dos ejes, y pinta el valor sin reinterpretarlo.
- [bd/ui-rejilla-modelo-resultados.md](bd/ui-rejilla-modelo-resultados.md) — los resultados de la
  consola se sustituyen por lote y releen en la sesión de su consola.
- [bd/ui-rejilla-modelo-teclado.md](bd/ui-rejilla-modelo-teclado.md) — el teclado de la rejilla
  sigue a las hojas de cálculo y fija sus mitades negativas por plataforma.
- [bd/ui-rejilla-modelo-visor.md](bd/ui-rejilla-modelo-visor.md) — el visor y la copia enseñan y
  copian el valor tal como se guardó, con un serializador compartido.
- [bd/ui-rejilla-visor-fuente.md](bd/ui-rejilla-visor-fuente.md) — fuente y DDL se leen en un pane
  con un Monaco de modelo propio, y Refrescar salta la caché de ese objeto.
- [bd/ui-rejilla-visor-valor.md](bd/ui-rejilla-visor-valor.md) — el visor de valor es un Monaco de
  solo lectura en un modal por portal que nace cuando su host ya mide.
- [bd/ui-rejilla-vista.md](bd/ui-rejilla-vista.md) — la rejilla solo pinta, selecciona y copia; los
  datos, el servidor y lo pendiente son de su dueño.
- [bd/ui-resultados-pestanas.md](bd/ui-resultados-pestanas.md) — cada resultado de la consola es
  una pestaña dueña de su rejilla o su plan, que sigue montada al ocultarse.
- [bd/ui-resultados-pildora-de-filas.md](bd/ui-resultados-pildora-de-filas.md) — el recuento de
  filas es una píldora que cuenta bajo demanda y reúne «Traer todas» y la exportación.
- [bd/uri-mongodb-al-pegar.md](bd/uri-mongodb-al-pegar.md) — «Pegar URI» de MongoDB rechaza lo que
  el driver rechaza y guarda campos, no la URI.
- [bd/uri-redis-al-pegar.md](bd/uri-redis-al-pegar.md) — «Pegar URI» de Redis lee las credenciales
  como ioredis y descarta las opciones.

### busqueda

- [busqueda/busqueda-en-archivos.md](busqueda/busqueda-en-archivos.md) — la búsqueda es siempre
  del proyecto activo (elegir otra carpeta lo activa) y cada barrido se cancela en cuanto deja de
  hacer falta.
- [busqueda/vista-previa-monaco.md](busqueda/vista-previa-monaco.md) — la vista previa tiene su
  propio Monaco con modelo propio, siempre montado y tapado por una capa, sin pasar por el
  registro de buffers.

### calidad

- [calidad/presupuesto-del-cambio-de-perfil.md](calidad/presupuesto-del-cambio-de-perfil.md) —
  cambiar de perfil tiene un presupuesto de repintados medido que no depende de los proyectos
  abiertos, y un diagnóstico apagado que se enciende con F12.
- [calidad/react-hooks-dos-reglas.md](calidad/react-hooks-dos-reglas.md) — de
  `eslint-plugin-react-hooks` se activan `rules-of-hooks` y `exhaustive-deps`, no su preset.

### comprimidos

- [comprimidos/contenedores-como-carpetas.md](comprimidos/contenedores-como-carpetas.md) — un .jar
  se navega como una carpeta: se lee por rangos con zlib nativo, sus carpetas se sintetizan y su
  índice se cachea por mtime y tamaño.
- [comprimidos/diff-de-contenedores.md](comprimidos/diff-de-contenedores.md) — el diff de un
  contenedor se resta en el main por CRC32, y al renderer solo cruzan el índice restado y el texto
  de una entrada.

### despliegue

- [despliegue/releases-de-github.md](despliegue/releases-de-github.md) — el feed es `generic`
  contra las Releases de GitHub, Actions publica al empujar la etiqueta y la release es borrador
  hasta tener las dos plataformas, y el mínimo de macOS viaja en Darwin.

### editor

- [editor/columna-del-agente-oculta.md](editor/columna-del-agente-oculta.md) — se guarda el
  motivo de ocultar la columna del agente (`'manual'` o `'diff'`), no un booleano, y restaurar se
  deduce del `kind` de la pestaña.
- [editor/diff-editable.md](editor/diff-editable.md) — el lado derecho del diff edita el buffer
  compartido del registro y Monaco no se recrea por cada cambio.
- [editor/panes-en-keep-alive.md](editor/panes-en-keep-alive.md) — cada pestaña es un pane en
  keep-alive que pide prestado su buffer al registro y nunca crea ni dispone un modelo compartido.
- [editor/recarga-en-vivo.md](editor/recarga-en-vivo.md) — la recarga en vivo solo relee el
  target activo y nunca un buffer sucio, pero sí le comprueba el borrado.
- [editor/registro-de-modelos.md](editor/registro-de-modelos.md) — un registro con refcount es el
  único dueño de cada buffer y solo muta su contenido, nunca reemplaza el modelo.
- [editor/scroll-sincronizado-vista-dividida.md](editor/scroll-sincronizado-vista-dividida.md) — en
  la vista dividida de un Markdown, mover un lado lleva al otro a la misma fracción de su
  recorrido, sin rebote.
- [editor/visores-de-archivos.md](editor/visores-de-archivos.md) — los visores piden solo si son
  del proyecto activo y leen los bytes solo por IPC.
- [editor/vista-previa-html-aislada.md](editor/vista-previa-html-aislada.md) — la vista previa de
  un `.html` va en un iframe con `sandbox` vacío, nunca en el DOM del renderer.

### explorador

- [explorador/arbol-de-archivos.md](explorador/arbol-de-archivos.md) — el árbol es un solo
  componente con el estado en hooks compuestos en el orden de sus efectos y las operaciones en
  funciones planas.
- [explorador/portapapeles-de-archivos.md](explorador/portapapeles-de-archivos.md) — el
  portapapeles del explorador arbitra entre la copia interna y la del sistema con una marca de
  texto, sin sondear.
- [explorador/portapapeles-del-sistema.md](explorador/portapapeles-del-sistema.md) — los ficheros
  del portapapeles del sistema se leen en el main por los formatos registrados del Shell, con
  PowerShell de reserva.
- [explorador/seleccion-multiple-del-arbol.md](explorador/seleccion-multiple-del-arbol.md) — la
  selección guarda claves de fila y las rutas movibles se derivan de la lista aplanada al usarlas.

### git

- [git/cambios-arbol-de-archivos.md](git/cambios-arbol-de-archivos.md) — solo los archivos de un
  commit usan árbol, compactado después de construirlo; el de ramas no se compacta ni comparte
  constructor.
- [git/cambios-blobs-y-diff.md](git/cambios-blobs-y-diff.md) — la caché de blobs solo retiene lo
  inmutable (con el ámbito en las claves mutables) y el diff solo es editable si su lado es el disco.
- [git/cambios-caches-de-estado.md](git/cambios-caches-de-estado.md) — el estado de los repos se
  acumula por generación y se pide en perezoso; las cachés del historial, sin filtrar y con dos topes.
- [git/cambios-fila-de-archivo.md](git/cambios-fila-de-archivo.md) — una sola fila de archivo con
  dos modos, sin letra de estado y con la casilla como `span` con `aria-checked`.
- [git/cambios-historial-de-archivo.md](git/cambios-historial-de-archivo.md) — el historial de un
  archivo pide sin repo para que el main deduzca el dueño y distingue «preparando» de «no aparece».
- [git/cambios-lista-y-marcas.md](git/cambios-lista-y-marcas.md) — Cambios es una lista plana de
  cuatro secciones con marcas por sección, podadas al refrescar, y un menú con objetivo fijo.
- [git/estilos-inyectados.md](git/estilos-inyectados.md) — el CSS de git es una sola hoja
  acotada por clase raíz, inyectada una vez y armada con trozos por sección en un orden fijo que
  es la cascada.
- [git/log-apertura-y-teclado.md](git/log-apertura-y-teclado.md) — seleccionar es ver: el diff se
  abre por un gesto con antirrebote de 180 ms, y Ctrl+C copia el hash solo con el modificador
  principal.
- [git/log-columnas-y-filas.md](git/log-columnas-y-filas.md) — el Log va en tres columnas, la fila
  tiene alto fijo y la columna de autor se mide con canvas.
- [git/log-filtros-y-grafo.md](git/log-filtros-y-grafo.md) — la rama se filtra en el backend y el
  resto en el cliente, reescribiendo los padres para que el grafo cierre.
- [git/log-identidad-y-anclaje.md](git/log-identidad-y-anclaje.md) — toda petición del Log lleva
  repo, y solo se pinta lo del repo que se muestra.
- [git/main-abanico-fondo-y-generacion.md](git/main-abanico-fondo-y-generacion.md) — el relleno
  de fondo del abanico de estado tiene su propio tope (4, medido) y lo encolado de una generación
  superada no llega a lanzarse.
- [git/main-cola-y-techos.md](git/main-cola-y-techos.md) — una sola cola de 16 procesos git, con
  techo de tiempo y `--no-optional-locks` solo en las lecturas.
- [git/main-escrituras-y-descartes.md](git/main-escrituras-y-descartes.md) — pathspecs nunca
  vacíos, `-z`, un candado por repo y descartar con UNA confirmación fuera del candado y
  reclasificando.
- [git/main-lecturas-y-cache.md](git/main-lecturas-y-cache.md) — los blobs salen de un
  `cat-file --batch` por repo con dos topes, y la rama actual se cachea por el sha de HEAD.

### java

- [java/descompilacion-con-motores-externos.md](java/descompilacion-con-motores-externos.md) — una
  clase se descompila extrayéndola con sus internas a un temporal y lanzando el motor como
  subproceso corto, sin que el jar del usuario entre en el classpath de la JVM.
- [java/deteccion-de-jvm-y-eleccion-de-motor.md](java/deteccion-de-jvm-y-eleccion-de-motor.md) — se
  enumeran todas las JVM del equipo, de forma perezosa, y el motor lo decide la versión de bytecode
  de cada clase.

### layout

- [layout/barra-superior-en-tres-franjas.md](layout/barra-superior-en-tres-franjas.md) — la parte
  superior son tres franjas (título, perfiles, proyectos) y los botones de ventana solo tienen su
  hueco reservado.
- [layout/estructura-de-la-ventana.md](layout/estructura-de-la-ventana.md) — marco fijo con la
  franja inferior dentro de la columna principal; lo que tiene sesión se oculta, no se desmonta.
- [layout/marco-y-lienzo.md](layout/marco-y-lienzo.md) — el contorno es un gris único y el
  área de trabajo un lienzo hundido; ningún ancestro de una capa fija crea contexto de
  apilamiento ni contención.
- [layout/oculto-manda-sobre-maximizado.md](layout/oculto-manda-sobre-maximizado.md) — con el
  agente oculto y maximizado a la vez manda el oculto: ocultar cancela el maximizado en el origen.

### mosaico

- [mosaico/disposicion-de-la-rejilla.md](mosaico/disposicion-de-la-rejilla.md) — la rejilla se
  elige puntuando en celdas de terminal (manda la peor tesela), con suelo, banda del 5 % e
  histéresis.
- [mosaico/teselas-y-orden.md](mosaico/teselas-y-orden.md) — las teselas son claves en orden
  canónico, una por proyecto y estables mientras está abierto.

### pruebas

- [pruebas/arnes-e2e-sobre-la-app-empaquetada.md](pruebas/arnes-e2e-sobre-la-app-empaquetada.md)
  — las pruebas de interfaz arrancan el paquete que se publica, con `userData`, cuentas de
  agente y registros aislados en un temporal, una sola app a la vez y sin reintentos.
- [pruebas/que-va-en-e2e-y-que-en-test-mts.md](pruebas/que-va-en-e2e-y-que-en-test-mts.md) — a
  `e2e/` va lo que solo falla en la frontera con el sistema o dentro del renderer de verdad; el
  menú se prueba con teclas nativas, Monaco por su fiber y las bases con servidores reales.

### renderer

- [renderer/abrir-con-tessera.md](renderer/abrir-con-tessera.md) — «Abrir con Tessera» se recoge
  de la cola del main solo con los ajustes cargados y un perfil, y avisa si el perfil no llega.
- [renderer/actualizaciones-de-la-app.md](renderer/actualizaciones-de-la-app.md) — la
  actualización de la app se cuenta igual en las dos plataformas, sin leer la plataforma, y un
  aviso solo se retira donde se lee.
- [renderer/atajos-por-plataforma.md](renderer/atajos-por-plataforma.md) — un modificador
  principal por plataforma, y los gestos cuya tecla también cambia son predicados con la
  plataforma como parámetro.
- [renderer/banda-de-perfiles.md](renderer/banda-de-perfiles.md) — la banda de perfiles es una
  fila hermana de la barra de título, fuera de la región de arrastre, y pinta el color cenizo.
- [renderer/barriles-sin-ciclos.md](renderer/barriles-sin-ciclos.md) — lo que solo compone
  App.tsx sale del `index.ts` a un `app.ts` por feature, y lo que dos features se necesitan va por
  prop: entre barriles no queda ningún ciclo y `test:ciclos` no deja que vuelva.
- [renderer/color-de-perfil-cenizo.md](renderer/color-de-perfil-cenizo.md) — el color de un
  perfil se guarda tal cual y se rebaja a una banda cenizo solo al pintar.
- [renderer/color-del-perfil-como-acento.md](renderer/color-del-perfil-como-acento.md) — el
  color del perfil es el acento de la aplicación y lo que codifica un estado se ancla al azul
  congelado.
- [renderer/densidad-de-interfaz.md](renderer/densidad-de-interfaz.md) — las alturas de la
  densidad se calculan en un solo módulo, con una base y superficies que la heredan.
- [renderer/dialogos-foco-y-teclado.md](renderer/dialogos-foco-y-teclado.md) — los diálogos
  comparten un hook de foco y teclado llamado antes que ningún efecto, y el foco vuelve por la
  cadena de ancestros.
- [renderer/estado-de-app.md](renderer/estado-de-app.md) — el estado de la ventana vive en
  stores por dominio (el que cruzan los efectos, en la misma vía, para no partir commits) y todos
  los efectos de App se siguen ejecutando desde App, en orden fijo.
- [renderer/hueco-de-botones-de-ventana.md](renderer/hueco-de-botones-de-ventana.md) — el hueco
  de los botones de la ventana lo mide Chromium con `env()`; el renderer solo marca el lado y si
  hay semáforo.
- [renderer/integracion-con-el-sistema.md](renderer/integracion-con-el-sistema.md) — la
  integración con el sistema viene apagada y cada cambio va por su propio canal, esperando la
  respuesta.
- [renderer/lista-virtual.md](renderer/lista-virtual.md) — la lista virtual mide su viewport en un
  efecto de layout y avisa del rango visible desde un efecto, comparando la identidad de `items`.
- [renderer/menu-contextual.md](renderer/menu-contextual.md) — el menú contextual agrupa con
  separadores y reserva dos columnas independientes, check e icono.
- [renderer/monaco.md](renderer/monaco.md) — Monaco se configura en un solo sitio, con
  validadores apagados, tema solo hex, sin estados de Monarch que queden abiertos y `layout` con
  medidas explícitas en el diff.
- [renderer/objetivo-de-git-derivado.md](renderer/objetivo-de-git-derivado.md) — lo que se pinta
  de git sale del modelo de pestañas y lo que se pide espera al backend confirmado.
- [renderer/persistencia-de-pestanas.md](renderer/persistencia-de-pestanas.md) — el guardado del
  workspace vive en un temporizador con dueño propio que solo se cancela al desmontar.
- [renderer/red-del-contenedor.md](renderer/red-del-contenedor.md) — la red del contenedor se
  decide en un diálogo con diagnóstico redactado por el main y se confirma antes de persistir.
- [renderer/reflow-monaco-oculto.md](renderer/reflow-monaco-oculto.md) — al volver de oculto,
  Monaco se recoloca reintentando unos frames hasta tener caja y con medidas explícitas.
- [renderer/reordenar-proyectos-arrastrando.md](renderer/reordenar-proyectos-arrastrando.md) —
  los proyectos de un perfil se reordenan arrastrando su pestaña con la regla de los perfiles;
  arrastrar no activa, y el reductor solo acepta exactamente las rutas abiertas.

### sandbox

- [sandbox/contenedor-del-agente.md](sandbox/contenedor-del-agente.md) — el agente corre bajo
  `env -i`, con git preparado por un preludio y un bloque de memoria que no miente.
- [sandbox/contenedores-propios.md](sandbox/contenedores-propios.md) — Tessera solo para o borra
  un contenedor con su prefijo y nacido de su imagen.
- [sandbox/gestor-concurrencia.md](sandbox/gestor-concurrencia.md) — el gestor del sandbox
  serializa por perfil, coalesce creaciones y builds, y no confunde «no sé» con «no existe».
- [sandbox/hibernacion-manual.md](sandbox/hibernacion-manual.md) — la hibernación del contenedor es
  manual y por perfil; el recuento de sesiones nunca para un contenedor.
- [sandbox/imagen-y-extras.md](sandbox/imagen-y-extras.md) — la imagen se pone al día sola por
  sello y se degrada sin extras antes que dejar el perfil sin agente.
- [sandbox/limpieza-de-montajes.md](sandbox/limpieza-de-montajes.md) — la raíz gestionada solo se
  borra cuando awk afirma que no queda nada montado debajo.
- [sandbox/montajes-en-caliente.md](sandbox/montajes-en-caliente.md) — proyectos y credenciales
  se montan en caliente con un helper privilegiado efímero.
- [sandbox/raices-por-plataforma.md](sandbox/raices-por-plataforma.md) — las raíces gestionadas
  viven en la VM en Windows y bajo `userData` en macOS.
- [sandbox/red-del-anfitrion.md](sandbox/red-del-anfitrion.md) — la red del anfitrión se mide con
  una sonda real; el prevuelo informa y no bloquea.
- [sandbox/ssh-global.md](sandbox/ssh-global.md) — el SSH del usuario se monta de solo lectura en
  todo contenedor y su config se traduce.

### shared

- [shared/citado-para-shell.md](shared/citado-para-shell.md) — para citar en una shell hay dos
  funciones con nombre, una por regla, las dos con comillas simples; cuál toca lo decide la shell
  que recibe la línea.
- [shared/plataforma-y-nombres-del-sistema.md](shared/plataforma-y-nombres-del-sistema.md) — la
  plataforma se consulta con `esWindows()`/`esMac()`, y en lo que comparte el renderer (como los
  nombres del sistema) entra por parámetro, sin valor por defecto.
- [shared/ruta-virtual-de-contenedor.md](shared/ruta-virtual-de-contenedor.md) — una ruta dentro de
  un contenedor es POSIX relativa con `!/`, y el corte solo vale tras una extensión de contenedor.
- [shared/rutas-del-host-por-forma.md](shared/rutas-del-host-por-forma.md) — las rutas del host se
  clasifican por la forma de su raíz y se comparan sin distinguir mayúsculas, nunca por
  `process.platform`.

### sistema

- [sistema/accion-rapida-del-finder.md](sistema/accion-rapida-del-finder.md) — en macOS «Abrir con
  Tessera» es un `.workflow` en `~/Library/Services` que se reconcilia al arrancar y cuya verdad es
  el disco, no el ajuste.
- [sistema/cola-de-aperturas.md](sistema/cola-de-aperturas.md) — las rutas de «Abrir con Tessera»
  se encolan crudas en el main y se resuelven contra el disco al recogerlas; el relevo en marcha se
  detecta con dos señales.
- [sistema/menu-contextual-de-windows.md](sistema/menu-contextual-de-windows.md) — el menú
  contextual de Windows se escribe en HKCU con `reg.exe`, valor a valor y en cola, desde un estado
  en memoria que se reconcilia al arrancar.

### terminales

- [terminales/ajuste-de-alto-y-anclaje-al-fondo.md](terminales/ajuste-de-alto-y-anclaje-al-fondo.md)
  — el alto del xterm se ajusta a su lienzo y el fit solo reancla al fondo a quien ya estaba ahí.
- [terminales/boton-de-reinicio-una-sola-verdad.md](terminales/boton-de-reinicio-una-sola-verdad.md)
  — lo que ofrece el botón de reinicio lo decide una función pura, con tres guardas.
- [terminales/ciclo-del-xterm-comun.md](terminales/ciclo-del-xterm-comun.md) — la terminal de shell
  y la del agente comparten un solo ciclo de vida del xterm, y desmontar despausa el pty antes de
  cerrar la sesión.
- [terminales/contrapresion-del-pty.md](terminales/contrapresion-del-pty.md) — la salida del pty
  se frena con marcas alta y baja, y una pausa nunca dura más de cinco segundos.
- [terminales/pty-entrada-de-un-pty-muerto.md](terminales/pty-entrada-de-un-pty-muerto.md) — la
  entrada de un pty de Windows lleva un oyente de error propio para que una escritura tardía no
  tumbe el proceso.
- [terminales/pty-shell-nativo-y-entorno.md](terminales/pty-shell-nativo-y-entorno.md) — el modo
  nativo lanza un shell de login e interactivo en macOS y fusiona el PATH según el sistema.
- [terminales/pty-y-detencion-de-sesion.md](terminales/pty-y-detencion-de-sesion.md) — todo pty se
  crea con la conpty.dll de node-pty, toda muerte de pty va por una sola cola y un reinicio descarta
  la cola del shell muerto.
- [terminales/raton-y-portapapeles-de-la-terminal.md](terminales/raton-y-portapapeles-de-la-terminal.md)
  — el clic derecho es de la aplicación cuando pide el ratón, y el portapapeles va por el IPC de
  Tessera.
- [terminales/terminales-keep-alive-y-reinicio-limpio.md](terminales/terminales-keep-alive-y-reinicio-limpio.md)
  — las terminales viven por ranura, siguen vivas al ocultarse y se reinician con la pantalla
  limpia.

### util

- [util/path-del-main-desde-el-shell-de-login.md](util/path-del-main-desde-el-shell-de-login.md) —
  en macOS el proceso main toma su PATH del shell de login e interactivo una vez al arrancar, con
  un respaldo fijo si el shell falla.

### workspace

- [workspace/estado-persistido-crash-safe.md](workspace/estado-persistido-crash-safe.md) — los JSON
  de estado se escriben crash-safe desde una copia en memoria con debounce, y una versión más nueva
  se archiva antes de degradarla.

## Plantilla (40 líneas como mucho)

```markdown
# <La decisión, como frase afirmativa>

- **Estado:** vigente | sustituida por <ruta del ADR nuevo>
- **Ámbito:** <archivos o carpetas a los que aplica>

## Contexto

<Qué problema o qué fuerza obliga a decidir. Hechos, no historia.>

## Decisión

<Qué se hace, de forma concreta y verificable.>

## Consecuencias

<Qué se gana, qué se paga y qué NO se debe cambiar sin revisar esta decisión.>

## Descartes

<Solo los que evitan repetir un error: qué se valoró y por qué no sirve.>
```
