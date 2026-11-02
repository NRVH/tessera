// =============================================================================
// Textos de los modales de exportar e importar la configuración, en español e inglés. Los plurales
// del inglés son plurales de verdad; el español conserva «perfil(es)». Se leen al usarse.
// Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

const s = (n: number): string => (n === 1 ? '' : 's')

export const txCopia = crearTextos(
  {
    comun: {
      cerrar: 'Cerrar',
      cancelar: 'Cancelar',
      frase: 'Frase',
      lista: (xs: readonly string[]) => xs.map((a) => `«${a}»`).join(', ')
    },
    exportar: {
      apartados: {
        ssh: 'Conexiones SSH (con sus contraseñas, claves y huellas)',
        bd: 'Conexiones de bases de datos (con sus contraseñas)',
        agentes: 'Agentes definidos a mano',
        ajustes: 'Ajustes de Tessera (preferencias, no tamaños de los paneles)'
      },
      guardado: (nombre: string) => `Guardado en «${nombre}».`,
      resumen: (perfiles: number, ssh: number, bd: number, agentes: number, sinFrase: boolean) =>
        `${perfiles} perfil(es), ${ssh} conexión(es) SSH, ${bd} de bases de datos y ${agentes} agente(s) definidos a mano. ${
          sinFrase
            ? 'El archivo va sin cifrar: quien lo tenga puede leer tus contraseñas y claves. Bórralo cuando ya no lo necesites.'
            : 'Guarda la frase: sin ella el archivo no se puede abrir.'
        }`,
      sinSecreto: (lista: string) =>
        `Estas conexiones van sin su contraseña porque este equipo ya no la puede leer: ${lista}. Tendrás que escribirla en el otro equipo.`,
      sinClave: (lista: string) =>
        `A estas conexiones SSH les falta su archivo de clave y no se podrán importar: ${lista}. Edítalas, vuelve a elegir la clave y exporta otra vez.`,
      elegirPerfil: 'Elige al menos un perfil.',
      perfiles: 'Perfiles',
      queLlevar: 'Qué llevar',
      fraseAyuda: (min: number) =>
        `Al menos ${min} caracteres. Cifra todo el archivo; sin ella no se puede importar, y Tessera no la guarda.`,
      repiteFrase: 'Repite la frase',
      sinFrase: 'Exportar sin frase',
      sinFraseAviso:
        'El archivo irá sin cifrar: las contraseñas de tus conexiones y tus claves SSH quedarán legibles para cualquiera que lo tenga (una carpeta sincronizada, un correo, un USB). Guárdalo y bórralo bajo tu responsabilidad.',
      titulo: 'Exportar la configuración',
      subtitulo: 'Para llevarla a otro equipo. No incluye los proyectos abiertos ni las sesiones iniciadas de los agentes.',
      exportando: 'Exportando…',
      exportar: 'Exportar…',
      historial: 'Historial de conversaciones',
      historialAyuda:
        'Lo hablado con los agentes en las cuentas de Docker de los perfiles elegidos. Solo las conversaciones: ni sesiones iniciadas ni ajustes de los agentes.',
      historialNativo: 'Incluir el historial nativo de este equipo (Claude Code y Codex)',
      historialCargando: 'Contando conversaciones…',
      historialVacio: 'No hay conversaciones que llevar.',
      historialNoSeLeyo: (motivo: string) => `No se pudo contar el historial: ${motivo}`,
      historialFila: (n: number, tam: string) => `${n} conversación(es) · ${tam}`,
      historialTotal: (n: number, tam: string) => `En total: ${n} conversación(es) · ${tam}`,
      historialGrande: (tam: string) => `El historial ocupa ${tam}: exportarlo tardará y el archivo será grande.`,
      historialSinFrase:
        'Además lleva lo hablado con los agentes, que puede incluir código y datos de tus proyectos: también quedará legible.',
      resumenHistorial: (n: number, tam: string) => `Historial: ${n} conversación(es) (${tam}).`,
      historialSaltadas: (n: number) =>
        `${n} archivo(s) del historial desaparecieron o estaban bloqueados mientras se exportaba (un agente los comprimió o los borró) y no van en la copia.`,
      deEsteEquipo: 'este equipo'
    },
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    predeterminada: 'Predeterminada',
    importar: {
      queImportar: 'Qué importar',
      previaAyuda:
        'Desmarca lo que no quieras traer y elige a qué perfil va cada uno: uno nuevo o uno de este equipo. Lo que ya existe aquí no se toca.',
      todo: 'Todo',
      recuento: (marcadas: number, total: number) => `${marcadas} de ${total} seleccionados`,
      perfilNuevo: 'Perfil nuevo',
      anadirA: (perfil: string) => `Añadir a «${perfil}»`,
      destinoDe: (perfil: string) => `Destino de «${perfil}»`,
      reglas: 'Reglas del perfil',
      reglasTraer: 'el perfil de aquí no tiene: se traen las del archivo',
      reglasIguales: 'Iguales',
      reglasDe: (perfil: string) => `Reglas de «${perfil}»`,
      mantenerReglas: 'Mantener las de aquí',
      sustituirReglas: 'Sustituir por las del archivo',
      verDiferencias: 'Ver diferencias',
      ocultarDiferencias: 'Ocultar diferencias',
      diferenciasAyuda: 'A la izquierda, las de este equipo; a la derecha, las del archivo.',
      reglasHecho: (perfiles: string) => `Reglas del archivo puestas en ${perfiles}.`,
      yaEsta: 'Ya existe',
      tipo: { ssh: 'SSH', bd: 'Base de datos', agente: 'Agente', nativo: 'Agente', historial: 'Historial' },
      nativos: 'Agentes nativos (de todo el equipo)',
      historialNativo: 'Historial nativo de los agentes (va a la carpeta de este equipo)',
      historialHecho: (importadas: number, actualizadas: number, alDia: number, conservadas: number, saltadas: number) =>
        `Historial: ${importadas} conversación(es) nueva(s), ${actualizadas} puesta(s) al día, ${alDia} ya estaban, ${conservadas} conservada(s) y ${saltadas} saltada(s).`,
      historialRutaCambiada: (n: number) => `${n} conversación(es) se dejaron bajo la ruta que su proyecto tiene en este equipo.`,
      historialConservadas: 'Se conservó la de este equipo:',
      historialRutaOriginal: 'Se quedaron con la ruta de origen (aparecerán al abrir el proyecto en esa ruta):',
      historialCarpeta: (carpeta: string, n: number, motivo: string) => `«${carpeta}» (${n}): ${motivo}`,
      historialSaltadas: 'No se importaron:',
      historialSesion: 'Las sesiones de las cuentas no viajan: inicia sesión en cada cuenta nueva para seguir sus conversaciones.',
      ajustes: 'Ajustes de Tessera (sustituyen las preferencias de este equipo)',
      marcadaTambien: (nombre: string, por: string) => `También se marca «${nombre}»: «${por}» la necesita.`,
      desmarcadaTambien: (nombre: string, por: string) => `También se desmarca «${nombre}»: necesita «${por}».`,
      nadaMarcado: 'Marca al menos una cosa que importar.',
      perfilesInvalidos: (n: number) => `${n} perfil(es) del archivo no tienen una forma válida y no se importan.`,
      importado: 'Importado.',
      hecho: (nuevos: number, ssh: number, bd: number, agentes: number, ajustes: boolean) =>
        `${nuevos} perfil(es) nuevo(s), ${ssh} conexión(es) SSH, ${bd} de bases de datos y ${agentes} agente(s) añadidos${ajustes ? '; ajustes aplicados' : ''}.`,
      saltadasSsh: 'No se importaron estas conexiones SSH:',
      saltadasBd: 'No se importaron estas conexiones de bases de datos:',
      saltada: (alias: string, motivo: string) => `«${alias}»: ${motivo}`,
      capaFallida: (perfil: string, error: string | null) =>
        `Los agentes de «${perfil}» no se pudieron instalar en su imagen${error ? `: ${error}` : ''}. Edita uno de ellos para volver a intentarlo.`,
      errorFinal: (motivo: string) =>
        `No se pudo terminar de importar (${motivo}). Lo que ya entró se queda; vuelve a importar el archivo para completar el resto.`,
      importar: 'Importar',
      importando: 'Importando…',
      abriendo: 'Abriendo…',
      abrir: 'Abrir',
      titulo: 'Importar la configuración',
      cabecera: (nombre: string, sistema: string, fecha: string, app: string) =>
        `«${nombre}», exportado en ${sistema} el ${fecha} con Tessera ${app}.`,
      fraseAyuda: 'La que se eligió al exportar.',
      sinCifrar:
        'Este archivo se exportó sin frase y no está cifrado: cualquiera pudo leerlo o cambiarlo. Importa solo si sabes de dónde viene, y bórralo después.',
      continuar: 'Continuar',
      sinCifrarPrevia:
        'Archivo sin cifrar: nada viene marcado. Marca solo lo que reconozcas, sobre todo agentes (llevan órdenes que se ejecutan) y ajustes.',
      noSeAbrio: 'No se pudo abrir el archivo de configuración',
      progreso:
        'Importando… Si llegan agentes de Docker con órdenes de instalación o mucho historial de conversaciones, puede tardar unos minutos.'
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
        bd: 'Database connections (with their passwords)',
        agentes: 'Custom agents',
        ajustes: 'Tessera settings (preferences, not panel sizes)'
      },
      guardado: (nombre: string) => `Saved to “${nombre}”.`,
      resumen: (perfiles: number, ssh: number, bd: number, agentes: number, sinFrase: boolean) =>
        `${perfiles} profile${s(perfiles)}, ${ssh} SSH connection${s(ssh)}, ${bd} database connection${s(bd)} and ${agentes} custom agent${s(agentes)}. ${
          sinFrase
            ? 'The file is not encrypted: anyone who has it can read your passwords and keys. Delete it when you no longer need it.'
            : 'Keep the passphrase: without it the file can’t be opened.'
        }`,
      sinSecreto: (lista: string) =>
        `These connections are exported without their password because this computer can no longer read it: ${lista}. Enter it again on the other computer.`,
      sinClave: (lista: string) =>
        `These SSH connections are missing their key file and can’t be imported: ${lista}. Edit them, choose the key again and export again.`,
      elegirPerfil: 'Choose at least one profile.',
      perfiles: 'Profiles',
      queLlevar: 'What to include',
      fraseAyuda: (min: number) =>
        `At least ${min} characters. It encrypts the whole file; without it the file can’t be imported, and Tessera doesn’t store it.`,
      repiteFrase: 'Repeat the passphrase',
      sinFrase: 'Export without a passphrase',
      sinFraseAviso:
        'The file will not be encrypted: your connection passwords and SSH keys will be readable by anyone who has it (a synced folder, an email, a USB drive). Keeping it safe and deleting it is up to you.',
      titulo: 'Export settings',
      subtitulo: 'To move them to another computer. It doesn’t include open projects or the agents’ signed-in sessions.',
      exportando: 'Exporting…',
      exportar: 'Export…',
      historial: 'Conversation history',
      historialAyuda:
        'Your conversations with the agents in the Docker accounts of the selected profiles. Only the conversations: no signed-in sessions or agent settings.',
      historialNativo: 'Include this computer’s native history (Claude Code and Codex)',
      historialCargando: 'Counting conversations…',
      historialVacio: 'There are no conversations to export.',
      historialNoSeLeyo: (motivo: string) => `The history couldn’t be counted: ${motivo}`,
      historialFila: (n: number, tam: string) => `${n} conversation${s(n)} · ${tam}`,
      historialTotal: (n: number, tam: string) => `In total: ${n} conversation${s(n)} · ${tam}`,
      historialGrande: (tam: string) => `The history takes ${tam}: exporting it will take a while and the file will be large.`,
      historialSinFrase:
        'It also includes your conversations with the agents, which may contain code and data from your projects: they will be readable too.',
      resumenHistorial: (n: number, tam: string) => `History: ${n} conversation${s(n)} (${tam}).`,
      historialSaltadas: (n: number) =>
        `${n} history file${s(n)} disappeared or ${n === 1 ? 'was' : 'were'} locked during the export (an agent compressed or deleted ${n === 1 ? 'it' : 'them'}) and ${n === 1 ? 'is' : 'are'} not in the backup.`,
      deEsteEquipo: 'this computer'
    },
    agentes: { 'claude-code': 'Claude Code', codex: 'Codex' },
    predeterminada: 'Default',
    importar: {
      queImportar: 'What to import',
      previaAyuda:
        'Clear what you don’t want to import and choose where each profile goes: a new profile or one on this computer. What already exists here stays as it is.',
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
      ajustes: 'Tessera settings (they replace this computer’s preferences)',
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
        `The agents of “${perfil}” couldn’t be installed in its image${error ? `: ${error}` : ''}. Edit one of them to try again.`,
      errorFinal: (motivo: string) =>
        `Couldn’t finish importing (${motivo}). What was already imported stays; import the file again to finish.`,
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
      noSeAbrio: 'The configuration file couldn’t be opened',
      progreso: 'Importing… This may take a few minutes if the file includes Docker agents with install commands or a lot of conversation history.'
    }
  }
)
