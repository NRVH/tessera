#!/usr/bin/env node
// =============================================================================
// Prueba del ENRUTADO de contenedores en FileService (npm run test:jar-routing): un .jar se
// navega como una carpeta por los canales de siempre (también pelado, sin `!/`, y anidado dentro
// de un .war), las clases internas se pliegan, `readFile`/`readBinary` leen una entrada, y todo lo
// que ESCRIBE rechaza una ruta virtual con un mensaje humano; `reveal`/`openPath` colapsan al
// .jar, `absPath` da el localizador completo y una carpeta real "algo.jar" o "scripts!" sigue
// siendo carpeta. Fabrica el proyecto en os.tmpdir() con fflate; el escritorio es un objeto literal.
// =============================================================================

import { register } from 'node:module'
import { promises as fs, mkdtempSync, rmSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import type { EscritorioArchivos } from './adaptadores/escritorioElectron.ts'

// Reintento ".ts" para los imports extensionless de producción; `electron` no debe cargarse.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('FileService importó electron desde ' + ctx.parentURL)
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { FileService } = await import('./FileService.ts')
const { JarService } = await import('../java/JarService.ts')

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
  imagenDesdeDataUrl: (d) => ({ isEmpty: () => typeof d !== 'string' || d.length < 24 }) as never,
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

const MANIFEST = 'Manifest-Version: 1.0\r\nImplementation-Version: 2.4.1\r\n'
const PROPS = 'saludo=Configuración del año\n'

function fabricarJar(): Uint8Array {
  return zipSync({
    'META-INF/MANIFEST.MF': Buffer.from(MANIFEST),
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

    const files = new FileService({ projectRoot: raiz, escritorio, log: () => {} })
    files.setJarService(new JarService({ log: () => {} }))
    try {
      // -------------------------------------------------------------------
      hr('(0) El listado del DISCO marca los contenedores')
      // -------------------------------------------------------------------
      // Sin esta marca el árbol no pinta chevron y NADA de lo de abajo se llega a
      // usar nunca, aunque funcione. Se comprueba primero por eso: es el eslabón
      // que conecta el enrutado con la interfaz, y el que se olvidó al principio.
      const enLib = await files.listDir('lib')
      const elJar = enLib.find((e) => e.name === 'comunes.jar')
      check(
        'un .jar del disco llega con contenedor:"jar"',
        elJar?.contenedor === 'jar',
        `${elJar?.name}: kind=${elJar?.kind}, contenedor=${elJar?.contenedor ?? 'AUSENTE  <-- sin chevron en el árbol'}`
      )
      check(
        'y sigue siendo kind:"file" (conserva icono, letra de git, renombrar…)',
        elJar?.kind === 'file',
        `kind=${elJar?.kind}`
      )
      const raizProy = await files.listDir('')
      const carpetaJar = raizProy.find((e) => e.name === 'carpeta.jar')
      check(
        'una CARPETA llamada "carpeta.jar" NO se marca como contenedor',
        carpetaJar?.kind === 'dir' && carpetaJar?.contenedor === undefined,
        `kind=${carpetaJar?.kind}, contenedor=${carpetaJar?.contenedor ?? 'ausente'}`
      )
      const elWar = raizProy.find((e) => e.name === 'dist')
      check(
        'los .txt/.md de al lado no se marcan',
        enLib.filter((e) => e.contenedor != null).length === 1,
        `${enLib.filter((e) => e.contenedor != null).length} contenedor(es) en lib/`
      )
      void elWar

      // -------------------------------------------------------------------
      hr('(1) El .jar PELADO enruta al contenedor')
      // -------------------------------------------------------------------
      const raizJar = await files.listDir('lib/comunes.jar')
      check(
        'listDir("lib/comunes.jar") devuelve el contenido, no ENOTDIR',
        raizJar.length > 0,
        `${raizJar.length} entradas: ${raizJar.map((e) => e.name).join(', ')}`
      )
      check(
        'carpetas primero y alfabético, igual que en el disco',
        raizJar[0].kind === 'dir' && raizJar.map((e) => e.name).join(',') === 'com,META-INF',
        raizJar.map((e) => `${e.name}(${e.kind})`).join(' ')
      )
      check(
        'las rutas emitidas llevan el separador virtual',
        raizJar.every((e) => e.path.startsWith('lib/comunes.jar!/')),
        raizJar[0].path
      )

      // -------------------------------------------------------------------
      hr('(2) Navegación por niveles')
      // -------------------------------------------------------------------
      const nivelCom = await files.listDir('lib/comunes.jar!/com')
      check(
        'un nivel exacto (no vuelca el jar entero)',
        nivelCom.length === 1 && nivelCom[0].name === 'ejemplo' && nivelCom[0].kind === 'dir',
        nivelCom.map((e) => e.name).join(', ')
      )
      check(
        'la carpeta se sintetiza aunque el zip no traiga registro de directorio',
        nivelCom[0].path === 'lib/comunes.jar!/com/ejemplo',
        nivelCom[0].path
      )
      const nivelNota = await files.listDir('lib/comunes.jar!/com/ejemplo/comunes/nota')
      const nombresNota = nivelNota.map((e) => e.name)
      check(
        'nivel con archivos: tamaño incluido',
        nivelNota.every((e) => e.kind === 'file' && typeof e.tamano === 'number'),
        nivelNota.map((e) => `${e.name}:${e.tamano}B`).join(' ')
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
      hr('(4) readFile de una entrada de texto')
      // -------------------------------------------------------------------
      const manifest = await files.readFile('lib/comunes.jar!/META-INF/MANIFEST.MF')
      check(
        'el MANIFEST se lee entero',
        manifest.content === MANIFEST && !manifest.binary,
        JSON.stringify(manifest.content.slice(0, 40))
      )
      const props = await files.readFile('lib/comunes.jar!/com/ejemplo/comunes/nota/mensajes.properties')
      check(
        'un .properties latin1 se decodifica con acentos correctos',
        props.content.includes('Configuración del año'),
        `${props.encoding}: ${JSON.stringify(props.content.trim())}`
      )
      check(
        'el lenguaje sale del nombre de la ENTRADA, no de la ruta del contenedor',
        props.language === 'properties',
        props.language
      )
      const clase = await files.readFile('lib/comunes.jar!/com/ejemplo/comunes/nota/ElementoNota.class')
      check(
        'un .class se marca como binario (aún no hay descompilador)',
        clase.binary && clase.content === '',
        `binary=${clase.binary}`
      )

      // -------------------------------------------------------------------
      hr('(5) readBinary de una entrada')
      // -------------------------------------------------------------------
      const bin = await files.readBinary('lib/comunes.jar!/com/ejemplo/comunes/nota/ElementoNota.class')
      check(
        'devuelve los bytes exactos con su magic',
        bin.bytes.length === 8 &&
          Buffer.from(bin.bytes).readUInt32BE(0) === 0xcafebabe &&
          !bin.truncated,
        `${bin.bytes.length} B, magic=0x${Buffer.from(bin.bytes).readUInt32BE(0).toString(16)}`
      )

      // -------------------------------------------------------------------
      hr('(6) Todo lo que ESCRIBE rechaza una ruta virtual')
      // -------------------------------------------------------------------
      const dentro = 'lib/comunes.jar!/com/ejemplo/comunes/nota/ElementoNota.class'
      const carpetaDentro = 'lib/comunes.jar!/com'
      const mutadores: Array<[string, () => Promise<unknown>]> = [
        ['writeFile', () => files.writeFile(dentro, 'hola')],
        ['createEntry (archivo)', () => files.createEntry(carpetaDentro, 'nuevo.txt', 'file')],
        ['createEntry (carpeta)', () => files.createEntry(carpetaDentro, 'nueva', 'dir')],
        ['rename', () => files.rename(dentro, 'otro.class')],
        ['moveMany', () => files.moveMany([dentro], 'lib')],
        ['deleteMany', () => files.deleteMany([dentro])]
      ]
      for (const [nombre, fn] of mutadores) {
        const msg = await mensajeDe(fn)
        check(
          `${nombre} lanza, y con mensaje humano`,
          msg.includes('archivo comprimido') && !msg.includes('undefined'),
          msg || 'NO LANZÓ  <-- la guarda no cubre este camino'
        )
      }
      // readZip y readDocx estaban en la lista de arriba, y no debían: LEEN, no
      // escriben. Al no bifurcar para rutas virtuales caían en la guarda de escritura
      // y quien hacía doble clic en un .docx dentro de un .war recibía "no se puede
      // modificar desde aquí" por haber intentado MIRARLO.
      //
      // Aquí solo se comprueba que pasan de la guarda: el éxito completo necesita un
      // worker_threads (`__dirname`, que en este arnés de ESM no existe), así que se
      // afirma lo que sí se puede afirmar y no se finge lo demás.
      for (const [nombre, fn] of [
        ['readZip', () => files.readZip('lib/comunes.jar!/META-INF/MANIFEST.MF')],
        ['readDocx', () => files.readDocx('lib/comunes.jar!/META-INF/MANIFEST.MF')]
      ] as Array<[string, () => Promise<unknown>]>) {
        const msg = await mensajeDe(fn)
        check(
          `${nombre} NO responde con la guarda de escritura (es una lectura)`,
          !msg.includes('no se puede modificar'),
          msg || '(no lanzó)'
        )
      }

      // La forma DEGENERADA `x.jar!`: un `!` de corte sin su barra. Sale sola de
      // `parentDir('lib/comunes.jar!/A.class')`, que es el destino que se calcula al
      // soltar un fichero de Windows sobre una clase de la RAÍZ del jar. No contiene
      // `!/`, así que `esRutaVirtual` la daba por buena y se colaba por la guarda
      // hasta reventar con un ENOENT crudo.
      for (const [nombre, fn] of [
        ['createEntry', () => files.createEntry('lib/comunes.jar!', 'x.txt', 'file')],
        ['writeFile', () => files.writeFile('lib/comunes.jar!/x.txt'.replace('/x.txt', ''), 'h')],
        ['deleteMany', () => files.deleteMany(['lib/comunes.jar!'])]
      ] as Array<[string, () => Promise<unknown>]>) {
        const msg = await mensajeDe(fn)
        check(
          `${nombre} sobre la forma degenerada "x.jar!" da mensaje humano, no ENOENT`,
          msg.includes('archivo comprimido'),
          msg || 'NO LANZÓ  <-- se coló por la guarda'
        )
      }

      // El proyecto no se ensucia: nada de lo anterior creó una carpeta "comunes.jar!".
      const raizProyecto = await files.listDir('')
      check(
        'ningún mutador dejó basura en el proyecto',
        !raizProyecto.some((e) => e.name.includes('!')) ||
          raizProyecto.filter((e) => e.name.includes('!')).every((e) => e.name === 'scripts!'),
        raizProyecto.map((e) => e.name).join(', ')
      )

      // -------------------------------------------------------------------
      hr('(7) reveal y openPath COLAPSAN al contenedor')
      // -------------------------------------------------------------------
      await files.reveal(dentro)
      check(
        'reveal muestra el .jar en el Explorador, en vez de no hacer nada',
        revelado === path.join(raiz, 'lib', 'comunes.jar'),
        revelado
      )
      await files.openPath(dentro)
      check('openPath abre el .jar', abierto === path.join(raiz, 'lib', 'comunes.jar'), abierto)

      // -------------------------------------------------------------------
      hr('(8) absPath y fileUrl')
      // -------------------------------------------------------------------
      const abs = await files.absPath(dentro)
      check(
        'absPath da el localizador completo, no una ruta creíble pero falsa',
        abs === path.join(raiz, 'lib', 'comunes.jar') + '!/com/ejemplo/comunes/nota/ElementoNota.class',
        abs
      )
      const url = await files.fileUrl(dentro)
      check('fileUrl devuelve "" (no es descargable)', url === '', JSON.stringify(url))

      // -------------------------------------------------------------------
      hr('(9) DESEMPATE: una CARPETA real llamada "carpeta.jar"')
      // -------------------------------------------------------------------
      const comoCarpeta = await files.listDir('carpeta.jar')
      check(
        'se lista como la carpeta que es, no como contenedor',
        comoCarpeta.length === 1 && comoCarpeta[0].name === 'dentro.txt',
        comoCarpeta.map((e) => e.name).join(', ')
      )
      const dentroDeEsa = await files.readFile('carpeta.jar/dentro.txt')
      check(
        'y sus archivos se leen con normalidad',
        dentroDeEsa.content === 'soy una carpeta, no un jar',
        JSON.stringify(dentroDeEsa.content)
      )

      // -------------------------------------------------------------------
      hr('(10) Una carpeta real llamada "scripts!" sigue funcionando')
      // -------------------------------------------------------------------
      const enScripts = await files.listDir('scripts!')
      check(
        'listDir de una carpeta con "!" en el nombre',
        enScripts.length === 1 && enScripts[0].name === 'build.cmd',
        enScripts.map((e) => e.name).join(', ')
      )
      const leido = await files.readFile('scripts!/build.cmd')
      check('readFile dentro de ella', leido.content === 'echo hola', JSON.stringify(leido.content))
      const creado = await files.createEntry('scripts!', 'nuevo.txt', 'file')
      check('y SÍ se puede escribir (no es un contenedor)', creado.path === 'scripts!/nuevo.txt', creado.path)

      // -------------------------------------------------------------------
      hr('(11) Contenedor ANIDADO')
      // -------------------------------------------------------------------
      const enWar = await files.listDir('dist/app.war')
      check(
        'el .war se navega igual',
        enWar.length === 1 && enWar[0].name === 'WEB-INF',
        enWar.map((e) => e.name).join(', ')
      )
      const libDelWar = await files.listDir('dist/app.war!/WEB-INF/lib')
      check(
        'un .jar DENTRO del .war viene marcado como contenedor (se puede reexpandir)',
        libDelWar.length === 1 && libDelWar[0].contenedor === 'jar' && libDelWar[0].kind === 'file',
        `${libDelWar[0]?.name}: contenedor=${libDelWar[0]?.contenedor}, kind=${libDelWar[0]?.kind}`
      )
      // La fila de arriba lleva chevron, así que el árbol la despliega pidiendo la
      // ruta SIN `!/` final. Esa es la llamada que salía siempre vacía: el jar
      // anidado parsea como una ENTRADA del .war, no como raíz propia, y el filtro
      // por prefijo "WEB-INF/lib/comunes.jar/" no casaba con nada. Vacío y en
      // silencio, que es la peor forma de fallar cuando la fila prometía contenido.
      const raizAnidado = await files.listDir('dist/app.war!/WEB-INF/lib/comunes.jar')
      check(
        'desplegar el .jar anidado lista SU raíz (no sale vacío)',
        raizAnidado.length > 0 && raizAnidado.some((e) => e.name === 'com'),
        raizAnidado.map((e) => e.name).join(', ') || '(vacío)'
      )
      check(
        'y sus hijos cuelgan del localizador anidado, no del .war',
        raizAnidado.every((e) => e.path.startsWith('dist/app.war!/WEB-INF/lib/comunes.jar!/')),
        raizAnidado.map((e) => e.path).join(', ')
      )
      const dentroAnidado = await files.listDir('dist/app.war!/WEB-INF/lib/comunes.jar!/com/ejemplo/comunes/nota')
      check(
        'y se navega SIN extraer nada a disco',
        dentroAnidado.some((e) => e.name === 'ElementoNota.class'),
        dentroAnidado.map((e) => e.name).join(', ')
      )
      const manifestAnidado = await files.readFile(
        'dist/app.war!/WEB-INF/lib/comunes.jar!/META-INF/MANIFEST.MF'
      )
      check(
        'y su contenido se lee a dos niveles de profundidad',
        manifestAnidado.content === MANIFEST,
        JSON.stringify(manifestAnidado.content.slice(0, 30))
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
        (await files.existeRuta('lib/comunes.jar')) === true,
        'lib/comunes.jar'
      )
      check(
        'uno que no está responde false',
        (await files.existeRuta('lib/fantasma.txt')) === false,
        'lib/fantasma.txt'
      )
      check(
        'una CARPETA también responde true (borrar la carpeta es borrar el archivo)',
        (await files.existeRuta('lib')) === true,
        'lib'
      )
      check(
        'una entrada DENTRO del .jar responde por su contenedor',
        (await files.existeRuta('lib/comunes.jar!/META-INF/MANIFEST.MF')) === true,
        'existe porque el .jar existe'
      )
      check(
        'y si el .jar no existe, su entrada tampoco',
        (await files.existeRuta('lib/no-esta.jar!/META-INF/MANIFEST.MF')) === false,
        'lib/no-esta.jar!/…'
      )
      let lanzoFuera = false
      try {
        await files.existeRuta('../../fuera.txt')
      } catch {
        lanzoFuera = true
      }
      check(
        'una ruta que se sale del proyecto LANZA, no responde false',
        lanzoFuera,
        'resolveSafe la rechaza y el error sube'
      )

      // -------------------------------------------------------------------
      hr('(13) `startDrag`: sacar varios al Explorador / al Finder')
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
      await files.startDrag(sender, ['lib/comunes.jar', 'carpeta.jar/dentro.txt'], ICONO)
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
      await files.startDrag(sender, ['lib/comunes.jar', 'lib/fantasma.txt'], ICONO)
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
        await files.startDrag(sender, ['lib/comunes.jar!/META-INF/MANIFEST.MF'], ICONO)
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
        await files.startDrag(sender, ['lib/fantasma.txt', 'otro/fantasma.txt'], ICONO)
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
      await files.startDrag(sender, ['lib/comunes.jar'], '')
      check(
        'un icono vacío NO tumba el arrastre (entra el respaldo)',
        ((arrastre as unknown as { files: string[] } | null)?.files ?? []).length === 1,
        JSON.stringify((arrastre as unknown as { files: string[] } | null)?.files)
      )
    } finally {
      files.dispose()
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
