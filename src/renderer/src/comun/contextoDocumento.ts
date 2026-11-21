// =============================================================================
// Contexto del documento en el que se pintan los portales (capa flotante y modales).
// Los paneles desacoplados en una ventana hija publican el documento de esa ventana;
// sin proveedor explícito, todo cae al `document` principal.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================

import { createContext, useContext } from 'react'
import { documentoVivo } from '../util/ventanaDe'

/** Documento destino para portales y escuchas; `null` significa el `document` principal. */
export const ContextoDocumento = createContext<Document | null>(null)

/** Devuelve `explicito` (si sigue vivo), o el del contexto, o el `document` principal. */
export function useDocumentoActual(explicito?: Document): Document {
  const delContexto = useContext(ContextoDocumento)
  return documentoVivo(explicito ?? delContexto, document)
}
