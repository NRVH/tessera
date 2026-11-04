// =============================================================================
// Tessera Academy · Exportar e importar la configuración en un archivo `.tessera`.
// Su forma es la de `modelo.ts` y el inglés repite la del español (`test-academy.mts`); las
// etiquetas en negrita son las de la interfaz, copiadas tal cual en cada idioma.
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'
import type { Articulo } from '../modelo.ts'

const es: Articulo = {
  resumen:
    'Permite llevar sus perfiles, conexiones y ajustes a otro equipo, de cualquier sistema, en un archivo `.tessera` cifrado con una frase de contraseña. Al importarlo se añade lo que falta y no se modifica lo que ya existe.',
  secciones: [
    {
      ancla: 'para-que',
      titulo: 'Para qué sirve',
      bloques: [
        'Tessera guarda sus contraseñas con {almacenSecretos}, que solo funciona en este equipo y con su usuario. Si se copian las carpetas de Tessera a otro equipo, las contraseñas quedan ilegibles. El archivo de exportación, en cambio, las lleva cifradas con una frase de contraseña que usted elige.',
        'La función está en **Configuración › Exportar e importar**.'
      ]
    },
    {
      ancla: 'exportar',
      titulo: 'Exportar',
      bloques: [
        {
          pasos: [
            'Pulse **Exportar…**. Se abre el diálogo de exportación.',
            'En **Perfiles**, seleccione los perfiles que desea llevar.',
            'En **Qué incluir**, marque lo que desea exportar.',
            'Escriba la **Frase de contraseña** dos veces. Debe tener al menos 8 caracteres.',
            'Pulse **Exportar…** y elija dónde guardar el archivo. Al terminar, el diálogo resume lo exportado.'
          ]
        },
        'El archivo puede incluir lo siguiente:',
        {
          lista: [
            'Cada perfil, con sus [reglas](reglas-del-perfil).',
            'Las conexiones SSH, con sus contraseñas, claves y [huellas](glosario/huella), y las de bases de datos, con sus contraseñas.',
            'Los agentes definidos manualmente y los ajustes de Tessera (preferencias, no tamaños de los paneles).',
            'No incluye los proyectos abiertos ni las sesiones iniciadas de los agentes.'
          ]
        },
        { nota: 'Tessera no guarda la frase: si se pierde, no hay forma de abrir el archivo. **Exportar sin frase de contraseña** crea un archivo sin cifrar, con sus contraseñas y claves legibles para cualquiera que lo tenga. Use esta opción solo entre sus propios equipos y elimine el archivo después.' }
      ]
    },
    {
      ancla: 'historial',
      titulo: 'El historial de conversaciones',
      bloques: [
        '**Historial de conversaciones** viene desmarcado. Al marcarlo, el archivo incluye las conversaciones con los agentes en las cuentas de Docker de los perfiles seleccionados y, si también se marca **Incluir el historial nativo de este equipo (Claude Code y Codex)**, las conversaciones de los agentes [nativos](glosario/nativo) de {tuEquipo}. Tessera indica cuántas conversaciones son y cuánto ocupan.',
        'Solo se incluyen las conversaciones, cifradas como el resto del archivo; nunca las sesiones iniciadas ni los ajustes de los agentes. Las conversaciones pueden contener código y datos de sus proyectos, así que el archivo requiere el mismo cuidado.'
      ]
    },
    {
      ancla: 'importar',
      titulo: 'Importar',
      bloques: [
        {
          pasos: [
            'Pulse **Importar…** y seleccione el archivo, o haga doble clic en él.',
            'Escriba la frase de contraseña que se eligió al exportar y pulse **Abrir**. Se muestra la lista de lo que contiene el archivo.',
            'En **Qué importar** viene todo marcado: desmarque lo que no desee importar.',
            'Junto a cada perfil, elija su destino: **Perfil nuevo** o **Añadir a «Trabajo»**, siendo «Trabajo» un perfil de este equipo.',
            'Pulse **Importar**. Al terminar, Tessera resume lo añadido y lo que no se pudo importar, con su motivo.'
          ]
        },
        'De forma predeterminada, cada perfil del archivo va al perfil de este equipo con el mismo nombre, aunque se hayan creado por separado en cada equipo. El perfil de este equipo conserva su nombre y su color, y solo recibe lo que le falta.',
        'Si el perfil de este equipo no tiene [reglas](reglas-del-perfil), recibe las del archivo. Si tiene otras, se elige entre **Mantener las de este equipo** (opción predeterminada) y **Sustituir por las del archivo**. **Ver diferencias** muestra las dos versiones.',
        'Lo que ya está en este equipo aparece como **Ya existe** y no se modifica. Si una conexión necesita otra (un bastión o un túnel SSH), las dos se marcan juntas. Importar dos veces el mismo archivo no duplica nada.',
        { nota: 'Un archivo exportado sin frase de contraseña muestra un aviso antes de abrirse (se continúa con **Continuar**) y no trae nada marcado, porque cualquiera pudo modificarlo. Marque solo lo que reconozca, sobre todo los agentes, que incluyen órdenes que se ejecutan; las reglas, que son instrucciones para los agentes; y los ajustes.' },
        { nota: 'Por seguridad, el doble clic solo abre archivos guardados en este equipo. Un archivo que esté en una ruta de red se importa con **Importar…**.' },
        { nota: 'El doble clic en un archivo `.tessera` solo funciona si se activó la integración con el escritorio en **Configuración › Integración con el sistema**. En caso contrario, impórtelo desde **Configuración › Exportar e importar**.', soloEn: ['linux'] }
      ]
    },
    {
      ancla: 'lo-que-no-cambia',
      titulo: 'Lo que importar no actualiza',
      bloques: [
        {
          lista: [
            'Un perfil o una conexión que ya existe se queda como está, aunque se haya modificado en el otro equipo. El perfil solo recibe lo que le falta, y sus reglas cambian únicamente si se elige sustituirlas.',
            'Lo que se añade a un perfil de este equipo, incluido el historial, queda en ese perfil.',
            'Si una conversación ya existe aquí y es distinta, se conserva la de este equipo. Si la que llega simplemente va más avanzada, se actualiza, salvo que esté abierta en un agente; en ese caso, vuelva a importar más tarde.',
            'Las sesiones de las cuentas no se transfieren: para continuar sus conversaciones, inicie sesión en cada cuenta nueva.',
            'Los ajustes, si se marcan, sí sustituyen las preferencias de este equipo.'
          ]
        },
        'Si un proyecto está en otra ruta en este equipo, sus conversaciones se guardan bajo la ruta de aquí cuando Tessera puede emparejarlo por el nombre de la carpeta. Si no puede, aparecen al abrir el proyecto en la ruta de origen.'
      ]
    }
  ]
}

const en: Articulo = {
  resumen:
    'Lets you move your profiles, connections, and settings to another computer, on any operating system, in a `.tessera` file encrypted with a passphrase. Importing the file adds what is missing and does not change what already exists.',
  secciones: [
    {
      ancla: 'para-que',
      titulo: 'Why use it',
      bloques: [
        'Tessera stores your passwords with {almacenSecretos}, which works only on this computer and with your user account. If you copy Tessera’s folders to another computer, the passwords become unreadable. The export file, by contrast, includes them encrypted with a passphrase you choose.',
        'You can find this feature in **Settings › Export and import**.'
      ]
    },
    {
      ancla: 'exportar',
      titulo: 'Export',
      bloques: [
        {
          pasos: [
            'Click **Export…**. The export dialog opens.',
            'Under **Profiles**, select the profiles you want to move.',
            'Under **What to include**, select what you want to export.',
            'Enter the **Passphrase** twice. It must have at least 8 characters.',
            'Click **Export…** and choose where to save the file. When it finishes, the dialog summarizes what was exported.'
          ]
        },
        'The file can include the following:',
        {
          lista: [
            'Each profile, with its [rules](reglas-del-perfil).',
            'SSH connections, with their passwords, keys, and [fingerprints](glosario/huella), and database connections, with their passwords.',
            'Agents you defined manually and Tessera settings (preferences, not panel sizes).',
            'It does not include open projects or the agents’ sign-in sessions.'
          ]
        },
        { nota: 'Tessera does not store the passphrase: if you lose it, there is no way to open the file. **Export without a passphrase** creates an unencrypted file, and anyone who has it can read your passwords and keys. Use this option only between your own computers, and delete the file afterward.' }
      ]
    },
    {
      ancla: 'historial',
      titulo: 'Conversation history',
      bloques: [
        '**Conversation history** is cleared by default. If you select it, the file includes your conversations with the agents in the Docker accounts of the selected profiles and, if you also select **Include this computer’s native history (Claude Code and Codex)**, the conversations of the [native](glosario/nativo) agents on {tuEquipo}. Tessera shows how many conversations there are and how much space they use.',
        'Only the conversations are included, encrypted like the rest of the file; never the sign-in sessions or the agents’ settings. Conversations may contain code and data from your projects, so handle the file with the same care.'
      ]
    },
    {
      ancla: 'importar',
      titulo: 'Import',
      bloques: [
        {
          pasos: [
            'Click **Import…** and select the file, or double-click the file.',
            'Enter the passphrase chosen when the file was exported and click **Open**. A list of what the file contains appears.',
            'Under **What to import**, everything is selected: clear anything you do not want to import.',
            'Next to each profile, choose its destination: **New profile** or **Add to “Work”**, where “Work” is a profile on this computer.',
            'Click **Import**. When it finishes, Tessera summarizes what was added and what could not be imported, with the reason.'
          ]
        },
        'By default, each profile in the file goes to the profile on this computer with the same name, even if they were created separately on each computer. The profile on this computer keeps its name and color, and receives only what it is missing.',
        'If the profile on this computer has no [rules](reglas-del-perfil), it receives the file’s rules. If it has different rules, you choose between **Keep the ones here** (the default) and **Replace with the file’s rules**. **Show differences** shows both versions.',
        'Items that already exist on this computer appear as **Already exists** and are not changed. If a connection depends on another one (a bastion or an SSH tunnel), both are selected together. Importing the same file twice does not create duplicates.',
        { nota: 'A file exported without a passphrase shows a warning before it opens (click **Continue** to proceed), and nothing is selected, because anyone could have modified it. Select only what you recognize, especially agents, which include commands that run; rules, which are instructions for the agents; and settings.' },
        { nota: 'For security, double-clicking opens only files saved on this computer. To import a file on a network path, use **Import…**.' },
        { nota: 'Double-clicking a `.tessera` file works only if you turned on desktop integration in **Settings › System integration**. Otherwise, import it from **Settings › Export and import**.', soloEn: ['linux'] }
      ]
    },
    {
      ancla: 'lo-que-no-cambia',
      titulo: 'What importing does not update',
      bloques: [
        {
          lista: [
            'A profile or connection that already exists stays as it is, even if it was changed on the other computer. The profile receives only what it is missing, and its rules change only if you choose to replace them.',
            'Everything added to a profile on this computer, including history, stays in that profile.',
            'If a conversation already exists here and is different, Tessera keeps the version on this computer. If the incoming version simply continues further, Tessera updates it, unless the conversation is open in an agent; in that case, import again later.',
            'Account sign-in sessions are not transferred: to continue their conversations, sign in to each new account.',
            'Settings, if you select them, do replace the preferences on this computer.'
          ]
        },
        'If a project is at a different path on this computer, Tessera saves its conversations under the local path when it can match the project by folder name. If it cannot, the conversations appear when you open the project at its original path.'
      ]
    }
  ]
}

export const txCopiaDeConfiguracion = crearTextos(es, en)
