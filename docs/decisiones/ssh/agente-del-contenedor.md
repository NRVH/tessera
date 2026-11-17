# Agente SSH del contenedor: Tessera autoriza y firma en el host

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/agente/`, `src/tssh/ssh-agente.cjs`, `src/shared/ssh-agente-ipc.ts`,
  `src/main/agentes/gitEnContenedor.ts`, `src/main/sandbox/gestor/` y el menú del perfil.

## Decisión

**Alcance: agentes en Docker.** Un agente nativo se ejecuta con el usuario del sistema y puede leer sus claves; este
permiso no lo limita. El menú del perfil lo agrupa bajo «Agentes en Docker» y la ventana de claves lo dice.

Las claves privadas del SSH del sistema y de `sshDir` permanecen en el host. Ninguna de esas carpetas se monta
ni se copia al contenedor. El preludio pide al buzón la configuración pública de su perfil y arranca un programa
Node que escucha en un socket Unix de modo 0600. Exporta `SSH_AUTH_SOCK` para ssh y git, también en agentes
manuales y delegados que usan `env -i`. La ruta de terminal Docker interactiva sin lanzamiento explícito también
ejecuta ese preludio antes de `exec bash -il`; las terminales ordinarias de la interfaz son nativas. Cada token
reutiliza su socket si ya está disponible. El socket se distingue por el token de sesión: una sesión que termina
no deja a otra dependiendo de su token revocado. Los contenedores anteriores se recrean en el arranque normal
del gestor; no se reutilizan entre procesos de Tessera.

El perfil guarda `clavesSshPermitidas`, una lista de rutas absolutas del host. Ausente conserva todas las claves
descubiertas para un perfil existente. Un perfil nuevo se crea con `[]`, también si un cliente antiguo omite
el campo al darlo de alta. Las claves propias del perfil forman parte de su catálogo y obedecen la misma lista.
Los permisos se guardan por un IPC específico que valida cada ruta contra el catálogo del perfil y confirma
la escritura antes de cerrar el diálogo. El guardado general conserva los permisos vigentes del main: una
instantánea antigua del renderer nunca restaura claves revocadas ni convierte una lista vacía en permiso global.
Cada catálogo incluye los `IdentityFile`, las claves estándar de `~/.ssh` y los archivos de clave de `sshDir`.
Los `Include` se expanden en el host, con patrones de archivos, detección de ciclos y hasta 64 archivos.
El config propio resuelve `~/.ssh/` y los includes relativos contra `sshDir`; el global los resuelve contra su
carpeta SSH. Los `IdentityFile` trasladados se normalizan antes de reunir ambos configs y generar las públicas.
La lectura del catálogo, sus includes, directorios, claves y públicas es asíncrona. Se reutiliza por huellas de
inode, tamaño, `mtime` y `ctime`, permisos y coincidencias de los patrones Include; crear un include también
invalida la entrada. Se conservan como máximo 32 entradas. Cada lectura de archivo SSH se limita a 1 MiB.

Una identidad cuya pública no se pueda obtener se omite y registra un motivo sin rutas ni secretos. Listar
material público nunca pide frase: un PEM cifrado necesita su `.pub`; los tipos de hardware no admitidos se
omiten. Al firmar solo se pregunta ante un fallo identificado de frase de un formato y cifrado admitidos.
Una frase guardada se prueba antes de preguntar. Cancelar suprime nuevas preguntas para esa clave y perfil durante
60 s, lo que tarda una conexión en reintentar sus firmas; después, o si cambian sus bytes, se vuelve a preguntar.
Los cambios de permisos y tokens se comprueban de nuevo después de cualquier diálogo.

El contenedor recibe únicamente las públicas permitidas, `known_hosts` y un config generado con
`IdentityAgent SSH_AUTH_SOCK` y `ForwardAgent no`. Los `IdentityFile` llevan nombres
derivados de la ruta y terminan en `.pub`. No se copian includes, certificados, proveedores externos,
`IdentityAgent` del usuario, directivas de contraseña ni archivos arbitrarios. Se conservan alias, destino,
usuario, puerto, `ProxyJump` y opciones de transporte admitidas por el generador. Un destino cuyo bloque elige
identidad queda con `IdentitiesOnly yes`, y solo prueba esa clave, o ninguna si no está permitida. Un bloque general
(`Host *`, `Match all` o lo anterior al primer `Host`) no ata: su clave, si está permitida, solo va primero. Cualquier otro
destino recibe lo que liste el agente: todas las claves permitidas, primero las de nombre estándar. Quién coincide
con cada bloque lo decide ssh, sin calcular patrones aquí. El host vuelve a consultar el perfil vigente en cada petición, por lo que
revocar impide nuevas firmas aunque siga vivo el socket o quede una pública antigua en el contenedor.

## Protocolo y límites

- El transporte local usa tramas SSH con longitud uint32 big endian, hasta 256 KiB. El buzón transporta el
  mensaje en base64 junto al token de sesión, nunca una ruta que decida qué clave abrir.
- Se admiten exclusivamente `SSH2_AGENTC_REQUEST_IDENTITIES` (11) y `SSH2_AGENTC_SIGN_REQUEST` (13).
  Listar devuelve públicas autorizadas; firmar selecciona por el blob público. Mensajes malformados,
  operaciones de altas/bajas, bloqueo, extensiones y cualquier otro tipo reciben fallo (5).
- Las firmas admitidas son Ed25519, ECDSA NIST P-256/P-384/P-521 y RSA con SHA-256 o SHA-512 según los flags.
  RSA con SHA-1, DSA, certificados SSH y claves de dispositivos de seguridad no están admitidos.
- El lector del host admite OpenSSH sin cifrar o bcrypt con AES-256-CTR/CBC, y PEM mediante `crypto` de Node.
  Comprueba los números de control, los componentes, la pública y el relleno; limita archivos, sal y rondas de
  derivación. La frase se obtiene del almacén cifrado o del `DialogoAskpass` existente. Una frase confirmada
  se guarda en `ssh/frases-agente.json` con el mismo `cifradoDelSistema` que las conexiones; si el almacén
  seguro no está disponible, se usa solo para esa petición. Nunca va al buzón ni al entorno del contenedor.
- Los permisos y el token se revalidan después de cualquier diálogo. La clave se lee otra vez al firmar y
  se exige que su pública corresponda a la solicitada. No se conserva una clave privada descifrada en caché.
- Se limita la concurrencia del host a dos peticiones y las conexiones del socket a 32; hay topes de tiempo
  para el buzón y los sockets. Las tramas fragmentadas se reúnen y las concatenadas se procesan en orden;
  la entrada acumulada de cada socket también está limitada a 256 KiB más su cabecera.

## Registro

`logs/ssh.log` recibe perfil, operación y cuándo, también en rechazos. Cada firma completada añade la huella
SHA-256 de la pública. No registra el reto firmado, la firma, la frase, las rutas de claves ni el token.

## Límites de la autorización

El permiso autoriza utilizar una clave, no un destino remoto. El agente puede pedir firmas arbitrarias con
una clave autorizada; la interfaz lo presenta como permiso de uso SSH. No se ofrecen restricciones por host,
confirmación por firma ni reenvío del agente. La configuración pública se actualiza al abrir la sesión; una
nueva clave autorizada puede requerir abrir otra sesión para actualizar sus `IdentityFile`.

Los mecanismos de `Match` que ejecutan órdenes y `ProxyCommand` no se trasladan. Tampoco se interpreta un
`IdentityFile` con tokens de destino sin resolver (`%h`, `%r`): no hay una ruta única que la persona pueda
autorizar. Esas conexiones requieren una ruta concreta en el config o una conexión gestionada por `tssh`.

## Verificación

Los `test-*.mts` de esta carpeta ejercen claves generadas por `ssh-keygen`, firmas verificadas con `crypto`,
mensajes malformados, permisos, revocación durante preguntas, catálogo, configuración y ausencia de montajes
o copias de claves. `test:ssh-config` comprueba las tres plataformas. El caso en
`e2e/perfiles-minimalista.spec.ts` cubre selección, persistencia y ventana de 900×620; necesita ejecutarse con
la app construida. Las conexiones reales y el arranque del socket en un contenedor se verifican con Docker.
El arnés fija siempre `TESSERA_E2E_SSH_DIR` a una carpeta inicialmente vacía del `userData` temporal, antes de
sembrar fixtures. Solo se admite esa variable si `lanzadaPorElArnes` confirma la marca del proceso. El spec de
claves genera veinte identidades y alias propios; no consulta el SSH real del usuario. El modal mantiene cada
clave en una fila, usa la tarjeta y el interruptor de Configuración y ofrece nombre, alias y carpeta completos en el tooltip.
La lista tiene desplazamiento propio para conservar visibles los controles a 900×620.

`test:gitcontainer`, con `TESSERA_TEST_SSH` y `TESSERA_TEST_SSH_DIR`, añade autenticación real como `clave`, solo
con el agente: comprueba primero que sin socket no entra, luego ejecuta una orden remota y verifica que no haya
privadas en SSH ni en el buzón del contenedor. Sin servidor se anuncia la omisión de ese caso.

## Archivos de la implementación

- `src/main/ssh/agente/`: `catalogo.ts`, `configuracion.ts`, `frases.ts`, `ipc.ts`, `lectorClaves.ts`,
  `permisos.ts`, `protocolo.ts`, `servicio.ts`, `textos.ts`, `bcrypt-pbkdf.d.ts` y sus cinco `test-*.mts`.
- Composición: `src/main/index.ts`, `src/main/ssh/componer.ts`, `src/main/agentes/componer.ts`.
- Perfiles y contrato: `src/main/perfiles/types.ts`, `validar.ts`, `src/shared/ssh-agente-ipc.ts`,
  `src/preload/index.ts`.
- Contenedor: `src/main/sandbox/gestor/montajes.ts`, `gestor/nombres.ts`,
  `src/main/agentes/gitEnContenedor.ts`, `src/tssh/ssh-agente.cjs`.
- `src/renderer/src/features/pestanas/`: `ModalClavesAgente.tsx`, `clavesAgente.css`,
  `textosClavesAgente.ts`, `CapasPerfil.tsx`, `DialogosPerfil.tsx`, `MenuContextualPerfil.tsx`,
  `modeloPestanas.ts`, `useAccionesPerfil.ts`, `useAccionesPestanas.ts`.
- Aceptación: `src/main/sandbox/test-ssh-config.mts`, `test-ssh-montaje.mts`,
  `src/main/agentes/test-git-en-contenedor.mts`, `e2e/perfiles-minimalista.spec.ts`.
- Decisiones: este ADR, `../sandbox/ssh-global.md` y `../sandbox/el-agente-pide-tessera-ejecuta.md`.
