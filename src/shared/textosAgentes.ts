// =============================================================================
// Textos de la validación de los agentes manuales y de la fuente de su contexto: los errores que
// llegan al modal y al pie del agente. Español e inglés juntos; se leen al usarse. Solo depende de
// i18n (lo usan el main, el renderer y los `test-*.mts`).
// =============================================================================
import { crearTextos } from './i18n.ts'

/** Los tres campos de una línea de la definición de un agente manual. */
type CampoLinea = { falta: string; pasaDe: (max: number) => string; unaLinea: string }

export const txAgentesManuales = crearTextos(
  {
    nombre: {
      falta: 'Falta el nombre.',
      pasaDe: (max: number) => `El nombre pasa de ${max} caracteres.`,
      unaLinea: 'El nombre tiene que ser una sola línea.'
    } as CampoLinea,
    comando: {
      falta: 'Falta el comando.',
      pasaDe: (max: number) => `El comando pasa de ${max} caracteres.`,
      unaLinea: 'El comando tiene que ser una sola línea.'
    } as CampoLinea,
    reanudar: {
      falta: 'Falta cómo reanudar.',
      pasaDe: (max: number) => `Cómo reanudar pasa de ${max} caracteres.`,
      unaLinea: 'Cómo reanudar tiene que ser una sola línea.'
    } as CampoLinea,
    instalacionSoloDocker: 'Las órdenes de instalación solo existen en Docker: en nativo el agente lo instalas tú.',
    instalacionLarga: (max: number) => `Las órdenes de instalación pasan de ${max} caracteres.`,
    instalacionControl: 'Las órdenes de instalación llevan caracteres que no son texto.',
    noEsObjeto: 'La definición no es un objeto.',
    idNoValido: 'El id del agente no es válido.',
    noEsJson: 'El texto pegado no es JSON.',
    noEsAgente: 'El JSON no es la definición de un agente de Tessera.',
    masNueva: 'Esta definición es de una Tessera más nueva: actualiza Tessera para pegarla.'
  },
  {
    nombre: {
      falta: 'The name is missing.',
      pasaDe: (max: number) => `The name is over ${max} characters.`,
      unaLinea: 'The name must be a single line.'
    },
    comando: {
      falta: 'The command is missing.',
      pasaDe: (max: number) => `The command is over ${max} characters.`,
      unaLinea: 'The command must be a single line.'
    },
    reanudar: {
      falta: 'How to resume is missing.',
      pasaDe: (max: number) => `How to resume is over ${max} characters.`,
      unaLinea: 'How to resume must be a single line.'
    },
    instalacionSoloDocker: 'Install commands only exist in Docker: in native mode you install the agent yourself.',
    instalacionLarga: (max: number) => `The install commands are over ${max} characters.`,
    instalacionControl: 'The install commands contain characters that are not text.',
    noEsObjeto: 'The definition is not an object.',
    idNoValido: 'The agent id is not valid.',
    noEsJson: 'The pasted text is not JSON.',
    noEsAgente: 'The JSON is not a Tessera agent definition.',
    masNueva: 'This definition is from a newer Tessera: update Tessera to paste it.'
  }
)

/** Lo que dice un error de la fuente del contexto según si es un comando o un archivo. */
type FuenteOrigen = { falta: string; pasaDe: (max: number) => string; unaLinea: string }
/** Un campo de la fuente (lo usado o el máximo). */
type CampoFuente = { falta: string; pasaDe: (max: number) => string; noValido: string }

export const txContextoAgente = crearTextos(
  {
    noEsObjeto: 'La fuente del contexto no es un objeto.',
    comandoOArchivo: 'La fuente del contexto es un comando o un archivo.',
    comando: {
      falta: 'Falta el comando del contexto.',
      pasaDe: (max: number) => `El comando del contexto pasa de ${max} caracteres.`,
      unaLinea: 'El comando del contexto tiene que ser una sola línea.'
    } as FuenteOrigen,
    archivo: {
      falta: 'Falta el archivo del contexto.',
      pasaDe: (max: number) => `El archivo del contexto pasa de ${max} caracteres.`,
      unaLinea: 'El archivo del contexto tiene que ser una sola línea.'
    } as FuenteOrigen,
    usadoNoNumero: 'Lo usado tiene que ser un campo del JSON, no un número.',
    usado: {
      falta: 'Falta El campo de lo usado.',
      pasaDe: (max: number) => `El campo de lo usado pasa de ${max} caracteres.`,
      noValido: 'El campo de lo usado no es un campo válido (p. ej. «context.used»).'
    } as CampoFuente,
    maximo: {
      falta: 'Falta El máximo.',
      pasaDe: (max: number) => `El máximo pasa de ${max} caracteres.`,
      noValido: 'El máximo no es un campo válido (p. ej. «context.used»).'
    } as CampoFuente,
    salidaSinNumeros: (usado: string) => `La salida no trae «${usado}» y el máximo como números.`,
    maximoCero: 'El máximo es 0.'
  },
  {
    noEsObjeto: 'The context source is not an object.',
    comandoOArchivo: 'The context source is a command or a file.',
    comando: {
      falta: 'The context command is missing.',
      pasaDe: (max: number) => `The context command is over ${max} characters.`,
      unaLinea: 'The context command must be a single line.'
    },
    archivo: {
      falta: 'The context file is missing.',
      pasaDe: (max: number) => `The context file is over ${max} characters.`,
      unaLinea: 'The context file must be a single line.'
    },
    usadoNoNumero: 'The used value must be a JSON field, not a number.',
    usado: {
      falta: 'The used-value field is missing.',
      pasaDe: (max: number) => `The used-value field is over ${max} characters.`,
      noValido: 'The used-value field is not a valid field (e.g. “context.used”).'
    },
    maximo: {
      falta: 'The maximum is missing.',
      pasaDe: (max: number) => `The maximum is over ${max} characters.`,
      noValido: 'The maximum is not a valid field (e.g. “context.used”).'
    },
    salidaSinNumeros: (usado: string) => `The output does not contain “${usado}” and the maximum as numbers.`,
    maximoCero: 'The maximum is 0.'
  }
)
