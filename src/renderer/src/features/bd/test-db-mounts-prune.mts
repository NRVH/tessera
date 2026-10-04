// =============================================================================
// Prueba de la poda de montajes de BD por proyecto (npm run test:db-prune): la clave
// partida por el primer `|` sin romper rutas de Windows, qué es basura y qué no, quitar
// una conexión solo en su perfil y los ids vivos con que se poda (nada con un registro
// de formato ajeno).
// Decisiones: docs/decisiones/bd/ui-area-estado-de-la-vista.md
// =============================================================================
import {
  idsVivosDePerfil,
  perfilDeClave,
  podarMontajes,
  quitarConexion,
  vivasParaPodarPestanas,
  vivosParaPodar,
  type DbMounts
} from './dbMounts.ts'

// =============================================================================
// Prueba de la PODA de montajes (npm run test:db-prune).
// -----------------------------------------------------------------------------
// Lo que protege: que limpiar basura no se lleve por delante montajes buenos. El
// error caro aquí no es dejar un id huérfano —eso solo pinta un badge de más— sino
// borrar de más: perderías en silencio las bases montadas de proyectos que sí usas
// y tendrías que rehacerlas una por una sin saber por qué desaparecieron. De ahí las
// dos secciones del final: las ajenas cuentan como vivas, y con un registro de formato
// ajeno (listas vacías que no dicen nada) no se poda en absoluto.
// =============================================================================

let fallos = 0
function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

const REPO = 'alfa|D:\\Proyectos\\mi-repo'
const OTRO = 'alfa|D:\\Proyectos\\otro'
const BETA = 'beta|D:\\cosas\\suyo'

console.log('\nperfilDeClave\n')
{
  comprobar('corta por el PRIMER separador', perfilDeClave(REPO) === 'alfa')
  // Una ruta con `|` es rarísima, pero cortar por el último rompería el perfil.
  comprobar('una ruta con | no confunde el perfil', perfilDeClave('alfa|D:\\a|b') === 'alfa')
  comprobar('clave sin separador se devuelve entera', perfilDeClave('alfa') === 'alfa')
}

console.log('\nquitarConexion (ceñida al perfil)\n')
{
  const m: DbMounts = { [REPO]: ['a', 'b'], [OTRO]: ['b'] }
  const r = quitarConexion(m, 'b', 'alfa')
  comprobar('quita el id de TODOS los proyectos del perfil', JSON.stringify(r[REPO]) === '["a"]' && r[OTRO] === undefined,
    JSON.stringify(r))
  comprobar('descarta el proyecto que se queda sin bases', Object.keys(r).length === 1)
}
{
  // La misma copia pegada en dos perfiles comparte id, y borrar la de un perfil no puede
  // desmontar la original del otro en sus proyectos.
  const m: DbMounts = { [REPO]: ['cp', 'a'], [BETA]: ['cp'] }
  const r = quitarConexion(m, 'cp', 'beta')
  comprobar(
    'NEGATIVO: los proyectos de OTRO perfil con el mismo id no se tocan (ni su array: la misma referencia)',
    r[REPO] === m[REPO] && r[BETA] === undefined && Object.keys(r).length === 1,
    JSON.stringify(r)
  )
  comprobar('y del perfil pedido sí se quita', quitarConexion(m, 'cp', 'alfa')[BETA] === m[BETA] &&
    JSON.stringify(quitarConexion(m, 'cp', 'alfa')[REPO]) === '["a"]')
  comprobar('un perfil sin montajes de ese id: el MISMO objeto', quitarConexion(m, 'a', 'beta') === m)
}
{
  const m: DbMounts = { [REPO]: ['a'] }
  // Identidad: sin cambios no debe crear objeto nuevo (evita render y escritura).
  comprobar('sin coincidencias devuelve el MISMO objeto', quitarConexion(m, 'zzz', 'alfa') === m)
}
{
  comprobar('mapa vacío no rompe', Object.keys(quitarConexion({}, 'a', 'alfa')).length === 0)
}

console.log('\npodarMontajes\n')
{
  const m: DbMounts = { [REPO]: ['viva', 'muerta'], [BETA]: ['suya'] }
  const validos = new Map([
    ['alfa', ['viva']],
    ['beta', ['suya']]
  ])
  const r = podarMontajes(m, validos)
  comprobar('quita ids de conexiones borradas', JSON.stringify(r[REPO]) === '["viva"]', JSON.stringify(r[REPO]))
  comprobar('no toca los de otro perfil', JSON.stringify(r[BETA]) === '["suya"]')
}
{
  // Perfil borrado: su entrada entera sobra.
  const m: DbMounts = { [REPO]: ['a'], 'fantasma|D:\\x': ['b'] }
  const r = podarMontajes(m, new Map([['alfa', ['a']]]))
  comprobar('descarta perfiles que ya no existen', r['fantasma|D:\\x'] === undefined && r[REPO] !== undefined)
}
{
  // LO IMPORTANTE: un perfil SIN conexiones sigue siendo un perfil vivo; si el
  // llamador lo omitiera se perderían montajes buenos, así que se exige pasarlo.
  const m: DbMounts = { [REPO]: ['a'] }
  const r = podarMontajes(m, new Map([['alfa', []]]))
  comprobar('perfil vivo sin conexiones -> se limpian sus ids', Object.keys(r).length === 0)
}
{
  const m: DbMounts = { [REPO]: ['a'], [OTRO]: ['a'] }
  const r = podarMontajes(m, new Map([['alfa', ['a']]]))
  comprobar('NO poda proyectos cerrados (no los conoce ni le importan)', Object.keys(r).length === 2)
  comprobar('todo válido devuelve el MISMO objeto', r === m)
}
{
  comprobar('mapa vacío no rompe', Object.keys(podarMontajes({}, new Map())).length === 0)
}

// LAS AJENAS (las que esta versión no sabe abrir: de un motor que no conoce, o de uno
// que conoce guardadas de una forma que no reconoce) siguen en el registro: su montaje
// NO es basura. Antes la poda solo contaba `db.list`, que no las devuelve, y abrir una
// versión anterior desmontaba la base del proyecto en silencio.
console.log('\nidsVivosDePerfil (las ajenas cuentan como vivas)\n')
{
  const conocidas = [{ id: 'pg' }, { id: 'ora' }]
  const ajenas = [{ id: 'mysql-1' }]
  const vivos = idsVivosDePerfil(conocidas, ajenas)
  comprobar('suma conocidas y ajenas, en ese orden', JSON.stringify(vivos) === '["pg","ora","mysql-1"]', JSON.stringify(vivos))
  const m: DbMounts = { [REPO]: ['pg', 'mysql-1', 'borrada'] }
  const r = podarMontajes(m, new Map([['alfa', vivos]]))
  comprobar(
    'la poda CONSERVA el montaje de una ajena y quita el de una borrada',
    JSON.stringify(r[REPO]) === '["pg","mysql-1"]',
    JSON.stringify(r[REPO])
  )
  // La mitad negativa: sin ajenas en la cuenta, la misma poda se la llevaría. Es lo
  // que pasaba; si esta línea deja de cumplirse, el caso de arriba no prueba nada.
  const sinAjenas = podarMontajes(m, new Map([['alfa', idsVivosDePerfil(conocidas, [])]]))
  comprobar('(contraprueba) contando solo las conocidas, se perdería', JSON.stringify(sinAjenas[REPO]) === '["pg"]',
    JSON.stringify(sinAjenas[REPO]))
  comprobar('sin repetidos si un id viniera en las dos listas',
    JSON.stringify(idsVivosDePerfil([{ id: 'x' }], [{ id: 'x' }])) === '["x"]')
  comprobar('perfil sin nada: lista vacía (sigue siendo un perfil vivo)', idsVivosDePerfil([], []).length === 0)
}

// EL FORMATO AJENO DEL REGISTRO ENTERO: el main no interpreta ninguna entrada y
// `listCompleta` devuelve las dos listas VACÍAS con `formatoAjeno: true`; tomarlas por
// «el perfil no tiene conexiones» desmontaría las bases de TODOS los proyectos, así que
// no se poda nada. Las mitades negativas fijan que sin la marca la poda sigue podando.
console.log('\nvivosParaPodar (con formato ajeno no se poda nada)\n')
{
  const ajeno = { conexiones: [], ajenas: [], formatoAjeno: true }
  const m: DbMounts = { [REPO]: ['pg', 'ora'], [OTRO]: ['pg'], [BETA]: ['suya'] }
  const conFormato = vivosParaPodar([
    ['alfa', ajeno],
    ['beta', ajeno]
  ])
  comprobar('con formato ajeno: null (no se poda)', conFormato === null, JSON.stringify(conFormato && [...conFormato]))
  // Lo que hace `useMontajesBd` con ese null: no llama a `podarMontajes`. La contraprueba es lo
  // que pasaba al tomar las listas vacías por buenas: se perdía TODO.
  const antes = podarMontajes(m, new Map([['alfa', []], ['beta', []]]))
  comprobar(
    '(contraprueba) tomando las listas vacías por buenas, se desmontaba todo',
    Object.keys(antes).length === 0,
    JSON.stringify(antes)
  )
  // Basta UNA respuesta con la marca: el registro es uno solo para todos los perfiles.
  const mezcla = vivosParaPodar([
    ['alfa', { conexiones: [{ id: 'pg' }], ajenas: [], formatoAjeno: false }],
    ['beta', ajeno]
  ])
  comprobar('basta UN perfil con formato ajeno para no podar ninguno', mezcla === null, JSON.stringify(mezcla && [...mezcla]))

  const sinFormato = vivosParaPodar([
    ['alfa', { conexiones: [{ id: 'pg' }], ajenas: [{ id: 'sqls' }], formatoAjeno: false }],
    ['beta', { conexiones: [], ajenas: [], formatoAjeno: false }]
  ])
  comprobar(
    'NEGATIVO: sin la marca, los ids vivos de cada perfil (conocidas + ajenas), también los de un perfil vacío',
    sinFormato !== null &&
      JSON.stringify(sinFormato.get('alfa')) === '["pg","sqls"]' &&
      JSON.stringify(sinFormato.get('beta')) === '[]' &&
      sinFormato.size === 2,
    JSON.stringify(sinFormato && [...sinFormato])
  )
  const podado = sinFormato ? podarMontajes(m, sinFormato) : m
  comprobar(
    'NEGATIVO: y con ellos la poda sigue quitando lo que no existe',
    JSON.stringify(podado[REPO]) === '["pg"]' && JSON.stringify(podado[OTRO]) === '["pg"]' && podado[BETA] === undefined,
    JSON.stringify(podado)
  )
}

console.log('\nvivasParaPodarPestanas (la poda de pestañas y selección se salta el perfil con formato ajeno)\n')
{
  const conexiones = new Map([
    ['alfa', [] as { id: string }[]],
    ['beta', [{ id: 't1' }]]
  ])
  const ajenas = new Map([['beta', [{ id: 't-sqls' }]]])
  const vivas = vivasParaPodarPestanas(conexiones, ajenas, new Map([['alfa', 'aviso']]))
  comprobar(
    'el perfil con formato ajeno NO está en el mapa (`podarConexiones` lo deja intacto)',
    !vivas.has('alfa'),
    JSON.stringify([...vivas])
  )
  comprobar(
    'los demás, con conocidas + ajenas',
    JSON.stringify(vivas.get('beta')) === '["t1","t-sqls"]' && vivas.size === 1,
    JSON.stringify([...vivas])
  )
  const sinAviso = vivasParaPodarPestanas(conexiones, ajenas, new Map())
  comprobar(
    'NEGATIVO: sin aviso, un perfil con la lista vacía SÍ entra (y se le podan las pestañas)',
    JSON.stringify(sinAviso.get('alfa')) === '[]' && sinAviso.size === 2,
    JSON.stringify([...sinAviso])
  )
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
