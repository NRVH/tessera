// =============================================================================
// Textos del aviso de carga común (`IndicadorCarga.tsx`) en español e inglés, con las mismas
// claves; se leen al usarse, nunca al cargar el módulo.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../shared/i18n.ts'

export const txCarga = crearTextos(
  {
    tardando: 'Está tardando más de lo habitual…',
    tardandoPor: (motivo: string) => `Está tardando más de lo habitual (${motivo})…`
  },
  {
    tardando: 'This is taking longer than usual…',
    tardandoPor: (motivo: string) => `This is taking longer than usual (${motivo})…`
  }
)
