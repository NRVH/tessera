// =============================================================================
// Mensajes de la configuración SSH de los agentes y de la petición de frase en el host.
// Centraliza las traducciones para comunicar errores y solicitar frases con textos coherentes.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { crearTextos } from '../../../shared/i18n.ts'
export const txAgenteSsh = crearTextos({
  perfil: 'No se encuentra el perfil.',
  lectura: 'No se pudo leer la configuración SSH de su equipo.',
  frase: (nombre: string) => `Escriba la frase de la clave SSH «${nombre}».`,
  fallo: 'No se pudo autorizar la operación SSH.'
}, {
  perfil: 'The profile could not be found.',
  lectura: 'Your SSH configuration could not be read.',
  frase: (nombre: string) => `Enter the passphrase for SSH key “${nombre}”.`,
  fallo: 'The SSH operation could not be authorized.'
})
