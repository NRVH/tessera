// =============================================================================
// Prueba de `reemplazarBloque` (nunca se come el contenido de los archivos del usuario) y del contenido del
// bloque del espacio de datos y del aviso de arranque: solo lo montado, consolas, producción, registro que
// no se sabe leer, destino que sale del descriptor, y las bases de archivo, SQL Server, MongoDB y Redis sin
// tocar el texto de Oracle y PG. (node src/main/db/test-agent-memory.mts)
// Decisiones: docs/decisiones/bd/puente-textos-del-agente.md
// =============================================================================
import { FIN, INICIO, bloqueEspacioDatos, reemplazarBloque } from './agentMemoryBlock.ts'
import { briefingBasesAgente, REGLA_PRODUCCION } from './briefingAgente.ts'
import { mensajeRegistroIlegible } from './registroConexiones.ts'
import type { DbConnection } from '../../shared/db-ipc.ts'
import { MOTORES } from '../../shared/motores/index.ts'
import { destinoDeRed } from '../../shared/motores/destinoRed.ts'

const BLOQUE = `${INICIO}\ncontenido gestionado\n${FIN}`
const BLOQUE2 = `${INICIO}\ncontenido NUEVO\n${FIN}`

let fallos = 0

function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) {
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

console.log('\nreemplazarBloque\n')

// --- Inserción ---------------------------------------------------------------
{
  const r = reemplazarBloque('', BLOQUE)
  comprobar('archivo vacío -> solo el bloque', r === `${BLOQUE}\n`, JSON.stringify(r))
}
{
  const usuario = '# Mis instrucciones\n\nSiempre responde en español.'
  const r = reemplazarBloque(usuario, BLOQUE)
  comprobar(
    'conserva el contenido del usuario al insertar',
    r.startsWith('# Mis instrucciones') && r.includes('Siempre responde en español.') && r.includes(BLOQUE)
  )
  comprobar('separa con una línea en blanco', r === `${usuario}\n\n${BLOQUE}\n`, JSON.stringify(r))
}

// --- Actualización -----------------------------------------------------------
{
  const antes = `# Cabecera\n\n${BLOQUE}\n\n## Cola del usuario\ntexto`
  const r = reemplazarBloque(antes, BLOQUE2)
  comprobar('sustituye SOLO el bloque', r.includes('contenido NUEVO') && !r.includes('contenido gestionado'))
  comprobar('conserva lo de antes y lo de después', r.startsWith('# Cabecera') && r.includes('## Cola del usuario'))
  comprobar('no duplica marcadores', r.split(INICIO).length === 2 && r.split(FIN).length === 2)
}
{
  // Idempotencia: re-aplicar el MISMO bloque no debe cambiar el archivo, o cada
  // arranque tocaría la fecha de modificación de un archivo del usuario.
  const antes = `hola\n\n${BLOQUE}\n`
  comprobar('idempotente', reemplazarBloque(antes, BLOQUE) === antes)
}

// --- Retirada ----------------------------------------------------------------
{
  const antes = `# Cabecera\n\n${BLOQUE}\n\n## Cola\ntexto`
  const r = reemplazarBloque(antes, '')
  comprobar('retira el bloque', !r.includes(INICIO) && !r.includes(FIN))
  comprobar('conserva el resto al retirar', r.includes('# Cabecera') && r.includes('## Cola'))
  comprobar('no deja huecos crecientes', !/\n{3,}/.test(r), JSON.stringify(r))
}
{
  const usuario = '# Solo mío\ntexto'
  comprobar('retirar sin bloque presente no toca nada', reemplazarBloque(usuario, '') === usuario)
}
{
  comprobar('archivo con SOLO el bloque queda vacío al retirar', reemplazarBloque(`${BLOQUE}\n`, '') === '\n')
}

// --- Robustez ----------------------------------------------------------------
{
  // Marcador de cierre ausente (alguien editó el archivo a medias): no se debe
  // destruir nada. Se trata como "no hay bloque" y se añade uno nuevo.
  const roto = `texto\n${INICIO}\na medias`
  const r = reemplazarBloque(roto, BLOQUE)
  comprobar('marcador de cierre ausente -> no destruye el archivo', r.includes('a medias'))
}

// --- Contenido del bloque del espacio de datos -------------------------------
console.log('\nbloqueEspacioDatos\n')
{
  const conexiones = [
    {
      id: 'x1',
      profileId: 'alfa',
      alias: 'DEV-VENTAS',
      motor: 'oracle' as const,
      host: '10.0.0.1',
      port: 1521,
      database: 'ORCL',
      user: 'APP',
      tieneSecreto: true,
      readonly: true
    }
  ]
  const b = bloqueEspacioDatos('Alfa', conexiones)
  // Las frases se comparan con los blancos colapsados: el bloque se parte en líneas
  // de ~80 columnas, y un salto de línea en medio de una frase no la cambia.
  const plano = b.replace(/\s+/g, ' ')
  comprobar('lleva los marcadores', b.startsWith(INICIO) && b.endsWith(FIN))
  comprobar('nombra el perfil', b.includes('Alfa'))
  comprobar('lista la conexión con su destino', b.includes('DEV-VENTAS') && b.includes('10.0.0.1:1521/ORCL'))
  // Lo que NUNCA debe salir: el archivo vive en disco y se lee entero en cada sesión.
  comprobar('no filtra la contraseña', !b.toLowerCase().includes('password') && !b.includes('tieneSecreto'))
  comprobar('dice que es solo lectura', b.includes('solo lectura'))

  // Se retiró "el espacio de datos ve todas": la tabla es un CATÁLOGO y lo
  // consultable es lo montado. Si el texto no lo dijera, el agente daría por hecho
  // que puede consultar todo lo de la tabla y diagnosticaría una avería al fallar.
  comprobar(
    'dice que solo puede consultar lo MONTADO, que cambia en caliente y que tdb ls lo dice',
    plano.includes(
      'Solo puedes consultar las bases MONTADAS en el botón de bases de datos de la cabecera del agente; ' +
        'cambian en caliente y `tdb ls` dice cuáles son ahora. Si necesitas otra, pide que te la monten.'
    ),
    b
  )
  comprobar('la tabla se presenta como catálogo, no como lo consultable', plano.includes('NO significa que puedas consultarla'))
  comprobar('ya no titula la tabla como "disponibles"', !b.includes('Conexiones disponibles'))
  comprobar('explica el cambio (antes veía todas)', plano.includes('Antes este espacio veía todas las conexiones del perfil; ya no.'))
  comprobar('lista el id de cada conexión (para cruzarlo con consolas/indice.json)', b.includes('`x1`'))

  // Las consolas SQL del usuario viven en esta misma carpeta: el agente las verá.
  comprobar('explica consolas/ y consolas/indice.json', b.includes('`consolas/`') && b.includes('`consolas/indice.json`'))
  comprobar(
    'dice que son del usuario y que no las edite salvo que se lo pida',
    plano.toLowerCase().includes('es el sql del usuario; léelo, no lo edites salvo que te lo pida')
  )
}
// --- Producción ----------------------------------------
console.log('\nbloqueEspacioDatos: conexiones de PRODUCCIÓN\n')
{
  const base = {
    profileId: 'alfa',
    motor: 'postgres' as const,
    host: 'h',
    port: 5432,
    database: 'd',
    user: 'u',
    tieneSecreto: true
  }
  const conexiones = [
    { ...base, id: 'p1', alias: 'ALFA-PROD', readonly: false, entorno: 'produccion' as const },
    { ...base, id: 'p2', alias: 'ALFA-PRUEBAS', readonly: false, entorno: 'pruebas' as const },
    { ...base, id: 'p3', alias: 'ALFA-DEV', readonly: true, entorno: 'desarrollo' as const },
    { ...base, id: 'p4', alias: 'ALFA-SIN', readonly: true }
  ]
  const b = bloqueEspacioDatos('Alfa', conexiones)
  const plano = b.replace(/\s+/g, ' ')
  const fila = (alias: string): string => b.split('\n').find((l) => l.startsWith(`| ${alias} |`)) ?? ''
  comprobar('la tabla tiene la columna Entorno', b.includes('| Nombre | Motor | Destino | Usuario | Modo | Entorno | Id |'))
  comprobar('producción en MAYÚSCULAS en su fila', fila('ALFA-PROD').includes('| PRODUCCIÓN |'), fila('ALFA-PROD'))
  comprobar('pruebas y desarrollo con su nombre', fila('ALFA-PRUEBAS').includes('| Pruebas |') && fila('ALFA-DEV').includes('| Desarrollo |'))
  comprobar('sin entorno: una raya, no un nombre inventado', fila('ALFA-SIN').includes('| — |'), fila('ALFA-SIN'))
  comprobar('la sección nombra las de producción', plano.includes('Son de PRODUCCIÓN: **ALFA-PROD**.'), b)
  comprobar('NEGATIVO: no nombra como producción las que no lo son', !/Son de PRODUCCIÓN:[^\n]*(ALFA-PRUEBAS|ALFA-DEV|ALFA-SIN)/.test(b))
  comprobar(
    'y la regla: no escribir en producción sin que el usuario lo pida explícitamente',
    plano.includes('No escribas en una conexión de PRODUCCIÓN salvo que el usuario te lo pida explícitamente en esta conversación')
  )
  comprobar('explica que tdb no pasa por el diálogo de confirmación', plano.includes('`tdb` no pasa por ese diálogo'))
  const sinProd = bloqueEspacioDatos('Alfa', [conexiones[1], conexiones[3]]).replace(/\s+/g, ' ')
  comprobar('NEGATIVO: sin ninguna de producción no inventa nombres', sinProd.includes('Ninguna de este perfil está marcada como de PRODUCCIÓN') && !sinProd.includes('Son de PRODUCCIÓN'))
  comprobar('… pero la regla sigue (el bloque solo se regenera al cambiar el registro)', sinProd.includes('No escribas en una conexión de PRODUCCIÓN'))
}
// --- El aviso de ARRANQUE del agente (briefingAgente.ts), con producción ------------
// Los proyectos también montan bases, y su agente escribe por `tdb` igual: el aviso que
// se hornea en su línea de arranque marca las de PRODUCCIÓN con la misma regla.
console.log('\nbriefingBasesAgente: conexiones de PRODUCCIÓN\n')
{
  const base = { motor: 'postgres' as const, host: 'h', port: 5432, database: 'd', user: 'u', readonly: false }
  const conProd = briefingBasesAgente([{ ...base, alias: 'ALFA-PROD', entorno: 'produccion' }, { ...base, alias: 'ALFA-DEV', entorno: 'desarrollo' }], false) ?? ''
  const lineas = conProd.split('\n')
  comprobar('la de producción lleva la marca en su línea', lineas.some((l) => l.startsWith('- ALFA-PROD') && l.endsWith('— PRODUCCIÓN')), conProd)
  comprobar('NEGATIVO: la de desarrollo no', lineas.some((l) => l.startsWith('- ALFA-DEV') && !l.includes('PRODUCCIÓN')), conProd)
  comprobar('y la regla va justo después de la lista', lineas.indexOf(REGLA_PRODUCCION) === lineas.findIndex((l) => l.startsWith('- ALFA-DEV')) + 1, conProd)
  comprobar('la regla dice «salvo que el usuario te lo pida explícitamente»', REGLA_PRODUCCION.includes('salvo que el usuario te lo pida explícitamente'))
  const sinProd = briefingBasesAgente([{ ...base, alias: 'ALFA-DEV', entorno: 'desarrollo' }], true) ?? ''
  comprobar('NEGATIVO: sin ninguna de producción, ni marca ni regla (el texto de siempre)', !sinProd.includes('PRODUCCIÓN') && !sinProd.includes(REGLA_PRODUCCION), sinProd)
}
{
  const b = bloqueEspacioDatos('Cliente', [])
  comprobar('sin conexiones sigue siendo válido', b.startsWith(INICIO) && b.endsWith(FIN))
  comprobar('sin conexiones lo dice', b.includes('ninguna configurada'))
  // Sin conexiones siguen valiendo las reglas: un perfil vacío hoy tendrá conexiones
  // mañana, y el bloque solo se regenera al cambiar el registro.
  comprobar('sin conexiones también explica el montaje y las consolas', b.includes('MONTADAS') && b.includes('`consolas/`'))
}
// --- El registro con un FORMATO que esta versión no reconoce ---------------------------------------
// El main no interpreta ninguna entrada y la lista llega VACÍA sin que el perfil lo esté.
// El bloque escribía entonces en disco «ninguna configurada todavía» y «Ninguna de este
// perfil está marcada como de PRODUCCIÓN»: falsas las dos, y la segunda es la regla que
// protege las escrituras. Con el aviso del main tiene que decir que no se puede leer.
console.log('\nbloqueEspacioDatos: registro con un formato que esta versión no reconoce\n')
{
  const AVISO = 'Esta versión de Tessera no reconoce el formato del registro de conexiones (db-connections.json).'
  const b = bloqueEspacioDatos('Alfa', [], AVISO)
  const plano = b.replace(/\s+/g, ' ')
  comprobar('sigue siendo un bloque válido', b.startsWith(INICIO) && b.endsWith(FIN))
  comprobar('cita el aviso del main tal cual', b.includes(`> ${AVISO}`), b)
  comprobar(
    'dice que no puede leer el catálogo, y que no es que el perfil no tenga',
    plano.includes('Tessera no puede leer el catálogo de este perfil') && plano.includes('no es que el perfil no tenga'),
    b
  )
  comprobar('NEGATIVO: no dice «ninguna configurada» ni manda a añadirlas', !b.includes('ninguna configurada'), b)
  comprobar(
    'NEGATIVO: no afirma que ninguna sea de PRODUCCIÓN (no se sabe)',
    !plano.includes('Ninguna de este perfil está marcada como de PRODUCCIÓN') &&
      plano.includes('no se sabe cuáles son de PRODUCCIÓN'),
    b
  )
  comprobar(
    '… y la regla de producción, el montaje y las consolas siguen',
    plano.includes('No escribas en una conexión de PRODUCCIÓN') && b.includes('MONTADAS') && b.includes('`consolas/`')
  )
  // Un registro que NO SE PUEDE LEER llega por el MISMO camino
  // (`listaCompleta` → `escribirContexto`), con el aviso REAL del main: el bloque lo cita
  // y dice lo mismo que con el formato ajeno, sin «ninguna configurada» ni «ninguna de
  // producción». Es lo que el agente lee al empezar: que no mande a crear una conexión que
  // la app rechazaría, ni dé por hecho que ninguna es de producción.
  const ILEGIBLE = mensajeRegistroIlegible({ tipo: 'roto' }, 'inservible')
  const bi = bloqueEspacioDatos('Alfa', [], ILEGIBLE)
  const planoI = bi.replace(/\s+/g, ' ')
  comprobar(
    'registro ilegible: cita su aviso (qué no se pudo leer, el .bak y qué hacer) y no dice que esté vacío',
    bi.includes(`> ${ILEGIBLE}`) &&
      planoI.includes('Tessera no puede leer el catálogo de este perfil') &&
      !bi.includes('ninguna configurada') &&
      !planoI.includes('Ninguna de este perfil está marcada como de PRODUCCIÓN'),
    bi
  )
  // Mitad negativa: sin aviso, el vacío de siempre (no se contagia al perfil vacío de verdad).
  const vacio = bloqueEspacioDatos('Alfa', [], null)
  comprobar(
    'NEGATIVO: sin aviso, un perfil vacío sigue diciendo «ninguna configurada» (y nada del catálogo ilegible)',
    vacio.includes('ninguna configurada') && !vacio.includes('no puede leer el catálogo'),
    vacio
  )
}

// --- El destino, del descriptor --------------------------------
// La tabla del bloque y cada línea del aviso de arranque escribían el destino con una
// copia a mano; ahora es `destinoLegible` de su motor. Se fija contra esa expresión,
// COPIADA TAL CUAL de antes del cambio, con cada motor del registro y con uno que esta
// versión no conoce (una ajena nunca llega aquí, pero si llegara se escribiría igual),
// y con las cuatro combinaciones de base y SID.
console.log('\nEl destino de cada conexión, del descriptor de su motor\n')
{
  const deAntes = (c: { host: string; port: number; database?: string | null; sid?: string | null }): string =>
    `${c.host}:${c.port}${c.database ? `/${c.database}` : c.sid ? ` (SID ${c.sid})` : ''}`
  const CASOS: Array<{ database?: string | null; sid?: string | null }> = [
    { database: 'ORCL' },
    { sid: 'XE' },
    { database: 'ORCL', sid: 'XE' },
    { database: null, sid: 'XE' },
    {}
  ]
  // La copia de antes es la de los motores de RED; un motor de ARCHIVO enseña el
  // NOMBRE de su archivo, nunca el host ni la ruta (abajo).
  const deRed = Object.keys(MOTORES).filter((m) => MOTORES[m as keyof typeof MOTORES].conexion.destinoLegible === destinoDeRed)
  for (const motor of Object.keys(MOTORES).filter((m) => MOTORES[m as keyof typeof MOTORES].conexion.deArchivo)) {
    const c = { id: 'd1', profileId: 'alfa', alias: 'DEST', motor, host: 'db.lan', port: 1521, user: '', tieneSecreto: false, readonly: true, archivoVisible: 'ejemplo.db' }
    const bloque = bloqueEspacioDatos('Alfa', [c as unknown as DbConnection])
    comprobar(`bloque, ${motor}: el destino es el NOMBRE del archivo, sin host`, bloque.includes(`| DEST | ${motor} | ejemplo.db |`) && !bloque.includes('db.lan'), bloque.split('\n').find((l) => l.includes('DEST')))
    const aviso = briefingBasesAgente([c as unknown as DbConnection], false) ?? ''
    comprobar(`aviso, ${motor}: el nombre del archivo, sin host`, aviso.includes('ejemplo.db') && !aviso.includes('db.lan'), aviso.split('\n').find((l) => l.includes('DEST')))
  }
  for (const motor of [...deRed, 'motor-futuro']) {
    for (const caso of CASOS) {
      const c = { id: 'd1', profileId: 'alfa', alias: 'DEST', motor, host: 'db.lan', port: 1521, user: 'APP', tieneSecreto: false, readonly: true, ...caso }
      const esperado = deAntes(c)
      const bloque = bloqueEspacioDatos('Alfa', [c as unknown as DbConnection])
      const fila = `| DEST | ${motor} | ${esperado} | APP |`
      comprobar(`bloque, ${motor} ${JSON.stringify(caso)}: «${esperado}»`, bloque.includes(fila), bloque.split('\n').find((l) => l.includes('DEST')))
      const aviso = briefingBasesAgente([c as unknown as DbConnection], false) ?? ''
      const linea = `- DEST (${motor}, ${esperado}, usuario APP) — solo lectura`
      comprobar(`aviso, ${motor} ${JSON.stringify(caso)}: «${esperado}»`, aviso.split('\n').includes(linea), aviso.split('\n').find((l) => l.includes('DEST')))
    }
  }
  // SQL Server tiene su destino (instancia, sin SID) y su solo lectura lo impone tdb
  // (el servidor no tiene candado): ni la frase de archivos ni «lo impone el servidor» a secas.
  const mssql = { id: 'd1', profileId: 'alfa', alias: 'DEST', motor: 'sqlserver', host: 'db.lan', port: 1433, user: 'APP', tieneSecreto: false, readonly: true, instancia: 'SQLEXPRESS', database: 'ventas', sid: 'XE' }
  const bloqueS = bloqueEspacioDatos('Alfa', [mssql as unknown as DbConnection])
  comprobar('bloque, sqlserver: destino `host\\INSTANCIA/base`, sin SID', bloqueS.includes('| DEST | sqlserver | db.lan\\SQLEXPRESS/ventas | APP |'), bloqueS.split('\n').find((l) => l.includes('DEST')))
  comprobar(
    'bloque, sqlserver: dice que el solo lectura lo impone Tessera, sin la frase de archivos',
    bloqueS.includes('no tiene candado de solo lectura: lo impone Tessera.') && bloqueS.includes('tdb rechaza antes de enviarla') && !bloqueS.includes('son un ARCHIVO'),
    ''
  )
  comprobar('bloque, sqlserver: la garantía real es un usuario con solo db_datareader', bloqueS.includes('usuario de la base con solo db_datareader'), '')
  comprobar('bloque, sqlserver: los consejos de T-SQL (TOP, corchetes, GO, base.esquema.tabla)', /T-SQL: TOP \(n\) en vez de LIMIT/.test(bloqueS) && bloqueS.includes('GO') && bloqueS.includes('base.esquema.tabla'), '')
  comprobar('bloque, sqlserver: nada de ATTACH ni de archivos', !bloqueS.includes('ATTACH') && !bloqueS.includes('VACUUM'), '')
  const avisoS = briefingBasesAgente([mssql as unknown as DbConnection], false) ?? ''
  comprobar(
    'aviso, solo sqlserver: «lo impone Tessera» y la frase de tdb, nunca «el servidor» ni ATTACH',
    avisoS.includes('lectura las impone Tessera, así que') && avisoS.includes('tdb rechaza antes de enviarla') && !avisoS.includes('impone el servidor') && !avisoS.includes('ATTACH'),
    avisoS
  )
  comprobar(
    'aviso, sqlserver: la línea dice el dialecto (T-SQL) detrás del usuario',
    avisoS.split('\n').includes('- DEST (sqlserver, db.lan\\SQLEXPRESS/ventas, usuario APP, T-SQL) — solo lectura'),
    avisoS.split('\n').find((l) => l.includes('DEST')) ?? ''
  )
  comprobar('aviso, sqlserver: db_datareader y los consejos de T-SQL', avisoS.includes('db_datareader') && avisoS.includes('TOP (n) en vez de LIMIT'), '')
  // Con una cuenta de DOMINIO (NTLM): `DOMINIO\usuario` en la línea y en la celda Usuario.
  const ntlm = { ...mssql, alias: 'NT', autenticacion: 'ntlm', dominio: 'EMPRESA', instancia: undefined, port: 1433 }
  const avisoN = briefingBasesAgente([ntlm as unknown as DbConnection], false) ?? ''
  comprobar(
    'aviso, sqlserver con cuenta de dominio: `usuario EMPRESA\\APP, T-SQL`',
    avisoN.split('\n').includes('- NT (sqlserver, db.lan:1433/ventas, usuario EMPRESA\\APP, T-SQL) — solo lectura'),
    avisoN.split('\n').find((l) => l.includes('NT (')) ?? ''
  )
  const bloqueN = bloqueEspacioDatos('Alfa', [ntlm as unknown as DbConnection])
  comprobar('bloque, sqlserver con cuenta de dominio: celda Usuario `EMPRESA\\APP`', bloqueN.includes('| NT | sqlserver | db.lan:1433/ventas | EMPRESA\\APP |'), bloqueN.split('\n').find((l) => l.includes('| NT |')) ?? '')
  // La mitad negativa: con Oracle y PG, ni T-SQL ni db_datareader ni la frase de Tessera.
  const ora = { ...mssql, motor: 'oracle', instancia: undefined, port: 1521 }
  const avisoO = briefingBasesAgente([ora as unknown as DbConnection, { ...ora, alias: 'PG', motor: 'postgres' } as unknown as DbConnection], false) ?? ''
  comprobar('aviso con Oracle y PG: ni T-SQL, ni db_datareader, ni «lo impone Tessera»', !avisoO.includes('T-SQL') && !avisoO.includes('db_datareader') && !avisoO.includes('lo impone Tessera'), '')
}

// --- Bases de ARCHIVO (SQLite) ---------------------------------------
// Sin usuario: la línea del aviso dice el SQL que habla y la celda Usuario, «—». Quién
// impone el solo lectura: Tessera, no un servidor, y se dice solo si hay alguna; con solo
// Oracle y PG, la frase de siempre al carácter.
console.log('\nBases de archivo: sin usuario, y el solo lectura lo impone Tessera\n')
{
  const FRASE_SERVIDOR = 'lectura las impone el servidor, así que puedes explorar sin riesgo de escribir.'
  const etq = MOTORES.sqlite.etiqueta
  const archivo = { id: 's1', profileId: 'alfa', alias: 'LOCAL', motor: 'sqlite', host: '', port: 0, user: '', tieneSecreto: false, readonly: true, archivoVisible: 'app.db' } as unknown as DbConnection
  const red = { id: 'o1', profileId: 'alfa', alias: 'ORA', motor: 'oracle', host: 'db.lan', port: 1521, user: 'APP', tieneSecreto: true, readonly: true, database: 'ORCL' } as unknown as DbConnection
  const pg = { ...red, id: 'p1', alias: 'PG', motor: 'postgres' } as unknown as DbConnection

  const soloArchivo = (briefingBasesAgente([archivo], false) ?? '').split('\n')
  comprobar(
    'aviso: la línea dice el SQL que habla, sin «usuario »',
    soloArchivo.includes(`- LOCAL (sqlite, app.db, SQL de ${etq}) — solo lectura`),
    soloArchivo.find((l) => l.includes('LOCAL'))
  )
  const textoArchivo = soloArchivo.join('\n')
  comprobar(
    'aviso con solo bases de archivo: lo impone Tessera, no «el servidor»',
    textoArchivo.includes(`lectura las impone Tessera (las de ${etq} son archivos, sin servidor)`) && !textoArchivo.includes(FRASE_SERVIDOR),
    textoArchivo
  )
  comprobar('aviso: ATTACH, VACUUM INTO y extensiones cerrados siempre', /ATTACH, VACUUM INTO y cargar extensiones están cerrados siempre/.test(textoArchivo), '')

  const mixto = briefingBasesAgente([red, archivo], false) ?? ''
  comprobar(
    'aviso mixto: el servidor, y en las de archivo, Tessera',
    mixto.includes(`lectura las impone el servidor (en las de ${etq}, que son archivos, Tessera)`) && mixto.includes('- ORA (oracle, db.lan:1521/ORCL, usuario APP) — solo lectura'),
    mixto
  )

  const deRed = briefingBasesAgente([red, pg], false) ?? ''
  comprobar(
    'aviso con solo Oracle y PG: la frase de SIEMPRE y nada de archivos',
    deRed.split('\n').includes(FRASE_SERVIDOR) && !deRed.includes('ATTACH') && !deRed.includes('Tessera ('),
    deRed
  )

  const bloque = bloqueEspacioDatos('Alfa', [red, archivo])
  comprobar('bloque: la celda Usuario de la de archivo es «—»', bloque.includes('| LOCAL | sqlite | app.db | — | solo lectura |'), bloque.split('\n').find((l) => l.includes('LOCAL')))
  comprobar('bloque: la de red conserva su usuario', bloque.includes('| ORA | oracle | db.lan:1521/ORCL | APP | solo lectura |'), '')
  comprobar(
    'bloque con una de archivo: dice que su solo lectura lo impone Tessera y que sessions no aplica',
    bloque.includes(`Las de ${etq} son un ARCHIVO, sin servidor ni usuario`) && bloque.includes('`tdb sessions` no aplica'),
    ''
  )
  const bloqueRed = bloqueEspacioDatos('Alfa', [red, pg])
  comprobar('bloque con solo Oracle y PG: sin la frase de archivos', !bloqueRed.includes('ARCHIVO, sin servidor') && !bloqueRed.includes('VACUUM INTO'), '')
  comprobar(
    'bloque con el registro ilegible: sin la frase de archivos (no se sabe qué hay)',
    !bloqueEspacioDatos('Alfa', [], 'aviso de prueba').includes('ARCHIVO, sin servidor'),
    ''
  )
}

// --- Motores de OTRAS familias (MongoDB, Redis) -----------------------
// Candado 'listaBlanca': lo impone Tessera y la garantía real es un usuario de solo lectura.
// Su línea no dice SQL sino lo que habla (con la etiqueta del registro), y el usuario es
// OPCIONAL: sin él, ni «usuario » en la línea ni celda vacía en el bloque.
console.log('\nMotores de otras familias: lista blanca, sin SQL y usuario opcional\n')
{
  const mongo = { id: 'm1', profileId: 'alfa', alias: 'DOCS', motor: 'mongodb', host: 'mongo.lan', port: 27017, user: '', tieneSecreto: false, readonly: true } as unknown as DbConnection
  const redis = { id: 'r1', profileId: 'alfa', alias: 'CACHE', motor: 'redis', host: 'redis.lan', port: 6379, user: 'lector', tieneSecreto: true, readonly: true } as unknown as DbConnection
  const ora = { id: 'o1', profileId: 'alfa', alias: 'ORA', motor: 'oracle', host: 'db.lan', port: 1521, user: 'APP', tieneSecreto: true, readonly: true, database: 'ORCL' } as unknown as DbConnection
  const eM = MOTORES.mongodb.etiqueta
  const eR = MOTORES.redis.etiqueta
  const aviso = briefingBasesAgente([mongo, redis], false) ?? ''
  const lineas = aviso.split('\n')
  comprobar(
    'aviso: Mongo sin usuario dice «consultas de …», sin «usuario » ni SQL',
    lineas.some((l) => l.startsWith('- DOCS (mongodb, ') && l.endsWith(`, consultas de ${eM}) — solo lectura`) && !l.includes('usuario') && !l.includes('SQL')),
    lineas.find((l) => l.includes('DOCS')) ?? ''
  )
  comprobar(
    'aviso: Redis con usuario dice el usuario y «comandos de …»',
    lineas.some((l) => l.startsWith('- CACHE (redis, ') && l.endsWith(`, usuario lector, comandos de ${eR}) — solo lectura`)),
    lineas.find((l) => l.includes('CACHE')) ?? ''
  )
  comprobar(
    'aviso con solo Mongo y Redis: lo impone Tessera (lista blanca) y la garantía es un usuario de solo lectura; ni servidor, ni ATTACH, ni db_datareader',
    aviso.includes('lectura las impone Tessera, así que') &&
      aviso.includes('lista blanca') &&
      aviso.includes('usuario de solo lectura') &&
      !aviso.includes('impone el servidor') &&
      !aviso.includes('ATTACH') &&
      !aviso.includes('db_datareader'),
    aviso
  )
  const mixto = briefingBasesAgente([ora, mongo], false) ?? ''
  comprobar('aviso mixto con Oracle: la frase del servidor y detrás la de lista blanca', mixto.includes('lectura las impone el servidor, así que') && mixto.includes('lista blanca'), mixto)
  const soloOra = briefingBasesAgente([ora], false) ?? ''
  comprobar('NEGATIVO: con solo Oracle, nada de lista blanca', !soloOra.includes('lista blanca'), '')
  const bloque = bloqueEspacioDatos('Alfa', [mongo, redis])
  comprobar('bloque: la celda Usuario de un Mongo sin usuario es «—»', bloque.includes('| DOCS | mongodb | mongo.lan:27017 | — | solo lectura |'), bloque.split('\n').find((l) => l.includes('DOCS')) ?? '')
  comprobar('bloque: la de Redis con usuario, el usuario', bloque.includes('| CACHE | redis | redis.lan:6379 | lector | solo lectura |'), bloque.split('\n').find((l) => l.includes('CACHE')) ?? '')
  comprobar('bloque: la frase de lista blanca, sin la de archivos', bloque.includes('lista blanca') && bloque.includes('usuario de solo lectura') && !bloque.includes('ARCHIVO, sin servidor'), '')
  comprobar('NEGATIVO: bloque con solo Oracle, sin lista blanca', !bloqueEspacioDatos('Alfa', [ora]).includes('lista blanca'), '')
}

console.log(fallos === 0 ? '\n  TODO EN VERDE\n' : `\n  ${fallos} FALLO(S)\n`)
process.exit(fallos === 0 ? 0 : 1)
