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
      subtitulo: 'Para llevarla a otro equipo. No incluye los proyectos abiertos ni las cuentas de los agentes.',
      exportando: 'Exportando…',
      exportar: 'Exportar…'
    },
    importar: {
      queImportar: 'Qué importar',
      previaAyuda: 'Desmarca lo que no quieras traer. Lo que ya existe en este equipo no se toca.',
      todo: 'Todo',
      recuento: (marcadas: number, total: number) => `${marcadas} de ${total} seleccionados`,
      perfilNuevo: 'perfil nuevo',
      perfilExiste: 'ya existe: se añade lo que le falte',
      yaEsta: 'Ya existe',
      tipo: { ssh: 'SSH', bd: 'Base de datos', agente: 'Agente', nativo: 'Agente' },
      nativos: 'Agentes nativos (de todo el equipo)',
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
      progreso: 'Importando… Si llegan agentes de Docker con órdenes de instalación, prepararlos puede tardar unos minutos.'
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
        agentes: 'Hand-defined agents',
        ajustes: 'Tessera settings (preferences, not panel sizes)'
      },
      guardado: (nombre: string) => `Saved to “${nombre}”.`,
      resumen: (perfiles: number, ssh: number, bd: number, agentes: number, sinFrase: boolean) =>
        `${perfiles} profile${s(perfiles)}, ${ssh} SSH connection${s(ssh)}, ${bd} database connection${s(bd)} and ${agentes} hand-defined agent${s(agentes)}. ${
          sinFrase
            ? 'The file is not encrypted: anyone who has it can read your passwords and keys. Delete it when you no longer need it.'
            : 'Keep the passphrase: without it the file can’t be opened.'
        }`,
      sinSecreto: (lista: string) =>
        `These connections go without their password because this computer can no longer read it: ${lista}. You will have to type it in on the other computer.`,
      sinClave: (lista: string) =>
        `These SSH connections are missing their key file and can’t be imported: ${lista}. Edit them, choose the key again and export again.`,
      elegirPerfil: 'Choose at least one profile.',
      perfiles: 'Profiles',
      queLlevar: 'What to take',
      fraseAyuda: (min: number) =>
        `At least ${min} characters. It encrypts the whole file; without it the file can’t be imported, and Tessera doesn’t store it.`,
      repiteFrase: 'Repeat the passphrase',
      sinFrase: 'Export without a passphrase',
      sinFraseAviso:
        'The file will not be encrypted: your connection passwords and SSH keys will be readable by anyone who has it (a synced folder, an email, a USB drive). Keep it and delete it at your own risk.',
      titulo: 'Export settings',
      subtitulo: 'To take them to another computer. It doesn’t include open projects or agent accounts.',
      exportando: 'Exporting…',
      exportar: 'Export…'
    },
    importar: {
      queImportar: 'What to import',
      previaAyuda: 'Clear what you don’t want to bring. What already exists on this computer is left alone.',
      todo: 'All',
      recuento: (marcadas: number, total: number) => `${marcadas} of ${total} selected`,
      perfilNuevo: 'new profile',
      perfilExiste: 'already exists: what it lacks is added',
      yaEsta: 'Already exists',
      tipo: { ssh: 'SSH', bd: 'Database', agente: 'Agent', nativo: 'Agent' },
      nativos: 'Native agents (for the whole computer)',
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
        `Couldn’t finish importing (${motivo}). What already came in stays; import the file again to complete the rest.`,
      importar: 'Import',
      importando: 'Importing…',
      abriendo: 'Opening…',
      abrir: 'Open',
      titulo: 'Import settings',
      cabecera: (nombre: string, sistema: string, fecha: string, app: string) =>
        `“${nombre}”, exported on ${sistema} on ${fecha} with Tessera ${app}.`,
      fraseAyuda: 'The one chosen when exporting.',
      sinCifrar:
        'This file was exported without a passphrase and is not encrypted: anyone could have read or changed it. Import it only if you know where it comes from, and delete it afterwards.',
      continuar: 'Continue',
      sinCifrarPrevia:
        'Unencrypted file: nothing comes selected. Select only what you recognize, especially agents (they carry commands that run) and settings.',
      noSeAbrio: 'The configuration file couldn’t be opened',
      progreso: 'Importing… If Docker agents with install commands arrive, preparing them may take a few minutes.'
    }
  }
)
