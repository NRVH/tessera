// =============================================================================
// API pública de la feature de bases de datos para las demás features: el store que
// comparte la ventana, los tipos de los hooks de la ventana, el árbol y los iconos de
// motor que compone el layout, los textos de montajes ajenos, el formato de enteros y
// el motor de un archivo de base de datos. Lo que solo compone App.tsx está en
// `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export { useStoreBd, ocultarAgenteDb } from './store'
export type { EspaciosDatos } from './useEspaciosDatos'
export type { MontajesBd } from './useMontajesBd'
export type { BdApp } from './useBdApp'
export { DbArbol } from './DbArbol'
export { IconoMotor, IconoBd, nombreMotor } from './iconosBd'
export {
  motivoSinConsola,
  NOTA_MONTAJE_FORMATO_AJENO,
  TITULO_FORMATO_AJENO,
  vistaPopoverMontaje
} from './filasArbolBdAvisos'
export { ajenasMontadasPopover, filaMontajeAjena } from './filasArbolBdAjenas'
export { formatoEntero } from './rejilla/celdasRejilla'
export { motorPorNombreDeArchivo } from './camposConexion'
