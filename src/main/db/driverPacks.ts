// =============================================================================
// Catálogo de drivers y matriz de interoperabilidad Oracle: es dato, añadir una versión de Instant Client es
// añadir una fila. Cada pack declara en qué plataformas existe y su centinela va por plataforma;
// `packsDePlataforma` es la única puerta y publica el pack ya resuelto, que también leen `tdb.cjs` y
// `oracle.cjs`. Un pack puede cubrir más de lo que Oracle soporta y lo dice (`soporteOracleDesde` + `aviso`).
// Decisiones: docs/decisiones/bd/drivers-catalogo-y-matriz-oracle.md
// =============================================================================
import type { DbMotor } from '../../shared/db-ipc'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Un cliente de base de datos descargable o registrable, tal como se declara en el catálogo. */
export interface DriverPackDef {
  id: string
  motor: DbMotor
  nombre: string
  sizeMB: number
  cubre: string
  /**
   * URL del paquete en el CDN de Oracle, o `null` si no hay descarga automática.
   *
   * Es `null` y no una URL rota a propósito: sin este campo la interfaz ofrecía un
   * botón "Descargar (42 MB)" que solo podía terminar en un 404, y prometer algo que
   * no puede pasar es peor que no ofrecerlo — el usuario lo intenta, falla, y no
   * tiene forma de saber si es su red, su VPN o la app. Con `null` se enseña el
   * porqué y queda solo la vía que sí funciona ("Seleccionar carpeta…").
   */
  url: string | null
  /**
   * Por qué no hay descarga automática, cuando `url` es null. Existe porque los
   * motivos pueden ser distintos (retirado del CDN no es lo mismo que publicado de
   * otra forma), y un único texto ("Oracle ya no lo publica") mentía en el segundo.
   */
  sinDescarga?: string
  /**
   * Cómo viene el paquete: `'zip'` (por defecto; se descomprime en memoria y se
   * aplana) o `'dmg'` (imagen de disco de macOS: se monta con hdiutil y se copia con
   * `cp -R -P -X`, que conserva los enlaces simbólicos; ver `instalarDmg.ts`). Ausente = zip,
   * para que los packs de Windows no cambien ni un byte.
   */
  formato?: 'zip' | 'dmg'
  /**
   * SHA-256 que Oracle PUBLICA junto a la descarga (en hexadecimal). Si está, lo
   * descargado se compara con él antes de tocarlo: un .dmg se monta, y montar bytes
   * que no son los de Oracle sería darle al parser de imágenes de disco un fichero de
   * cualquiera. Ausente en los zip de Windows, que se instalan como siempre.
   */
  sha256?: string
  /**
   * Firma de código que tienen que llevar los binarios copiados (solo Mac): el Team ID
   * de Oracle y los archivos que se comprueban con `codesign`. Es la segunda llave: la
   * huella fija los bytes del paquete; la firma demuestra que la copia conserva lo que
   * Oracle firmó y que un pack futuro con otra huella sigue siendo de Oracle.
   */
  firma?: { teamId: string; archivos: readonly string[] }
  /**
   * Archivos del paquete que NO forman parte del cliente y se borran tras copiarlo.
   * El .dmg de Oracle trae su `install_ic.sh` y su README de instalación, que el propio
   * guion de Oracle borra al copiar; aquí se hace lo mismo.
   */
  sobrantes?: readonly string[]
  /**
   * Versión MÍNIMA de macOS que exigen sus binarios (la del LC_BUILD_VERSION), si es
   * mayor que la de Tessera. En un sistema anterior el pack se lista sin descarga y
   * con el porqué, en vez de instalar algo que no va a cargar.
   */
  macosMinimo?: number
  /**
   * Versión de servidor desde la que ORACLE da soporte a este cliente, cuando el pack
   * cubre más que eso (`servidorDesde` menor). Por debajo, se avisa con `aviso`.
   */
  soporteOracleDesde?: number
  /** Aviso para el tramo `servidorDesde`–`soporteOracleDesde` (fuera del soporte de Oracle). */
  aviso?: string
  /** Nombre de carpeta que trae el paquete dentro (donde acaba el centinela). */
  carpetaInterna: string
  /** Plataformas donde este pack existe. Fuera de ellas no se ofrece ni se resuelve. */
  plataformas: readonly Plataforma[]
  /**
   * Archivo que DEBE existir para dar el pack por instalado, por plataforma. Nunca se
   * lee directamente: `packsDePlataforma` lo resuelve a string.
   */
  centinela: Partial<Record<Plataforma, string>>
  /**
   * Versiones de servidor que este pack alcanza, como [min, max] inclusivos en forma
   * numérica `mayor.menor` (11.2 -> 11.2). Se usa para elegir pack por versión.
   */
  servidorDesde: number
  servidorHasta: number
}

/**
 * Un pack visto DESDE una plataforma: el centinela ya es el nombre de archivo que
 * toca en ella. Es la forma que se publica en `catalogo.json` y la única que usan
 * `DriverManager`, `tdb` y `oracle.cjs`.
 */
export interface DriverPackResuelto extends Omit<DriverPackDef, 'centinela'> {
  centinela: string
}

/**
 * Packs conocidos. Solo Oracle: PostgreSQL va con `pg` (JS puro, empaquetado) y
 * habla con cualquier versión, así que no necesita driver externo jamás.
 *
 * El patrón de URL del CDN de Windows es `<VVVV000>/instantclient-basiclite-windows.x64-<V.VV>.0.0.0dbru.zip`,
 * con 7 dígitos en el directorio (1928000 = 19.28). Comprobado descargando la 19.28.
 *
 * ORACLE SOLO CONSERVA AHÍ LA RAMA 19 DE WINDOWS. Medido el 04-09-2026 con peticiones
 * reales: 19.28 y 19.18 responden 200, y 12.1, 12.2 y 18.5 responden 404 en todas las
 * variantes del patrón. No es un fallo de red ni una URL mal escrita: las versiones
 * anteriores se movieron al archivo histórico, que exige iniciar sesión y aceptar la
 * licencia en el navegador — o sea, imposible de automatizar. Por eso el pack 12.1
 * conserva su ficha (la matriz de interoperabilidad sigue siendo verdad y hay que
 * poder REGISTRAR uno que el usuario ya tenga) pero se queda sin descarga.
 *
 * Se elige **Basic Light** (~38 MB) y no el Basic completo (~250 MB) porque cubre
 * todos los juegos de caracteres habituales, incluido `WE8ISO8859P15`, que es el de
 * las bases Oracle con acentos (verificado con un round-trip de acentos).
 *
 * El pack de Mac, MEDIDO contra el CDN de Oracle (HEAD 200, sin
 * login ni licencia que aceptar): `…/mac/instantclient/2326200/instantclient-basiclite-
 * macos.arm64-23.26.2.0.0.dmg`, 66.228.928 bytes, SHA-256 el que publica la página de
 * descargas de macOS ARM64 (y el que dio el .dmg bajado). Por dentro: UDIF con una
 * partición APFS, SIN acuerdo de licencia en el recurso (hdiutil no pregunta nada), los
 * archivos del cliente en la RAÍZ del volumen (50 más `network/admin`, 121 MB) y
 * `libclntsh.dylib` como ENLACE SIMBÓLICO a `libclntsh.dylib.23.1`. Los Mach-O son arm64,
 * firmados con «Developer ID Application» de Oracle America (Team ID VB5E2TV963) y con
 * runtime endurecido; `libclntsh.dylib.23.1` carga sus dependencias por `@rpath` =
 * `@loader_path`, así que la carpeta es autocontenida y no hace falta DYLD_LIBRARY_PATH.
 * La licencia que trae (Oracle Free Distribution, Hosting, and Use Terms) permite
 * redistribuirlo sin modificar. `carpetaInterna` es la que deja el `install_ic.sh` de
 * esta versión, para que «Seleccionar carpeta…» acepte también su padre.
 */
export const DRIVER_PACKS: readonly DriverPackDef[] = [
  {
    id: 'oracle-ic-19',
    motor: 'oracle',
    nombre: 'Oracle Instant Client 19.28 (Basic Light)',
    sizeMB: 39,
    cubre: 'Oracle 11.2 y superior',
    url: 'https://download.oracle.com/otn_software/nt/instantclient/1928000/instantclient-basiclite-windows.x64-19.28.0.0.0dbru.zip',
    carpetaInterna: 'instantclient_19_28',
    plataformas: ['windows'],
    centinela: { windows: 'oci.dll' },
    servidorDesde: 11.2,
    servidorHasta: 99
  },
  {
    id: 'oracle-ic-12.1',
    motor: 'oracle',
    nombre: 'Oracle Instant Client 12.1 (Basic Light)',
    sizeMB: 42,
    cubre: 'Oracle 10.2 – 11.1 (más antiguas que las que alcanza el 19)',
    url: null,
    sinDescarga:
      'Oracle ya no publica Oracle Instant Client 12.1 (Basic Light) para descarga directa: ' +
      'solo queda en su archivo histórico, que exige iniciar sesión y aceptar la licencia ' +
      'en el navegador. Descárgalo a mano y usa "Seleccionar carpeta…".',
    carpetaInterna: 'instantclient_12_1',
    plataformas: ['windows'],
    centinela: { windows: 'oci.dll' },
    servidorDesde: 10.2,
    servidorHasta: 11.1
  },
  {
    // El id se CONSERVA aunque el pack cambie: está persistido en el `driverId` de las
    // conexiones y en `db-drivers.json` (los externos que el usuario registró).
    id: 'oracle-ic-23-macos-arm64',
    motor: 'oracle',
    nombre: 'Oracle Instant Client 23.26 (Basic Light)',
    sizeMB: 66,
    cubre: 'Oracle 11.2 y superior',
    url: 'https://download.oracle.com/otn_software/mac/instantclient/2326200/instantclient-basiclite-macos.arm64-23.26.2.0.0.dmg',
    formato: 'dmg',
    sha256: '54defa9e957da0aef6219965da3cb2d22ac19bfb20f168741b424c89e90d47ea',
    firma: {
      teamId: 'VB5E2TV963',
      // Lo que se CARGA: el centinela (enlace a libclntsh.dylib.23.1) y las dos
      // dependencias que ese binario pide por @rpath.
      archivos: ['libclntsh.dylib', 'libclntshcore.dylib', 'libnnz.dylib']
    },
    sobrantes: ['install_ic.sh', 'INSTALL_IC_README.txt'],
    macosMinimo: 13,
    soporteOracleDesde: 19,
    aviso: '11.2–18c están fuera del soporte de Oracle; probado.',
    carpetaInterna: 'instantclient_23_26',
    plataformas: ['mac'],
    centinela: { mac: 'libclntsh.dylib' },
    servidorDesde: 11.2,
    servidorHasta: 99
  }
]

/**
 * Los packs de una plataforma, con el centinela resuelto a string. Puro: la
 * plataforma entra por parámetro para que el test fije las dos desde cualquiera.
 * Un pack que se declara en una plataforma pero no trae centinela para ella se
 * omite: darlo por bueno sin saber qué archivo comprobar sería peor que no ofrecerlo.
 */
export function packsDePlataforma(plataforma: Plataforma): DriverPackResuelto[] {
  const out: DriverPackResuelto[] = []
  for (const pack of DRIVER_PACKS) {
    const centinela = pack.centinela[plataforma]
    if (!pack.plataformas.includes(plataforma) || !centinela) continue
    out.push({ ...pack, centinela })
  }
  return out
}

/** Pack por id, visto desde una plataforma. Un pack de otra plataforma no existe aquí. */
export function packById(
  id: string,
  plataforma: Plataforma = plataformaActual()
): DriverPackResuelto | undefined {
  return packsDePlataforma(plataforma).find((p) => p.id === id)
}

/**
 * Pack necesario para una versión de servidor Oracle en una plataforma.
 *
 * Devuelve null en dos casos, igual que el `packParaServidor` de `oracle.cjs` (que
 * es el que decide de verdad al escalar): cuando le basta el modo thin (12.1+, que
 * va empaquetado) y cuando la plataforma no tiene ningún pack que alcance esa
 * versión (10.2 en Mac). Quien llama sabe cuál es por la versión.
 *
 * Si la versión es desconocida o no cae en ningún rango, se devuelve el 19 si la
 * plataforma lo tiene y, si no, el primer pack Oracle de la plataforma: es
 * preferible ofrecer algo que probar a dejar al usuario en un callejón sin salida.
 * "Versión desconocida" NUNCA bloquea.
 */
export function packParaServidor(
  version: number | null,
  plataforma: Plataforma = plataformaActual()
): DriverPackResuelto | null {
  if (version !== null && version >= 12.1) return null // thin basta
  const oracle = packsDePlataforma(plataforma).filter((p) => p.motor === 'oracle') // motor-fijo: packs de Oracle (función solo de Oracle)
  const porDefecto = oracle.find((p) => p.id === 'oracle-ic-19') ?? null
  if (version === null) return porDefecto ?? oracle[0] ?? null
  const exacto = oracle.find((p) => version >= p.servidorDesde && version <= p.servidorHasta)
  return exacto ?? porDefecto
}

/**
 * El aviso de «fuera del soporte de Oracle» para un servidor de esta versión con este
 * pack, o null si no toca. Solo avisa con la versión CONOCIDA y por debajo de
 * `soporteOracleDesde`: con la versión desconocida (NJS-533, NJS-116) no se sabe, y
 * avisar de algo que probablemente no pasa enseña a ignorar los avisos. Tiene un
 * gemelo en `oracle.cjs` (`avisoDeSoporte`), que es el que habla en la escalada;
 * `test:driver-packs` cruza los dos con el catálogo publicado.
 */
export function avisoSoporte(
  pack: Pick<DriverPackDef, 'soporteOracleDesde' | 'aviso'> | null | undefined,
  version: number | null
): string | null {
  if (!pack || typeof pack.soporteOracleDesde !== 'number' || !pack.aviso) return null
  if (version === null || !Number.isFinite(version)) return null
  return version < pack.soporteOracleDesde ? pack.aviso : null
}

/**
 * Versión MAYOR de macOS a partir del `os.release()` de Darwin, o null si no se
 * reconoce. macOS 11–15 son Darwin 20–24 (+9 al revés), y desde que Apple saltó de la
 * 15 a la 26, la 26 es Darwin 25 (+1). Es el inverso de `darwinDeMacos` de
 * `scripts/sistemaMinimo.mjs`, que traduce en el otro sentido para el feed. Lo
 * anterior a Darwin 20 es macOS 10.x, y se da como 10.
 */
export function macosDeDarwin(release: string): number | null {
  const mayor = Number.parseInt(String(release).split('.')[0] ?? '', 10)
  if (!Number.isInteger(mayor) || mayor <= 0) return null
  if (mayor < 20) return 10
  if (mayor <= 24) return mayor - 9
  return mayor + 1
}

/** ¿Se puede DESCARGAR este pack en este sistema? Si no, el porqué, para la interfaz. */
export type Disponibilidad = { ok: true } | { ok: false; motivo: string }

/**
 * Si el pack se puede instalar en ESTE sistema. Puro: la plataforma y la versión del
 * sistema (`os.release()`) entran por parámetro. Hoy solo mira `macosMinimo`: en un
 * macOS anterior, dlopen rechazaría las dylibs, y descargar 66 MB para eso es peor que
 * decirlo antes. Una versión que no se sabe leer NO bloquea («versión desconocida
 * nunca bloquea», como en `packParaServidor`): el peor caso es el error de carga, que
 * ya se explica solo.
 *
 * El texto nombra macOS a pelo porque solo existe en packs de Mac (la regla de
 * `nombresSistema` es para frases que ven las dos plataformas).
 */
export function disponibilidadPack(
  pack: Pick<DriverPackDef, 'macosMinimo' | 'nombre'>,
  plataforma: Plataforma,
  releaseSistema: string
): Disponibilidad {
  if (plataforma === 'mac' && typeof pack.macosMinimo === 'number') {
    const macos = macosDeDarwin(releaseSistema)
    if (macos !== null && macos < pack.macosMinimo) {
      return {
        ok: false,
        motivo:
          `${pack.nombre} necesita macOS ${pack.macosMinimo} o posterior, y este Mac tiene ` +
          `macOS ${macos}: sus bibliotecas no cargarían. Con un cliente que sí funcione ` +
          'aquí, usa "Seleccionar carpeta…".'
      }
    }
  }
  return { ok: true }
}
