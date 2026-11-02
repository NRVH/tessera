// =============================================================================
// Tessera Academy · Exportar e importar la configuración en un archivo `.tessera`.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Lleva tus perfiles, conexiones y ajustes a otro equipo, de cualquier sistema, en un archivo `.tessera` cifrado con una frase. Al importarlo se añade lo que falta y no se toca lo que ya hay.',
  secciones: [
    {
      ancla: 'para-que',
      titulo: 'Para qué sirve',
      bloques: [
        'Tessera guarda tus contraseñas con {almacenSecretos}, que solo funciona en este equipo y con tu usuario: copiar sus carpetas a otro equipo deja las contraseñas ilegibles. La copia las lleva dentro de un archivo cifrado con una frase que eliges tú.',
        'Está en **Configuración › Exportar e importar**.'
      ]
    },
    {
      ancla: 'exportar',
      titulo: 'Exportar',
      bloques: [
        {
          pasos: [
            'Pulsa **Exportar…** y elige los perfiles.',
            'En **Qué llevar**, marca lo que quieras.',
            'Escribe la frase dos veces: al menos 8 caracteres.',
            'Pulsa **Exportar…** y elige dónde guardar el archivo.'
          ]
        },
        {
          lista: [
            'Cada perfil va con sus [reglas](reglas-del-perfil).',
            'Las conexiones SSH van con sus contraseñas, claves y huellas, y las de bases de datos con sus contraseñas.',
            'También los agentes definidos a mano y los ajustes de Tessera (preferencias, no tamaños de los paneles).',
            'No van los proyectos abiertos ni las sesiones iniciadas de los agentes.'
          ]
        },
        { nota: 'Tessera no guarda la frase: si la pierdes, no hay forma de abrir el archivo. **Exportar sin frase** lo deja sin cifrar, con tus contraseñas y claves legibles para quien lo tenga: úsalo solo entre tus equipos y bórralo después.' }
      ]
    },
    {
      ancla: 'historial',
      titulo: 'El historial de conversaciones',
      bloques: [
        '**Historial de conversaciones** viene desmarcado. Al marcarlo lleva lo hablado con los agentes en las cuentas de Docker de los perfiles elegidos y, si lo pides, el historial nativo de {tuEquipo}. Tessera dice cuántas conversaciones son y cuánto ocupan.',
        'Solo van las conversaciones, cifradas como el resto: nunca las sesiones iniciadas ni los ajustes de los agentes. Pueden llevar código y datos de tus proyectos, así que trata el archivo con el mismo cuidado.'
      ]
    },
    {
      ancla: 'importar',
      titulo: 'Importar',
      bloques: [
        {
          pasos: [
            'Pulsa **Importar…** y elige el archivo, o ábrelo con doble clic.',
            'Escribe la frase que se eligió al exportar.',
            'En **Qué importar** viene todo marcado: desmarca lo que no quieras traer.',
            'Junto a cada perfil, elige su destino: **Perfil nuevo** o **Añadir a «Trabajo»**, uno de este equipo.',
            'Pulsa **Importar**.'
          ]
        },
        'De serie, cada perfil va al de este equipo con el mismo nombre, aunque lo crearas aparte en cada equipo. El de aquí no cambia de nombre ni de color: recibe lo que le falte.',
        'Si el de aquí no tiene [reglas](reglas-del-perfil), se traen las del archivo. Si tiene otras, eliges **Mantener las de aquí** (de serie) o **Sustituir por las del archivo**; **Ver diferencias** enseña las dos.',
        'Lo que ya está en este equipo sale como **Ya existe** y no se toca. Si una conexión necesita otra (un bastión o un túnel SSH), se marcan juntas. Importar dos veces el mismo archivo no duplica nada.',
        { nota: 'Un archivo exportado sin frase avisa antes de abrirse y no trae nada marcado: alguien pudo cambiarlo. Marca solo lo que reconozcas, sobre todo los agentes, que llevan órdenes que se ejecutan, y las reglas, que son instrucciones para los agentes.' },
        { nota: 'El doble clic en un archivo `.tessera` solo funciona si integraste Tessera en el escritorio. Si no, impórtalo desde Configuración.', soloEn: ['linux'] }
      ]
    },
    {
      ancla: 'lo-que-no-cambia',
      titulo: 'Lo que importar no pone al día',
      bloques: [
        {
          lista: [
            'Un perfil o una conexión que ya existe se queda como está, aunque en el otro equipo la cambiaras: el perfil solo recibe lo que le falta, y sus reglas cambian solo si eliges sustituirlas.',
            'Lo que se añade a un perfil de aquí, historial incluido, queda en ese perfil.',
            'Si una conversación ya está aquí y es distinta, se conserva la de este equipo. Si la que llega solo va más avanzada, se pone al día, salvo que esté abierta en un agente: entonces vuelve a importar más tarde.',
            'Las sesiones de las cuentas no viajan: inicia sesión en cada cuenta nueva para seguir sus conversaciones.',
            'Los ajustes sí sustituyen las preferencias de este equipo, si los marcas.'
          ]
        },
        'Si un proyecto está en otra ruta en este equipo, sus conversaciones se dejan bajo la ruta de aquí cuando Tessera puede emparejarlo por el nombre de la carpeta; si no, aparecen al abrir el proyecto en la ruta de origen.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Move your profiles, connections, and settings to another computer, on any operating system, in a `.tessera` file encrypted with a passphrase. Importing the file adds what is missing and does not change what is already there.',
  secciones: [
    {
      ancla: 'para-que',
      titulo: 'Why use it',
      bloques: [
        'Tessera stores your passwords with {almacenSecretos}, which works only on this computer and with your user account: if you copy Tessera’s folders to another computer, the passwords become unreadable. The export file includes them, encrypted with a passphrase you choose.',
        'You can find it in **Settings › Export and import**.'
      ]
    },
    {
      ancla: 'exportar',
      titulo: 'Export',
      bloques: [
        {
          pasos: [
            'Click **Export…** and choose the profiles.',
            'Under **What to include**, select what you want to export.',
            'Enter the passphrase twice. It must have at least 8 characters.',
            'Click **Export…** and choose where to save the file.'
          ]
        },
        {
          lista: [
            'Each profile includes its [rules](reglas-del-perfil).',
            'SSH connections include their passwords, keys, and fingerprints, and database connections include their passwords.',
            'Agents you added yourself and Tessera settings (preferences, not panel sizes) are also included.',
            'Open projects and the agents’ sign-in sessions are not included.'
          ]
        },
        { nota: 'Tessera does not store the passphrase: if you lose it, you cannot open the file. **Export without a passphrase** creates an unencrypted file, and anyone who has it can read your passwords and keys. Use it only between your own computers, and delete the file afterward.' }
      ]
    },
    {
      ancla: 'historial',
      titulo: 'Conversation history',
      bloques: [
        '**Conversation history** is cleared by default. If you select it, the file includes your conversations with the agents in the Docker accounts of the chosen profiles and, if you request it, the native history of {tuEquipo}. Tessera shows how many conversations there are and how much space they use.',
        'Only the conversations are included, encrypted like everything else: never the sign-in sessions or the agents’ settings. Conversations may contain code and data from your projects, so handle the file with the same care.'
      ]
    },
    {
      ancla: 'importar',
      titulo: 'Import',
      bloques: [
        {
          pasos: [
            'Click **Import…** and choose the file, or double-click the file.',
            'Enter the passphrase you chose when you exported it.',
            'Under **What to import**, everything is selected: clear anything you do not want to import.',
            'Next to each profile, choose its destination: **New profile** or **Add to “Work”**, a profile on this computer.',
            'Click **Import**.'
          ]
        },
        'By default, each profile goes to the profile on this computer with the same name, even if you created it separately on each computer. The profile here keeps its name and color: it receives only what it is missing.',
        'If the profile here has no [rules](reglas-del-perfil), it receives the file’s rules. If it has different rules, choose **Keep the ones here** (the default) or **Replace with the file’s rules**; **Show differences** shows both.',
        'Items that already exist on this computer are marked **Already exists** and are not changed. If a connection depends on another one (a bastion or an SSH tunnel), both are selected together. Importing the same file twice does not create duplicates.',
        { nota: 'A file exported without a passphrase shows a warning before it opens, and nothing is selected, because someone could have modified it. Select only what you recognize, especially agents, which include commands that will run, and rules, which are instructions for the agents.' },
        { nota: 'Double-clicking a `.tessera` file works only if you integrated Tessera with the desktop. Otherwise, import it from Settings.', soloEn: ['linux'] }
      ]
    },
    {
      ancla: 'lo-que-no-cambia',
      titulo: 'What importing does not update',
      bloques: [
        {
          lista: [
            'A profile or connection that already exists stays as it is, even if you changed it on the other computer: the profile receives only what it is missing, and its rules change only if you choose to replace them.',
            'Everything added to a profile on this computer, including history, stays in that profile.',
            'If a conversation already exists here and is different, Tessera keeps the version on this computer. If the imported version simply continues further, Tessera updates it, unless the conversation is open in an agent; in that case, import again later.',
            'Account sign-in sessions are not transferred: sign in to each new account to continue its conversations.',
            'Settings, if you select them, do replace the preferences on this computer.'
          ]
        },
        'If a project is at a different path on this computer, Tessera places its conversations under the local path when it can match the project by folder name; otherwise, the conversations appear when you open the project at its original path.'
      ]
    }
  ]
}

export const txCopiaDeConfiguracion = crearTextos(es, en)
