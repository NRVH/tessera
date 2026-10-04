// =============================================================================
// Prueba del saneado de `dbMountsByProject` (npm run test:db-mounts).
// Las bases montadas en cada proyecto tienen que sobrevivir a guardar y leer: `normalizeSettings`
// descarta lo que no reconoce, y sin esta prueba un refactor haría desaparecer los montajes de
// todos los proyectos en silencio al reiniciar.
// =============================================================================

import { normalizeWorkspaceState, DEFAULT_SETTINGS } from './workspace-state-ipc.ts'

let fallos = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

/** Estado mínimo válido con el slice de ajustes que se quiera probar. */
function estadoCon(settings: unknown): ReturnType<typeof normalizeWorkspaceState> {
  return normalizeWorkspaceState({ version: 1, activeProfileId: 'alfa', byProfile: {}, settings })
}

console.log('\ndbMountsByProject (saneado)\n')

const CLAVE = 'alfa|D:\\proyectos\\mi-repo'
const OTRA = 'cliente|D:\\proyectos\\otro'

// --- Camino feliz: ida y vuelta ---------------------------------------------
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: ['id-1', 'id-2'] } })?.settings
  comprobar('conserva los ids del proyecto', JSON.stringify(s?.dbMountsByProject?.[CLAVE]) === '["id-1","id-2"]',
    JSON.stringify(s?.dbMountsByProject))
}
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: ['a'], [OTRA]: ['b', 'c'] } })?.settings
  comprobar('conserva VARIOS proyectos a la vez', Object.keys(s?.dbMountsByProject ?? {}).length === 2)
}

// --- Ausencia y defaults -----------------------------------------------------
{
  const s = estadoCon({})?.settings
  comprobar('sin el campo -> objeto vacío, no undefined', JSON.stringify(s?.dbMountsByProject) === '{}')
  comprobar('el default del módulo también es vacío', JSON.stringify(DEFAULT_SETTINGS.dbMountsByProject) === '{}')
}
{
  // El slice entero ausente no debe tumbar la carga (archivo de una versión vieja).
  const s = estadoCon(undefined)?.settings
  comprobar('sin slice settings sigue habiendo un mapa usable', JSON.stringify(s?.dbMountsByProject) === '{}')
}

// --- Defensa ante basura -----------------------------------------------------
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: ['id-1', 'id-1', 'id-2'] } })?.settings
  comprobar('deduplica ids repetidos', JSON.stringify(s?.dbMountsByProject?.[CLAVE]) === '["id-1","id-2"]',
    JSON.stringify(s?.dbMountsByProject?.[CLAVE]))
}
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: [], [OTRA]: ['x'] } })?.settings
  comprobar('descarta proyectos SIN bases montadas', s?.dbMountsByProject?.[CLAVE] === undefined)
  comprobar('...sin llevarse por delante los demás', JSON.stringify(s?.dbMountsByProject?.[OTRA]) === '["x"]')
}
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: ['ok', 42, null, '', { a: 1 }] } })?.settings
  comprobar('descarta entradas que no son cadenas', JSON.stringify(s?.dbMountsByProject?.[CLAVE]) === '["ok"]',
    JSON.stringify(s?.dbMountsByProject?.[CLAVE]))
}
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: 'no-es-array' } })?.settings
  comprobar('un valor que no es array se ignora', s?.dbMountsByProject?.[CLAVE] === undefined)
}
{
  const s = estadoCon({ dbMountsByProject: 'basura' })?.settings
  comprobar('un campo corrupto no rompe la carga', JSON.stringify(s?.dbMountsByProject) === '{}')
}

// --- No debe contaminar el resto del slice -----------------------------------
{
  const s = estadoCon({ dbMountsByProject: { [CLAVE]: ['a'] }, ccWidth: 400 })?.settings
  comprobar('convive con los demás ajustes', s?.ccWidth === 400 && s?.dbMountsByProject?.[CLAVE]?.length === 1)
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
