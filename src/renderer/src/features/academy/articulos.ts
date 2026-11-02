// =============================================================================
// El contenido de cada artículo de Tessera Academy, por id. Un `Record` completo sobre
// `ArticuloId`: un artículo del índice sin contenido no compila. Cada uno se lee al usarse,
// en el idioma de la interfaz.
// =============================================================================

import type { Textos } from '../../../../shared/i18n.ts'
import type { ArticuloId } from './indice.ts'
import type { Articulo } from './modelo.ts'
import { txActualizaciones } from './contenido/actualizaciones.ts'
import { txAgentes } from './contenido/agentes.ts'
import { txAtajos } from './contenido/atajos.ts'
import { txBasesDeDatos } from './contenido/basesDeDatos.ts'
import { txBienvenida } from './contenido/bienvenida.ts'
import { txContenedoresDocker } from './contenido/contenedoresDocker.ts'
import { txContinuarEnOtroAgente } from './contenido/continuarEnOtroAgente.ts'
import { txConversaciones } from './contenido/conversaciones.ts'
import { txCopiaDeConfiguracion } from './contenido/copiaDeConfiguracion.ts'
import { txCuentas } from './contenido/cuentas.ts'
import { txEditorYExplorador } from './contenido/editorYExplorador.ts'
import { txGit } from './contenido/git.ts'
import { txGlosario } from './contenido/glosario.ts'
import { txHerramientasDeLosAgentes } from './contenido/herramientasDeLosAgentes.ts'
import { txHibernar } from './contenido/hibernar.ts'
import { txMosaico } from './contenido/mosaico.ts'
import { txNativoODocker } from './contenido/nativoODocker.ts'
import { txPerfiles } from './contenido/perfiles.ts'
import { txProyectos } from './contenido/proyectos.ts'
import { txReglasDelPerfil } from './contenido/reglasDelPerfil.ts'
import { txSsh } from './contenido/ssh.ts'
import { txTerminales } from './contenido/terminales.ts'

export const ARTICULOS: Record<ArticuloId, () => Textos<Articulo>> = {
  bienvenida: txBienvenida,
  glosario: txGlosario,
  perfiles: txPerfiles,
  proyectos: txProyectos,
  hibernar: txHibernar,
  agentes: txAgentes,
  cuentas: txCuentas,
  'nativo-o-docker': txNativoODocker,
  'continuar-en-otro-agente': txContinuarEnOtroAgente,
  'reglas-del-perfil': txReglasDelPerfil,
  conversaciones: txConversaciones,
  mosaico: txMosaico,
  'herramientas-de-los-agentes': txHerramientasDeLosAgentes,
  'bases-de-datos': txBasesDeDatos,
  ssh: txSsh,
  'editor-y-explorador': txEditorYExplorador,
  git: txGit,
  terminales: txTerminales,
  'contenedores-docker': txContenedoresDocker,
  'copia-de-configuracion': txCopiaDeConfiguracion,
  atajos: txAtajos,
  actualizaciones: txActualizaciones
}

/** El artículo en el idioma de la interfaz. */
export function articulo(id: ArticuloId): Articulo {
  // Los dos idiomas se declaran como `Articulo`; `Textos` solo ensancha `soloEn` a `string[]`.
  return ARTICULOS[id]() as Articulo
}
