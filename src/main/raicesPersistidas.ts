// =============================================================================
// Las formas que Tessera escribe en disco o intercambia con otro programa o versión: cada propiedad es
// un artefacto y su tipo, lo que se escribe. No lo importa la app; lo lee `test:claves-persistidas`,
// que calcula desde aquí las claves fijadas y para el commit si una cambia o desaparece.
// Decisiones: docs/decisiones/calidad/claves-persistidas.md
// =============================================================================
import type { ConexionPersistida } from './db/conservarAlEditar.ts'
import type { ConexionSshPersistida, GrupoSshPersistido } from './ssh/conservarAlEditarSsh.ts'
import type { EstadoWorkspace } from '../shared/workspace-state-ipc.ts'
import type { Perfil } from './perfiles/types.ts'
import type { AlmacenCuentasPersistido } from './agentes/AlmacenCuentas.ts'
import type { EntradaRegistro } from './agentes/delegacion/registroTareas.ts'
import type { ContextoGlobal } from '../shared/contexto.ts'
import type { ArchivoCapasPerfil } from './sandbox/gestor/capaPerfil.ts'
import type { LecturaImagen } from './sandbox/estadoImagenAgentes.ts'
import type { Persistido as PropuestasReglasPersistidas } from './reglas/propuestasReglas.ts'
import type { PropuestaConfig } from '../shared/configAgente-ipc.ts'
import type { ArchivoAjustesJava } from './java/ServicioJava.ts'
import type { Documento } from './util/carpetaDialogo.ts'
import type { EstadoVentana } from './app/estadoVentana.ts'
import type { ArchivoRestauracion } from './app/ventanasAgentePuro.ts'
import type { MarcadorActualizacion } from './actualizacion/marcadorActualizacionPuro.ts'
import type { RevisionVolcados } from './app/volcados.ts'
import type { ConstanciaParada } from '../shared/agent-terminal-ipc.ts'
import type { DbEntradaHistorial } from '../shared/dbExploradorPeticiones.ts'
import type { ArchivoIndiceConsolas } from './db/explorador/AlmacenConsolas.ts'
import type { CatalogoDrivers, RegistroExterno } from './db/GestorDrivers.ts'
import type { ArchivoCopia } from './configuracion/cifradoFrase.ts'
import type { ContenidoCopia } from './configuracion/contenido.ts'
import type { MetaArchivo, MetaFin } from './configuracion/trozosCopia.ts'
import type { LineaSalud } from '../shared/salud.ts'
import type { EncargoRelevo } from '../shared/relevo.ts'
import type { RespuestaResolverPuente } from './db/puenteBd.ts'
import type { VistaTarea, VistaTareaConResultado, CuentaDelegable } from '../shared/delegacion-ipc.ts'
import type { ResultadoModelos } from './agentes/delegacion/ServicioDelegacion.ts'
import type { Coincidencia } from './historial/buscarHistorial.ts'
import type { DocumentoListado } from './documentos/documentosPerfil.ts'
import type { Peticion, RespuestaTrabajador, ResultadoTrabajador } from './db/explorador/protocoloTrabajador.ts'
import type { CredencialesClaude } from './uso/credencialesClaude.ts'
import type { AjustesClaude, InstalacionClaude } from './agentes/nativos/urls.ts'
import type { LineaJsonl } from './util/jsonlCola.ts'
import type { LineaJsonConversacion } from './conversaciones/LectorConversaciones.ts'
import type { EstadoInspeccionDocker } from './sandbox/gestor/tipos.ts'
import type { LimiteClaude, VentanaCodex } from './uso/ventanasUso.ts'

/** Artefacto persistido → forma que se escribe. */
export interface RaicesPersistidas {
  /** `serializarRegistro` (`db/registroConexiones.ts`): `{ version, connections, ...raiz }`. */
  'db-connections.json': { version: number; connections: ConexionPersistida[] }
  /** `serializarRegistroSsh` (`ssh/registroSsh.ts`): `{ version, grupos, conexiones, ...raiz }`. */
  'ssh-connections.json': { version: number; grupos: GrupoSshPersistido[]; conexiones: ConexionSshPersistida[] }
  /** `escribirEstadoAtomico` (`workspace/almacenEstadoWorkspace.ts`). */
  'workspace-state.json': EstadoWorkspace
  /** `perfiles/store.ts`: perfiles completos, también en la semilla. */
  'profiles.json': Perfil[]
  /** `perfiles/ordenDeBorrado.ts`: perfiles pendientes de borrar. */
  'perfiles-borrados.json': Perfil[]
  /** `AlmacenCuentas.persistir` (`agentes/AlmacenCuentas.ts`). */
  'agent-accounts.json': AlmacenCuentasPersistido
  /** `AlmacenCuentas.persistirGlobales` (`agentes/AlmacenCuentas.ts`): cuentas conocidas. */
  'agent-accounts-globales.json': AlmacenCuentasPersistido
  /** `agentes/delegacion/registroTareas.ts`: entradas completas del registro. */
  'tareas-delegadas.json': EntradaRegistro[]
  /** `contexto/contextoGlobal.ts`: reglas y documentos globales. */
  'contexto-global.json': ContextoGlobal
  /** `sandbox/gestor/capaPerfil.ts`: instalaciones por perfil y fallos. */
  'capas-perfil.json': ArchivoCapasPerfil
  /** `crearRegistroLecturaImagen` (`sandbox/estadoImagenAgentes.ts`). */
  'versiones-imagen-docker.json': LecturaImagen
  /** `reglas/propuestasReglas.ts`: propuestas pendientes. */
  'reglas-propuestas.json': PropuestasReglasPersistidas
  /** `agentes/configAgente/propuestasConfig.ts`: propuestas pendientes. */
  'config-propuestas.json': PropuestaConfig[]
  /** `ServicioJava.guardarAjustes` (`java/ServicioJava.ts`). */
  'java-runtime.json': ArchivoAjustesJava
  /** `MemoriaCarpetas` (`util/carpetaDialogo.ts`): última carpeta por diálogo. */
  'carpetas-dialogos.json': Documento
  /** `app/ventana.ts`: geometría de la ventana principal. */
  'ventana.json': EstadoVentana
  /** `app/integracionVentanas.ts`: ventanas de agente que se restauran. */
  'ventanas-agente.json': ArchivoRestauracion
  /** `actualizacion/marcadorActualizacion.ts`: actualización preparada e intentos. */
  'pending_update.json': MarcadorActualizacion
  /** `app/volcados.ts`: última revisión de volcados. */
  'logs/volcados.json': RevisionVolcados
  /** `RegistroParadas.anotar` (`agentes/terminalAgente/registroParadas.ts`): una línea. */
  'logs/paradas-contenedores.jsonl': ConstanciaParada
  /** `db/explorador/AlmacenHistorial.ts`: una sentencia por línea. */
  'db-historial/*.jsonl': DbEntradaHistorial
  /** `db/explorador/AlmacenConsolas.ts`: índice de consolas. */
  'conexiones/*/consolas/indice.json': ArchivoIndiceConsolas
  /** `GestorDrivers` (`db/GestorDrivers.ts`): carpetas externas elegidas. */
  'db-drivers.json': RegistroExterno
  /** `GestorDrivers` (`db/GestorDrivers.ts`): catálogo que lee el cliente. */
  'drivers/catalogo.json': CatalogoDrivers
  /** `configuracion/ipc.ts`: cabecera y contenido cifrado. */
  'copia.tessera': ArchivoCopia
  /** `armarContenido` (`configuracion/contenido.ts`): JSON interior. */
  'copia.tessera(contenido)': ContenidoCopia
  /** `configuracion/trozosCopia.ts`: metadatos de archivo o de cierre. */
  'copia.tessera(trozo)': MetaArchivo | MetaFin
  // Lo que se intercambia con otro proceso o programa: diagnóstico, relevo, puente y trabajador de BD.
  // Una operación del puente que arma su respuesta en un literal sin tipo fija solo sus elementos.
  'logs/salud.jsonl': LineaSalud
  'encargo.json': EncargoRelevo
  'puente:resolve': RespuestaResolverPuente
  'puente:ctx.tareas': VistaTarea[]
  'puente:ctx.tarea': VistaTareaConResultado
  'puente:ctx.cuentas': CuentaDelegable[]
  'puente:ctx.modelos': ResultadoModelos
  'puente:ctx.buscar': Coincidencia[]
  'puente:ctx.docs': DocumentoListado[]
  'trabajador:peticion': Peticion
  'trabajador:respuesta': RespuestaTrabajador
  'trabajador:resultado': ResultadoTrabajador
  // Formatos que escribe otro programa: no hay escritor propio, así que lo fijado es lo que se lee.
  'ajeno:~/.claude/.credentials.json': CredencialesClaude
  'ajeno:~/.claude.json': InstalacionClaude
  'ajeno:settings.json(claude)': AjustesClaude
  'ajeno:transcript.jsonl': LineaJsonl
  'ajeno:transcript.jsonl(cabeza)': LineaJsonConversacion
  'ajeno:docker-inspect': EstadoInspeccionDocker
  'ajeno:api-uso': LimiteClaude | VentanaCodex
}
