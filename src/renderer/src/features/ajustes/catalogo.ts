// =============================================================================
// catalogo: QUÉ ajustes hay, en qué categoría del riel caen y con qué palabras
// se buscan. Es la única lista; el modal solo la recorre. Módulo PURO (`.ts`, sin JSX)
// para que su prueba valide el catálogo real: no importa nada salvo tipos.
// `categoriasVisibles` toma la plataforma de `window.tessera.plataforma` y no de
// `plataformaActual()`: en el renderer no hay `process`.
// Las claves son sinónimos de verdad, no la etiqueta troceada; el nombre de la
// categoría ya lo mete el buscador (ver `gruposDe` en filtrarAjustes).
// =============================================================================

import type { CategoriaBuscable } from './filtrarAjustes'
// Sólo TIPOS, como manda la cabecera: `shared/plataforma.ts` no importa nada a su vez,
// así que ni siquiera un import de valor arrastraría la app — pero la regla se respeta
// igual, que es lo que la mantiene viva.
import type { CapacidadesPlataforma, Plataforma } from '../../../../shared/plataforma'

/**
 * Las categorías del riel, EN ORDEN, y sus ajustes.
 *
 * El orden es por FRECUENCIA DE USO, no por antigüedad: Apariencia (lo que de
 * verdad se toca) · Terminales · Proyectos · Bases de datos · Integración con el
 * sistema · Actualizaciones · Acerca de. «Bases de datos» sigue a Proyectos porque es la
 * otra forma de trabajar dentro de un perfil. «Integración con el sistema» va detrás de Proyectos
 * porque es su continuación natural —cómo se ABRE un proyecto desde fuera de la app— y
 * delante de Actualizaciones porque se toca una vez
 * al instalar y otra si cambias de idea, que sigue siendo más que un update. El modo
 * por defecto de proyecto se toca una vez en la vida y abría el panel; "Acerca de"
 * se abre menos que ninguna, y va al final por eso — con el efecto secundario
 * bueno de quedar pegada a Actualizaciones, que es la otra categoría donde la app
 * habla de sí misma.
 *
 * NO hay categorías "previstas" vacías. Una entrada del riel que abre un panel
 * en blanco se lee como un fallo, no como una hoja de ruta; que quepan más se ve
 * en que añadir una cuesta una entrada aquí y un componente que el compilador
 * exige (ver el registro de paneles en SettingsModal).
 */
export const CATEGORIAS = [
  {
    id: 'apariencia',
    titulo: 'Apariencia',
    grupos: [
      {
        // "y escala" no es adorno: mete el zoom en el mismo grupo que los
        // tamaños, que es donde lo busca todo el mundo, sin que el título mienta
        // (el zoom NO es un tamaño de letra: escala también editor y terminales).
        titulo: 'Tamaño y escala',
        ajustes: [
          { id: 'ui-font', etiqueta: 'Interfaz', claves: ['tamaño', 'letra', 'fuente', 'densidad'] },
          {
            id: 'explorer-font',
            etiqueta: 'Explorador',
            claves: ['tamaño', 'letra', 'fuente', 'archivos', 'árbol']
          },
          {
            id: 'git-font',
            etiqueta: 'Vista de git',
            claves: ['tamaño', 'letra', 'fuente', 'cambios', 'historial', 'commits']
          },
          {
            id: 'zoom',
            etiqueta: 'Zoom',
            claves: ['escala', 'aumentar', 'acercar', 'alejar', 'porcentaje', 'tamaño']
          }
        ]
      },
      {
        titulo: 'Barra de perfiles',
        ajustes: [
          {
            id: 'banda',
            etiqueta: 'Colapsar la banda de perfiles',
            claves: ['perfiles', 'compacta', 'nombres', 'banda']
          }
        ]
      }
    ]
  },
  {
    id: 'terminales',
    titulo: 'Terminales',
    grupos: [
      {
        titulo: 'Terminal',
        ajustes: [
          { id: 'term-fuente', etiqueta: 'Fuente', claves: ['tipografía', 'letra', 'shell'] },
          { id: 'term-tamano', etiqueta: 'Tamaño', claves: ['letra', 'fuente', 'shell'] }
        ]
      },
      {
        titulo: 'Terminal del agente',
        ajustes: [
          {
            id: 'agente-fuente',
            etiqueta: 'Fuente',
            claves: ['tipografía', 'letra', 'claude', 'codex', 'agente']
          },
          {
            id: 'agente-tamano',
            etiqueta: 'Tamaño',
            claves: ['letra', 'fuente', 'claude', 'codex', 'agente']
          }
        ]
      },
      {
        titulo: 'Rendimiento',
        ajustes: [
          { id: 'term-render', etiqueta: 'Renderizado', claves: ['webgl', 'gpu', 'gráfica', 'dom'] }
        ]
      }
    ]
  },
  {
    id: 'proyectos',
    titulo: 'Proyectos',
    grupos: [
      {
        titulo: 'Al abrir un proyecto nuevo',
        ajustes: [
          {
            id: 'modo-proyecto',
            etiqueta: 'Modo por defecto',
            claves: ['docker', 'windows', 'aislado', 'nativo', 'contenedor']
          }
        ]
      },
      {
        titulo: 'Agentes en segundo plano',
        ajustes: [
          {
            id: 'agente-inactividad',
            etiqueta: 'Hibernar el agente inactivo tras',
            claves: ['hibernar', 'hibernación', 'inactividad', 'inactivo', 'dormir', 'memoria', 'ram', 'mcp', 'agente', 'claude', 'codex', 'segundo plano', 'minutos', 'nunca']
          }
        ]
      },
      {
        titulo: 'Sandbox de Docker',
        ajustes: [
          {
            id: 'sandbox-docs',
            etiqueta: 'Herramientas de documentos',
            claves: ['pdf', 'word', 'excel', 'office', 'libreoffice', 'poppler', 'captura', 'convertir']
          },
          {
            id: 'sandbox-navegador',
            etiqueta: 'Navegador de pruebas',
            claves: ['chromium', 'playwright', 'navegador', 'e2e', 'libs', 'dependencias']
          },
          {
            id: 'sandbox-otros',
            etiqueta: 'Otros paquetes',
            claves: ['apt', 'instalar', 'paquete', 'imagen', 'sudo', 'debian']
          }
        ]
      }
    ]
  },
  {
    // El explorador de bases de datos. Va detrás de Proyectos porque es la otra forma de
    // trabajar dentro de un perfil, y delante de «Integración con el sistema», que se toca
    // una vez al instalar. Los cuatro valores y su porqué, en `shared/ajustesBd.ts`. Las
    // claves son lo que escribe quien busca en otros clientes: «page size», «fetch size»,
    // «auto-commit» y «disconnect».
    id: 'bases-de-datos',
    titulo: 'Bases de datos',
    grupos: [
      {
        titulo: 'Apariencia',
        ajustes: [
          {
            id: 'db-font',
            etiqueta: 'Tamaño de letra',
            claves: ['tamaño', 'letra', 'fuente', 'rejilla', 'árbol', 'conexiones', 'densidad']
          }
        ]
      },
      {
        titulo: 'Resultados',
        ajustes: [
          {
            id: 'db-filas-pagina',
            etiqueta: 'Filas por página',
            claves: ['página', 'filas', 'resultados', 'rejilla', 'cargar', 'límite', 'page size', 'fetch']
          }
        ]
      },
      {
        titulo: 'Consolas',
        ajustes: [
          {
            id: 'db-tx-inicial',
            etiqueta: 'Transacción al abrir',
            claves: ['transacción', 'tx', 'manual', 'automática', 'commit', 'auto-commit', 'consola', 'sql']
          },
          {
            id: 'db-inactividad-consola',
            etiqueta: 'Cerrar la sesión inactiva tras',
            claves: ['inactividad', 'inactiva', 'cerrar', 'sesión', 'desconectar', 'tiempo', 'nunca', 'consola']
          }
        ]
      }
    ]
  },
  {
    // Se llamaba «Windows» y sólo existía allí. Ahora las dos plataformas tienen su
    // interruptor de menú contextual (`AJUSTES_POR_PLATAFORMA` decide cuál se monta),
    // así que el título tiene que valer para las dos: lo que la categoría hace es
    // integrar Tessera con el gestor de archivos DEL SISTEMA, se llame Explorador o
    // Finder.
    id: 'integracion',
    titulo: 'Integración con el sistema',
    grupos: [
      {
        titulo: 'Explorador de Windows',
        ajustes: [
          {
            id: 'menu-windows-carpetas',
            etiqueta: 'Carpetas y unidades',
            claves: [
              'menú',
              'contextual',
              'botón derecho',
              'explorador',
              'abrir con',
              'carpeta',
              'unidad',
              'registro'
            ]
          },
          {
            id: 'menu-windows-archivos',
            etiqueta: 'Cualquier archivo',
            claves: ['menú', 'contextual', 'botón derecho', 'explorador', 'abrir con', 'archivo']
          },
          {
            id: 'menu-windows-extensiones',
            etiqueta: 'Extensiones asociadas',
            claves: [
              'extensión',
              'asociar',
              'abrir con',
              'predeterminada',
              'tipo de archivo',
              'java',
              'sql'
            ]
          }
        ]
      },
      {
        // Grupo propio y no una fila más en el de arriba: en Mac el grupo de Windows
        // desaparece entero (se queda sin ajustes y `categoriasVisibles` lo poda), y
        // al revés en Windows. Un solo grupo con filas de las dos plataformas dejaría
        // un título que miente en las dos.
        titulo: 'Finder',
        ajustes: [
          {
            id: 'accion-rapida-finder',
            etiqueta: 'Acción rápida «Abrir en Tessera»',
            claves: [
              'menú',
              'contextual',
              'botón derecho',
              'finder',
              'servicios',
              'acción rápida',
              'quick action',
              'abrir en',
              'carpeta'
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'actualizaciones',
    titulo: 'Actualizaciones',
    grupos: [
      {
        titulo: 'Tessera',
        ajustes: [
          { id: 'update', etiqueta: 'Versión', claves: ['actualizar', 'instalar', 'nueva'] }
        ]
      },
      {
        // Los CLIs de los agentes NATIVOS: lo mismo que el botón de la barra de título,
        // que sólo se ve con algún proyecto nativo abierto. Aquí se encuentra siempre.
        titulo: 'Agentes',
        ajustes: [
          {
            id: 'update-agentes',
            etiqueta: 'Claude Code y Codex',
            claves: ['agentes', 'claude', 'codex', 'cli', 'actualizar', 'versión', 'reiniciar', 'nativo']
          }
        ]
      },
      {
        // Al final, tras las dos tarjetas que buscan: es CUÁNDO se aplica, no si hay algo.
        titulo: 'Preferencias',
        ajustes: [
          {
            id: 'update-al-cerrar',
            etiqueta: 'Aplicar al cerrar Tessera',
            claves: ['automática', 'reiniciar', 'instalar', 'salir', 'cerrar', 'sola', 'pendiente']
          }
        ]
      }
    ]
  },
  {
    id: 'acerca',
    titulo: 'Acerca de',
    grupos: [
      {
        titulo: 'Tessera',
        ajustes: [
          {
            id: 'acerca',
            etiqueta: 'Versión y créditos',
            claves: [
              'versión',
              'autor',
              'créditos',
              'información',
              'electron',
              'node',
              'chromium'
            ]
          }
        ]
      }
    ]
  }
] as const satisfies readonly CategoriaBuscable[]

/**
 * Los ids de categoría que EXISTEN, como tipo literal.
 *
 * Es el heredero del viejo `TituloGrupo`: el riel, el registro de paneles y el
 * estado que recuerda la categoría abierta se enlazan por una cadena suelta, y
 * sin este tipo renombrar una categoría en un sitio y no en el otro no daba
 * ningún error — la sección simplemente desaparecía en tiempo de ejecución.
 */
export type CategoriaId = (typeof CATEGORIAS)[number]['id']

/**
 * Categorías que sólo existen donde una capacidad lo permite.
 *
 * «Integración con el sistema» es el interruptor que pone "Abrir con Tessera" en el
 * menú del botón derecho del gestor de archivos. Existe en Windows (claves de
 * `HKCU\Software\Classes`) y en macOS (un `.workflow` en `~/Library/Services`), y por
 * eso `integracionShellEnCaliente` es `true` en las dos: la categoría se MONTA en las
 * dos, con contenido distinto (ver `AJUSTES_POR_PLATAFORMA`).
 *
 * DONDE SIGUE CAYENDO ES EN `'otra'` (Linux, BSD): allí el menú contextual lo pone el
 * escritorio —Nautilus, Dolphin, Thunar, cada uno con su formato— y no hay ninguno
 * escrito, así que la categoría entera se queda sin nada que ofrecer.
 *
 * POR QUÉ SE OCULTA LA CATEGORÍA ENTERA Y NO SE DEJA "EN GRIS". Un riel con una entrada
 * que abre un panel de casillas inertes se lee como una app rota, no como una
 * limitación del sistema; y el propio catálogo ya declara que "no hay categorías
 * previstas vacías". Esconderla es la versión honesta: donde ese ajuste no se puede
 * tocar desde aquí es porque no se toca desde ningún sitio.
 */
const CATEGORIAS_POR_CAPACIDAD: Partial<Record<CategoriaId, keyof CapacidadesPlataforma>> = {
  integracion: 'integracionShellEnCaliente'
}

/**
 * Ajustes que sólo existen en UNA plataforma CONCRETA, por el mecanismo que usan.
 *
 * POR QUÉ ESTO NO ES UNA CAPACIDAD MÁS. Las capacidades responden "¿esta plataforma
 * sabe hacer X?", y aquí las dos saben: Windows y macOS ponen las dos su entrada en el
 * menú contextual, y por eso comparten `integracionShellEnCaliente`. Lo que no
 * comparten es CÓMO, y el cómo asoma en la interfaz porque no se puede esconder: en
 * Windows son tres superficies del registro que se encienden por separado (carpetas,
 * cualquier archivo, extensiones asociadas); en macOS es un único servicio del Finder,
 * porque las extensiones ya vienen declaradas en el paquete y no hay nada que conmutar.
 * Inventar una capacidad por cada fila (`menuEnCarpetas`, `menuEnArchivos`…) sería
 * fabricar un contrato de plataforma para describir un detalle de una pantalla, y el
 * propio `shared/plataforma.ts` avisa de que una capacidad sin lector es documentación
 * disfrazada. Aquí la pregunta es literalmente "¿en qué sistema estoy?", así que se
 * pregunta eso.
 *
 * SE FILTRA EN EL CATÁLOGO Y NO EN EL PANEL por el mismo motivo que
 * `AJUSTES_POR_CAPACIDAD`: el BUSCADOR no pasa por el panel. Sin esto, teclear
 * "registro" en un Mac contaría tres coincidencias en una categoría que luego enseña
 * un solo interruptor.
 */
const AJUSTES_POR_PLATAFORMA: Partial<Record<AjusteId, Plataforma>> = {
  'menu-windows-carpetas': 'windows',
  'menu-windows-archivos': 'windows',
  'menu-windows-extensiones': 'windows',
  'accion-rapida-finder': 'mac'
}

/** Los ids de AJUSTE que existen, como tipo literal: una clave mal escrita abajo no compila. */
export type AjusteId = (typeof CATEGORIAS)[number]['grupos'][number]['ajustes'][number]['id']

/**
 * Ajustes SUELTOS que sólo existen en una plataforma, con la capacidad que los
 * justifica. Es el mismo razonamiento que `CATEGORIAS_POR_CAPACIDAD`, a la escala de
 * una fila.
 *
 * «Aplicar al cerrar Tessera» es la preferencia de aplicar sola una actualización
 * PREPARADA al salir. Donde la app no puede instalarse sola nunca hay nada preparado
 * —el main ni descarga— y `seAplicaAlCerrar` es `false` pase lo que pase con el
 * interruptor. O sea: la fila se podría marcar y desmarcar y NADA observable
 * cambiaría jamás. Es exactamente la casilla inerte que `shared/plataforma.ts`
 * prohíbe, y esconderla es la versión honesta.
 *
 * HOY ESO ES LINUX/BSD, NO macOS. Lo fue: mientras el update de Mac se quedaba en
 * "comprobar y avisar", esta fila estaba oculta allí. Desde que macOS aplica sus
 * actualizaciones con un relevo propio (`main/update/relevoMac.ts`) la capacidad es
 * `true` y la fila se ve en las dos plataformas, que es lo que el port perseguía. La
 * entrada se queda porque el mecanismo sigue haciendo falta: `'otra'` no sabe
 * aplicar nada, y el siguiente ajuste de una sola plataforma entrará por aquí.
 *
 * POR QUÉ SE FILTRA EN EL CATÁLOGO Y NO EN EL PANEL. El panel podría mirar la
 * capacidad y no pintar la fila, pero el BUSCADOR no pasa por el panel: cuenta las
 * coincidencias sobre el catálogo, y "cerrar" o "sola" seguirían anunciando una fila
 * que luego no aparece. Filtrando aquí, de la misma lista salen el riel, el conteo
 * y el `ve()` de cada fila, y ninguno puede saber de un ajuste que no existe.
 */
const AJUSTES_POR_CAPACIDAD: Partial<Record<AjusteId, keyof CapacidadesPlataforma>> = {
  'update-al-cerrar': 'autoInstalarUpdate'
}

/**
 * Una categoría tal y como la monta el riel: la del catálogo, ya sin lo que este
 * sistema no puede enseñar. `id` sigue siendo el literal (`ICONOS` y `PANELES` se
 * indexan con él); los grupos y ajustes son los buscables de siempre, pero pueden ser
 * un SUBCONJUNTO de los del catálogo, y por eso ya no es `(typeof CATEGORIAS)[number]`.
 */
export interface CategoriaVisible extends CategoriaBuscable {
  id: CategoriaId
}

/**
 * Las categorías que este sistema puede enseñar de verdad, con los ajustes que puede
 * enseñar de verdad dentro.
 *
 * El catálogo COMPLETO se conserva intacto —de él salen `CategoriaId`, `AjusteId` y su
 * test, que comprueba que no haya ids repetidos ni categorías vacías—; lo que se filtra
 * es únicamente lo que el riel monta. Se filtra a TRES niveles y en este orden:
 * categoría entera (`CATEGORIAS_POR_CAPACIDAD`), ajuste suelto (`AJUSTES_POR_CAPACIDAD`
 * y `AJUSTES_POR_PLATAFORMA`), y después se descartan los grupos que se hayan quedado
 * sin ajustes y las categorías que se hayan quedado sin grupos: un grupo con título y
 * sin filas es un panel medio vacío, que es el síntoma que el filtro venía a evitar.
 *
 * EL TERCER NIVEL YA NO ES TEÓRICO, y es el cambio que trajo la acción rápida del
 * Finder. Antes ningún grupo del catálogo real se quedaba vacío —lo dice el párrafo
 * que había aquí— y la poda sólo se podía ejercitar con un catálogo sintético. Ahora
 * «Integración con el sistema» tiene DOS grupos, «Explorador de Windows» y «Finder»,
 * y en cada plataforma uno de los dos se queda literalmente sin filas. Sin esa poda,
 * un Mac enseñaría un título «Explorador de Windows» con nada debajo.
 *
 * POR QUÉ EL CATÁLOGO TAMBIÉN ES PARÁMETRO. Aunque el caso real ya exista, el
 * sintético sigue haciendo falta para la poda de CATEGORÍA vacía por la vía de los
 * ajustes: en el catálogo real esa nunca se dispara (la categoría que desaparece cae
 * antes, entera, por `CATEGORIAS_POR_CAPACIDAD`). Sin este parámetro esa rama sería
 * código sin cobertura posible — se podría borrar y el test seguiría verde.
 *
 * LA PLATAFORMA ES EL ÚLTIMO PARÁMETRO Y POR DEFECTO LA REAL, que es la regla del
 * repo: un test que sólo pudiera comprobar la plataforma donde corre dejaría de
 * comprobar las otras en silencio, que es lo mismo que borrar esos casos.
 *
 * PERO ES `window.tessera.plataforma` Y NO `plataformaActual()`, y la diferencia no es
 * cosmética: este módulo corre en el RENDERER, que va con `sandbox: true` y NO TIENE
 * `process`. Un `plataformaActual()` aquí compila, pasa el typecheck, pasa los tests
 * (que corren bajo `node`, donde `process` sí existe) y revienta la aplicación
 * empaquetada con `ReferenceError: process is not defined` — pantalla en blanco, porque
 * esta llamada ocurre al cargar el módulo de `SettingsModal`. Está comprobado. La
 * plataforma le llega al renderer por el preload, igual que `capacidades`.
 *
 * El valor por defecto SÓLO se evalúa cuando falta el argumento, así que bajo `node`
 * (sin `window`) basta con pasarlo explícito — que es lo que el test hace, y además
 * tiene que hacer para fijar las tres plataformas. Es el mismo contrato, palabra por
 * palabra, que `util/atajos.ts`.
 */
export function categoriasVisibles(
  capacidades: CapacidadesPlataforma,
  catalogo: readonly CategoriaBuscable[] = CATEGORIAS,
  plataforma: Plataforma = window.tessera.plataforma
): readonly CategoriaVisible[] {
  const puede = (capacidad: keyof CapacidadesPlataforma | undefined): boolean =>
    capacidad === undefined || capacidades[capacidad]
  const esDeAqui = (soloEn: Plataforma | undefined): boolean =>
    soloEn === undefined || soloEn === plataforma
  const out: CategoriaVisible[] = []
  for (const c of catalogo) {
    // Los ids del catálogo sintético del test no son `CategoriaId`/`AjusteId`; el
    // índice sobre un `Partial<Record<…>>` da `undefined` para los desconocidos, que
    // es exactamente "sin capacidad asociada". El cast es sobre la CLAVE, no oculta nada.
    if (!puede(CATEGORIAS_POR_CAPACIDAD[c.id as CategoriaId])) continue
    const grupos = c.grupos
      .map((g) => ({
        titulo: g.titulo,
        ajustes: g.ajustes.filter(
          (a) =>
            puede(AJUSTES_POR_CAPACIDAD[a.id as AjusteId]) &&
            esDeAqui(AJUSTES_POR_PLATAFORMA[a.id as AjusteId])
        )
      }))
      .filter((g) => g.ajustes.length > 0)
    if (grupos.length > 0) out.push({ id: c.id as CategoriaId, titulo: c.titulo, grupos })
  }
  return out
}

/** La primera categoría del catálogo: el destino por defecto y el de rescate. */
export const CATEGORIA_INICIAL: CategoriaId = CATEGORIAS[0].id

/**
 * Un id de categoría VÁLIDO, siempre.
 *
 * Nunca devuelve `undefined`: el estado que guarda la categoría abierta vive
 * fuera del catálogo (en el store de ajustes), así que un renombrado o un valor viejo podrían
 * dejarlo apuntando a nada y el panel quedaría en blanco sin que nadie sepa por
 * qué. Cinturón y tirantes sobre el tipo literal, que solo protege en compilación.
 */
export function resolverCategoria(id: string | null | undefined): CategoriaId {
  return CATEGORIAS.some((c) => c.id === id) ? (id as CategoriaId) : CATEGORIA_INICIAL
}

/**
 * La categoría vecina, con vuelta al principio. Para las flechas ↑/↓ del riel.
 *
 * Da la vuelta a propósito (`(i + delta + n) % n`): un riel que se planta en los
 * extremos obliga a contar cuántas veces has pulsado, y aquí solo hay cinco.
 *
 * `lista` es la de categorías VISIBLES (ver `categoriasVisibles`), no el catálogo
 * entero, y por eso es un parámetro. Recorriendo el catálogo completo, en macOS las
 * flechas se detendrían en «Windows» —que allí no se monta— y el panel quedaría en
 * blanco: exactamente el síntoma que ocultar la categoría venía a evitar.
 */
export function siguienteCategoria(
  actual: string,
  delta: 1 | -1,
  lista: readonly { id: CategoriaId }[] = CATEGORIAS
): CategoriaId {
  const i = lista.findIndex((c) => c.id === actual)
  if (i < 0) return lista[0]?.id ?? CATEGORIA_INICIAL
  const n = lista.length
  return lista[(i + delta + n) % n].id
}

/**
 * Ids de AJUSTE repetidos en todo el catálogo. Debe ser siempre `[]`.
 *
 * Existe solo para el test: el id es la clave con la que el buscador decide qué
 * filas se pintan, así que dos ajustes con el mismo id aparecerían y
 * desaparecerían juntos —en categorías distintas— y el fallo se leería como "el
 * buscador está roto", no como "hay un id duplicado".
 */
export function idsDuplicados(): string[] {
  const vistos = new Set<string>()
  const repes = new Set<string>()
  for (const c of CATEGORIAS) {
    for (const g of c.grupos) {
      for (const a of g.ajustes) {
        if (vistos.has(a.id)) repes.add(a.id)
        vistos.add(a.id)
      }
    }
  }
  return [...repes].sort()
}
