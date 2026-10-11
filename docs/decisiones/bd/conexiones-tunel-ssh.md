# El túnel SSH de una base lo abre Tessera, con las conexiones SSH del perfil, y lo comparten tdb y el explorador

- **Estado:** vigente
- **Ámbito:** `src/main/db/tuneles/`, `ControladorSsh.prepararTunelBd`, `lineaSsh.ts` (`reenvioBd`), `dbBridge.ts`
  (`db.tunel`, `fichaTunel`), `src/tdb/tdbConectar.cjs` (`porTunel`), `tlsComun.cjs` (`identidadPorTunel`),
  `explorador/protocoloTrabajador.ts` (`conTunel`), `features/bd/DbConexionTunel.tsx`
- **Revisa:** el descarte de «túneles en segundo plano sin terminal» de `docs/decisiones/ssh/tuneles-y-bastiones.md`,
  que sigue valiendo para los túneles de la pestaña.

## Contexto

Muchas bases solo se alcanzan a través de un servidor SSH (un bastión en la red del servidor). Tessera ya tenía
conexiones SSH por perfil, con bastiones, huellas y secretos guardados; las bases no podían usarlas.

## Decisión

- Una conexión de red guarda `tunelSsh: { conexionId }`: una conexión SSH del MISMO perfil. El host y el puerto de la
  base son los vistos desde el servidor SSH. El main lo valida al guardar y entra en la huella del destino (las dos
  copias): otro túnel es otro destino y la contraseña emitida para el de antes no se usa.
- El túnel vive en el MAIN (`GestorTuneles`): uno por conexión de base, `ssh -N -L 127.0.0.1:<libre>:<host>:<puerto>`
  con la línea de la conexión SSH y sus saltos (`ProxyCommand`, como la pestaña) y `ExitOnForwardFailure`. Está listo
  cuando ssh (con `-v`) escribe que empezó la sesión, a la que solo llega con el reenvío escuchando, Y el puerto acepta
  conexiones (25 s de tope): la sonda sola daría por bueno a otro proceso que tomara el puerto entre que se eligió y
  ssh lo abrió, y le mandaría la contraseña de la base. Si ssh muere, la siguiente petición abre otro. Si cambia el
  destino de la base o cualquier conexión SSH (puede ser el bastión de cualquiera), la siguiente petición abre otro y
  el de antes NO se mata: cortaría las sesiones que ya van por él, también una transacción sin confirmar (la casilla
  de los agentes se edita con una pendiente). Se matan al borrar la base o el perfil y al cerrar la app. No se cierra
  por inactividad: cerraría las sesiones abiertas del explorador.
- Como un agente: solo servidores cuya huella ya confirmó una persona (si no, se dice que pulse «Probar» en la
  conexión SSH) y solo el secreto guardado, sin diálogo, porque también lo abre un `tdb` de un agente. Los saltos usan
  el modo de la pestaña, pero con todas las huellas ya confirmadas `accept-new` no acepta nada nuevo.
- `tdb` (también el de Docker, que corre en el anfitrión por el buzón) pide el extremo local con `db.tunel` tras
  comprobar la huella contra la entrada del disco. Lo autoriza su token de sesión si la base está en el ámbito
  VIGENTE. El token de «Probar» es de un solo uso y se gasta en `resolve`, así que `resolve` le da una ficha de túnel
  de un solo uso (60 s). Sin puente no hay túnel, y no se intenta la conexión directa.
- El explorador lo pide antes de mandar `abrir` al trabajador y le pasa `host`/`port` del túnel y `hostTls` con el host
  real. El trabajador nunca ve nada de SSH.
- Cifrando por el túnel, el certificado se verifica contra el host REAL (`servername` y `checkServerIdentity`; en SQL
  Server, `serverName` de tedious). Oracle thin solo lo compara con el host al que conecta (127.0.0.1): con túnel no
  cifra (`cifraPorTunel: false`), y el túnel ya cifra el tramo hasta el servidor SSH.
- Lo que no cabe en un reenvío de un solo puerto se rechaza al guardar: MongoDB con SRV, con varios servidores o con
  `replicaSet` (el driver iría a los demás miembros por su nombre, saltándose el túnel), y SQL Server con instancia
  (el puerto lo resuelve SQL Browser por UDP).

## Consecuencias

Una base tras un bastión se configura eligiendo la conexión SSH en el formulario. La primera consulta tarda lo que
tarda el ssh en autenticarse; las siguientes van por el túnel ya abierto. Una conexión SSH con segundo factor o sin
secreto guardado no sirve para un túnel. Una versión anterior de Tessera abriría la misma entrada directa, sin túnel.

El extremo local escucha en 127.0.0.1, como cualquier `ssh -L`: mientras está abierto, cualquier proceso del equipo
llega a la base por él, también uno al que el ámbito de `tdb` no se la da. Con una base que pide contraseña eso no
basta para entrar; con una base sin autenticación (Redis o MongoDB abiertos tras el bastión), sí.

## Descartes

- Que `tdb` o el trabajador lancen su propio ssh: verían secretos SSH, que hoy solo maneja el main, y el agente de
  Docker no tiene el ssh del anfitrión.
- Abrir los túneles de todo el ámbito en `resolve`: un `tdb ls` abriría un ssh por cada base montada.
- Diálogo para el secreto o el segundo factor: lo dispararía también un agente, con una ventana que nadie espera.
- Un reenvío por miembro de un replica set: más casos que probar para lo indispensable.
