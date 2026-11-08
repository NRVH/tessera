// =============================================================================
// Textos del permiso de uso de claves SSH por los agentes de cada perfil.
// Centraliza las traducciones del diálogo para explicar la selección, el guardado y sus errores.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { crearTextos } from '../../../../shared/i18n.ts'
export const txClavesAgente = crearTextos({
  menu: 'Claves SSH…',
  titulo: (perfil: string) => `Claves SSH de los agentes en Docker · ${perfil}`,
  descripcion: 'Los agentes de este perfil que trabajan en Docker solo pueden conectarse por SSH (git push, servidores) con las claves activadas. Las claves privadas permanecen en su equipo.',
  alcance: 'Esta selección no limita a los agentes nativos: se ejecutan con su usuario del sistema y pueden leer las claves de su equipo. Para mantener separadas las claves de cada perfil, trabaje esos proyectos en Docker.',
  grupo: 'Claves disponibles',
  origen: 'Las claves salen de su configuración SSH y de la carpeta SSH de este perfil.',
  alias: (alias: string) => `Se usa en: ${alias}`,
  vacio: 'No se encontraron claves SSH. Configure una IdentityFile en su configuración SSH o una clave de nombre estándar en ~/.ssh.',
  cargando: 'Buscando claves SSH…',
  error: 'No se pudieron cargar o guardar los permisos SSH. Inténtelo de nuevo.',
  cancelar: 'Cancelar',
  guardar: 'Guardar'
}, {
  menu: 'SSH keys…',
  titulo: (perfil: string) => `SSH keys for agents in Docker · ${perfil}`,
  descripcion: 'Agents in this profile that work in Docker can connect over SSH (git push, servers) only with the enabled keys. Private keys remain on your computer.',
  alcance: 'This selection does not limit native agents: they run with your system user and can read the keys on your computer. To keep each profile’s keys separate, work on those projects in Docker.',
  grupo: 'Available keys',
  origen: 'Keys come from your SSH configuration and from this profile\'s SSH folder.',
  alias: (alias: string) => `Used for: ${alias}`,
  vacio: 'No SSH keys were found. Configure an IdentityFile in your SSH configuration or a standard key name in ~/.ssh.',
  cargando: 'Looking for SSH keys…',
  error: 'SSH permissions could not be loaded or saved. Please try again.',
  cancelar: 'Cancel',
  guardar: 'Save'
})
