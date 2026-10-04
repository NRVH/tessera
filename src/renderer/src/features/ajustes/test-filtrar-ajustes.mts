#!/usr/bin/env node
// =============================================================================
// Prueba del buscador del panel de Configuración (npm run test:filtrar-ajustes).
// Fija que filtre como espera quien no sabe cómo se llama el ajuste: consulta vacía =
// todo visible, acentos, sinónimos, varias palabras (acotan), título del grupo, grupos
// sin filas ocultos, una consulta que casa en dos categorías las devuelve las dos, y
// capacidades y plataforma (las tres, pasadas como parámetro, y un catálogo sintético
// para la poda de una categoría que se queda sin grupos).
// =============================================================================

import {
  CATEGORIAS,
  CATEGORIA_INICIAL,
  categoriasVisibles,
  idsDuplicados,
  resolverCategoria,
  siguienteCategoria
} from './catalogo.ts'
// Import de VALOR con extensión explícita: `plataforma.ts` no importa nada a su vez,
// así que no arrastra la app a la cadena (la regla del catálogo sigue intacta).
import { capacidadesDe } from '../../../../shared/plataforma.ts'
import {
  categoriaVisible,
  contarPorCategoria,
  filtrarAjustes,
  grupoVisible,
  gruposDe,
  normalizarTexto,
  sinResultados,
  type CategoriaBuscable,
  type GrupoBuscable
} from './filtrarAjustes.ts'

// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Un catálogo con la misma forma que el real, para no depender del panel. */
const GRUPOS: GrupoBuscable[] = [
  {
    titulo: 'Apariencia',
    ajustes: [
      { id: 'ui', etiqueta: 'Interfaz', claves: ['tamaño', 'letra', 'fuente', 'densidad'] },
      { id: 'explorador', etiqueta: 'Explorador', claves: ['tamaño', 'letra', 'archivos'] },
      { id: 'git', etiqueta: 'Vista de git', claves: ['tamaño', 'letra', 'cambios', 'historial'] },
      { id: 'banda', etiqueta: 'Colapsar la banda de perfiles', claves: ['perfiles', 'compacta'] }
    ]
  },
  {
    titulo: 'Terminales',
    ajustes: [
      { id: 'term-fuente', etiqueta: 'Fuente', claves: ['tipografía'] },
      { id: 'term-tamano', etiqueta: 'Tamaño', claves: ['letra'] }
    ]
  },
  {
    titulo: 'Proyectos',
    ajustes: [{ id: 'modo', etiqueta: 'Al abrir un proyecto nuevo', claves: ['docker', 'windows'] }]
  }
]

/**
 * Los grupos de arriba repartidos en categorías, como los pinta el riel.
 *
 * FALSAS a propósito: los bloques 1-8 prueban el MOTOR con un catálogo mínimo y
 * estable, para que añadir un ajuste real no obligue a reescribir aserciones. El
 * catálogo de verdad se prueba aparte, en el bloque 9.
 */
const FALSAS: CategoriaBuscable[] = [
  { id: 'apariencia', titulo: 'Apariencia', grupos: [GRUPOS[0]] },
  { id: 'terminales', titulo: 'Terminales', grupos: [GRUPOS[1]] },
  { id: 'proyectos', titulo: 'Proyectos', grupos: [GRUPOS[2]] }
]

const ids = (consulta: string): string[] => [...filtrarAjustes(GRUPOS, consulta)].sort()

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) NORMALIZACIÓN del texto')
  {
    check(
      'quita acentos y baja a minúsculas',
      normalizarTexto('Tamaño DE Letra') === 'tamano de letra',
      normalizarTexto('Tamaño DE Letra')
    )
    check(
      'las vocales acentuadas también',
      normalizarTexto('Configuración Íntegra') === 'configuracion integra',
      normalizarTexto('Configuración Íntegra')
    )
    check('el texto vacío no rompe', normalizarTexto('') === '', '""')
  }

  // -------------------------------------------------------------------------
  hr('2) CONSULTA VACÍA: se ve todo')
  {
    const total = GRUPOS.reduce((n, g) => n + g.ajustes.length, 0)
    check('sin consulta salen todos', ids('').length === total, `${ids('').length} de ${total}`)
    check(
      'solo espacios cuenta como vacío',
      ids('   ').length === total,
      `${ids('   ').length} de ${total}`
    )
    check('y no hay "sin resultados"', !sinResultados(GRUPOS, filtrarAjustes(GRUPOS, '')), 'hay filas')
  }

  // -------------------------------------------------------------------------
  hr('3) ACENTOS y MAYÚSCULAS en la consulta')
  {
    // El caso de verdad: la clave está escrita "tamaño" y se busca "tamano".
    check(
      '"tamano" encuentra las filas de "tamaño"',
      ids('tamano').includes('ui') && ids('tamano').includes('term-tamano'),
      ids('tamano').join(',')
    )
    check(
      '"TAMAÑO" en mayúsculas da lo mismo',
      ids('TAMAÑO').join(',') === ids('tamano').join(','),
      ids('TAMAÑO').join(',')
    )
    check(
      'casa por SUBCADENA (mientras se teclea)',
      ids('tam').length === ids('tamano').length,
      `"tam" -> ${ids('tam').join(',')}`
    )
  }

  // -------------------------------------------------------------------------
  hr('4) SINÓNIMOS: se busca por lo que uno diría, no por la etiqueta')
  {
    // "Explorador" no contiene la palabra "letra" por ningún lado.
    check(
      '"letra" encuentra Explorador y Vista de git',
      ids('letra').includes('explorador') && ids('letra').includes('git'),
      ids('letra').join(',')
    )
    check(
      '"docker" encuentra el modo de proyecto',
      ids('docker').join(',') === 'modo',
      ids('docker').join(',')
    )
    check(
      'y la ETIQUETA sigue casando por sí sola',
      ids('perfiles').join(',') === 'banda',
      ids('perfiles').join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('5) VARIAS PALABRAS: acotan, y el orden da igual')
  {
    check(
      '"letra git" deja solo la vista de git',
      ids('letra git').join(',') === 'git',
      ids('letra git').join(',')
    )
    check(
      '"git letra" da exactamente lo mismo',
      ids('git letra').join(',') === ids('letra git').join(','),
      ids('git letra').join(',')
    )
    check(
      'añadir palabras nunca AMPLÍA el resultado',
      ids('letra git').length < ids('letra').length,
      `${ids('letra').length} -> ${ids('letra git').length}`
    )
    check(
      'los espacios de sobra no cambian nada',
      ids('  letra   git  ').join(',') === 'git',
      ids('  letra   git  ').join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('6) EL TÍTULO DEL GRUPO cuenta como texto de sus filas')
  {
    // "Fuente" y "Tamaño" a secas no dicen de qué son; el grupo sí.
    const t = ids('terminales')
    check(
      '"terminales" saca las filas de ese grupo',
      t.includes('term-fuente') && t.includes('term-tamano'),
      t.join(',')
    )
    check(
      'y NO arrastra las de Apariencia',
      !t.includes('ui') && !t.includes('explorador'),
      t.join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('7) GRUPOS vacíos y SIN RESULTADOS')
  {
    const visibles = filtrarAjustes(GRUPOS, 'docker')
    const apariencia = GRUPOS[0]
    const proyectos = GRUPOS[2]
    check(
      'un grupo sin filas visibles se oculta entero',
      !grupoVisible(apariencia, visibles) && grupoVisible(proyectos, visibles),
      `Apariencia=${grupoVisible(apariencia, visibles)} Proyectos=${grupoVisible(proyectos, visibles)}`
    )
    const nada = filtrarAjustes(GRUPOS, 'bluetooth')
    check('una consulta sin coincidencias no deja nada', nada.size === 0, `${nada.size} filas`)
    check(
      'y se puede DECIR que no hay resultados',
      sinResultados(GRUPOS, nada) && !sinResultados(GRUPOS, visibles),
      `bluetooth=${sinResultados(GRUPOS, nada)} docker=${sinResultados(GRUPOS, visibles)}`
    )
    // Un catálogo vacío no puede tirar el panel abajo.
    check('un catálogo vacío no rompe', filtrarAjustes([], 'lo que sea').size === 0, '0 filas')
  }

  // -------------------------------------------------------------------------
  hr('8) CATEGORÍAS del riel: la búsqueda las ATRAVIESA')
  {
    const planos = gruposDe(FALSAS)
    check(
      'gruposDe aplana en el orden del catálogo',
      planos.length === GRUPOS.length &&
        planos[0].ajustes === GRUPOS[0].ajustes &&
        planos[2].ajustes === GRUPOS[2].ajustes,
      planos.map((g) => g.titulo).join(' | ')
    )
    check(
      'y filtrar sobre el aplanado da lo mismo que sobre los grupos sueltos',
      [...filtrarAjustes(planos, 'letra')].sort().join(',') === ids('letra').join(','),
      ids('letra').join(',')
    )
    // El título del grupo sale COMPUESTO con el de la categoría: es solo pajar de
    // búsqueda, y así "apariencia" encuentra sus filas sin repetir la palabra en
    // las claves de cada ajuste.
    const soloCategoria: CategoriaBuscable[] = [
      { id: 'apariencia', titulo: 'Apariencia', grupos: [{ titulo: 'Tamaño', ajustes: GRUPOS[0].ajustes }] }
    ]
    const porCategoria = filtrarAjustes(gruposDe(soloCategoria), 'apariencia')
    check(
      'el nombre de la CATEGORÍA también encuentra sus filas',
      porCategoria.size === GRUPOS[0].ajustes.length,
      `${porCategoria.size} de ${GRUPOS[0].ajustes.length}`
    )

    // EL CASO QUE MOTIVA EL DISEÑO: "letra" cae en Apariencia Y en Terminales.
    const visibles = filtrarAjustes(planos, 'letra')
    const conteo = contarPorCategoria(FALSAS, visibles)
    check(
      '"letra" casa en DOS categorías a la vez',
      (conteo.get('apariencia') ?? 0) > 0 && (conteo.get('terminales') ?? 0) > 0,
      `apariencia=${conteo.get('apariencia')} terminales=${conteo.get('terminales')}`
    )
    check(
      'la categoría sin coincidencias cuenta 0, y la clave EXISTE',
      conteo.has('proyectos') && conteo.get('proyectos') === 0,
      `proyectos=${conteo.get('proyectos')}`
    )
    check(
      'categoriaVisible es falso justo cuando el conteo es 0',
      FALSAS.every((c) => categoriaVisible(c, visibles) === ((conteo.get(c.id) ?? 0) > 0)),
      FALSAS.map((c) => `${c.id}=${categoriaVisible(c, visibles)}`).join(' ')
    )

    // Sin consulta el riel enseña todas las categorías con su total.
    const todas = filtrarAjustes(planos, '')
    const total = contarPorCategoria(FALSAS, todas)
    check(
      'sin consulta cada categoría cuenta todos sus ajustes',
      FALSAS.every((c) => total.get(c.id) === c.grupos.reduce((n, g) => n + g.ajustes.length, 0)),
      FALSAS.map((c) => `${c.id}=${total.get(c.id)}`).join(' ')
    )
    check(
      'un catálogo de categorías vacío no rompe',
      gruposDe([]).length === 0 && contarPorCategoria([], todas).size === 0,
      '0 grupos, 0 conteos'
    )
  }

  // -------------------------------------------------------------------------
  hr('9) EL CATÁLOGO REAL (no una imitación)')
  {
    // `catalogo.ts` es PURO justo para poder llegar aquí: antes el catálogo vivía
    // dentro del .tsx del panel y el test tenía que imitarlo, así que nada impedía
    // que el de verdad se rompiera sin que ningún test se enterase.
    check('no hay ids de ajuste repetidos', idsDuplicados().length === 0, idsDuplicados().join(',') || 'ninguno')
    const idsCat = CATEGORIAS.map((c) => c.id)
    check(
      'los ids de categoría son únicos',
      new Set(idsCat).size === idsCat.length,
      idsCat.join(',')
    )
    check(
      'ninguna categoría está vacía y ningún grupo tampoco',
      CATEGORIAS.every((c) => c.grupos.length > 0 && c.grupos.every((g) => g.ajustes.length > 0)),
      CATEGORIAS.map((c) => `${c.id}:${c.grupos.length}`).join(' ')
    )

    // La lista se escribe LITERAL a propósito: borrar un ajuste por accidente
    // rompe el test en vez de desaparecer de la pantalla en silencio.
    const ESPERADOS = [
      'accion-rapida-finder',
      'acerca', 'agente-fuente', 'agente-inactividad', 'agente-tamano', 'banda',
      'db-filas-pagina', 'db-font', 'db-inactividad-consola', 'db-tx-inicial',
      'explorer-font', 'git-font',
      'menu-windows-archivos', 'menu-windows-carpetas', 'menu-windows-extensiones',
      'modo-proyecto', 'sandbox-docs', 'sandbox-navegador', 'sandbox-otros',
      'term-fuente', 'term-render', 'term-tamano', 'ui-font',
      'update', 'update-agentes', 'update-al-cerrar', 'zoom'
    ]
    const presentes = [...filtrarAjustes(gruposDe(CATEGORIAS), '')].sort()
    check(
      `están los ${ESPERADOS.length} ajustes esperados, ni uno más ni uno menos`,
      presentes.join(',') === ESPERADOS.join(','),
      presentes.join(',')
    )

    // El caso que motiva el diseño, ahora contra el catálogo real.
    const visibles = filtrarAjustes(gruposDe(CATEGORIAS), 'letra')
    const conteo = contarPorCategoria(CATEGORIAS, visibles)
    check(
      '"letra" casa en Apariencia Y en Terminales del catálogo real',
      (conteo.get('apariencia') ?? 0) > 0 && (conteo.get('terminales') ?? 0) > 0,
      [...conteo].map(([k, v]) => `${k}=${v}`).join(' ')
    )
    // El "todos" se DERIVA del catálogo, no se escribe a mano: cuando Proyectos
    // pasó de un ajuste a cuatro, un `=== 1` literal fallaba sin que nada estuviera
    // roto, y lo que este check quiere fijar es la proporción, no el número.
    const totalProyectos = (CATEGORIAS.find((c) => c.id === 'proyectos')?.grupos ?? []).reduce(
      (n, g) => n + g.ajustes.length,
      0
    )
    // Bases de datos: lo que escribe quien busca, venga de otro cliente de BD
    // («page size», «auto-commit») o de la propia etiqueta, lleva a SU fila.
    const enBd = (q: string): string[] =>
      [...filtrarAjustes(gruposDe(CATEGORIAS), q)].filter((id) => id.startsWith('db-')).sort()
    check(
      '"página", "commit", "inactividad" y "nunca" llevan a su fila de Bases de datos',
      enBd('página').join(',') === 'db-filas-pagina' &&
        enBd('commit').join(',') === 'db-tx-inicial' &&
        enBd('inactividad').join(',') === 'db-inactividad-consola' &&
        enBd('nunca').join(',') === 'db-inactividad-consola',
      [enBd('página'), enBd('commit'), enBd('inactividad'), enBd('nunca')].map((x) => x.join('+')).join(' | ')
    )
    // La hibernación del agente por inactividad: quien busca por lo que quiere ahorrar
    // («memoria», «mcp») o por lo que hace («hibernar») llega a su fila de Proyectos.
    const llevaAlAgente = (q: string): boolean => filtrarAjustes(gruposDe(CATEGORIAS), q).has('agente-inactividad')
    check(
      '"hibernar", "memoria", "mcp", "inactividad" y "nunca" llevan a la fila del agente inactivo',
      ['hibernar', 'memoria', 'mcp', 'inactividad', 'nunca'].every(llevaAlAgente),
      ['hibernar', 'memoria', 'mcp', 'inactividad', 'nunca'].map((q) => `${q}=${llevaAlAgente(q)}`).join(' ')
    )
    check(
      '"letra" también encuentra el tamaño de la vista de BD (cruza categorías)',
      (contarPorCategoria(CATEGORIAS, filtrarAjustes(gruposDe(CATEGORIAS), 'letra')).get('bases-de-datos') ?? 0) === 1,
      String(contarPorCategoria(CATEGORIAS, filtrarAjustes(gruposDe(CATEGORIAS), 'letra')).get('bases-de-datos'))
    )
    const totalBd = (CATEGORIAS.find((c) => c.id === 'bases-de-datos')?.grupos ?? []).reduce((n, g) => n + g.ajustes.length, 0)
    check(
      '"bases de datos" saca los cuatro ajustes de su categoría',
      totalBd === 4 &&
        contarPorCategoria(CATEGORIAS, filtrarAjustes(gruposDe(CATEGORIAS), 'bases de datos')).get('bases-de-datos') === 4,
      `total=${totalBd}`
    )
    check(
      'la categoría va entre Proyectos e Integración con el sistema',
      CATEGORIAS.map((c) => c.id).join(',') === 'apariencia,terminales,proyectos,bases-de-datos,integracion,actualizaciones,acerca',
      CATEGORIAS.map((c) => c.id).join(',')
    )
    check(
      'buscar el nombre de una categoría saca todos sus ajustes',
      contarPorCategoria(CATEGORIAS, filtrarAjustes(gruposDe(CATEGORIAS), 'proyectos')).get(
        'proyectos'
      ) === totalProyectos,
      `proyectos=${totalProyectos}`
    )
  }

  // -------------------------------------------------------------------------
  hr('10) NAVEGACIÓN del riel')
  {
    check(
      'un id desconocido cae en la primera categoría, nunca en undefined',
      resolverCategoria('inventada') === CATEGORIA_INICIAL &&
        resolverCategoria(null) === CATEGORIA_INICIAL &&
        resolverCategoria(undefined) === CATEGORIA_INICIAL,
      CATEGORIA_INICIAL
    )
    check(
      'un id válido se respeta',
      resolverCategoria('proyectos') === 'proyectos',
      resolverCategoria('proyectos')
    )
    const ultima = CATEGORIAS[CATEGORIAS.length - 1].id
    check(
      '↓ desde la última vuelve a la primera',
      siguienteCategoria(ultima, 1) === CATEGORIA_INICIAL,
      `${ultima} +1 -> ${siguienteCategoria(ultima, 1)}`
    )
    check(
      '↑ desde la primera va a la última',
      siguienteCategoria(CATEGORIA_INICIAL, -1) === ultima,
      `${CATEGORIA_INICIAL} -1 -> ${siguienteCategoria(CATEGORIA_INICIAL, -1)}`
    )
    check(
      'y un id desconocido tampoco rompe la navegación',
      siguienteCategoria('inventada', 1) === CATEGORIA_INICIAL,
      siguienteCategoria('inventada', 1)
    )
  }

  // -------------------------------------------------------------------------
  hr('11) CAPACIDADES: lo que este sistema no puede hacer no se monta')
  {
    // Las tres plataformas desde ésta. `mac` y `otra` (Linux) no son lo mismo:
    // `autoInstalarUpdate` es `true` en Mac y `false` en `otra`, así que Mac ve una
    // fila más que Linux, y estos checks fijan esa divergencia.
    //
    // La plataforma se pasa siempre: hay filas que dependen de la PLATAFORMA y no de
    // una capacidad, y sin pasarla se mezclarían capacidades de una con filas de otra.
    // Además el valor por defecto es `window.tessera.plataforma`, y bajo `node` no hay
    // `window`: omitirla da un `ReferenceError`.
    const win = categoriasVisibles(capacidadesDe('windows'), CATEGORIAS, 'windows')
    const mac = categoriasVisibles(capacidadesDe('mac'), CATEGORIAS, 'mac')
    const otra = categoriasVisibles(capacidadesDe('otra'), CATEGORIAS, 'otra')
    const idsDe = (cats: ReturnType<typeof categoriasVisibles>): string[] =>
      [...filtrarAjustes(gruposDe(cats), '')].sort()
    const todosLosIds = [...filtrarAjustes(gruposDe(CATEGORIAS), '')].sort()

    // Windows ve TODAS las categorías, pero ya no todos los ajustes: la fila de la
    // acción rápida del Finder es de Mac y allí no pinta nada.
    check(
      'en Windows se ven TODAS las categorías del catálogo',
      win.map((c) => c.id).join(',') === CATEGORIAS.map((c) => c.id).join(','),
      win.map((c) => c.id).join(',')
    )
    check(
      'Windows pierde EXACTAMENTE la fila del Finder, nada más',
      todosLosIds.filter((id) => !idsDe(win).includes(id)).join(',') === 'accion-rapida-finder',
      todosLosIds.filter((id) => !idsDe(win).includes(id)).join(',') || '∅'
    )
    // Y el grupo «Finder», que se queda sin filas, tiene que desaparecer ENTERO: un
    // título sin nada debajo es el panel medio vacío que el filtro venía a evitar.
    const integracionWin = win.find((c) => c.id === 'integracion')
    check(
      'en Windows la categoría de integración enseña sólo el grupo del Explorador',
      integracionWin !== undefined &&
        integracionWin.grupos.map((g) => g.titulo).join(',') === 'Explorador de Windows',
      integracionWin ? integracionWin.grupos.map((g) => g.titulo).join(' | ') : 'ausente'
    )

    const actualizacionesMac = mac.find((c) => c.id === 'actualizaciones')
    check(
      'en Mac la categoría Actualizaciones SIGUE existiendo',
      actualizacionesMac !== undefined && actualizacionesMac.grupos.length > 0,
      actualizacionesMac ? actualizacionesMac.grupos.map((g) => g.titulo).join(' | ') : 'ausente'
    )
    // La fila «Aplicar al cerrar» estuvo oculta en Mac mientras el ciclo se quedaba en
    // "comprobar y avisar": conmutarla no cambiaba nada observable, que es la casilla
    // inerte que `shared/plataforma.ts` prohíbe. Ahora sí hace algo (la actualización
    // se aplica al cerrar, con el relevo), así que tiene que verse.
    check(
      'en Mac se ven las DOS filas de Tessera: "Versión" y "Aplicar al cerrar"',
      idsDe(mac).includes('update') && idsDe(mac).includes('update-al-cerrar'),
      idsDe(mac).filter((id) => id.startsWith('update')).join(',') || 'ninguno'
    )
    // ESTO ES LO QUE CAMBIÓ CON LA ACCIÓN RÁPIDA DEL FINDER. Antes la categoría se
    // llamaba «Windows» y en Mac NO se montaba: `integracionShellEnCaliente` era
    // `false` allí porque se había mirado el mecanismo equivocado (las asociaciones del
    // `Info.plist`, que sí se declaran al empaquetar) en vez del que sí es conmutable
    // (un `.workflow` en `~/Library/Services`). Ahora la categoría se monta en las DOS
    // y lo que cambia es su contenido.
    check(
      'en Mac la categoría de integración SÍ se monta (antes no existía allí)',
      mac.some((c) => c.id === 'integracion'),
      mac.map((c) => c.id).join(',')
    )
    check(
      'en Mac se ve la fila de la acción rápida del Finder',
      idsDe(mac).includes('accion-rapida-finder'),
      idsDe(mac).filter((id) => id.startsWith('accion')).join(',') || 'ninguna'
    )
    check(
      'en Mac NO se ve ninguna fila del registro de Windows',
      !idsDe(mac).some((id) => id.startsWith('menu-windows')),
      idsDe(mac).filter((id) => id.startsWith('menu-windows')).join(',') || '∅'
    )
    check(
      'Mac pierde EXACTAMENTE las filas de Windows, nada más',
      todosLosIds.filter((id) => !idsDe(mac).includes(id)).join(',') ===
        ['menu-windows-archivos', 'menu-windows-carpetas', 'menu-windows-extensiones'].join(','),
      todosLosIds.filter((id) => !idsDe(mac).includes(id)).join(',')
    )
    // El espejo del check de Windows: en Mac el grupo que sobrevive es el del Finder.
    const integracionMac = mac.find((c) => c.id === 'integracion')
    check(
      'en Mac la categoría de integración enseña sólo el grupo del Finder',
      integracionMac !== undefined &&
        integracionMac.grupos.map((g) => g.titulo).join(',') === 'Finder',
      integracionMac ? integracionMac.grupos.map((g) => g.titulo).join(' | ') : 'ausente'
    )
    // Y las dos plataformas ven el MISMO título de categoría: el riel no puede decir
    // «Windows» en un Mac, que es de donde venía todo esto.
    check(
      'la categoría se llama igual en las dos y no menciona un solo sistema',
      integracionWin?.titulo === 'Integración con el sistema' &&
        integracionMac?.titulo === 'Integración con el sistema',
      `${integracionWin?.titulo} / ${integracionMac?.titulo}`
    )
    // Linux/BSD: ahí no hay ni registro ni `~/Library/Services`, así que la categoría
    // entera sigue cayendo — ahora es el ÚNICO sitio donde eso pasa.
    check(
      'en «otra» (Linux/BSD) la categoría de integración NO se monta',
      !otra.some((c) => c.id === 'integracion') &&
        !idsDe(otra).some((id) => id.startsWith('menu-windows') || id.startsWith('accion-rapida')),
      otra.map((c) => c.id).join(',')
    )
    // Y la fila inerte sigue existiendo para quien de verdad no puede aplicar nada.
    check(
      'un sistema «otra» (Linux) SÍ pierde "Aplicar al cerrar": allí no hay nada que aplicar',
      idsDe(otra).includes('update') && !idsDe(otra).includes('update-al-cerrar'),
      idsDe(otra).filter((id) => id.startsWith('update')).join(',') || 'ninguno'
    )
    // Mac y «otra» se separan ahora por DOS filas, no por una. La segunda es la que
    // trajo la acción rápida del Finder, y el check se actualiza en vez de aflojarse:
    // sigue diciendo EXACTAMENTE cuáles, y que «otra» no ve nada que Mac no vea.
    check(
      'Mac ve dos filas que «otra» no: el relevo de update y la acción rápida del Finder',
      idsDe(mac).filter((id) => !idsDe(otra).includes(id)).join(',') ===
        'accion-rapida-finder,update-al-cerrar' &&
        idsDe(otra).every((id) => idsDe(mac).includes(id)),
      `mac−otra=${idsDe(mac).filter((id) => !idsDe(otra).includes(id)).join(',') || '∅'}`
    )
    // Lo que `ve()` recibe en SettingsModal es exactamente `filtrarAjustes(gruposDe(
    // categoriasVisibles(...)), consulta)`: ni con la consulta que MÁS casa aparece la
    // fila muerta. Es lo que hace que el buscador no cuente una fila que luego no sale.
    check(
      'buscando "cerrar" en «otra» el buscador NO cuenta la fila muerta, y en Mac y Windows sí',
      !filtrarAjustes(gruposDe(otra), 'cerrar').has('update-al-cerrar') &&
        filtrarAjustes(gruposDe(mac), 'cerrar').has('update-al-cerrar') &&
        filtrarAjustes(gruposDe(win), 'cerrar').has('update-al-cerrar'),
      `otra=${[...filtrarAjustes(gruposDe(otra), 'cerrar')].join(',') || '∅'} mac=${[...filtrarAjustes(gruposDe(mac), 'cerrar')].join(',')}`
    )
    check(
      'el filtrado no deja grupos ni categorías vacíos en ninguna plataforma',
      [win, mac, otra].every((cats) =>
        cats.every((c) => c.grupos.length > 0 && c.grupos.every((g) => g.ajustes.length > 0))
      ),
      [win, mac, otra].map((cats) => cats.map((c) => `${c.id}:${c.grupos.length}`).join(' ')).join(' // ')
    )
    check(
      'el catálogo COMPLETO no se toca: sigue teniendo todos los ajustes esperados',
      todosLosIds.includes('update-al-cerrar') && todosLosIds.includes('menu-windows-carpetas'),
      `${todosLosIds.length} ajustes en CATEGORIAS`
    )

    // LA PODA DE GRUPO VACÍO YA NO ES VACUA: los checks de «Explorador de Windows» y
    // «Finder» de arriba la ejercitan con el catálogo REAL, porque en cada plataforma
    // uno de los dos grupos se queda literalmente sin filas. Antes no la ejercitaba
    // nadie —el único ajuste con capacidad ('update-al-cerrar') comparte grupo con
    // «Versión»— y borrar la poda dejaba el test verde.
    //
    // LO QUE SIGUE SIN COBERTURA REAL es la poda de la CATEGORÍA que se queda sin
    // grupos por la vía de los AJUSTES: en el catálogo real la única categoría que
    // desaparece cae antes y entera, por `CATEGORIAS_POR_CAPACIDAD`. Para eso sigue
    // haciendo falta el catálogo sintético.
    const catalogoSintetico: readonly CategoriaBuscable[] = [
      {
        id: 'sintetica',
        titulo: 'Sintética',
        grupos: [{ titulo: 'Solo una fila', ajustes: [{ id: 'update-al-cerrar', etiqueta: 'Aplicar al cerrar' }] }]
      }
    ]
    const sinteticaWin = categoriasVisibles(capacidadesDe('windows'), catalogoSintetico, 'windows')
    const sinteticaOtra = categoriasVisibles(capacidadesDe('otra'), catalogoSintetico, 'otra')
    check(
      'catálogo sintético: en Windows la categoría de un solo ajuste sobrevive',
      sinteticaWin.length === 1 && sinteticaWin[0].grupos.length === 1 && sinteticaWin[0].grupos[0].ajustes.length === 1,
      sinteticaWin.map((c) => `${c.id}:${c.grupos.map((g) => g.ajustes.length).join('+')}`).join(' ') || '∅'
    )
    check(
      'catálogo sintético: en «otra» se van el grupo vacío Y la categoría que se queda sin grupos',
      sinteticaOtra.length === 0,
      sinteticaOtra.map((c) => `${c.id}:${c.grupos.length}`).join(' ') || '∅ (ninguna categoría)'
    )
  }

  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
