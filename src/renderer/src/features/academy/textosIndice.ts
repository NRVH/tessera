// =============================================================================
// Títulos de los grupos y artículos de Tessera Academy, y las palabras con que se buscan en cada
// idioma. Las palabras no se ven: el buscador suma las de los dos (`indice.gruposBuscables`).
// Los títulos son un `Record` completo: un artículo del índice sin título no compila.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'
import type { ArticuloId, GrupoAcademyId } from './indice.ts'

export const txIndice = crearTextos(
  {
    grupos: {
      'primeros-pasos': 'Primeros pasos',
      'perfiles-y-proyectos': 'Perfiles y proyectos',
      agentes: 'Agentes',
      herramientas: 'Herramientas de los agentes',
      'datos-y-conexiones': 'Datos y conexiones',
      'codigo-y-terminales': 'Código y terminales',
      'tessera-y-tu-equipo': 'Tessera y su equipo'
    } satisfies Record<GrupoAcademyId, string>,
    titulos: {
      bienvenida: 'Qué es Tessera',
      glosario: 'Glosario',
      perfiles: 'Perfiles',
      proyectos: 'Proyectos',
      hibernar: 'Hibernar y reanudar',
      agentes: 'Claude Code, Codex y otros agentes',
      cuentas: 'Cuentas de los agentes',
      'nativo-o-docker': 'Nativo o en Docker',
      'continuar-en-otro-agente': 'Continuar en otro agente o cuenta',
      'reglas-del-perfil': 'Reglas para los agentes',
      conversaciones: 'Conversaciones e historial',
      mosaico: 'Mosaico y ventanas de agente',
      'herramientas-de-los-agentes': 'tdb, tssh y tctx',
      'bases-de-datos': 'Bases de datos',
      ssh: 'Conexiones SSH',
      'editor-y-explorador': 'Editor y explorador',
      git: 'Git',
      terminales: 'Terminales',
      'contenedores-docker': 'Contenedores de Docker',
      'copia-de-configuracion': 'Exportar e importar',
      atajos: 'Atajos de teclado',
      actualizaciones: 'Actualizaciones'
    } satisfies Record<ArticuloId, string>
  },
  {
    grupos: {
      'primeros-pasos': 'Getting started',
      'perfiles-y-proyectos': 'Profiles and projects',
      agentes: 'Agents',
      herramientas: 'Agent tools',
      'datos-y-conexiones': 'Data and connections',
      'codigo-y-terminales': 'Code and terminals',
      'tessera-y-tu-equipo': 'Tessera and your computer'
    },
    titulos: {
      bienvenida: 'What is Tessera?',
      glosario: 'Glossary',
      perfiles: 'Profiles',
      proyectos: 'Projects',
      hibernar: 'Hibernate and resume',
      agentes: 'Claude Code, Codex, and other agents',
      cuentas: 'Agent accounts',
      'nativo-o-docker': 'Native or in Docker',
      'continuar-en-otro-agente': 'Continue in another agent or account',
      'reglas-del-perfil': 'Rules for agents',
      conversaciones: 'Conversations and history',
      mosaico: 'Mosaic and agent windows',
      'herramientas-de-los-agentes': 'tdb, tssh, and tctx',
      'bases-de-datos': 'Databases',
      ssh: 'SSH connections',
      'editor-y-explorador': 'Editor and explorer',
      git: 'Git',
      terminales: 'Terminals',
      'contenedores-docker': 'Docker containers',
      'copia-de-configuracion': 'Export and import',
      atajos: 'Keyboard shortcuts',
      actualizaciones: 'Updates'
    }
  }
)

/** Las palabras de búsqueda de cada artículo en cada idioma. */
export const CLAVES_ACADEMY: Record<'es' | 'en', Record<ArticuloId, readonly string[]>> = {
  es: {
    bienvenida: ['empezar', 'introducción', 'ventana', 'conceptos', 'guía', 'ayuda', 'inicio'],
    glosario: ['términos', 'significa', 'definición', 'palabras', 'vocabulario', 'ayuda'],
    perfiles: ['espacio de trabajo', 'color', 'renombrar', 'eliminar', 'barra de perfiles', 'cambiar'],
    proyectos: ['carpeta', 'abrir', 'repositorio', 'pestañas', 'multi-repo', 'cambiar carpeta'],
    hibernar: ['hibernar', 'hibernado', 'reanudar', 'memoria', 'parar', 'inactividad', 'liberar'],
    agentes: ['claude', 'codex', 'agente propio', 'agente manual', 'pestañas de agente', 'ocultar', 'actualizar'],
    cuentas: ['cuenta', 'sesión', 'iniciar sesión', 'selector de cuenta', 'uso', 'límite', 'tarjeta'],
    'nativo-o-docker': ['nativo', 'docker', 'contenedor', 'sandbox', 'aislado', 'modo', 'montar'],
    'continuar-en-otro-agente': ['continuar', 'traspaso', 'pasar', 'otra cuenta', 'cambiar de agente', 'conversación'],
    'reglas-del-perfil': ['reglas', 'instrucciones', 'propuesta', 'aviso de arranque', 'tctx'],
    conversaciones: ['historial', 'conversación', 'reanudar', 'buscar', 'tctx', 'renombrar'],
    mosaico: ['mosaico', 'rejilla', 'casillas', 'ventana', 'varios agentes', 'ampliar'],
    'herramientas-de-los-agentes': ['tdb', 'tssh', 'tctx', 'comandos', 'credenciales', 'contraseñas', 'buzón'],
    'bases-de-datos': ['base de datos', 'sql', 'conexión', 'montar', 'producción', 'transacción', 'consola'],
    ssh: ['ssh', 'servidor', 'huella', 'túnel', 'sftp', 'clave', 'bastión'],
    'editor-y-explorador': ['editor', 'archivos', 'árbol', 'vista previa', 'buscar en archivos', 'diff'],
    git: ['git', 'cambios', 'commit', 'descartar', 'historial', 'ramas'],
    terminales: ['terminal', 'shell', 'consola', 'pestañas', 'reiniciar', 'franja inferior'],
    'contenedores-docker': ['docker', 'contenedores', 'límite', 'saturación', 'red', 'memoria', 'imagen'],
    'copia-de-configuracion': ['exportar', 'importar', 'copia', 'respaldo', 'otro equipo', 'migrar', 'historial'],
    atajos: ['atajos', 'teclado', 'tecla', 'combinación'],
    actualizaciones: ['actualizar', 'versión', 'nueva', 'instalar', 'alpha']
  },
  en: {
    bienvenida: ['start', 'introduction', 'window', 'concepts', 'guide', 'help', 'overview'],
    glosario: ['terms', 'meaning', 'definition', 'words', 'vocabulary', 'help'],
    perfiles: ['workspace', 'color', 'rename', 'delete', 'profile bar', 'switch'],
    proyectos: ['folder', 'open', 'repository', 'tabs', 'multi-repo', 'change folder'],
    hibernar: ['hibernate', 'hibernated', 'resume', 'memory', 'stop', 'idle', 'free'],
    agentes: ['claude', 'codex', 'custom agent', 'manual agent', 'agent tabs', 'hide', 'update'],
    cuentas: ['account', 'session', 'sign in', 'log in', 'account selector', 'usage', 'limit', 'card'],
    'nativo-o-docker': ['native', 'docker', 'container', 'sandbox', 'isolated', 'mode', 'mount'],
    'continuar-en-otro-agente': ['continue', 'handoff', 'hand over', 'another account', 'switch agent', 'conversation'],
    'reglas-del-perfil': ['rules', 'instructions', 'proposal', 'startup notice', 'tctx'],
    conversaciones: ['history', 'conversation', 'resume', 'search', 'tctx', 'rename'],
    mosaico: ['mosaic', 'grid', 'tiles', 'window', 'several agents', 'enlarge'],
    'herramientas-de-los-agentes': ['tdb', 'tssh', 'tctx', 'commands', 'credentials', 'passwords', 'mailbox'],
    'bases-de-datos': ['database', 'sql', 'connection', 'mount', 'production', 'transaction', 'console'],
    ssh: ['ssh', 'server', 'fingerprint', 'tunnel', 'sftp', 'key', 'bastion'],
    'editor-y-explorador': ['editor', 'files', 'tree', 'preview', 'search in files', 'diff'],
    git: ['git', 'changes', 'commit', 'discard', 'history', 'branches'],
    terminales: ['terminal', 'shell', 'console', 'tabs', 'restart', 'bottom strip'],
    'contenedores-docker': ['docker', 'containers', 'limit', 'saturation', 'network', 'memory', 'image'],
    'copia-de-configuracion': ['export', 'import', 'copy', 'backup', 'another computer', 'migrate', 'history'],
    atajos: ['shortcuts', 'keyboard', 'key', 'combination', 'hotkeys'],
    actualizaciones: ['update', 'version', 'new', 'install', 'alpha']
  }
}
