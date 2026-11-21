#!/usr/bin/env node
// =============================================================================
// Guardia de REGISTRO (npm run test:registro [-- rutas]): tratamiento formal en `crearTextos(es, en)`
// y convenciones de los catálogos de interfaz: vocabulario, glosario, comillas, plurales, contracciones
// y mayúsculas. Distingue los idiomas por su argumento; no analiza comentarios ni salida de tdb.
// Depende de `comun.mts`; el criterio está en docs/decisiones/app/redaccion.md.
// =============================================================================
import ts from 'typescript'
import { archivosDelAmbito, cerrar, check, hr, informar, leer, leerArgumentos } from './comun.mts'
import type { Hallazgo } from './comun.mts'

const TUTEO =
  /(?<![\p{L}\p{N}_-])(tú|tu|tus|tuyo|tuya|tuyos|tuyas|tienes|puedes|quieres|necesitas|debes|sabes|usas|estás|abriste|cerraste|pusiste|elegiste|hiciste|cancelaste|asegúrate|inténtalo|actívalo|ciérralo|ábrelo|elimínala|elimínalo|revísalo|recuérdalo)(?![\p{L}\p{N}_-])/iu

/** Siglas y palabras reservadas que la interfaz necesita mostrar literalmente. */
const SIGLAS = new Set(['JSON', 'JSONL', 'HTML', 'HTTP', 'HTTPS', 'SFTP', 'TCPS', 'UUID', 'UTF', 'ASCII', 'BOM', 'CRLF', 'PATH', 'USER', 'HOME', 'WSL', 'VERSION', 'HEAD', 'NULL', 'WHERE', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'BEGIN', 'ALTER', 'CREATE', 'TABLE', 'SESSION', 'LREM', 'INTO', 'FROM', 'VALUES', 'LIMIT', 'ORDER', 'GROUP', 'SCARD', 'SSCAN', 'ZSCAN', 'HSCAN', 'SCAN', 'ZRANGE', 'TYPE', 'DUMP', 'RESTORE', 'PEXPIRE', 'PERSIST', 'RENAME', 'EXPLAIN', 'ANALYZE', 'REDIS', 'CLUSTER', 'SENTINEL', 'AUTH', 'PING', 'PONG', 'INFO', 'CLIENT', 'CONFIG', 'AGENTS', 'CLAUDE', 'MCP', 'PKCS', 'JDBC', 'ODBC', 'DSN', 'TNS', 'ORACLE', 'OCI', 'OPENSSH', 'SOCKS', 'CERT', 'PEM', 'RSA', 'ECDSA', 'ED25519', 'SHA256', 'HMAC', 'AES', 'GCM', 'PBKDF', 'SQL', 'XML', 'YAML', 'CSV', 'TSV', 'JVM', 'JAR', 'ZIP', 'UTF8', 'UTF16'])

// Comandos, formatos y nombres de entornos que deben conservar su escritura técnica.
for (const palabra of 'GNOME UNIQUE WITH ENCRYPTION VIEW DEFINITION CHECK GENERATED ALWAYS LONG BFILE IDENTITY SHOWPLAN USAGE ROWNUM ROWID SHARE AAAA YYYY SAME SQLEXPRESS USERPROFILE WITHOUT MULTI GETRANGE DECLARE DEFAULT NTLM REQUIRED PREFERRED DISABLED EMPRESA COMPANY VENTAS SALES PRAGMA RESET CONVERT FORMAT SUBSTRING CAST IGNORE USING SHOW MERGE'.split(' ')) SIGLAS.add(palabra)

function reglasRedaccion(idioma: 'es' | 'en'): [string, RegExp][] {
  return [
    ['plural-parentesis', /\((?:s|es)\)/u],
    ['comillas-tipograficas', /[«»“”‘]|(?<![\p{L}\p{N}]|\$\{…\})’/u],
    ...(idioma === 'es' ? [
      ['vocabulario', /\ba la vez\b|\barranca(?:r|n)?\b|\bcorre\b|\bno se toca(?:n)?\b|\bpulse\s+"|\bPulse Refrescar\b/iu],
      ['glosario', /\bagentes? manual(?:es)?\b|\bcuentas? aisladas?\b|\bPlegar\b|\bRecargar\b|\bPreferencias\b|\bAgregar\b|\bagente de datos\b/iu]
    ] as [string, RegExp][] : [
      ['contraccion', /\b\p{L}+n[’']t\b/iu],
      ['glosario', /\bmanual[- ]agents?\b|\bisolated accounts?\b|\bdata agents?\b/iu]
    ] as [string, RegExp][])
  ]
}

/** Un objeto de idioma de la llamada, o la `const` del archivo que lo declara. */
function bloqueEspanol(sf: ts.SourceFile, llamada: ts.CallExpression, indice = 0): ts.Node | null {
  const arg = llamada.arguments[indice]
  if (!arg || !ts.isIdentifier(arg)) return arg ?? null
  let hallado: ts.Node | null = null
  const buscar = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text && n.initializer) hallado = n.initializer
    ts.forEachChild(n, buscar)
  }
  buscar(sf)
  return hallado
}

/** Los incumplimientos del registro y la redacción, con la ubicación del texto. */
export function analizarRegistro(archivo: string, texto: string): Hallazgo[] {
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hallazgos: Hallazgo[] = []
  const mirar = (n: ts.Node, idioma: 'es' | 'en'): void => {
    // Estos bloques alimentan stderr de tdb; su contrato de terminal queda fuera de la interfaz.
    if (archivo === 'src/main/db/textosDb.ts' && ts.isPropertyAssignment(n) && /^(tdb|puente)$/.test(n.name.getText(sf))) return
    const literal =
      ts.isTemplateExpression(n) ? n.head.text + n.templateSpans.map((s) => '${…}' + s.literal.text).join('') :
        ts.isStringLiteralLike(n) ? n.text : null
    const forma = literal === null || idioma !== 'es' ? null : TUTEO.exec(literal)
    if (forma) {
      hallazgos.push({
        archivo,
        linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        clase: 'tuteo',
        detalle: `«${forma[0]}» en «${(literal ?? '').slice(0, 70)}»`
      })
    }
    if (literal !== null && (/\/textos[^/]*\.ts$/.test(archivo) || archivo.endsWith('/erroresDocker.ts'))) {
      for (const [clase, patron] of reglasRedaccion(idioma)) {
        // Las comillas de una orden son sintaxis; no se sustituyen por comillas tipográficas.
        const coincidencia = patron.exec(literal)
        if (coincidencia) hallazgos.push({ archivo, linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, clase, detalle: `«${coincidencia[0]}» en «${literal.slice(0, 90)}»` })
      }
      for (const palabra of literal.matchAll(/(?<![\p{L}\p{N}_])[\p{Lu}]{4,}(?![\p{L}\p{N}_])/gu)) {
        if (!SIGLAS.has(palabra[0])) hallazgos.push({ archivo, linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, clase: 'mayusculas', detalle: palabra[0] })
      }
    }
    ts.forEachChild(n, (hijo) => {
      if (ts.isPropertyAssignment(n) && hijo === n.name) return
      mirar(hijo, idioma)
    })
  }
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'crearTextos') {
      const es = bloqueEspanol(sf, n)
      if (es) mirar(es, 'es')
      const en = bloqueEspanol(sf, n, 1)
      if (en) mirar(en, 'en')
    }
    ts.forEachChild(n, visitar)
  }
  visitar(sf)
  return hallazgos
}

function autoprueba(): void {
  const casos: [string, string, number][] = [
    ['tuteo en un literal', "crearTextos({ a: 'Si tienes dudas' }, { a: 'x' })", 1],
    ['posesivo en una función', 'crearTextos({ a: (x: string) => `En tu equipo ${x}` }, { a: () => "x" })', 1],
    ['bloque por nombre', "const es = { a: 'Lo que puedes hacer' }; crearTextos(es, en)", 1],
    ['usted', "crearTextos({ a: 'Si tiene dudas, puede consultar su equipo' }, { a: 'x' })", 0],
    ['tercera persona', "crearTextos({ a: 'Tessera elige y pulsa' }, { a: 'x' })", 0],
    ['el inglés no se mira', "crearTextos({ a: 'x' }, { a: 'tu tienes' })", 0],
    ['fuera de crearTextos', "const a = 'instrucción: si tienes dudas'", 0],
    ['dentro de un identificador', "crearTextos({ a: 'sistema.tu-equipo tuEquipo' }, { a: 'x' })", 0]
  ]
  for (const [nombre, codigo, esperado] of casos) {
    const n = analizarRegistro('x.ts', codigo).length
    check(`autoprueba: ${nombre}`, n === esperado, `esperado ${esperado}, obtenido ${n}`)
  }
  const redaccion: [string, string, number][] = [
    ['vocabulario', "crearTextos({a: 'Arrancar a la vez'}, {a: 'Start'})", 1],
    ['sinónimo', "crearTextos({a: 'Agente manual'}, {a: 'Custom agent'})", 1],
    ['comillas angulares en español', `crearTextos({a: 'Haga clic en «Guardar»'}, {a: 'Click "Save"'})`, 1],
    ['comillas tipográficas en inglés', `crearTextos({a: 'Haga clic en "Guardar"'}, {a: 'Click “Save”'})`, 1],
    ['comillas simples tipográficas', `crearTextos({a: 'Haga clic en "Guardar"'}, {a: 'Click "Save ‘as’"'})`, 1],
    ['comillas rectas y cita interior', `crearTextos({a: \`Haga clic en "Guardar 'como'"\`}, {a: \`Click "Save 'as'"\`})`, 0],
    ['apóstrofo dentro de una palabra', `crearTextos({a: 'El archivo'}, {a: 'The file’s name'})`, 0],
    ['plural', "crearTextos({a: 'archivo(s)'}, {a: 'files'})", 1],
    ['contracción curva', `crearTextos({a: 'No se puede'}, {a: 'It doesn’t work'})`, 1],
    ['contracción recta', `crearTextos({a: 'No se puede'}, {a: "It doesn't work"})`, 1],
    ['mayúsculas', "crearTextos({a: 'PELIGRO'}, {a: 'Warning'})", 1],
    ['siglas', "crearTextos({a: 'JSON y COMMIT'}, {a: 'JSON and COMMIT'})", 0],
    ['bloques por nombre', "const es = {a: 'Añadir'}; const en = {a: 'Don’t add'}; crearTextos(es, en)", 1],
    ['comentarios', "// Agente manual\ncrearTextos({a: 'Agente propio'}, {a: 'Custom agent'})", 0],
    ['carácter literal', `crearTextos({a: 'Carácter prohibido: "'}, {a: 'Invalid character'})`, 0],
    ['terminal ajena', "const a = 'archivo(s)'", 0]
  ]
  for (const [nombre, codigo, esperado] of redaccion) {
    const hallados = analizarRegistro('src/shared/textosPrueba.ts', codigo)
    check(`autoprueba de redacción: ${nombre}`, hallados.length === esperado && hallados.every((h) => h.linea > 0), `esperado ${esperado}, obtenido ${hallados.length}`)
  }
  for (const texto of ['a la vez', 'arranca', 'arrancar', 'el proceso corre ahora', 'no se toca', 'pulse "Reintentar"', 'Pulse Refrescar', 'agente manual', 'cuenta aislada', 'Plegar', 'Recargar', 'Preferencias', 'Agregar', 'agente de datos']) {
    const hallados = analizarRegistro('src/shared/textosPrueba.ts', `crearTextos({a: ${JSON.stringify(texto)}}, {a: 'Text'})`)
    check(`autoprueba de término: ${texto}`, hallados.length === 1 && hallados[0].archivo === 'src/shared/textosPrueba.ts' && hallados[0].linea === 1)
  }
  const plantilla = 'crearTextos({a: (x: string) => `Haga clic en "${x}"`}, {a: (x: string) => `Click "${x}"`})'
  check('autoprueba: comillas rectas alrededor de una interpolación', analizarRegistro('src/shared/textosPrueba.ts', plantilla).length === 0)
  check('autoprueba: comillas tipográficas alrededor de una interpolación', analizarRegistro('src/shared/textosPrueba.ts', plantilla.replace('"${x}"', '«${x}»')).some((h) => h.clase === 'comillas-tipograficas'))
  check('autoprueba: apóstrofo posesivo después de una interpolación', analizarRegistro('src/shared/textosPrueba.ts', 'crearTextos({a: "Interrumpir"}, {a: (x: string) => `Interrupt ${x}’s turn?`})').length === 0)
}

const op = leerArgumentos(process.argv.slice(2))
autoprueba()
const archivos = archivosDelAmbito(/\.tsx?$/, op.rutas).filter((f) => f.startsWith('src/') && !/\/test-[^/]+$/.test(f))
const hallazgos = archivos.flatMap((a) => analizarRegistro(a, leer(a)))
hr(`Registro formal: ${archivos.length} archivo(s) revisado(s)`)
informar(hallazgos, op)
cerrar('registro', archivos.length, hallazgos, op)
