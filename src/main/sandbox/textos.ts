// =============================================================================
// Textos del sandbox que llegan a la persona: el progreso de «Actualizar agentes», los avisos y
// errores de contenedores, montajes e imagen, y las filas del diagnóstico de la red del anfitrión.
// Español e inglés juntos; se leen al usarse. Depende solo de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txSandbox = crearTextos(
  {
    actualizar: {
      reconstruyendo: 'Reconstruyendo la imagen de agentes (docker build --no-cache)… puede tardar unos minutos.',
      horneado: (codex: string, claude: string) => `✓ Horneado en la imagen: ${codex} · ${claude}`,
      recreando: 'Recreando contenedores (los agentes activos se reinician solos)…',
      listo: '✓ Listo. Los agentes se reabrirán sobre la versión nueva.',
      error: (e: string) => `✕ Error: ${e}`
    },
    contenedorAjeno: (nombre: string) =>
      `Ya existe un contenedor «${nombre}» que no creó Tessera, y Tessera no borra ni para ` +
      'contenedores ajenos. Cámbiale el nombre (docker rename) para poder usar el ' +
      'aislamiento de este perfil.',
    progreso: {
      deteniendo: 'Deteniendo contenedores…',
      sinContenedores: 'Sin contenedores activos',
      detenido: (nombre: string) => `Contenedor detenido: ${nombre}`,
      liberando: 'Liberando montajes…',
      verificando: 'Verificando…',
      listo: 'Listo'
    },
    contenedores: {
      noSeCreo: (nombre: string, err: string) => `No se pudo crear el contenedor "${nombre}": ${err}`,
      noSeDetuvo: (nombre: string, err: string) => `No se pudo detener el contenedor "${nombre}": ${err}`,
      noSeElimino: (nombre: string, err: string) => `No se pudo eliminar el contenedor "${nombre}": ${err}`
    },
    montajes: {
      nsenterSalio: (status: number | null) => `nsenter salió con ${status}`,
      noSePrepararon: (descripcion: string, raiz: string, motivo: string) =>
        `No se pudo preparar ${descripcion} (${raiz}): ${motivo}`,
      noSeMontoProyecto: (proyecto: string, perfil: string, motivo: string) =>
        `No se pudo montar el proyecto "${proyecto}" en el perfil "${perfil}": ${motivo}`,
      noSeDesmontoProyecto: (proyecto: string, perfil: string, motivo: string) =>
        `No se pudo desmontar el proyecto "${proyecto}" del perfil "${perfil}": ${motivo}`,
      noSeMontaronCredenciales: (agente: string, perfil: string, motivo: string) =>
        `No se pudieron montar las credenciales del agente "${agente}" del perfil "${perfil}": ${motivo}`,
      noSeDesmontaronCredenciales: (agente: string, perfil: string, motivo: string) =>
        `No se pudieron desmontar las credenciales del agente "${agente}" del perfil "${perfil}": ${motivo}`
    },
    imagen: {
      preparando: (motivo: string) => `La imagen del sandbox ${motivo}: preparándola…`,
      desactualizada: 'está desactualizada',
      noExiste: 'no existe',
      lista: 'Imagen del sandbox lista.',
      noSeConstruyo: (imagen: string, dir: string) => `No se pudo construir la imagen "${imagen}" desde "${dir}".`,
      extrasFallidos:
        'No se pudieron instalar los paquetes extra (¿algún nombre no existe en Debian?). ' +
        'Se construye el sandbox SIN ellos; revísalos en Configuración → Proyectos → Sandbox de Docker.',
      listaSinExtras: 'Imagen del sandbox lista (sin los paquetes extra).',
      fallaReconstruccion: (imagen: string, codigo: number | null) =>
        `Falló la reconstrucción de la imagen "${imagen}" (docker build salió con ${codigo}).`
    },
    capa: {
      sinCapa: 'No se pudo preparar la capa de los agentes manuales de este perfil: se usa la imagen base, sin ellos.',
      instalando: 'Instalando los agentes manuales en la imagen de este perfil…',
      fallo: 'Falló la instalación (mira el registro de arriba).',
      noSeComprobo: (detalle: string) => `Se instaló, pero no se pudo comprobar la imagen: ${detalle}`
    },
    diagnostico: {
      daemon: 'El daemon de Docker no responde.',
      queVerificar: 'Que verificar:',
      salidaIlegible: (nombre: string) =>
        `docker inspect ${nombre} devolvió una salida que no se pudo interpretar; ` +
        'no se toca nada del perfil hasta poder consultarlo.',
      dockerSalio: (status: number | null) => `docker salió con ${status}`,
      noSeConsulto: (nombre: string, motivo: string) =>
        `No se pudo consultar el estado del contenedor "${nombre}" (${motivo}). ` +
        'No se recrea ni se desmonta nada: podría estar vivo.'
    },
    red: {
      sondaTitulo: (tuEquipo: string) => `La red del anfitrión no está llegando a ${tuEquipo}`,
      sondaDetalle: (perfil: string, tuEquipo: string) =>
        `El contenedor de “${perfil}” se creó pidiendo la red del anfitrión, pero una prueba real no llegó a ` +
        `${tuEquipo}. Suele ser que «Enable host networking» está desactivado en Docker Desktop (Settings › Resources › ` +
        'Network). Abre «Red del contenedor…» en el menú del perfil para ver el diagnóstico completo.'
    },
    prevuelo: {
      motorTitulo: 'Docker responde',
      motorRemedio: 'Abre Docker Desktop y espera a que el motor esté en marcha.',
      linuxTitulo: 'Docker ejecuta contenedores Linux',
      linuxRemedio:
        'Docker está en modo de contenedores Windows, y la red del anfitrión sólo existe para contenedores Linux. Cámbialo desde el icono de Docker en la bandeja del sistema.',
      motorOk: 'Docker responde y ejecuta contenedores Linux',
      versionTitulo: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor} o posterior`,
      versionDesconocida:
        'No se reconoció Docker Desktop (puede ser Docker Engine u otra distribución). Lo que decide es la comprobación del tráfico, más abajo.',
      versionVieja: (tmayor: number, tmenor: number, mayor: number, menor: number) =>
        `Tienes la ${tmayor}.${tmenor}. La red del anfitrión llegó a Docker Desktop en la ${mayor}.${menor}; actualiza Docker Desktop.`,
      versionOk: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor}`,
      ajusteTitulo: '«Enable host networking» en Docker Desktop',
      ajusteDesconocido:
        'No se pudo leer la configuración de Docker Desktop. Lo que decide es la comprobación del tráfico, más abajo.',
      ajusteApagado:
        'Está desactivado, y viene así de fábrica. Actívalo en Docker Desktop › Settings › Resources › Network y pulsa «Apply and restart».',
      ajusteOk: '«Enable host networking» activado',
      aislamientoTitulo: '«Enhanced Container Isolation» desactivado',
      aislamientoDesconocido: 'No se pudo leer la configuración de Docker Desktop.',
      aislamientoActivo: (tuEquipo: string) =>
        `Está activado. Aislar el contenedor de ${tuEquipo} y darle su red son lo contrario, y Docker no deja hacer las dos cosas a la vez: desmárcalo en Docker Desktop › Settings › General. Si tu organización lo impone por política, este modo no está disponible aquí.`,
      traficoTitulo: (tuEquipo: string) => `El tráfico llega de verdad a ${tuEquipo}`,
      traficoDesconocido: 'No se pudo completar la comprobación.',
      traficoWindows: (tuEquipo: string) =>
        `El puerto de prueba no llegó a ${tuEquipo}. Si actualizaste WSL hace poco, Docker documenta una incompatibilidad de esta función con los kernels recientes de WSL 2: prueba «wsl --update --rollback» y reinicia Docker Desktop.`,
      traficoOtra: (tuEquipo: string) =>
        `El puerto de prueba no llegó a ${tuEquipo}. Reinicia Docker Desktop después de aplicar el ajuste de red; si sigue igual, este modo no está operativo en esta máquina y el perfil funcionará mejor en red aislada.`,
      egressEspejo:
        'WSL está en modo espejo, así que los contenedores de todos los perfiles salen por la VPN que tengas activa. No depende de esta opción.',
      egressNat:
        'WSL está en modo NAT: los contenedores NO siguen a la VPN que tengas activa. Eso es independiente de esta opción y se arregla en %USERPROFILE%\\.wslconfig con networkingMode=mirrored (y luego «wsl --shutdown»).'
    }
  },
  {
    actualizar: {
      reconstruyendo: 'Rebuilding the agent image (docker build --no-cache)… this may take a few minutes.',
      horneado: (codex: string, claude: string) => `✓ Baked into the image: ${codex} · ${claude}`,
      recreando: 'Recreating containers (active agents restart by themselves)…',
      listo: '✓ Done. Agents will reopen on the new version.',
      error: (e: string) => `✕ Error: ${e}`
    },
    contenedorAjeno: (nombre: string) =>
      `A container named “${nombre}” already exists that Tessera did not create, and Tessera does not remove ` +
      'containers that are not its own. Rename it (docker rename) so you can use ' +
      "this profile's isolation.",
    progreso: {
      deteniendo: 'Stopping containers…',
      sinContenedores: 'No active containers',
      detenido: (nombre: string) => `Container stopped: ${nombre}`,
      liberando: 'Releasing mounts…',
      verificando: 'Verifying…',
      listo: 'Done'
    },
    contenedores: {
      noSeCreo: (nombre: string, err: string) => `Could not create container "${nombre}": ${err}`,
      noSeDetuvo: (nombre: string, err: string) => `Could not stop container "${nombre}": ${err}`,
      noSeElimino: (nombre: string, err: string) => `Could not remove container "${nombre}": ${err}`
    },
    montajes: {
      nsenterSalio: (status: number | null) => `nsenter exited with ${status}`,
      noSePrepararon: (descripcion: string, raiz: string, motivo: string) =>
        `Could not prepare ${descripcion} (${raiz}): ${motivo}`,
      noSeMontoProyecto: (proyecto: string, perfil: string, motivo: string) =>
        `Could not mount project "${proyecto}" in profile "${perfil}": ${motivo}`,
      noSeDesmontoProyecto: (proyecto: string, perfil: string, motivo: string) =>
        `Could not unmount project "${proyecto}" from profile "${perfil}": ${motivo}`,
      noSeMontaronCredenciales: (agente: string, perfil: string, motivo: string) =>
        `Could not mount the credentials of agent "${agente}" in profile "${perfil}": ${motivo}`,
      noSeDesmontaronCredenciales: (agente: string, perfil: string, motivo: string) =>
        `Could not unmount the credentials of agent "${agente}" from profile "${perfil}": ${motivo}`
    },
    imagen: {
      preparando: (motivo: string) => `The Docker sandbox image ${motivo}: preparing it…`,
      desactualizada: 'is out of date',
      noExiste: 'does not exist',
      lista: 'Docker sandbox image ready.',
      noSeConstruyo: (imagen: string, dir: string) => `Could not build image "${imagen}" from "${dir}".`,
      extrasFallidos:
        'The extra packages could not be installed (does a name not exist in Debian?). ' +
        'The sandbox is being built WITHOUT them; check them in Settings → Projects → Docker sandbox.',
      listaSinExtras: 'Docker sandbox image ready (without the extra packages).',
      fallaReconstruccion: (imagen: string, codigo: number | null) =>
        `Rebuilding image "${imagen}" failed (docker build exited with ${codigo}).`
    },
    capa: {
      sinCapa: "Could not prepare this profile's manual-agents layer: the base image is used, without them.",
      instalando: "Installing the manual agents into this profile's image…",
      fallo: 'The installation failed (see the log above).',
      noSeComprobo: (detalle: string) => `It was installed, but the image could not be checked: ${detalle}`
    },
    diagnostico: {
      daemon: 'The Docker daemon is not responding.',
      queVerificar: 'What to check:',
      salidaIlegible: (nombre: string) =>
        `docker inspect ${nombre} returned output that could not be interpreted; ` +
        "nothing in the profile is touched until it can be queried.",
      dockerSalio: (status: number | null) => `docker exited with ${status}`,
      noSeConsulto: (nombre: string, motivo: string) =>
        `Could not query the state of container "${nombre}" (${motivo}). ` +
        'Nothing is recreated or unmounted: it might still be alive.'
    },
    red: {
      sondaTitulo: (tuEquipo: string) => `The host network is not reaching ${tuEquipo}`,
      sondaDetalle: (perfil: string, tuEquipo: string) =>
        `The container for “${perfil}” was created asking for the host network, but a real test did not reach ` +
        `${tuEquipo}. This is usually because “Enable host networking” is off in Docker Desktop (Settings › Resources › ` +
        'Network). Open “Container network…” in the profile menu to see the full diagnosis.'
    },
    prevuelo: {
      motorTitulo: 'Docker is responding',
      motorRemedio: 'Open Docker Desktop and wait for the engine to be running.',
      linuxTitulo: 'Docker runs Linux containers',
      linuxRemedio:
        'Docker is in Windows containers mode, and the host network only exists for Linux containers. Switch it from the Docker icon in the system tray.',
      motorOk: 'Docker is responding and runs Linux containers',
      versionTitulo: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor} or later`,
      versionDesconocida:
        'Docker Desktop was not recognized (it may be Docker Engine or another distribution). What decides is the traffic check, below.',
      versionVieja: (tmayor: number, tmenor: number, mayor: number, menor: number) =>
        `You have ${tmayor}.${tmenor}. The host network arrived in Docker Desktop ${mayor}.${menor}; update Docker Desktop.`,
      versionOk: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor}`,
      ajusteTitulo: '“Enable host networking” in Docker Desktop',
      ajusteDesconocido:
        'The Docker Desktop settings could not be read. What decides is the traffic check, below.',
      ajusteApagado:
        'It is off, and ships that way by default. Turn it on in Docker Desktop › Settings › Resources › Network and click “Apply and restart”.',
      ajusteOk: '“Enable host networking” is on',
      aislamientoTitulo: '“Enhanced Container Isolation” off',
      aislamientoDesconocido: 'The Docker Desktop settings could not be read.',
      aislamientoActivo: (tuEquipo: string) =>
        `It is on. Isolating the container from ${tuEquipo} and giving it its network are opposites, and Docker does not allow both at once: turn it off in Docker Desktop › Settings › General. If your organization enforces it by policy, this mode is not available here.`,
      traficoTitulo: (tuEquipo: string) => `Traffic really reaches ${tuEquipo}`,
      traficoDesconocido: 'The check could not be completed.',
      traficoWindows: (tuEquipo: string) =>
        `The test port did not reach ${tuEquipo}. If you updated WSL recently, Docker documents an incompatibility of this feature with recent WSL 2 kernels: try “wsl --update --rollback” and restart Docker Desktop.`,
      traficoOtra: (tuEquipo: string) =>
        `The test port did not reach ${tuEquipo}. Restart Docker Desktop after applying the network setting; if it stays the same, this mode is not working on this machine and the profile will do better on an isolated network.`,
      egressEspejo:
        'WSL is in mirrored mode, so the containers of all profiles go out through whichever VPN you have active. It does not depend on this option.',
      egressNat:
        'WSL is in NAT mode: containers do NOT follow whichever VPN you have active. That is independent of this option and is fixed in %USERPROFILE%\\.wslconfig with networkingMode=mirrored (then “wsl --shutdown”).'
    }
  }
)
