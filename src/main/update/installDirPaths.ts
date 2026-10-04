// =============================================================================
// Pre-vuelo de rutas de la carpeta de instalación (Windows), puro. El desinstalador de NSIS
// no borra los archivos: los RENOMBRA a un temporal más largo (`%TEMP%\nsXXXX.tmp\old-install`)
// con la API Win32 sin prefijo `\\?\`, así que una ruta que al crecer llega a MAX_PATH no se
// puede renombrar y el instalador aborta con «…: 2», un mensaje que habla de archivos en uso
// y miente. Aquí se calcula el crecimiento, qué rutas condena y qué restos de versiones viejas
// (datos de usuario bajo appPath) se borran antes. Lo prueba `test-update.mts`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

/** Límite clásico de Windows para rutas sin el prefijo `\\?\` (el que usa NSIS). */
export const MAX_PATH = 260

/**
 * Restos de versiones viejas dentro de la carpeta de la app. Son datos de USUARIO
 * que hoy viven en `userData` (%APPDATA%\Tessera); bajo appPath no pintan nada —de
 * hecho un update los borraría igualmente— y son la fuente típica de rutas kilométricas
 * (los agentes anidan plugins/marketplaces sin piedad).
 */
export const STRAY_APP_DATA = ['.tessera']

/**
 * Cuánto CRECE una ruta al ser renombrada al temporal del desinstalador. Se calcula
 * con el prefijo real de destino (`<tmp>\nsXXXXX.tmp\old-install`) frente a la raíz de
 * instalación; puede ser negativo si el temporal es más corto (entonces no hay riesgo).
 */
export function renameGrowth(installRoot: string, tmpDir: string): number {
  // `nsXXXXX.tmp` es el nombre que NSIS da a su $PLUGINSDIR (8.3 + extensión).
  const destPrefix = `${tmpDir}\\nsXXXXX.tmp\\old-install`
  return destPrefix.length - installRoot.length
}

/**
 * ¿Esta ruta rompe el renombrado del desinstalador? Es decir: al reescribirla bajo el
 * temporal, ¿se pasa de MAX_PATH? El `>=` es deliberado: MAX_PATH incluye el NUL final,
 * así que 260 exactos ya es demasiado.
 */
export function wouldExceedMaxPath(fullPath: string, growth: number): boolean {
  return fullPath.length + growth >= MAX_PATH
}
