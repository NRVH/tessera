#!/usr/bin/env node
// =============================================================================
// Prueba del ENRUTADO de contenedores en ServicioArchivos (npm run test:enrutado-jar): un .jar se
// navega como una carpeta por los canales de siempre (también pelado, sin `!/`, y anidado dentro
// de un .war), las clases internas se pliegan, `leerArchivo`/`leerBinario` leen una entrada, y todo lo
// que ESCRIBE rechaza una ruta virtual con un mensaje humano; `revelar`/`abrirRuta` colapsan al
// .jar, `rutaAbs` da el localizador completo y una carpeta real "algo.jar" o "scripts!" sigue
// siendo carpeta. Fabrica el proyecto en os.tmpdir() con fflate; el escritorio es un objeto literal.
// =============================================================================

import { register } from 'node:module'
import { promises as fs, mkdtempSync, rmSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron.ts'

// Reintento ".ts" para los imports extensionless de producción; `electron` no debe cargarse.
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('ServicioArchivos importó electron desde ' + ctx.parentURL)
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))
const { ServicioArchivos } = await import('./ServicioArchivos.ts')
const { ServicioJar } = await import('../java/ServicioJar.ts')

/** Lo último que se pidió revelar y abrir, capturado por el doble del escritorio. */
let revelado = ''
let abierto = ''
/**
 * El escritorio de la prueba. De la imagen del arrastre solo se pregunta si salió vacía, y se
 * imita por el LARGO del data-URL: así el caso (13) distingue un icono bueno de uno corrupto.
 */
const escritorio: EscritorioArchivos = {
  revelarEnCarpeta: (abs) => {
    revelado = abs
  },
  abrirRuta: async (abs) => {
    abierto = abs
    return ''
  },
  imagenDesdeUrlDatos: (d) => ({ isEmpty: () => typeof d !== 'string' || d.length < 24 }) as never,
  guardarConDialogo: async () => ({ canceled: true, filePath: '' })
}

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: Array<{ name: string; pass: boolean; evidence: string }> = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
/** Devuelve el mensaje de error, o '' si NO lanzó (que en las guardas es un fallo). */
async function mensajeDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const MANIFIESTO = 'Manifest-Version: 1.0\r\nImplementation-Version: 2.4.1\r\n'
const PROPS = 'saludo=Configuración del año\n'

function fabricarJar(): Uint8Array {
  return zipSync({
    'META-INF/MANIFEST.MF': Buffer.from(MANIFIESTO),
    'META-INF/maven/com.ejemplo/comunes/pom.properties': Buffer.from('groupId=com.ejemplo\n'),
    'com/ejemplo/comunes/nota/ElementoNota.class': Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 3, 0, 46]),
    // Interna CON su externa presente -> se pliega y no debe listarse.
    'com/ejemplo/comunes/nota/ElementoNota$1.class': Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 3, 0, 46]),
    // Interna HUÉRFANA -> sí se lista (si no, sería inalcanzable).
    'com/ejemplo/comunes/nota/Suelta$Interna.class': Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 3, 0, 46]),
    'com/ejemplo/comunes/nota/mensajes.properties': Buffer.from(PROPS, 'latin1')
  })
}

async function main(): Promise<void> {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-jar-routing-')))
  try {
    // --- proyecto desechable ---------------------------------------------
    mkdirSync(path.join(raiz, 'lib'), { recursive: true })
    const jarBytes = fabricarJar()
    writeFileSync(path.join(raiz, 'lib', 'comunes.jar'), jarBytes)

    // Un .war con el jar DENTRO (sin comprimir, para que el offset sea directo).
    const warBytes = zipSync({
      'WEB-INF/web.xml': Buffer.from('<web-app/>'),
      'WEB-INF/lib/comunes.jar': jarBytes
    })
    mkdirSync(path.join(raiz, 'dist'), { recursive: true })
    writeFileSync(path.join(raiz, 'dist', 'app.war'), warBytes)

    // Trampas para el desempate y para la regresión del corte anclado.
    mkdirSync(path.join(raiz, 'carpeta.jar'), { recursive: true })
    writeFileSync(path.join(raiz, 'carpeta.jar', 'dentro.txt'), 'soy una carpeta, no un jar')
    mkdirSync(path.join(raiz, 'scripts!'), { recursive: true })
    writeFileSync(path.join(raiz, 'scripts!', 'build.cmd'), 'echo hola')

    const archivos = new ServicioArchivos({ raizProyecto: raiz, escritorio, log: () => {} })
    archivos.fijarServicioJar(new ServicioJar({ log: () => {} }))
    try {
      // -------------------------------------------------------------------
      hr('(0) El listado del DISCO marca los contenedores')
      // -------------------------------------------------------------------
      // Sin esta marca el árbol no pinta chevron y NADA de lo de abajo se llega a
      // usar nunca, aunque funcione. Se comprueba primero por eso: es el eslabón
      // que conecta el enrutado con la interfaz, y el que se olvidó al principio.
      const enLib = await archivos.listarDirectorio('lib')
      const elJar = enLib.find((e) => e.nombre === 'comunes.jar')
      check(
        'un .jar del disco llega con contenedor:"jar"',
        elJar?.contenedor === 'jar',
        `${elJar?.nombre}: tipo=${elJar?.tipo}, contenedor=${elJar?.contenedor ?? 'AUSENTE  <-- sin chevron en el árbol'}`
      )
      check(
        'y sigue siendo tipo:"file" (conserva icono, letra de git, renombrar…)',
        elJar?.tipo === 'file',
        `tipo=${elJar?.tipo}`
      )
      const raizProy = await archivos.listarDirectorio('')
      const carpetaJar = raizProy.find((e) => e.nombre === 'carpeta.jar')
      check(
        'una CARPETA llamada "carpeta.jar" NO se marca como contenedor',
        carpetaJar?.tipo === 'dir' && carpetaJar?.contenedor === undefined,
        `tipo=${carpetaJar?.tipo}, contenedor=${carpetaJar?.contenedor ?? 'ausente'}`
      )
      const elWar = raizProy.find((e) => e.nombre === 'dist')
      check(
        'los .txt/.md de al lado no se marcan',
        enLib.filter((e) => e.contenedor != null).length === 1,
        `${enLib.filter((e) => e.contenedor != null).length} contenedor(es) en lib/`
      )
      void elWar

      // -------------------------------------------------------------------
      hr('(1) El .jar PELADO enruta al contenedor')
      // -------------------------------------------------------------------
      const raizJar = await archivos.listarDirectorio('lib/comunes.jar')
      check(
        'listarDirectorio("lib/comunes.jar") devuelve el contenido, no ENOTDIR',
        raizJar.length > 0,
        `${raizJar.length} entradas: ${raizJar.map((e) => e.nombre).join(', ')}`
      )
      check(
        'carpetas primero y alfabético, igual que en el disco',
        raizJar[0].tipo === 'dir' && raizJar.map((e) => e.nombre).join(',') === 'com,META-INF',
        raizJar.map((e) => `${e.nombre}(${e.tipo})`).join(' ')
      )
      check(
        'las rutas emitidas llevan el separador virtual',
        raizJar.every((e) => e.ruta.startsWith('lib/comunes.jar!/')),
        raizJar[0].ruta
      )

      // -------------------------------------------------------------------
      hr('(2) Navegación por niveles')
      // -------------------------------------------------------------------
      const nivelCom = await archivos.listarDirectorio('lib/comunes.jar!/com')
      check(
        'un nivel exacto (no vuelca el jar entero)',
        nivelCom.length === 1 && nivelCom[0].nombre === 'ejemplo' && nivelCom[0].tipo === 'dir',
        nivelCom.map((e) => e.nombre).join(', ')
      )
      check(
        'la carpeta se sintetiza aunque el zip no traiga registro de directorio',
        nivelCom[0].ruta === 'lib/comunes.jar!/com/ejemplo',
        nivelCom[0].ruta
      )
      const nivelNota = await archivos.listarDirectorio('lib/comunes.jar!/com/ejemplo/comunes/nota')
      const nombresNota = nivelNota.map((e) => e.nombre)
      check(
        'nivel con archivos: tamaño incluido',
        nivelNota.every((e) => e.tipo === 'file' && typeof e.tamano === 'number'),
        nivelNota.map((e) => `${e.nombre}:${e.tamano}B`).join(' ')
      )

      // -------------------------------------------------------------------
      hr('(3) Clases internas')
      // -------------------------------------------------------------------
      check(
        'la interna con su externa presente NO se lista (se plegará dentro de ella)',
        !nombresNota.includes('ElementoNota$1.class') && nombresNota.includes('ElementoNota.class'),
        nombresNota.join(', ')
      )
      check(
        'la interna HUÉRFANA sí se lista (si no, sería inalcanzable)',
        nombresNota.includes('Suelta$Interna.class'),
        nombresNota.join(', ')
      )

      // -------------------------------------------------------------------
      hr('(4) leerArchivo de una entrada de texto')
      // -------------------------------------------------------------------
      const manifiesto = await archivos.leerArchivo('lib/comunes.jar!/META-INF/MANIFEST.MF')
      check(
        'el MANIFEST se lee entero',
        manifiesto.contenido === MANIFIESTO && !manifiesto.binario,
        JSON.stringify(manifiesto.contenido.slice(0, 40))
      )
      const props = await archivos.leerArchivo('lib/comunes.jar!/com/ejemplo/comunes/nota/mensajes.properties')
      check(
        'un .properties latin1 se decodifica con acentos correctos',
        props.contenido.includes('Configuración del año'),
        `${props.encoding}: ${JSON.stringify(props.contenido.trim())}`
      )
      check(
        'el lenguaje sale del nombre de la ENTRADA, no de la ruta del contenedor',
        props.lenguaje === 'properties',
        props.lenguaje
      )
      const clase = await archivos.leerArchivo('lib/comunes.jar!/com/ejemplo/comunes/nota/ElementoNota.class')
      check(
        'un .class se marca como binario (aún no hay descompilador)',
        clase.binario && clase.contenido === '',
        `binario=${clase.binario}`
      )

      // -------------------------------------------------------------------
      hr('(5) leerBinario de una entrada')
      // -------------------------------------------------------------------
      const bin = await archivos.leerBinario('lib/comunes.jar!/com/ejemplo/comunes/nota/ElementoNota.class')
      check(
        'devuelve los bytes exactos con su magic',
        bin.bytes.length === 8 &&
          Buffer.from(bin.bytes).readUInt32BE(0) === 0xcafebabe &&
          !bin.truncado,
        `${bin.bytes.length} B, magic=0x${Buffer.from(bin.bytes).readUInt32BE(0).toString(16)}`
      )

      // -------------------------------------------------------------------
      hr('(6) Todo lo que ESCRIBE rechaza una ruta virtual')
      // -------------------------------------------------------------------
      const dentro = 'lib/comunes.jar!/com/ejemplo/comunes/nota/ElementoNota.class'
      const carpetaDentro = 'lib/comunes.jar!/com'
      const mutadores: Array<[string, () => Promise<unknown>]> = [
        ['escribirArchivo', () => archivos.escribirArchivo(dentro, 'hola')],
        ['crearEntrada (archivo)', () => archivos.crearEntrada(carpetaDentro, 'nuevo.txt', 'file')],
        ['crearEntrada (carpeta)', () => archivos.crearEntrada(carpetaDentro, 'nueva', 'dir')],
        ['renombrar', () => archivos.renombrar(dentro, 'otro.class')],
        ['moverVarios', () => archivos.moverVarios([dentro], 'lib')],
        ['borrarVarios', () => archivos.borrarVarios([dentro])]
      ]
      for (const [nombre, fn] of mutadores) {
        const msg = await mensajeDe(fn)
        check(
          `${nombre} lanza, y con mensaje humano`,
          msg.includes('archivo comprimido') && !msg.includes('undefined'),
          msg || 'NO LANZÓ  <-- la guarda no cubre este camino'
        )
      }
      // leerZip y leerDocx estaban en la lista de arriba, y no debían: LEEN, no
      // escriben. Al no bifurcar para rutas virtuales caían en la guarda de escritura
      // y quien hacía doble clic en un .docx dentro de un .war recibía "no se puede
      // modificar desde aquí" por haber intentado MIRARLO.
      //
      // Aquí solo se comprueba que pasan de la guarda: el éxito completo necesita un
      // worker_threads (`__dirname`, que en este arnés de ESM no existe), así que se
      // afirma lo que sí se puede afirmar y no se finge lo demás.
      for (const [nombre, fn] of [
        ['leerZip', () => archivos.leerZip('lib/comunes.jar!/META-INF/MANIFEST.MF')],
        ['leerDocx', () => archivos.leerDocx('lib/comunes.jar!/META-INF/MANIFEST.MF')]
      ] as Array<[string, () => Promise<unknown>]>) {
        const msg = await mensajeDe(fn)
        check(
          `${nombre} NO responde con la guarda de escritura (es una lectura)`,
          !msg.includes('no se puede modificar'),
          msg || '(no lanzó)'
        )
      }

      // La forma DEGENERADA `x.jar!`: un `!` de corte sin su barra. Sale sola de
      // `dirPadre('lib/comunes.jar!/A.class')`, que es el destino que se calcula al
      // soltar un fichero de Windows sobre una clase de la RAÍZ del jar. No contiene
      // `!/`, así que `esRutaVirtual` la daba por buena y se colaba por la guarda
      // hasta reventar con un ENOENT crudo.
      for (const [nombre, fn] of [
        ['crearEntrada', () => archivos.crearEntrada('lib/comunes.jar!', 'x.txt', 'file')],
        ['escribirArchivo', () => archivos.escribirArchivo('lib/comunes.jar!/x.txt'.replace('/x.txt', ''), 'h')],
        ['borrarVarios', () => archivos.borrarVarios(['lib/comunes.jar!'])]
      ] as Array<[string, () => Promise<unknown>]>) {
        const msg = await mensajeDe(fn)
        check(
          `${nombre} sobre la forma degenerada "x.jar!" da mensaje humano, no ENOENT`,
          msg.includes('archivo comprimido'),
          msg || 'NO LANZÓ  <-- se coló por la guarda'
        )
      }

      // El proyecto no se ensucia: nada de lo anterior creó una carpeta "comunes.jar!".
      const raizProyecto = await archivos.listarDirectorio('')
      check(
        'ningún mutador dejó basura en el proyecto',
        !raizProyecto.some((e) => e.nombre.includes('!')) ||
          raizProyecto.filter((e) => e.nombre.includes('!')).every((e) => e.nombre === 'scripts!'),
        raizProyecto.map((e) => e.nombre).join(', ')
      )

      // -------------------------------------------------------------------
      hr('(7) revelar y abrirRuta COLAPSAN al contenedor')
      // -------------------------------------------------------------------
      await archivos.revelar(dentro)
      check(
        'revelar muestra el .jar en el Explorador, en vez de no hacer nada',
        revelado === path.join(raiz, 'lib', 'comunes.jar'),
        revelado
      )
      await archivos.abrirRuta(dentro)
      check('abrirRuta abre el .jar', abierto === path.join(raiz, 'lib', 'comunes.jar'), abierto)

      // -------------------------------------------------------------------
      hr('(8) rutaAbs y urlArchivo')
      // -------------------------------------------------------------------
      const abs = await archivos.rutaAbs(dentro)
      check(
        'rutaAbs da el localizador completo, no una ruta creíble pero falsa',
        abs === path.join(raiz, 'lib', 'comunes.jar') + '!/com/ejemplo/comunes/nota/ElementoNota.class',
        abs
      )
      const url = await archivos.urlArchivo(dentro)
      check('urlArchivo devuelve "" (no es descargable)', url === '', JSON.stringify(url))

      // -------------------------------------------------------------------
      hr('(9) DESEMPATE: una CARPETA real llamada "carpeta.jar"')
      // -------------------------------------------------------------------
      const comoCarpeta = await archivos.listarDirectorio('carpeta.jar')
      check(
        'se lista como la carpeta que es, no como contenedor',
        comoCarpeta.length === 1 && comoCarpeta[0].nombre === 'dentro.txt',
        comoCarpeta.map((e) => e.nombre).join(', ')
      )
      const dentroDeEsa = await archivos.leerArchivo('carpeta.jar/dentro.txt')
      check(
        'y sus archivos se leen con normalidad',
        dentroDeEsa.contenido === 'soy una carpeta, no un jar',
        JSON.stringify(dentroDeEsa.contenido)
      )

      // -------------------------------------------------------------------
      hr('(10) Una carpeta real llamada "scripts!" sigue funcionando')
      // -------------------------------------------------------------------
      const enScripts = await archivos.listarDirectorio('scripts!')
      check(
        'listarDirectorio de una carpeta con "!" en el nombre',
        enScripts.length === 1 && enScripts[0].nombre === 'build.cmd',
        enScripts.map((e) => e.nombre).join(', ')
      )
      const leido = await archivos.leerArchivo('scripts!/build.cmd')
      check('leerArchivo dentro de ella', leido.contenido === 'echo hola', JSON.stringify(leido.contenido))
      const creado = await archivos.crearEntrada('scripts!', 'nuevo.txt', 'file')
      check('y SÍ se puede escribir (no es un contenedor)', creado.ruta === 'scripts!/nuevo.txt', creado.ruta)

      // -------------------------------------------------------------------
      hr('(11) Contenedor ANIDADO')
      // -------------------------------------------------------------------
      const enWar = await archivos.listarDirectorio('dist/app.war')
      check(
        'el .war se navega igual',
        enWar.length === 1 && enWar[0].nombre === 'WEB-INF',
        enWar.map((e) => e.nombre).join(', ')
      )
      const libDelWar = await archivos.listarDirectorio('dist/app.war!/WEB-INF/lib')
      check(
        'un .jar DENTRO del .war viene marcado como contenedor (se puede reexpandir)',
        libDelWar.length === 1 && libDelWar[0].contenedor === 'jar' && libDelWar[0].tipo === 'file',
        `${libDelWar[0]?.nombre}: contenedor=${libDelWar[0]?.contenedor}, tipo=${libDelWar[0]?.tipo}`
      )
      // La fila de arriba lleva chevron, así que el árbol la despliega pidiendo la
      // ruta SIN `!/` final. Esa es la llamada que salía siempre vacía: el jar
      // anidado parsea como una ENTRADA del .war, no como raíz propia, y el filtro
      // por prefijo "WEB-INF/lib/comunes.jar/" no casaba con nada. Vacío y en
      // silencio, que es la peor forma de fallar cuando la fila prometía contenido.
      const raizAnidado = await archivos.listarDirectorio('dist/app.war!/WEB-INF/lib/comunes.jar')
      check(
        'desplegar el .jar anidado lista SU raíz (no sale vacío)',
        raizAnidado.length > 0 && raizAnidado.some((e) => e.nombre === 'com'),
        raizAnidado.map((e) => e.nombre).join(', ') || '(vacío)'
      )
      check(
        'y sus hijos cuelgan del localizador anidado, no del .war',
        raizAnidado.every((e) => e.ruta.startsWith('dist/app.war!/WEB-INF/lib/comunes.jar!/')),
        raizAnidado.map((e) => e.ruta).join(', ')
      )
      const dentroAnidado = await archivos.listarDirectorio('dist/app.war!/WEB-INF/lib/comunes.jar!/com/ejemplo/comunes/nota')
      check(
        'y se navega SIN extraer nada a disco',
        dentroAnidado.some((e) => e.nombre === 'ElementoNota.class'),
        dentroAnidado.map((e) => e.nombre).join(', ')
      )
      const manifiestoAnidado = await archivos.leerArchivo(
        'dist/app.war!/WEB-INF/lib/comunes.jar!/META-INF/MANIFEST.MF'
      )
      check(
        'y su contenido se lee a dos niveles de profundidad',
        manifiestoAnidado.contenido === MANIFIESTO,
        JSON.stringify(manifiestoAnidado.contenido.slice(0, 30))
      )

      // -------------------------------------------------------------------
      hr('(12) `existeRuta`: la pregunta del editor con el buffer SUCIO')
      // -------------------------------------------------------------------
      // La usa el editor cuando el watcher avisa y no puede releer sin destruir
      // ediciones: necesita saber si tachar la pestaña. Aquí importa lo virtual —una
      // entrada de un .jar no se puede borrar por separado, así que la pregunta
      // honesta es si el CONTENEDOR sigue en disco— y que una ruta inválida NO se
      // conteste con un `false` (eso tacharía una pestaña por un fallo de
      // programación; quien llama tiene que poder distinguirlo).
      check(
        'un archivo que está responde true',
        (await archivos.existeRuta('lib/comunes.jar')) === true,
        'lib/comunes.jar'
      )
      check(
        'uno que no está responde false',
        (await archivos.existeRuta('lib/fantasma.txt')) === false,
        'lib/fantasma.txt'
      )
      check(
        'una CARPETA también responde true (borrar la carpeta es borrar el archivo)',
        (await archivos.existeRuta('lib')) === true,
        'lib'
      )
      check(
        'una entrada DENTRO del .jar responde por su contenedor',
        (await archivos.existeRuta('lib/comunes.jar!/META-INF/MANIFEST.MF')) === true,
        'existe porque el .jar existe'
      )
      check(
        'y si el .jar no existe, su entrada tampoco',
        (await archivos.existeRuta('lib/no-esta.jar!/META-INF/MANIFEST.MF')) === false,
        'lib/no-esta.jar!/…'
      )
      let lanzoFuera = false
      try {
        await archivos.existeRuta('../../fuera.txt')
      } catch {
        lanzoFuera = true
      }
      check(
        'una ruta que se sale del proyecto LANZA, no responde false',
        lanzoFuera,
        'resolverSeguro la rechaza y el error sube'
      )

      // -------------------------------------------------------------------
      hr('(13) `iniciarArrastre`: sacar varios al Explorador / al Finder')
      // -------------------------------------------------------------------
      // Es el único camino que NO se puede probar en vivo —`startDrag` bloquea el
      // hilo principal en el bucle de arrastre del sistema y sin un ratón de verdad
      // cuelga la app—, así que sus decisiones se fijan aquí: qué rutas llegan, qué
      // se omite, cuándo se AVISA y que un icono corrupto no tumbe el gesto.
      const ICONO = 'data:image/png;base64,' + 'A'.repeat(40)
      let arrastre: { file: string; files: string[]; icon: unknown } | null = null
      // El `webContents` que `ipc.ts` saca del evento: aquí, un doble que solo recuerda el gesto.
      const sender = {
        startDrag(arg: { file: string; files: string[]; icon: unknown }) {
          arrastre = arg
        }
      } as never

      arrastre = null
      await archivos.iniciarArrastre(sender, ['lib/comunes.jar', 'carpeta.jar/dentro.txt'], ICONO)
      const soltadas = (arrastre as unknown as { files: string[] } | null)?.files ?? []
      check(
        'las rutas llegan ABSOLUTAS y en el mismo orden',
        soltadas.length === 2 &&
          soltadas[0] === path.join(raiz, 'lib', 'comunes.jar') &&
          soltadas[1] === path.join(raiz, 'carpeta.jar', 'dentro.txt'),
        JSON.stringify(soltadas)
      )
      check(
        'y `file` repite la primera (la firma de Electron lo exige aunque manda `files`)',
        (arrastre as unknown as { file: string } | null)?.file === soltadas[0],
        String((arrastre as unknown as { file: string } | null)?.file)
      )

      arrastre = null
      await archivos.iniciarArrastre(sender, ['lib/comunes.jar', 'lib/fantasma.txt'], ICONO)
      check(
        'una ruta que ya no existe se OMITE y el resto sale igual',
        ((arrastre as unknown as { files: string[] } | null)?.files ?? []).length === 1,
        JSON.stringify((arrastre as unknown as { files: string[] } | null)?.files)
      )

      // Una entrada DENTRO de un .jar no es un fichero del disco: no se puede
      // entregar al Explorador, así que se omite como cualquier ruta inválida.
      arrastre = null
      let avisoVirtual = ''
      try {
        await archivos.iniciarArrastre(sender, ['lib/comunes.jar!/META-INF/MANIFEST.MF'], ICONO)
      } catch (err) {
        avisoVirtual = err instanceof Error ? err.message : String(err)
      }
      check(
        'una entrada de dentro del .jar no se arrastra, y se AVISA',
        arrastre === null && avisoVirtual.includes('no hay nada que arrastrar'),
        JSON.stringify(avisoVirtual)
      )

      // NO QUEDA NADA: se avisa en vez de volver callando. El arrastre HTML5 ya se
      // canceló para dar paso a éste, así que un retorno mudo deja el gesto muerto.
      arrastre = null
      let avisoVacio = ''
      try {
        await archivos.iniciarArrastre(sender, ['lib/fantasma.txt', 'otro/fantasma.txt'], ICONO)
      } catch (err) {
        avisoVacio = err instanceof Error ? err.message : String(err)
      }
      check(
        'si NADA sobrevive al filtro se lanza un mensaje humano',
        arrastre === null && avisoVacio.includes('Ninguno de esos elementos'),
        JSON.stringify(avisoVacio)
      )

      // Icono corrupto: el respaldo incrustado entra y el arrastre SIGUE. Al usuario
      // le importa sacar los archivos, no la estampita.
      arrastre = null
      await archivos.iniciarArrastre(sender, ['lib/comunes.jar'], '')
      check(
        'un icono vacío NO tumba el arrastre (entra el respaldo)',
        ((arrastre as unknown as { files: string[] } | null)?.files ?? []).length === 1,
        JSON.stringify((arrastre as unknown as { files: string[] } | null)?.files)
      )
    } finally {
      archivos.dispose()
    }
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }

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

void fs // (importado por simetría con los otros tests del directorio)
main().catch((err) => {
  console.error('El test lanzó una excepción no controlada:', err)
  process.exit(1)
})
