# SSH: el explorador SFTP habla SFTP v3 sobre el `ssh -s sftp` del sistema

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/sftp/` (`protocoloSftp.ts`, `ClienteSftp.ts`, `transferenciasSftp.ts`, `SesionesSftp.ts`, `ipc.ts`),
  `ControladorSsh.prepararSftp`, `lineaSsh.ts` (`subsistemaSftp`), `src/shared/sftp-ipc.ts`, `src/preload/sftp.ts` y
  `src/renderer/src/features/sftp/` (macOS: sin verificar)

## Contexto

Explorar y mover archivos de un servidor de las conexiones del perfil, con la misma huella, clave y contraseña guardada
que su pestaña SSH. Medido en Windows con el OpenSSH 9.5 del sistema: `sftp.exe` con la salida a una tubería no suelta
nada hasta salir (no sirve una sesión viva), y en sus órdenes convierte `\` en `/` (un nombre con comillas, `*` o `\`
no se puede escribir) y enmascara los permisos (`drwx******`). `ssh -s sftp` por tuberías sí va en vivo, binario limpio
y en unos 2 ms por petición.

## Decisión

- Un cliente propio del protocolo SFTP v3 (lo justo: listar, mirar, crear, borrar, renombrar, abrir, leer y escribir)
  sobre la entrada y la salida de `ssh -T -s … sftp`, una sesión por pestaña. ssh sigue siendo el del sistema con la
  línea de la pestaña (`argumentosSsh` en modo humano); la biblioteca SSH en JavaScript sigue descartada
  (`motor-linea-y-huellas.md`): aquí solo se trocean paquetes.
- Sin terminal nadie puede teclear: sin contraseña o frase guardada, `BatchMode`, y el fallo de autenticación dice que
  se guarde o se use una clave. La ficha del programa de contraseñas se suelta en cuanto pasa el saludo.
- Es una pestaña de la franja de terminales, del perfil, como las SSH; se abre desde el menú de la conexión.
- El renderer solo ve rutas remotas: los diálogos de elegir carpeta o archivos se abren en el main, y de lo soltado
  saca la ruta el preload (`webUtils`).
- Nunca un archivo a medias encima de uno bueno: se baja a `<destino>.tessera-parcial` y se sube a un temporal oculto
  creado en exclusiva al lado del destino; al acabar se renombra (en el servidor, con `posix-rename@openssh.com` si lo
  anuncia; si no, borrando el destino justo antes) y se conservan los permisos del reemplazado. Cancelar o fallar borra
  el temporal.
- No se pisa sin confirmar: si algo de lo que se sube o se baja ya existe, la operación queda como plan con los nombres
  en conflicto y espera «Reemplazar» (o se descarta). Renombrar no pisa nunca (el RENAME de v3 falla si existe, y se
  comprueba antes). Una carpeta que ya existe se mezcla.
- Borrar una carpeta borra su contenido recorriéndolo; un enlace se borra a sí mismo. `/` y las rutas con `.`/`..` no
  llegan al servidor. Los enlaces se siguen solo si apuntan a un archivo: una carpeta enlazada podría dar vueltas.
- Un nombre del servidor que no se puede crear en este equipo (`a:b`, `CON` en Windows) para la bajada con un aviso.
- Avance cada 250 ms y cancelación entre trozos; trozos de 32 KiB con 16 peticiones en vuelo.

## Descartes

- `sftp.exe` por lotes o en vivo: ver el contexto. `scp` y órdenes de shell en el servidor (`ls`, `rm -rf`): exigen
  una shell POSIX, y un servidor solo-SFTP (`internal-sftp`) o de Windows no la tiene.
- Preguntar la contraseña desde el explorador: es otra superficie de secretos; la pestaña SSH ya pregunta.
