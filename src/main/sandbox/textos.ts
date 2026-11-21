// =============================================================================
// Textos del sandbox que llegan a la persona: el progreso de actualizar los agentes en Docker, los avisos y
// errores de contenedores, montajes e imagen, y las filas del diagnóstico de la red del anfitrión.
// Español e inglés juntos; se leen al usarse. Depende solo de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txSandbox = crearTextos(
  {
    actualizar: {
      iniciandoDocker: 'Docker estaba detenido: Tessera lo está iniciando…',
      reconstruyendo: 'Reconstruyendo la imagen de agentes (docker build --no-cache)… puede tardar unos minutos.',
      horneado: (codex: string, claude: string) => `✓ Incluido en la imagen: ${codex} · ${claude}`,
      recreando: 'Recreando contenedores (los agentes activos se reinician automáticamente)…',
      listo: '✓ Listo. Los agentes se reabrirán sobre la versión nueva.',
      error: (e: string) => `✕ Error: ${e}`
    },
    contenedorAjeno: (nombre: string) =>
      `Ya existe un contenedor "${nombre}" que no creó Tessera. Tessera no detiene ni elimina ` +
      'contenedores ajenos. Cámbiele el nombre (docker rename) para poder usar el ' +
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
      nsenterSalio: (estado: number | null) => `nsenter salió con ${estado}`,
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
        'El sandbox se construye sin ellos; revíselos en Configuración › Proyectos › Sandbox de Docker.',
      listaSinExtras: 'Imagen del sandbox lista (sin los paquetes extra).',
      fallaReconstruccion: (imagen: string, codigo: number | null) =>
        `Falló la reconstrucción de la imagen "${imagen}" (docker build salió con ${codigo}).`
    },
    capa: {
      sinCapa: 'No se pudo preparar la capa de los agentes propios de este perfil: se usa la imagen base, sin ellos.',
      instalando: 'Instalando los agentes propios en la imagen de este perfil…',
      fallo: 'Falló la instalación (revise el registro anterior).',
      noSeComprobo: (detalle: string) => `Se instaló, pero no se pudo comprobar la imagen: ${detalle}`
    },
    arranque: {
      noSeLanzo: 'Tessera intentó iniciar Docker, pero no encontró cómo hacerlo en este equipo.',
      noRespondio: (minutos: number) => `Tessera inició Docker, pero el motor no respondió en ${minutos} minutos.`
    },
    diagnostico: {
      motor: 'El motor de Docker no responde.',
      queVerificar: 'Qué verificar:',
      salidaIlegible: (nombre: string) =>
        `docker inspect ${nombre} devolvió una salida que no se pudo interpretar; ` +
        'no se modifica nada del perfil hasta poder consultarlo.',
      dockerSalio: (estado: number | null) => `docker salió con ${estado}`,
      noSeConsulto: (nombre: string, motivo: string) =>
        `No se pudo consultar el estado del contenedor "${nombre}" (${motivo}). ` +
        'No se recrea ni se desmonta nada: el contenedor podría seguir en ejecución.'
    },
    red: {
      sondaTitulo: (tuEquipo: string) => `La red del anfitrión no está llegando a ${tuEquipo}`,
      sondaDetalle: (perfil: string, tuEquipo: string) =>
        `El contenedor de "${perfil}" se creó solicitando la red del anfitrión, pero una prueba real no llegó a ` +
        `${tuEquipo}. Suele deberse a que "Enable host networking" está desactivado en Docker Desktop (Settings › Resources › ` +
        'Network). Abra "Red del contenedor" en el menú del perfil, dentro de "Agentes en Docker", para ver el diagnóstico completo.'
    },
    prevuelo: {
      motorTitulo: 'Docker responde',
      motorRemedio: 'Abra Docker Desktop y espere a que el motor esté en marcha.',
      linuxTitulo: 'Docker ejecuta contenedores Linux',
      linuxRemedio:
        'Docker está en modo de contenedores Windows, y la red del anfitrión solo existe para contenedores Linux. Cambie el modo desde el icono de Docker en la bandeja del sistema.',
      motorOk: 'Docker responde y ejecuta contenedores Linux',
      versionTitulo: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor} o posterior`,
      versionDesconocida:
        'No se reconoció Docker Desktop (puede ser Docker Engine u otra distribución). Lo que decide es la comprobación del tráfico, más abajo.',
      versionVieja: (tmayor: number, tmenor: number, mayor: number, menor: number) =>
        `La versión instalada es la ${tmayor}.${tmenor}. La red del anfitrión llegó a Docker Desktop en la versión ${mayor}.${menor}; actualice Docker Desktop.`,
      versionOk: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor}`,
      ajusteTitulo: '"Enable host networking" en Docker Desktop',
      ajusteDesconocido:
        'No se pudo leer la configuración de Docker Desktop. Lo que decide es la comprobación del tráfico, más abajo.',
      ajusteApagado:
        'Está desactivado, y viene así de fábrica. Actívelo en Docker Desktop › Settings › Resources › Network y haga clic en "Apply and restart".',
      ajusteOk: '"Enable host networking" activado',
      aislamientoTitulo: '"Enhanced Container Isolation" desactivado',
      aislamientoDesconocido: 'No se pudo leer la configuración de Docker Desktop.',
      aislamientoActivo: (tuEquipo: string) =>
        `Está activado. Aislar el contenedor de ${tuEquipo} y darle acceso a su red son objetivos opuestos, y Docker no permite combinarlos: desmárquelo en Docker Desktop › Settings › General. Si su organización lo impone por política, este modo no está disponible aquí.`,
      traficoTitulo: (tuEquipo: string) => `El tráfico llega de verdad a ${tuEquipo}`,
      traficoDesconocido: 'No se pudo completar la comprobación.',
      traficoWindows: (tuEquipo: string) =>
        `El puerto de prueba no llegó a ${tuEquipo}. Si actualizó WSL recientemente, Docker documenta una incompatibilidad de esta función con los kernels recientes de WSL 2: pruebe "wsl --update --rollback" y reinicie Docker Desktop.`,
      traficoOtra: (tuEquipo: string) =>
        `El puerto de prueba no llegó a ${tuEquipo}. Reinicie Docker Desktop después de aplicar el ajuste de red; si el resultado es el mismo, este modo no está operativo en esta máquina y el perfil funcionará mejor en red aislada.`,
      salidaVpnEspejo:
        'WSL está en modo espejo, por lo que los contenedores de todos los perfiles salen por la VPN que esté activa. No depende de esta opción.',
      salidaVpnNat:
        'WSL está en modo NAT: los contenedores no usan la VPN que esté activa. Esto es independiente de esta opción y se corrige en %USERPROFILE%\\.wslconfig con networkingMode=mirrored (y después "wsl --shutdown").'
    }
  },
  {
    actualizar: {
      iniciandoDocker: 'Docker was stopped: Tessera is starting it…',
      reconstruyendo: 'Rebuilding the agent image (docker build --no-cache)… this might take a few minutes.',
      horneado: (codex: string, claude: string) => `✓ Included in the image: ${codex} · ${claude}`,
      recreando: 'Recreating containers (active agents restart automatically)…',
      listo: '✓ Done. Agents will reopen with the new version.',
      error: (e: string) => `✕ Error: ${e}`
    },
    contenedorAjeno: (nombre: string) =>
      `A container named "${nombre}" already exists, but Tessera did not create it, and Tessera does not remove ` +
      'containers it did not create. Rename it (docker rename) to use ' +
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
      nsenterSalio: (estado: number | null) => `nsenter exited with code ${estado}`,
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
        'The extra packages could not be installed (is one of the names missing from Debian?). ' +
        'The sandbox is being built without them; check them in Settings › Projects › Docker sandbox.',
      listaSinExtras: 'Docker sandbox image ready (without the extra packages).',
      fallaReconstruccion: (imagen: string, codigo: number | null) =>
        `Rebuilding image "${imagen}" failed (docker build exited with code ${codigo}).`
    },
    capa: {
      sinCapa: "Could not prepare this profile's custom-agent layer: Tessera uses the base image without them.",
      instalando: "Installing the custom agents into this profile's image…",
      fallo: 'The installation failed (see the log above).',
      noSeComprobo: (detalle: string) => `It was installed, but the image could not be checked: ${detalle}`
    },
    arranque: {
      noSeLanzo: 'Tessera tried to start Docker but found no way to do so on this computer.',
      noRespondio: (minutos: number) => `Tessera started Docker, but the engine did not respond within ${minutos} minutes.`
    },
    diagnostico: {
      motor: 'The Docker engine is not responding.',
      queVerificar: 'What to check:',
      salidaIlegible: (nombre: string) =>
        `docker inspect ${nombre} returned output that could not be interpreted; ` +
        "Tessera does not change anything in the profile until it can query the container.",
      dockerSalio: (estado: number | null) => `docker exited with code ${estado}`,
      noSeConsulto: (nombre: string, motivo: string) =>
        `Could not query the state of container "${nombre}" (${motivo}). ` +
        'Nothing is recreated or unmounted: it might still be running.'
    },
    red: {
      sondaTitulo: (tuEquipo: string) => `The host network is not reaching ${tuEquipo}`,
      sondaDetalle: (perfil: string, tuEquipo: string) =>
        `The container for "${perfil}" was created with the host network, but a real test did not reach ` +
        `${tuEquipo}. This usually happens because "Enable host networking" is off in Docker Desktop (Settings › Resources › ` +
        'Network). Open "Container network" in the profile menu, under "Agents in Docker", to see the full diagnosis.'
    },
    prevuelo: {
      motorTitulo: 'Docker is responding',
      motorRemedio: 'Open Docker Desktop and wait for the engine to start.',
      linuxTitulo: 'Docker runs Linux containers',
      linuxRemedio:
        'Docker is in Windows containers mode, and the host network exists only for Linux containers. Switch modes from the Docker icon in the system tray.',
      motorOk: 'Docker is responding and runs Linux containers',
      versionTitulo: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor} or later`,
      versionDesconocida:
        'Docker Desktop was not recognized (it might be Docker Engine or another distribution). The traffic check below is what decides.',
      versionVieja: (tmayor: number, tmenor: number, mayor: number, menor: number) =>
        `You have ${tmayor}.${tmenor}. Host networking became available in Docker Desktop ${mayor}.${menor}; update Docker Desktop.`,
      versionOk: (mayor: number, menor: number) => `Docker Desktop ${mayor}.${menor}`,
      ajusteTitulo: '"Enable host networking" in Docker Desktop',
      ajusteDesconocido:
        'The Docker Desktop settings could not be read. The traffic check below is what decides.',
      ajusteApagado:
        'It is off, which is the default. Turn it on in Docker Desktop › Settings › Resources › Network and click "Apply and restart".',
      ajusteOk: '"Enable host networking" is on',
      aislamientoTitulo: '"Enhanced Container Isolation" off',
      aislamientoDesconocido: 'The Docker Desktop settings could not be read.',
      aislamientoActivo: (tuEquipo: string) =>
        `It is on. Isolating the container from ${tuEquipo} and giving it access to that network are mutually exclusive, and Docker does not allow both: turn it off in Docker Desktop › Settings › General. If your organization enforces it through a policy, this mode is not available here.`,
      traficoTitulo: (tuEquipo: string) => `Traffic actually reaches ${tuEquipo}`,
      traficoDesconocido: 'The check could not be completed.',
      traficoWindows: (tuEquipo: string) =>
        `The test port did not reach ${tuEquipo}. If you updated WSL recently, Docker documents an incompatibility between this feature and recent WSL 2 kernels: try "wsl --update --rollback" and restart Docker Desktop.`,
      traficoOtra: (tuEquipo: string) =>
        `The test port did not reach ${tuEquipo}. Restart Docker Desktop after applying the network setting; if nothing changes, this mode does not work on this computer, and the profile will work better on an isolated network.`,
      salidaVpnEspejo:
        'WSL is in mirrored mode, so containers in all profiles send their traffic through your active VPN. This option does not affect that.',
      salidaVpnNat:
        'WSL is in NAT mode: containers do NOT send their traffic through your active VPN. This option does not affect that; to change it, set networkingMode=mirrored in %USERPROFILE%\\.wslconfig (then run "wsl --shutdown").'
    }
  }
)
