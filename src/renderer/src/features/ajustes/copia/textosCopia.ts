// =============================================================================
// Textos de los modales de exportar e importar la configuración, en español e inglés. Los plurales
// de ambos idiomas distinguen el singular del plural. Se leen al usarse.
// Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

const s = (n: number): string => (n === 1 ? '' : 's')

export const txCopia = crearTextos(
  {
    comun: {
      cerrar: 'Cerrar',
      cancelar: 'Cancelar',
      frase: 'Frase de contraseña',
      lista: (xs: readonly string[]) => xs.map((a) => `«${a}»`).join(', ')
    },
    exportar: {
      apartados: {
        ssh: 'Conexiones SSH (con sus contraseñas, claves y huellas)',
        bd: 'Conexiones de bases de datos (con sus contraseñas)',
        agentes: 'Agentes propios',
        configDocker: 'Contexto global de los agentes y configuración de Docker de cada perfil (las reglas de cada perfil viajan con él)',
        archivosCuentas: 'Archivos de las cuentas de Docker (CLAUDE.md y settings.json, AGENTS.md y config.toml)',
        reglasNativas: 'Reglas de los agentes nativos de este equipo (CLAUDE.md y AGENTS.md, sin su configuración técnica)',
        ajustes: 'Ajustes de Tessera (sin los tamaños de los paneles)'
      },
      guardado: (nombre: string) => `Guardado en «${nombre}».`,
      resumen: (perfiles: number, ssh: number, bd: number, agentes: number, sinFrase: boolean) =>
        `${perfiles} ${perfiles === 1 ? 'perfil' : 'perfiles'}, ${ssh} ${ssh === 1 ? 'conexión' : 'conexiones'} SSH, ${bd} de bases de datos y ${agentes} ${agentes === 1 ? 'agente propio' : 'agentes propios'}. ${
          sinFrase
            ? 'El archivo no está cifrado: quien lo tenga puede leer sus contraseñas y claves. Elimínelo cuando ya no lo necesite.'
            : 'Conserve la frase de contraseña: sin ella no se puede abrir el archivo.'
        }`,
      sinSecreto: (lista: string) =>
        `Estas conexiones se exportan sin su contraseña porque este equipo ya no puede leerla: ${lista}. Deberá escribirla de nuevo en el otro equipo.`,
      sinClave: (lista: string) =>
        `A estas conexiones SSH les falta su archivo de clave y no se podrán importar: ${lista}. Edítelas, seleccione de nuevo la clave y vuelva a exportar.`,
      elegirPerfil: 'Seleccione al menos un perfil.',
      perfiles: 'Perfiles',
      queLlevar: 'Qué incluir',
      fraseAyuda: (min: number) =>
        `Mínimo ${min} caracteres. Cifra todo el archivo; sin ella no se puede importar y Tessera no la guarda.`,
      repiteFrase: 'Repetir la frase de contraseña',
      sinFrase: 'Exportar sin frase de contraseña',
      sinFraseAviso:
        'El archivo no estará cifrado: las contraseñas de sus conexiones, sus claves SSH y la configuración y los archivos de los agentes, incluidas las cuentas de Docker y las reglas nativas (pueden incluir tokens de servidores MCP o variables de entorno), quedarán legibles para cualquiera que lo tenga (en una carpeta sincronizada, un correo o una memoria USB). Guárdelo y elimínelo bajo su responsabilidad.',
      titulo: 'Exportar la configuración',
      subtitulo: 'Para llevarla a otro equipo. No incluye los proyectos abiertos ni las sesiones iniciadas de los agentes.',
      exportando: 'Exportando…',
      exportar: 'Exportar…',
      historial: 'Historial de conversaciones',
      historialAyuda:
        'Las conversaciones con los agentes en las cuentas de Docker de los perfiles seleccionados. Solo se incluyen las conversaciones, no las sesiones iniciadas ni los ajustes de los agentes.',
      historialNativo: 'Incluir el historial nativo de este equipo (Claude Code y Codex)',
      historialCargando: 'Contando conversaciones…',
      historialVacio: 'No hay conversaciones que incluir.',
      historialNoSeLeyo: (motivo: string) => `No se pudo contar el historial: ${motivo}`,
      historialFila: (n: number, tam: string) => `${n} ${n === 1 ? 'conversación' : 'conversaciones'} · ${tam}`,
      historialTotal: (n: number, tam: string) => `En total: ${n} ${n === 1 ? 'conversación' : 'conversaciones'} · ${tam}`,
      historialGrande: (tam: string) => `El historial ocupa ${tam}: la exportación tardará y el archivo será grande.`,
      historialSinFrase:
        'Además incluye las conversaciones con los agentes, que pueden contener código y datos de sus proyectos: también quedarán legibles.',
      resumenHistorial: (n: number, tam: string) => `Historial: ${n} ${n === 1 ? 'conversación' : 'conversaciones'} (${tam}).`,
      resumenArchivos: (cuentas: number, nativos: number) =>
        `Archivos de los agentes: ${cuentas} ${cuentas === 1 ? 'cuenta de Docker' : 'cuentas de Docker'} y ${nativos === 1 ? 'las reglas de 1 agente nativo' : `las reglas de ${nativos} agentes nativos`}.`,
      archivosBloqueados: (lista: string) => `Estos archivos no se exportan porque no se pueden leer con seguridad: ${lista}.`,
      historialSaltadas: (n: number) =>
        `${n} ${n === 1 ? 'archivo del historial desapareció o estaba bloqueado' : 'archivos del historial desaparecieron o estaban bloqueados'} durante la exportación (un agente ${n === 1 ? 'lo comprimió o lo eliminó' : 'los comprimió o los eliminó'}) y ${n === 1 ? 'no se incluye' : 'no se incluyen'} en la copia.`,
      deEsteEquipo: 'este equipo'
    },
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    predeterminada: 'Predeterminada',
    importar: {
      queImportar: 'Qué importar',
      previaAyuda:
        'Desmarque lo que no desee importar y elija el perfil de destino de cada elemento: uno nuevo o uno de este equipo. Lo que ya existe aquí no se modifica.',
      todo: 'Todo',
      recuento: (marcadas: number, total: number) => `${marcadas} de ${total} seleccionados`,
      perfilNuevo: 'Perfil nuevo',
      anadirA: (perfil: string) => `Añadir a «${perfil}»`,
      destinoDe: (perfil: string) => `Destino de «${perfil}»`,
      reglas: 'Reglas del perfil',
      reglasTraer: 'el perfil de este equipo no tiene reglas: se importan las del archivo',
      reglasIguales: 'Iguales',
      reglasDe: (perfil: string) => `Reglas de «${perfil}»`,
      mantenerReglas: 'Mantener las de este equipo',
      sustituirReglas: 'Sustituir por las del archivo',
      verDiferencias: 'Ver diferencias',
      ocultarDiferencias: 'Ocultar diferencias',
      diferenciasAyuda: 'A la izquierda, las reglas de este equipo; a la derecha, las del archivo.',
      reglasHecho: (perfiles: string) => `Reglas del archivo aplicadas en ${perfiles}.`,
      yaEsta: 'Ya existe',
      tipo: { ssh: 'SSH', bd: 'Base de datos', agente: 'Agente', nativo: 'Agente', historial: 'Historial' },
      nativos: 'Agentes nativos (de todo el equipo)',
      historialNativo: 'Historial nativo de los agentes (va a la carpeta de este equipo)',
      historialHecho: (importadas: number, actualizadas: number, alDia: number, conservadas: number, saltadas: number) =>
        `Historial: ${importadas} ${importadas === 1 ? 'conversación nueva' : 'conversaciones nuevas'}, ${actualizadas} ${actualizadas === 1 ? 'actualizada' : 'actualizadas'}, ${alDia} ${alDia === 1 ? 'ya estaba' : 'ya estaban'} al día, ${conservadas} ${conservadas === 1 ? 'conservada' : 'conservadas'} y ${saltadas} ${saltadas === 1 ? 'omitida' : 'omitidas'}.`,
      historialRutaCambiada: (n: number) => `${n} ${n === 1 ? 'conversación' : 'conversaciones'} ${n === 1 ? 'se guardó' : 'se guardaron'} bajo la ruta que su proyecto tiene en este equipo.`,
      historialConservadas: 'Se conservó la versión de este equipo:',
      historialRutaOriginal: 'Se conservaron con la ruta de origen (aparecerán al abrir el proyecto en esa ruta):',
      historialCarpeta: (carpeta: string, n: number, motivo: string) => `«${carpeta}» (${n}): ${motivo}`,
      historialSaltadas: 'No se importaron:',
      historialSesion: 'Las sesiones iniciadas de las cuentas no se transfieren: inicie sesión en cada cuenta nueva para continuar sus conversaciones.',
      ajustes: 'Ajustes de Tessera (sustituyen los ajustes de este equipo)',
      configDocker: 'Configuración de Docker del perfil',
      configGlobal: 'Contexto global de los agentes: reglas y configuración de Docker, para todos los perfiles',
      configIgual: 'Igual',
      configSustituye: 'distinta de la de este equipo: si la marca, la sustituye; la anterior se puede recuperar desde el editor',
      configSustituyeGlobal:
        'distinto del de este equipo: si lo marca, lo sustituye. La configuración de Docker anterior se puede recuperar desde el editor; si el archivo trae reglas globales, sustituyen a las de este equipo y las anteriores no se pueden recuperar',
      configHecho: (niveles: readonly string[]) => `Se importó ${niveles.length > 1 ? `${niveles.slice(0, -1).join(', ')} y ${niveles.at(-1)}` : niveles[0]}.`,
      cuentaAgente: (agente: string, cuenta: string) => `Cuenta de ${agente} «${cuenta}»`,
      cuentaNueva: 'la cuenta es nueva: se crea',
      archivoTraer: 'este equipo no lo tiene: se crea',
      archivoIgual: 'Igual',
      archivoBloqueado: 'No se puede leer',
      mantenerArchivo: 'Mantener el de este equipo',
      sustituirArchivo: 'Sustituir por el del archivo',
      eleccionArchivoDe: (archivo: string) => `Qué hacer con ${archivo}`,
      diferenciasArchivoAyuda: 'A la izquierda, el archivo de este equipo; a la derecha, el del archivo importado.',
      diferenciasCargando: 'Cargando diferencias…',
      diferenciasNoDisponibles: 'No se pueden mostrar las diferencias: el archivo cambió o ya no está disponible.',
      reglasNativas: (agente: string) => `Reglas de ${agente}`,
      reglasNativaTraer: 'este equipo no tiene: si lo marca, se crea',
      reglasNativaDe: (agente: string) => `Reglas de ${agente} en este equipo`,
      archivosInvalidos: (lista: string) => `Estos archivos no se pueden importar porque no son válidos: ${lista}.`,
      archivosCreados: 'Archivos creados:',
      archivosSustituidos: 'Archivos sustituidos (la versión anterior queda junto a cada uno):',
      confirmar: {
        titulo: (n: number) => `¿Sustituir ${n} ${n === 1 ? 'archivo' : 'archivos'} de este equipo?`,
        mensaje: 'La importación reemplazará lo siguiente. Tessera guarda la versión anterior junto a cada archivo.',
        mensajeParcial: 'La importación reemplazará lo siguiente. Tessera guarda la versión anterior de los archivos, salvo de lo que se indica.',
        mensajeNinguno: 'La importación reemplazará lo siguiente, y no queda una versión anterior que recuperar.',
        noRecuperable: 'No se podrá recuperar',
        volver: 'Volver a la lista',
        sustituir: 'Sustituir e importar',
        enPerfil: (perfil: string) => `Perfil «${perfil}»`,
        enPerfilArchivo: (perfil: string, archivo: string) => `Perfil «${perfil}» · ${archivo}`,
        paraTodos: 'Para todos los perfiles',
        reglasPerfil: 'Reglas del perfil',
        configPerfil: 'Configuración de Docker del perfil',
        reglasGlobales: 'Reglas globales de los agentes',
        configGlobal: 'Configuración global de Docker',
        reglasCuenta: (agente: string, cuenta: string) => `Reglas de ${agente} «${cuenta}»`,
        configCuenta: (agente: string, cuenta: string) => `Configuración de ${agente} «${cuenta}»`,
        reglasNativa: (agente: string) => `Reglas de ${agente} nativo`
      },
      marcadaTambien: (nombre: string, por: string) => `También se marca «${nombre}»: «${por}» la necesita.`,
      desmarcadaTambien: (nombre: string, por: string) => `También se desmarca «${nombre}»: necesita «${por}».`,
      nadaMarcado: 'Marque al menos un elemento que importar.',
      perfilesInvalidos: (n: number) => `${n} ${n === 1 ? 'perfil del archivo no tiene una forma válida y no se importa' : 'perfiles del archivo no tienen una forma válida y no se importan'}.`,
      importado: 'Importado.',
      hecho: (nuevos: number, ssh: number, bd: number, agentes: number, ajustes: boolean) =>
        `${nuevos} ${nuevos === 1 ? 'perfil nuevo' : 'perfiles nuevos'}, ${ssh} ${ssh === 1 ? 'conexión' : 'conexiones'} SSH, ${bd} de bases de datos y ${agentes} ${agentes === 1 ? 'agente propio' : 'agentes propios'}${ajustes ? '; ajustes aplicados' : ''}.`,
      saltadasSsh: 'No se importaron estas conexiones SSH:',
      saltadasBd: 'No se importaron estas conexiones de bases de datos:',
      saltada: (alias: string, motivo: string) => `«${alias}»: ${motivo}`,
      capaFallida: (perfil: string, error: string | null) =>
        `Los agentes de «${perfil}» no se pudieron instalar en su imagen${error ? `: ${error}` : ''}. Edite uno de ellos para volver a intentarlo.`,
      errorFinal: (motivo: string) =>
        `No se pudo terminar de importar (${motivo}). Lo ya importado se conserva; vuelva a importar el archivo para completar el resto.`,
      importar: 'Importar',
      importando: 'Importando…',
      abriendo: 'Abriendo…',
      abrir: 'Abrir',
      titulo: 'Importar la configuración',
      cabecera: (nombre: string, sistema: string, fecha: string, app: string) =>
        `«${nombre}», exportado en ${sistema} el ${fecha} con Tessera ${app}.`,
      fraseAyuda: 'La frase de contraseña que se eligió al exportar.',
      sinCifrar:
        'Este archivo se exportó sin frase de contraseña y no está cifrado: cualquiera pudo leerlo o modificarlo. Impórtelo solo si conoce su origen y elimínelo después.',
      continuar: 'Continuar',
      sinCifrarPrevia:
        'Archivo sin cifrar: no hay nada marcado. Marque solo lo que reconozca, sobre todo los agentes (incluyen órdenes que se ejecutan) y los ajustes.',
      noSeAbrio: 'No se pudo abrir el archivo de configuración',
      progreso:
        'Importando… Si el archivo incluye agentes de Docker con órdenes de instalación o mucho historial de conversaciones, puede tardar unos minutos.'
    }
  },
  {
    comun: {
      cerrar: 'Close',
      cancelar: 'Cancel',
      frase: 'Passphrase',
      lista: (xs: readonly string[]) => xs.map((a) => `“${a}”`).join(', ')
    },
    exportar: {
      apartados: {
        ssh: 'SSH connections (with their passwords, keys and fingerprints)',
        bd: 'Databases (with their passwords)',
        agentes: 'Custom agents',
        configDocker: 'Global agent context and each profile’s Docker configuration (each profile’s rules travel with it)',
        archivosCuentas: 'Docker account files (CLAUDE.md and settings.json, AGENTS.md and config.toml)',
        reglasNativas: 'Rules of this computer’s native agents (CLAUDE.md and AGENTS.md, without their technical configuration)',
        ajustes: 'Tessera settings (excluding panel sizes)'
      },
      guardado: (nombre: string) => `Saved to “${nombre}”.`,
      resumen: (perfiles: number, ssh: number, bd: number, agentes: number, sinFrase: boolean) =>
        `${perfiles} profile${s(perfiles)}, ${ssh} SSH connection${s(ssh)}, ${bd} database connection${s(bd)} and ${agentes} custom agent${s(agentes)}. ${
          sinFrase
            ? 'The file is not encrypted: anyone who has it can read your passwords and keys. Delete it when you no longer need it.'
            : 'Keep the passphrase: without it the file cannot be opened.'
        }`,
      sinSecreto: (lista: string) =>
        `These connections are exported without their password because this computer can no longer read it: ${lista}. Enter it again on the other computer.`,
      sinClave: (lista: string) =>
        `These SSH connections are missing their key file and cannot be imported: ${lista}. Edit them, choose the key again and export again.`,
      elegirPerfil: 'Choose at least one profile.',
      perfiles: 'Profiles',
      queLlevar: 'What to include',
      fraseAyuda: (min: number) =>
        `At least ${min} characters. It encrypts the whole file; without it the file cannot be imported, and Tessera does not store it.`,
      repiteFrase: 'Repeat the passphrase',
      sinFrase: 'Export without a passphrase',
      sinFraseAviso:
        'The file will not be encrypted: your connection passwords, SSH keys and agent configuration and files, including Docker accounts and native rules (they may include MCP server tokens or environment variables), will be readable by anyone who has it (a synced folder, an email, a USB drive). Keeping it safe and deleting it is up to you.',
      titulo: 'Export settings',
      subtitulo: 'To move them to another computer. It does not include open projects or the agents’ signed-in sessions.',
      exportando: 'Exporting…',
      exportar: 'Export…',
      historial: 'Conversation history',
      historialAyuda:
        'Your conversations with the agents in the Docker accounts of the selected profiles. Only the conversations: no signed-in sessions or agent settings.',
      historialNativo: 'Include this computer’s native history (Claude Code and Codex)',
      historialCargando: 'Counting conversations…',
      historialVacio: 'There are no conversations to export.',
      historialNoSeLeyo: (motivo: string) => `The history could not be counted: ${motivo}`,
      historialFila: (n: number, tam: string) => `${n} conversation${s(n)} · ${tam}`,
      historialTotal: (n: number, tam: string) => `In total: ${n} conversation${s(n)} · ${tam}`,
      historialGrande: (tam: string) => `The history takes ${tam}: exporting it will take a while and the file will be large.`,
      historialSinFrase:
        'It also includes your conversations with the agents, which may contain code and data from your projects: they will be readable too.',
      resumenHistorial: (n: number, tam: string) => `History: ${n} conversation${s(n)} (${tam}).`,
      resumenArchivos: (cuentas: number, nativos: number) =>
        `Agent files: ${cuentas} Docker account${s(cuentas)} and the rules of ${nativos} native agent${s(nativos)}.`,
      archivosBloqueados: (lista: string) => `These files are not exported because they cannot be read safely: ${lista}.`,
      historialSaltadas: (n: number) =>
        `${n} history file${s(n)} disappeared or ${n === 1 ? 'was' : 'were'} locked during the export (an agent compressed or deleted ${n === 1 ? 'it' : 'them'}) and ${n === 1 ? 'is' : 'are'} not in the backup.`,
      deEsteEquipo: 'this computer'
    },
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    predeterminada: 'Default',
    importar: {
      queImportar: 'What to import',
      previaAyuda:
        'Clear what you do not want to import and choose where each profile goes: a new profile or one on this computer. What already exists here stays as it is.',
      todo: 'All',
      recuento: (marcadas: number, total: number) => `${marcadas} of ${total} selected`,
      perfilNuevo: 'New profile',
      anadirA: (perfil: string) => `Add to “${perfil}”`,
      destinoDe: (perfil: string) => `Destination of “${perfil}”`,
      reglas: 'Profile rules',
      reglasTraer: 'the profile here has none: the file’s rules are added',
      reglasIguales: 'Identical',
      reglasDe: (perfil: string) => `Rules of “${perfil}”`,
      mantenerReglas: 'Keep the ones here',
      sustituirReglas: 'Replace with the file’s rules',
      verDiferencias: 'Show differences',
      ocultarDiferencias: 'Hide differences',
      diferenciasAyuda: 'On the left, the rules on this computer; on the right, the rules in the file.',
      reglasHecho: (perfiles: string) => `Rules from the file applied to ${perfiles}.`,
      yaEsta: 'Already exists',
      tipo: { ssh: 'SSH', bd: 'Database', agente: 'Agent', nativo: 'Agent', historial: 'History' },
      nativos: 'Native agents (for the whole computer)',
      historialNativo: 'Native agent history (goes to this computer’s folder)',
      historialHecho: (importadas: number, actualizadas: number, alDia: number, conservadas: number, saltadas: number) =>
        `History: ${importadas} new conversation${s(importadas)}, ${actualizadas} updated, ${alDia} already here, ${conservadas} kept and ${saltadas} skipped.`,
      historialRutaCambiada: (n: number) => `${n} conversation${s(n)} ${n === 1 ? 'was' : 'were'} placed under the path its project has on this computer.`,
      historialConservadas: 'The one on this computer was kept:',
      historialRutaOriginal: 'These kept their original path (they appear when you open the project at that path):',
      historialCarpeta: (carpeta: string, n: number, motivo: string) => `“${carpeta}” (${n}): ${motivo}`,
      historialSaltadas: 'Not imported:',
      historialSesion: 'Account sign-ins are not exported: sign in to each new account to continue its conversations.',
      ajustes: 'Tessera settings (they replace this computer’s settings)',
      configDocker: 'Profile Docker configuration',
      configGlobal: 'Global agent context: rules and Docker configuration, for every profile',
      configIgual: 'Identical',
      configSustituye: 'different from the one on this computer: selecting it replaces it; the previous one can be restored from the editor',
      configSustituyeGlobal:
        'different from the one on this computer: selecting it replaces it. The previous Docker configuration can be restored from the editor; if the file includes global rules, they replace the ones on this computer and the previous ones cannot be restored',
      configHecho: (niveles: readonly string[]) => `Imported ${niveles.length > 1 ? `${niveles.slice(0, -1).join(', ')} and ${niveles.at(-1)}` : niveles[0]}.`,
      cuentaAgente: (agente: string, cuenta: string) => `${agente} account “${cuenta}”`,
      cuentaNueva: 'new account: it will be created',
      archivoTraer: 'not on this computer: it will be created',
      archivoIgual: 'Identical',
      archivoBloqueado: 'Cannot be read',
      mantenerArchivo: 'Keep the one here',
      sustituirArchivo: 'Replace with the file’s version',
      eleccionArchivoDe: (archivo: string) => `What to do with ${archivo}`,
      diferenciasArchivoAyuda: 'On the left, the file on this computer; on the right, the one being imported.',
      diferenciasCargando: 'Loading differences…',
      diferenciasNoDisponibles: 'The differences cannot be shown: the file changed or is no longer available.',
      reglasNativas: (agente: string) => `${agente} rules`,
      reglasNativaTraer: 'not on this computer: selecting it creates it',
      reglasNativaDe: (agente: string) => `${agente} rules on this computer`,
      archivosInvalidos: (lista: string) => `These files cannot be imported because they are not valid: ${lista}.`,
      archivosCreados: 'Files created:',
      archivosSustituidos: 'Files replaced (the previous version stays next to each one):',
      confirmar: {
        titulo: (n: number) => `Replace ${n} file${s(n)} on this computer?`,
        mensaje: 'The import will replace the following. Tessera keeps the previous version next to each file.',
        mensajeParcial: 'The import will replace the following. Tessera keeps the previous version of the files, except where noted.',
        mensajeNinguno: 'The import will replace the following, and no previous version remains to restore.',
        noRecuperable: 'Cannot be restored',
        volver: 'Back to the list',
        sustituir: 'Replace and import',
        enPerfil: (perfil: string) => `Profile “${perfil}”`,
        enPerfilArchivo: (perfil: string, archivo: string) => `Profile “${perfil}” · ${archivo}`,
        paraTodos: 'For every profile',
        reglasPerfil: 'Profile rules',
        configPerfil: 'Profile Docker configuration',
        reglasGlobales: 'Global agent rules',
        configGlobal: 'Global Docker configuration',
        reglasCuenta: (agente: string, cuenta: string) => `${agente} rules “${cuenta}”`,
        configCuenta: (agente: string, cuenta: string) => `${agente} configuration “${cuenta}”`,
        reglasNativa: (agente: string) => `Native ${agente} rules`
      },
      marcadaTambien: (nombre: string, por: string) => `“${nombre}” is selected too: “${por}” needs it.`,
      desmarcadaTambien: (nombre: string, por: string) => `“${nombre}” is unselected too: it needs “${por}”.`,
      nadaMarcado: 'Select at least one thing to import.',
      perfilesInvalidos: (n: number) =>
        `${n} profile${s(n)} in the file ${n === 1 ? 'has' : 'have'} an invalid shape and ${n === 1 ? 'is' : 'are'} not imported.`,
      importado: 'Imported.',
      hecho: (nuevos: number, ssh: number, bd: number, agentes: number, ajustes: boolean) =>
        `${nuevos} new profile${s(nuevos)}, ${ssh} SSH connection${s(ssh)}, ${bd} database connection${s(bd)} and ${agentes} agent${s(agentes)} added${ajustes ? '; settings applied' : ''}.`,
      saltadasSsh: 'These SSH connections were not imported:',
      saltadasBd: 'These database connections were not imported:',
      saltada: (alias: string, motivo: string) => `“${alias}”: ${motivo}`,
      capaFallida: (perfil: string, error: string | null) =>
        `The agents of “${perfil}” could not be installed in its image${error ? `: ${error}` : ''}. Edit one of them to try again.`,
      errorFinal: (motivo: string) =>
        `Could not finish importing (${motivo}). What was already imported stays; import the file again to finish.`,
      importar: 'Import',
      importando: 'Importing…',
      abriendo: 'Opening…',
      abrir: 'Open',
      titulo: 'Import settings',
      cabecera: (nombre: string, sistema: string, fecha: string, app: string) =>
        `“${nombre}”, exported on ${sistema} on ${fecha} with Tessera ${app}.`,
      fraseAyuda: 'The one chosen when exporting.',
      sinCifrar:
        'This file was exported without a passphrase and is not encrypted: anyone could have read or changed it. Import it only if you know where it comes from, and delete it afterward.',
      continuar: 'Continue',
      sinCifrarPrevia:
        'Unencrypted file: nothing is selected. Select only what you recognize, especially agents (they carry commands that run) and settings.',
      noSeAbrio: 'The configuration file could not be opened',
      progreso: 'Importing… This may take a few minutes if the file includes Docker agents with install commands or a lot of conversation history.'
    }
  }
)
