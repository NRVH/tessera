// =============================================================================
// Los errores de «Continuar en…» que llegan a la persona por IPC, en español e inglés; se leen al usarse.
// Lo que se escribe para el agente de destino (el traspaso, su aviso y su primer mensaje) no va aquí.
// Decisiones: docs/decisiones/app/idioma.md, docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txTraspaso = crearTextos(
  {
    peticion: 'Continuar en otro agente: la petición no es válida.',
    sinSesion: 'La sesión del agente ya no está abierta: vuelva a abrirla e inténtelo de nuevo.',
    mismoDestino: 'El destino es el mismo agente con la misma cuenta: no hay nada que traspasar.',
    sinCuenta: 'Esa cuenta no existe o no es de este perfil y este agente.',
    sinConversacion: 'No se sabe en qué conversación está el agente: envíele un mensaje o elija la conversación en el historial, e inténtelo de nuevo.',
    noEncontrada: 'No se encuentra el archivo de esta conversación en la cuenta de origen.',
    sinCarpeta: 'No se encuentra la carpeta de la cuenta de destino.',
    caducado: 'El traspaso ya no está disponible (caducó o ya se usó): vuelva a solicitarlo desde ⇄ en la cabecera del agente.',
    rutaLarga: 'La ruta del proyecto es demasiado larga para continuar la conversación en otra cuenta: continúe con otro agente desde ⇄ en la cabecera o mueva el proyecto a una ruta más corta.',
    conflicto: (ruta: string) =>
      `La cuenta de destino ya tiene una conversación con este id y otro contenido (${ruta}): no se sobrescribe. Si no la necesita, muévala o elimínela e inténtelo de nuevo.`
  },
  {
    peticion: 'Continue in another agent: the request is not valid.',
    sinSesion: 'The agent session is no longer open: reopen it and try again.',
    mismoDestino: 'The destination is the same agent with the same account: there is nothing to transfer.',
    sinCuenta: 'That account does not exist or does not belong to this profile and agent.',
    sinConversacion: 'Tessera cannot tell which conversation the agent is in: send it a message or choose the conversation in the history, and try again.',
    noEncontrada: 'The file for this conversation cannot be found in the source account.',
    sinCarpeta: 'The folder for the destination account cannot be found.',
    caducado: 'The handoff is no longer available (it expired or was already used): request it again from ⇄ in the agent header.',
    rutaLarga: 'The project path is too long to continue the conversation in another account: continue with another agent from ⇄ in the header, or move the project to a shorter path.',
    conflicto: (ruta: string) =>
      `The destination account already has a conversation with this id and different content (${ruta}), so it is not overwritten. If you do not need it, move or delete it and try again.`
  }
)
