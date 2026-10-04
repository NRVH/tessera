#!/usr/bin/env node
// =============================================================================
// Prueba de la capa PURA del ciclo de actualización (npm run test:marcador-update): comparar
// versiones, sanear un marcador roto, decidir al arrancar y al cerrar, la cadencia, el texto
// del último chequeo y si de verdad SE PUEDE aplicar ahora mismo. Son las decisiones que, si
// se equivocan, se equivocan en silencio. Sin electron, fs ni red: los módulos de `update/`
// solo tienen `import type`, así que se importan con extensión explícita y sin resolver-hook.
// =============================================================================

import {
  MAX_INTENTOS_UPDATE,
  compararVersiones,
  decidirAlArrancar,
  decidirPlanDeCierre,
  esMarcadorSensato,
  estadoTrasCierreCancelado,
  marcadorConIntento,
  marcadorTrasFallo,
  nuevoMarcador,
  sanearMarcador,
  type MarcadorUpdate
} from './marcadorUpdatePuro.ts'
import {
  CADENCIA,
  PERIODOS_POR_DEFECTO,
  debeChequearAlRecuperarFoco,
  decidirProximoChequeo,
  periodosDeEntorno,
  type EntradaCadencia
} from './cadencia.ts'
import {
  decidirComoInstalar,
  type DecisionInstalar,
  type EntradaInstalar
} from './decisionInstalar.ts'
import { textoUltimoChequeo } from '../../renderer/src/features/actualizaciones/textoUpdate.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
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

const AHORA = new Date('2026-08-27T10:00:00.000Z')
const T0 = AHORA.getTime()

/** Marcador base sano: 0.31.0 -> 0.32.0, sin intentos. */
function base(over: Partial<MarcadorUpdate> = {}): MarcadorUpdate {
  return {
    ...nuevoMarcador({
      versionDestino: '0.32.0',
      versionOrigen: '0.31.0',
      rutaInstalador: 'C:\\tmp\\Tessera-0.32.0-Setup.exe',
      ahora: AHORA
    }),
    ...over
  }
}

function arranque(over: Partial<Parameters<typeof decidirAlArrancar>[0]> = {}): ReturnType<
  typeof decidirAlArrancar
> {
  return decidirAlArrancar({
    marcador: base(),
    versionActual: '0.31.0',
    vinoDeUnUpdate: false,
    instaladorPresente: true,
    maxIntentos: MAX_INTENTOS_UPDATE,
    ...over
  })
}

function cadencia(over: Partial<EntradaCadencia> = {}): ReturnType<typeof decidirProximoChequeo> {
  return decidirProximoChequeo({
    ahoraMs: T0,
    ultimoChequeoMs: T0 - 60_000,
    enfocada: true,
    suspendido: false,
    reintentoPendiente: false,
    estadoTerminal: false,
    ...over
  })
}

function cierre(
  over: Partial<Parameters<typeof decidirPlanDeCierre>[0]> = {}
): ReturnType<typeof decidirPlanDeCierre> {
  return decidirPlanDeCierre({
    status: 'ready',
    empaquetada: true,
    preferenciaAlCerrar: true,
    marcador: base(),
    maxIntentos: MAX_INTENTOS_UPDATE,
    ...over
  })
}

function main(): void {
  // =========================================================================
  hr('(A) compararVersiones')
  // =========================================================================
  check(
    '(A1) 0.31.0 < 0.32.0',
    compararVersiones('0.31.0', '0.32.0') === -1,
    String(compararVersiones('0.31.0', '0.32.0'))
  )
  // EL caso que rompe una comparación lexicográfica ingenua. Si esto falla, una
  // 0.10.0 se leería como MÁS VIEJA que la 0.9.0 y el update nunca se ofrecería.
  check(
    '(A2) 0.9.0 < 0.10.0 (no es comparación de cadenas)',
    compararVersiones('0.9.0', '0.10.0') === -1,
    String(compararVersiones('0.9.0', '0.10.0'))
  )
  check('(A3) iguales -> 0', compararVersiones('1.2.3', '1.2.3') === 0, 'ok')
  check(
    '(A4) 1.0 equivale a 1.0.0 (se rellena con ceros)',
    compararVersiones('1.0', '1.0.0') === 0,
    'ok'
  )
  check('(A5) la v inicial se ignora', compararVersiones('v1.2.3', '1.2.3') === 0, 'ok')
  check(
    '(A6) el prerelease se ignora (descarte consciente)',
    compararVersiones('1.2.3-beta', '1.2.3') === 0,
    'ok'
  )
  // No lanzar es un requisito duro: esto decide el camino de ARRANQUE.
  let lanzo = false
  let basura: number[] = []
  try {
    basura = [
      compararVersiones('', '1.0.0'),
      compararVersiones('abc', '1.0.0'),
      compararVersiones(null as unknown as string, undefined as unknown as string)
    ]
  } catch {
    lanzo = true
  }
  check(
    '(A7) basura -> 0.0.0 y NUNCA lanza',
    !lanzo && basura[0] === -1 && basura[1] === -1 && basura[2] === 0,
    JSON.stringify({ lanzo, basura })
  )
  const pares: [string, string][] = [
    ['0.1.0', '0.2.0'],
    ['2.0.0', '1.9.9'],
    ['1.2.3', '1.2.3'],
    ['0.10.0', '0.9.9']
  ]
  check(
    '(A8) simetría cmp(a,b) === -cmp(b,a)',
    pares.every(([a, b]) => compararVersiones(a, b) === -compararVersiones(b, a)),
    JSON.stringify(pares.map(([a, b]) => compararVersiones(a, b)))
  )

  // =========================================================================
  hr('(B) sanearMarcador: un archivo roto nunca tumba el arranque')
  // =========================================================================
  check(
    '(B1) no-objeto / null / array -> null',
    [null, 42, 'x', [], undefined].every((v) => sanearMarcador(v) === null),
    'ok'
  )
  check(
    '(B2) esquema futuro (version: 99) -> null',
    sanearMarcador({ ...base(), version: 99 }) === null,
    'un build viejo no adivina campos nuevos'
  )
  check(
    '(B3) faltan campos obligatorios -> null',
    sanearMarcador({ ...base(), rutaInstalador: '' }) === null &&
      sanearMarcador({ ...base(), versionDestino: undefined }) === null,
    'ok'
  )
  const intentosRaros = [
    sanearMarcador({ ...base(), intentos: -3 })?.intentos,
    sanearMarcador({ ...base(), intentos: 'dos' })?.intentos,
    sanearMarcador({ ...base(), intentos: 1e9 })?.intentos
  ]
  check(
    '(B4) intentos negativos / no numéricos / enormes se acotan',
    intentosRaros[0] === 0 && intentosRaros[1] === 0 && intentosRaros[2] === 99,
    JSON.stringify(intentosRaros)
  )
  check(
    '(B5) motor desconocido -> nsis',
    sanearMarcador({ ...base(), motor: 'brujeria' })?.motor === 'nsis',
    'ok'
  )
  // Un marcador escrito ANTES de que existiera 'relevo-mac' no lleva el campo (o lo
  // lleva vacío). Tiene que quedar en 'nsis', que es con lo que de verdad se preparó:
  // adivinar otra cosa sería inventarse el pasado de un archivo de gente real.
  const { motor: _sinMotor, ...viejo } = base()
  check(
    '(B5b) marcador viejo SIN campo motor -> nsis (sin migración)',
    sanearMarcador(viejo)?.motor === 'nsis' &&
      sanearMarcador({ ...base(), motor: '' })?.motor === 'nsis',
    'ok'
  )
  check(
    "(B5c) 'relevo-mac' y 'swap' SOBREVIVEN al saneo",
    sanearMarcador({ ...base(), motor: 'relevo-mac' })?.motor === 'relevo-mac' &&
      sanearMarcador({ ...base(), motor: 'swap' })?.motor === 'swap',
    'ok'
  )
  // El defecto de `nuevoMarcador` es el camino de Windows y NO puede moverse: si
  // cambiara, cada marcador de Windows empezaría a decir otra cosa sin que nadie lo
  // pidiera. Quien use otro motor lo dice (`atenderUpdateMac` pasa 'relevo-mac').
  const macNuevo = nuevoMarcador({
    versionDestino: '0.32.0',
    versionOrigen: '0.31.0',
    rutaInstalador: '/Users/x/Library/Application Support/Tessera/tessera-updater/pending/T.zip',
    ahora: AHORA,
    motor: 'relevo-mac'
  })
  check(
    "(B5d) nuevoMarcador: por defecto 'nsis', y 'relevo-mac' cuando se pide",
    base().motor === 'nsis' && macNuevo.motor === 'relevo-mac',
    `${base().motor} / ${macNuevo.motor}`
  )
  check(
    '(B5e) round-trip de un marcador de macOS por disco',
    sanearMarcador(JSON.parse(JSON.stringify(macNuevo)))?.motor === 'relevo-mac',
    'ok'
  )
  const conIntentoRoto = sanearMarcador({ ...base({ intentos: 1 }), intento: { n: 'x' } })
  check(
    '(B6) intento con forma rota -> null, y el resto del marcador SOBREVIVE',
    conIntentoRoto !== null && conIntentoRoto.intento === null && conIntentoRoto.intentos === 1,
    JSON.stringify(conIntentoRoto)
  )
  const sellado = marcadorConIntento(base(), {
    iniciadoEn: AHORA.toISOString(),
    origen: 'cierre',
    relanzar: false
  })
  const ida = sanearMarcador(JSON.parse(JSON.stringify(sellado)))
  check(
    '(B7) round-trip: sanear(JSON(m)) === m',
    JSON.stringify(ida) === JSON.stringify(sellado),
    JSON.stringify(ida)
  )
  check(
    '(B8) marcadorConIntento consume UN intento y lo numera',
    sellado.intentos === 1 && sellado.intento?.n === 1 && sellado.intento?.relanzar === false,
    JSON.stringify(sellado.intento)
  )
  const trasFallo = marcadorTrasFallo(sellado, true)
  check(
    '(B9) marcadorTrasFallo cierra el intento pero CONSERVA la cuenta',
    trasFallo.intento === null && trasFallo.intentos === 1 && trasFallo.bloqueado !== null,
    JSON.stringify(trasFallo)
  )
  check(
    '(B10) esMarcadorSensato exige destino > origen',
    esMarcadorSensato(base()) &&
      !esMarcadorSensato(base({ versionDestino: '0.30.0' })) &&
      !esMarcadorSensato(base({ versionDestino: '0.31.0' })),
    'ok'
  )

  // =========================================================================
  hr('(C) decidirAlArrancar: ¿se aplicó, falló, o sigue esperando?')
  // =========================================================================
  check('(C1) sin marcador -> ninguno', arranque({ marcador: null }).clase === 'ninguno', 'ok')

  // EL CASO DE APLICAR-AL-CERRAR. El instalador no relanza la app y por tanto no
  // pasa `--updated`; si la decisión dependiera de esa bandera, una actualización
  // aplicada se leería como "no ha pasado nada" y se reintentaría en bucle.
  const exito = arranque({ versionActual: '0.32.0', vinoDeUnUpdate: false })
  check(
    '(C2) corriendo la versión destino SIN --updated -> exito',
    exito.clase === 'exito' && exito.desde === '0.31.0' && exito.hasta === '0.32.0',
    JSON.stringify(exito)
  )
  check(
    '(C3) corriendo una versión AÚN MÁS nueva -> exito (marcador obsoleto)',
    arranque({ versionActual: '0.33.0' }).clase === 'exito',
    'ok'
  )

  // LA REGRESIÓN QUE SE PREVIENE: sin el guard de sensatez ANTES de comparar, un
  // marcador de downgrade saldría por el camino de éxito y pintaríamos
  // "¡Actualizada a 0.30.0!" sin que hubiera ocurrido nada.
  const downgrade = arranque({ marcador: base({ versionDestino: '0.30.0' }), versionActual: '0.31.0' })
  check(
    '(C4) marcador de DOWNGRADE -> ninguno, y NO exito',
    downgrade.clase === 'ninguno',
    JSON.stringify(downgrade)
  )

  const falloUno = arranque({
    marcador: base({ intentos: 1, intento: { n: 1, iniciadoEn: '', origen: 'cierre', relanzar: false } })
  })
  check(
    '(C5) intento sellado y seguimos en la vieja -> fallo, aún no agotado',
    falloUno.clase === 'fallo' && falloUno.intentos === 1 && falloUno.agotado === false,
    JSON.stringify(falloUno)
  )
  const falloDos = arranque({
    marcador: base({ intentos: 2, intento: { n: 2, iniciadoEn: '', origen: 'cierre', relanzar: false } })
  })
  check(
    '(C6) segundo intento fallido -> agotado',
    falloDos.clase === 'fallo' && falloDos.agotado === true,
    JSON.stringify(falloDos)
  )
  const bloqueado = arranque({ marcador: base({ bloqueado: 'agotados los intentos', intentos: 0 }) })
  check(
    '(C7) bloqueado -> fallo agotado, sin mirar los intentos',
    bloqueado.clase === 'fallo' && bloqueado.agotado === true,
    JSON.stringify(bloqueado)
  )
  // Sin intento previo, que el instalador ya no esté NO es un error: nada se rompió.
  check(
    '(C8) instalador borrado SIN intento -> ninguno (no es fallo)',
    arranque({ instaladorPresente: false }).clase === 'ninguno',
    'el próximo chequeo lo vuelve a bajar'
  )
  // Con intento previo, el borrado es una causa del fallo, no una excusa.
  check(
    '(C9) instalador borrado CON intento -> fallo',
    arranque({
      instaladorPresente: false,
      marcador: base({ intentos: 1, intento: { n: 1, iniciadoEn: '', origen: 'cierre', relanzar: false } })
    }).clase === 'fallo',
    'ok'
  )
  const listo = arranque()
  check(
    '(C10) preparado y sin intentos -> listo (no se re-descarga)',
    listo.clase === 'listo' && listo.marcador.versionDestino === '0.32.0',
    JSON.stringify(listo.clase)
  )
  check(
    '(C11) determinista: misma entrada, mismo resultado',
    JSON.stringify(arranque()) === JSON.stringify(arranque()),
    'no toca reloj ni disco'
  )

  // =========================================================================
  hr('(D) cadencia: cuándo toca la próxima comprobación')
  // =========================================================================
  const d1 = cadencia({ enfocada: true, ultimoChequeoMs: T0 - 4 * 60_000 })
  check(
    '(D1) enfocada + 4 min -> programar el minuto que falta',
    d1.accion === 'programar' && d1.enMs === 60_000,
    JSON.stringify(d1)
  )
  check(
    '(D2) enfocada + 6 min -> chequear',
    cadencia({ enfocada: true, ultimoChequeoMs: T0 - 6 * 60_000 }).accion === 'chequear',
    'ok'
  )
  const d3 = cadencia({ enfocada: false, ultimoChequeoMs: T0 - 6 * 60_000 })
  check(
    '(D3) en segundo plano + 6 min -> programar 24 min',
    d3.accion === 'programar' && d3.enMs === 24 * 60_000,
    JSON.stringify(d3)
  )
  // Las tres precedencias. Son lo que impide que la cadencia, el backoff y el
  // power-monitor lancen chequeos pisándose.
  check(
    '(D4) estado ocupado -> ninguna, AUNQUE haya pasado un día',
    cadencia({ estadoTerminal: true, ultimoChequeoMs: T0 - 86_400_000 }).accion === 'ninguna',
    'ok'
  )
  check('(D5) suspendido -> ninguna', cadencia({ suspendido: true }).accion === 'ninguna', 'ok')
  check(
    '(D6) reintento en cola -> ninguna (el backoff siempre gana)',
    cadencia({ reintentoPendiente: true, ultimoChequeoMs: T0 - 86_400_000 }).accion === 'ninguna',
    'ok'
  )
  const d7 = cadencia({ ultimoChequeoMs: null })
  check(
    '(D7) sin chequeo previo -> el retraso de cortesía del arranque',
    d7.accion === 'programar' && d7.enMs === CADENCIA.PRIMER_CHEQUEO_MS,
    JSON.stringify(d7)
  )
  // Un reloj que salta atrás daría transcurrido negativo: no debe producir un enMs
  // mayor que el periodo ni, peor, un chequeo en bucle.
  const d8 = cadencia({ ultimoChequeoMs: T0 + 999_999 })
  check(
    '(D8) reloj hacia atrás -> se espera el periodo entero, sin negativos',
    d8.accion === 'programar' && d8.enMs === CADENCIA.ENFOCADA_MS,
    JSON.stringify(d8)
  )
  const matriz = [true, false].flatMap((enfocada) =>
    [null, T0 - 1, T0 - 10 * 60_000, T0 + 5_000].map((u) =>
      cadencia({ enfocada, ultimoChequeoMs: u })
    )
  )
  check(
    '(D9) enMs nunca negativo ni NaN en toda la matriz',
    matriz.every((d) => d.accion !== 'programar' || (Number.isFinite(d.enMs) && d.enMs >= 0)),
    `${matriz.length} combinaciones`
  )

  const refoco = (ms: number | null, over: Partial<EntradaCadencia> = {}): boolean =>
    debeChequearAlRecuperarFoco({
      ahoraMs: T0,
      ultimoChequeoMs: ms,
      suspendido: false,
      reintentoPendiente: false,
      estadoTerminal: false,
      ...over
    })
  check('(D10) re-foco a los 90 s -> no', refoco(T0 - 90_000) === false, 'umbral 2 min')
  check('(D11) re-foco a los 150 s -> sí', refoco(T0 - 150_000) === true, 'ok')
  // Sin chequeo previo la respuesta es NO, y es lo que mantiene vivo el retraso de
  // cortesía del arranque: el primer `focus` llega a los milisegundos de crear la
  // ventana, así que un `true` aquí saltaba SIEMPRE los 8 s y metía una petición de
  // red en mitad del arranque.
  check('(D12) re-foco sin chequeo previo -> NO (manda el retraso de arranque)', refoco(null) === false, 'ok')
  check(
    '(D13) re-foco con algo ya descargado -> no',
    refoco(T0 - 86_400_000, { estadoTerminal: true }) === false,
    'ok'
  )

  // Los knobs del entorno. El de las pruebas de interfaz alarga el PRIMER chequeo más allá de
  // un spec: a los 8 s de fábrica el botón de la barra cambiaba de icono a mitad de la prueba.
  const sinKnobs = periodosDeEntorno({})
  check(
    '(D14) sin variables -> los periodos de fábrica',
    JSON.stringify(sinKnobs) === JSON.stringify(PERIODOS_POR_DEFECTO),
    JSON.stringify(sinKnobs)
  )
  const unDia = periodosDeEntorno({ TESSERA_PRIMER_CHEQUEO_MS: '86400000' })
  check(
    '(D15) TESSERA_PRIMER_CHEQUEO_MS alarga el primero y no toca los demás',
    unDia.primerChequeoMs === 86_400_000 && unDia.enfocadaMs === CADENCIA.ENFOCADA_MS && unDia.fondoMs === CADENCIA.FONDO_MS,
    JSON.stringify(unDia)
  )
  check(
    '(D16) NEGATIVO: por debajo del suelo de 5 s o no numérico -> el de fábrica',
    ['1000', 'nunca', '', '-5'].every((v) => periodosDeEntorno({ TESSERA_PRIMER_CHEQUEO_MS: v }).primerChequeoMs === CADENCIA.PRIMER_CHEQUEO_MS),
    'ok'
  )
  // Por encima de 2^31-1 Node sustituye el plazo por 1 ms: el «nunca» se convertiría en «ya».
  const enorme = periodosDeEntorno({ TESSERA_PRIMER_CHEQUEO_MS: '99999999999', TESSERA_CADENCIA_FONDO_MS: '1e12' })
  check(
    '(D17) un plazo mayor de lo que admite setTimeout se recorta a su techo, no se dispara al instante',
    enorme.primerChequeoMs === 2_147_483_647 && enorme.fondoMs === 2_147_483_647,
    JSON.stringify(enorme)
  )
  const d18 = cadencia({ ultimoChequeoMs: null, periodos: unDia })
  check('(D18) y la cadencia lo usa para el primer chequeo', d18.accion === 'programar' && d18.enMs === 86_400_000, JSON.stringify(d18))

  // =========================================================================
  hr('(E0) estadoTrasCierreCancelado: «Reiniciar para actualizar» y luego Cancelar')
  // =========================================================================
  // El diálogo de salida del explorador de BD se puede CANCELAR: si el estado se quedara
  // en 'installing', el siguiente cierre normal (E1: 'installing' = lo pidió una persona)
  // instalaría y relanzaría.
  check(
    "(E0a) 'installing' vuelve a 'ready' (el único estado desde el que se pudo pedir)",
    estadoTrasCierreCancelado('installing') === 'ready',
    String(estadoTrasCierreCancelado('installing'))
  )
  check(
    '(E0b) NEGATIVO: ningún otro estado lo toca un cierre cancelado',
    (['disabled', 'idle', 'checking', 'downloading', 'available', 'ready', 'error'] as const).every(
      (s) => estadoTrasCierreCancelado(s) === null
    ),
    'null en los siete'
  )
  {
    const tras = estadoTrasCierreCancelado('installing') ?? 'installing'
    const sinPreferencia = cierre({ status: tras, preferenciaAlCerrar: false })
    const conPreferencia = cierre({ status: tras, preferenciaAlCerrar: true })
    const atascado = cierre({ status: 'installing', preferenciaAlCerrar: false })
    check(
      "(E0c) tras volver a 'ready', el siguiente cierre normal respeta la preferencia (OFF: no instala; ON: instala SIN relanzar)",
      sinPreferencia.tipo !== 'instalar' && conPreferencia.tipo === 'instalar' && conPreferencia.relanzar === false,
      `${sinPreferencia.tipo} / ${conPreferencia.tipo}:${conPreferencia.tipo === 'instalar' ? String(conPreferencia.relanzar) : '-'}`
    )
    check(
      "(E0d) y el fallo que se evita: atascado en 'installing', ese cierre instalaba Y relanzaba con la preferencia apagada",
      atascado.tipo === 'instalar' && atascado.relanzar === true,
      `${atascado.tipo}:${atascado.tipo === 'instalar' ? String(atascado.relanzar) : '-'}`
    )
  }

  // =========================================================================
  hr('(E) decidirPlanDeCierre: relanzar o no relanzar')
  // =========================================================================
  const manual = cierre({ status: 'installing' })
  check(
    '(E1) el usuario pulsó instalar -> relanzar, origen manual',
    manual.tipo === 'instalar' && manual.relanzar === true && manual.origen === 'manual',
    JSON.stringify(manual)
  )
  const alCerrar = cierre()
  check(
    '(E2) preparada + preferencia ON -> instalar SIN relanzar',
    alCerrar.tipo === 'instalar' && alCerrar.relanzar === false && alCerrar.origen === 'cierre',
    JSON.stringify(alCerrar)
  )
  check(
    '(E3) preferencia OFF -> ninguno (cerrar es cerrar)',
    cierre({ preferenciaAlCerrar: false }).tipo === 'ninguno',
    'ok'
  )
  check(
    '(E4) sin marcador -> ninguno (sin contabilidad no hay automatismo)',
    cierre({ marcador: null }).tipo === 'ninguno',
    'ok'
  )
  check(
    '(E5) intentos agotados -> ninguno',
    cierre({ marcador: base({ intentos: MAX_INTENTOS_UPDATE }) }).tipo === 'ninguno',
    'guarda anti-bucle'
  )
  check(
    '(E6) bloqueado -> ninguno',
    cierre({ marcador: base({ bloqueado: 'agotados los intentos' }) }).tipo === 'ninguno',
    'ok'
  )
  check(
    '(E7) sin empaquetar -> ninguno SIEMPRE (la simulación de dev llega a ready)',
    cierre({ empaquetada: false }).tipo === 'ninguno' &&
      cierre({ empaquetada: false, status: 'installing' }).tipo === 'ninguno',
    'ok'
  )
  check(
    '(E8) estados no accionables -> ninguno',
    (['idle', 'checking', 'downloading', 'error', 'disabled'] as const).every(
      (s) => cierre({ status: s }).tipo === 'ninguno'
    ),
    'ok'
  )
  // INVARIANTE DURO sobre toda la matriz: cerrar la app NUNCA puede reabrirla.
  const matrizCierre = (['idle', 'checking', 'downloading', 'ready', 'installing', 'error'] as const)
    .flatMap((status) => [true, false].map((pref) => ({ status, pref })))
    .flatMap(({ status, pref }) =>
      [base(), base({ intentos: 2 }), null].map((m) =>
        cierre({ status, preferenciaAlCerrar: pref, marcador: m })
      )
    )
  check(
    '(E9) NUNCA relanzar: true con origen cierre',
    matrizCierre.every((p) => p.tipo === 'ninguno' || !(p.relanzar && p.origen === 'cierre')),
    `${matrizCierre.length} combinaciones`
  )

  // =========================================================================
  hr('(F) textoUltimoChequeo')
  // =========================================================================
  check('(F1) null -> aún no', textoUltimoChequeo(null, T0) === 'Aún no se ha comprobado', 'ok')
  check(
    '(F2) 30 s -> hace un momento',
    textoUltimoChequeo(T0 - 30_000, T0) === 'Comprobado hace un momento',
    'ok'
  )
  check('(F3) 5 min', textoUltimoChequeo(T0 - 5 * 60_000, T0) === 'Comprobado hace 5 min', 'ok')
  check('(F4) 3 h', textoUltimoChequeo(T0 - 3 * 3_600_000, T0) === 'Comprobado hace 3 h', 'ok')
  check('(F5) 2 d', textoUltimoChequeo(T0 - 2 * 86_400_000, T0) === 'Comprobado hace 2 d', 'ok')
  check(
    '(F6) reloj hacia atrás -> se acota, nunca "hace -4 min"',
    textoUltimoChequeo(T0 + 240_000, T0) === 'Comprobado hace un momento',
    'ok'
  )

  // =========================================================================
  hr('(G) decidirComoInstalar: ¿queremos? vs. ¿PODEMOS?')
  // =========================================================================
  const instalar = (over: Partial<EntradaInstalar> = {}): DecisionInstalar =>
    decidirComoInstalar({
      motorArmado: true,
      instaladorEnDisco: true,
      chequeoConcluido: true,
      ...over
    })
  /** El motivo, o '' si la decisión fue seguir adelante. */
  const motivoDe = (d: DecisionInstalar): string => (d.via === 'abortar' ? d.motivo : '')
  const bloqueaDe = (d: DecisionInstalar): boolean => d.via === 'abortar' && d.bloquear

  check(
    '(G1) motor armado + instalador en disco -> quitAndInstall',
    instalar().via === 'quitAndInstall',
    JSON.stringify(instalar())
  )

  // EL INCIDENTE, LITERAL: la actualización venía del marcador, nadie la ha
  // revalidado y `quitAndInstall` habría devuelto false sin lanzar nada, quemando
  // un intento. Lo que se fija es que NO se cede el control.
  const sinRevalidar = instalar({ motorArmado: false, chequeoConcluido: false })
  check(
    '(G2) preparada del arranque y sin revalidar -> abortar, y NO quitAndInstall',
    sinRevalidar.via === 'abortar' &&
      !bloqueaDe(sinRevalidar) &&
      motivoDe(sinRevalidar).includes('revalidad'),
    JSON.stringify(sinRevalidar)
  )

  const feedMudo = instalar({ motorArmado: false, chequeoConcluido: true })
  check(
    '(G3) chequeo hecho pero el feed no confirmó -> abortar sin bloquear, otro motivo',
    feedMudo.via === 'abortar' &&
      !bloqueaDe(feedMudo) &&
      motivoDe(feedMudo) !== motivoDe(sinRevalidar),
    JSON.stringify(feedMudo)
  )

  // Los dos abortos anteriores son TRANSITORIOS (falta tiempo, falta red) y por eso
  // no bloquean; este es determinista y sí, porque no se cura solo.
  const sinFichero = instalar({ instaladorEnDisco: false })
  check(
    '(G4) instalador borrado del disco -> abortar y BLOQUEAR',
    sinFichero.via === 'abortar' && bloqueaDe(sinFichero),
    JSON.stringify(sinFichero)
  )
  check(
    '(G5) sin fichero manda incluso con el motor armado',
    instalar({ instaladorEnDisco: false, motorArmado: true }).via === 'abortar',
    'el fichero es condición previa a todo'
  )
  // (G6) fue "el origen no decide si se PUEDE": afirmaba que un campo daba igual, o
  // sea que el campo sobraba. El repaso de código lo señaló y `origen` se retiró de
  // `EntradaInstalar`; con él se va su prueba. Lo que decide qué pasa DESPUÉS de un
  // aborto (plan B o salir) vive en `iniciarCierre` (`app/cierre.ts`), no aquí.
  check(
    '(G6) los dos motivos sin motor son distintos entre sí y ninguno bloquea',
    motivoDe(sinRevalidar) !== '' &&
      motivoDe(feedMudo) !== '' &&
      !bloqueaDe(sinRevalidar) &&
      !bloqueaDe(feedMudo),
    `${motivoDe(sinRevalidar)} | ${motivoDe(feedMudo)}`
  )

  // Las dos funciones responden preguntas DISTINTAS, y su combinación "sí quiero
  // pero no puedo" es un estado alcanzable y bien definido, no una contradicción.
  const quiere = cierre()
  const puede = instalar({ motorArmado: false, chequeoConcluido: false })
  check(
    '(G7) plan "instalar" + decisión "abortar" conviven sin contradecirse',
    quiere.tipo === 'instalar' && puede.via === 'abortar',
    `${quiere.tipo} / ${puede.via}`
  )

  // ---------------------------------------------------------------------------
  // Reporte final
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
