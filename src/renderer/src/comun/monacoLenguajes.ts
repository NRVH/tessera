// =============================================================================
// Lenguajes propios de Monaco (Monarch): `properties`, `groovy` y `mermaid`, más el refuerzo
// heurístico del resaltado de Java. `properties` y `mermaid` van sin estados (Monarch no hace pop
// al final de línea y un estado abierto tiñe lo que sigue); `groovy` los usa solo para lo que
// tiene cierre explícito (comentarios de bloque y strings). Depende de `monaco-editor`; lo llama
// `ensureMonaco` en `monacoSetup.ts`.
// Decisiones: docs/decisiones/renderer/monaco.md
// =============================================================================

import * as monaco from 'monaco-editor'

type ReglaMonarch = monaco.languages.IMonarchLanguageRule

/**
 * Reglas heurísticas que suben el resaltado de los lenguajes tipo C (Java/Groovy): un
 * identificador con mayúscula inicial es `type` y uno seguido de `(` es `function` (salvo
 * palabra clave). Son seguras de anteponer: ninguna palabra clave empieza por mayúscula y no
 * pueden robar el comienzo de un string, comentario o anotación.
 */
const TYPE_AND_METHOD_RULES = [
  [/[A-Z][\w$]*/, 'type'],
  [
    /[a-z_$][\w$]*(?=\s*\()/,
    { cases: { '@keywords': { token: 'keyword.$0' }, '@default': 'function' } }
  ]
] as ReglaMonarch[]

/**
 * Resaltado de Java con las reglas de tipos/métodos. Se registra como factory: las
 * basic-languages registran el suyo con `registerTokensProviderFactory` al importarse y el
 * último registro gana, así que este, que corre después, lo sustituye de forma determinista.
 * La configuración del lenguaje (brackets, comentarios) sigue por su canal aparte.
 */
export function boostJavaHighlighting(): void {
  monaco.languages.registerTokensProviderFactory('java', {
    create: async (): Promise<monaco.languages.IMonarchLanguage> => {
      const { language } = await import('monaco-editor/esm/vs/basic-languages/java/java.js')
      const root = (language.tokenizer.root as ReglaMonarch[]) ?? []
      return {
        ...language,
        tokenizer: { ...language.tokenizer, root: [...TYPE_AND_METHOD_RULES, ...root] }
      }
    }
  })
}

/**
 * Lenguaje `properties` (Java .properties y familia .env). Cada línea se resuelve con una regla
 * que la casa completa, con grupos clave / delimitador / valor, así una línea `KEY=` no deja
 * estado colgado. No soporta la continuación con `\` final: no se distingue de una ruta
 * `DIR=C:\tools\` sin estado. Con acciones de grupo, los grupos deben cubrir todo lo casado.
 */
export function registerPropertiesLanguage(): void {
  monaco.languages.register({ id: 'properties' })
  monaco.languages.setLanguageConfiguration('properties', {
    comments: { lineComment: '#' }
  })
  monaco.languages.setMonarchTokensProvider('properties', {
    tokenizer: {
      root: [
        // Comentario de línea completa (`#` o `!`), solo al principio (tras sangría).
        [/^[ \t]*[#!].*$/, 'comment'],
        // `clave = valor`: 4 grupos (sangría, clave, delimitador, valor) que cubren
        // toda la línea. El valor puede ser VACÍO sin dejar estado colgado.
        [
          /^([ \t]*)([^#!:=\s][^:=]*)([:=])(.*)$/,
          ['', 'key', 'delimiter', 'string']
        ],
        // Clave suelta sin delimitador (entrada de valor vacío, válida en .properties).
        [/^[ \t]*[^#!:=\s][^:=]*$/, 'key']
      ]
    }
  })
}

const GROOVY_KEYWORDS = [
  'abstract', 'as', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'def', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'in', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'threadsafe', 'throw', 'throws',
  'trait', 'transient', 'true', 'try', 'var', 'void', 'volatile', 'while'
]

const GROOVY_OPERATORS = [
  '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '++', '--',
  '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>', '+=', '-=', '*=', '/=',
  '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=', '?:', '?.', '<=>', '==~', '=~', '**'
]

/** Estados del tokenizer de Groovy que no son de cadenas: raíz, espacios y comentarios. */
function estadosBaseGroovy(): Record<string, ReglaMonarch[]> {
  return {
    root: [
      ...TYPE_AND_METHOD_RULES,
      [
        /[a-zA-Z_$][\w$]*/,
        { cases: { '@keywords': { token: 'keyword.$0' }, '@default': 'identifier' } }
      ],
      { include: '@whitespace' },
      [/@\s*[a-zA-Z_$][\w$]*/, 'annotation'],
      [/[{}()[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'delimiter', '@default': '' } }],
      [/\d+\.\d+([eE][-+]?\d+)?[fFdDgG]?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+[lLgG]?/, 'number.hex'],
      [/\d+[lLgGiI]?/, 'number'],
      [/[;,.]/, 'delimiter'],
      // Strings: triple comilla ANTES que la simple (el orden importa).
      [/"""/, 'string', '@tripleDouble'],
      [/'''/, 'string', '@tripleSingle'],
      [/"/, 'string', '@stringDouble'],
      [/'/, 'string', '@stringSingle']
    ],
    whitespace: [
      [/^#!.*$/, 'comment'], // shebang de un script Groovy
      [/[ \t\r\n]+/, ''],
      [/\/\*\*(?!\/)/, 'comment.doc', '@javadoc'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment']
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment']
    ],
    javadoc: [
      [/[^/*]+/, 'comment.doc'],
      [/\*\//, 'comment.doc', '@pop'],
      [/[/*]/, 'comment.doc']
    ]
  }
}

/** Estados del tokenizer de Groovy para las cadenas simples, dobles y de triple comilla. */
function estadosCadenasGroovy(): Record<string, ReglaMonarch[]> {
  return {
    stringDouble: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop']
    ],
    stringSingle: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop']
    ],
    tripleDouble: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/"""/, 'string', '@pop'],
      [/"/, 'string']
    ],
    tripleSingle: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/'''/, 'string', '@pop'],
      [/'/, 'string']
    ]
  }
}

/**
 * Lenguaje `groovy` propio (build.gradle, .groovy, Jenkinsfile): el tokenizer de `java` solo
 * admite literales de un carácter entre comillas simples y rompe un `'com.example:Lib:1.0'`
 * normal. Es conservador: sin «slashy strings» (ambiguas con la división) ni interpolación
 * `${…}`, el `$` queda como parte del string.
 */
export function registerGroovyLanguage(): void {
  monaco.languages.register({ id: 'groovy' })
  monaco.languages.setLanguageConfiguration('groovy', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  })
  monaco.languages.setMonarchTokensProvider('groovy', {
    keywords: GROOVY_KEYWORDS,
    operators: GROOVY_OPERATORS,
    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[abfnrtv\\"'$]|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,
    tokenizer: { ...estadosBaseGroovy(), ...estadosCadenasGroovy() }
  })
}

// Tipos de diagrama: la primera palabra del archivo, la que decide todo lo demás.
const MERMAID_DIAGRAMAS = [
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie', 'gitGraph',
  'mindmap', 'timeline', 'quadrantChart', 'requirementDiagram', 'C4Context',
  'C4Container', 'C4Component', 'C4Dynamic', 'sankey-beta', 'xychart-beta',
  'block-beta', 'packet-beta', 'architecture-beta', 'kanban', 'radar-beta'
]

// Estructura: lo que agrupa, nombra o reparte.
const MERMAID_KEYWORDS = [
  'subgraph', 'end', 'direction', 'title', 'accTitle', 'accDescr', 'section',
  'participant', 'actor', 'activate', 'deactivate', 'note', 'over', 'of', 'as',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'option',
  'break', 'autonumber', 'link', 'links', 'state', 'class', 'classDef',
  'callback', 'click', 'call', 'href', 'style', 'linkStyle', 'namespace',
  'requirement', 'element', 'commit', 'branch', 'checkout', 'merge',
  'dateFormat', 'axisFormat', 'excludes'
]

/**
 * Lenguaje `mermaid` propio (.mmd y .mermaid). Colorea lo que responde a «quién va con quién»:
 * los enlaces (`-->`, `==>`, `->>`…) de operador; el texto de nodo (`[ ]`, `( )`, `{ }`) y las
 * etiquetas de arista (`|así|`) de string; el tipo de diagrama y las palabras de estructura de
 * keyword; y las direcciones (`TD`, `LR`) de tipo. Sin estados: cada pareja es una regla que no
 * cruza de línea (`[^\]\n]*`) y con el cierre opcional, así un corchete a medio escribir colorea
 * hasta el fin de su línea. Un texto de nodo repartido en varias líneas pierde el color.
 */
export function registerMermaidLanguage(): void {
  monaco.languages.register({ id: 'mermaid', extensions: ['.mmd', '.mermaid'] })
  monaco.languages.setLanguageConfiguration('mermaid', {
    // El comentario de mermaid es `%%`. No tiene comentario de bloque.
    comments: { lineComment: '%%' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' }
    ]
  })
  monaco.languages.setMonarchTokensProvider('mermaid', {
    diagramas: MERMAID_DIAGRAMAS,
    keywords: MERMAID_KEYWORDS,
    direcciones: ['TB', 'TD', 'BT', 'RL', 'LR'],
    tokenizer: {
      root: [
        // Directiva `%%{init: {...} }%%`: configuración, no comentario. Va antes que el
        // comentario porque las dos empiezan por `%%`.
        [/%%\{.*$/, 'annotation'],
        [/%%.*$/, 'comment'],
        // Delimitador de frontmatter. Sin estado: solo se pinta la línea.
        [/^\s*---\s*$/, 'delimiter'],
        // Enlaces y flechas de todos los diagramas, pronto en la lista para que no se
        // confundan con guiones y signos sueltos.
        [/(-{2,}[>ox]|-{3,}|<?-{1,2}>{1,2}|={2,}[>ox]?|-\.{1,3}->?|\.{2,}>|<{2}-{1,2})/, 'operator'],
        // Texto de nodo y etiquetas: tres grupos que cubren todo lo casado (apertura,
        // contenido, cierre) y tres acciones, sin abrir ningún estado.
        [/(\[)([^\]\n]*)(\]?)/, ['@brackets', 'string', '@brackets']],
        [/(\{)([^}\n]*)(\}?)/, ['@brackets', 'string', '@brackets']],
        [/(\()([^)\n]*)(\)?)/, ['@brackets', 'string', '@brackets']],
        [/(\|)([^|\n]*)(\|?)/, ['string', 'string', 'string']],
        [/(")([^"\n]*)("?)/, ['string', 'string', 'string']],
        [/\d+/, 'number'],
        [
          /[A-Za-z_][\w-]*/,
          {
            cases: {
              '@diagramas': 'keyword',
              '@keywords': 'keyword',
              '@direcciones': 'type',
              '@default': 'identifier'
            }
          }
        ],
        [/[;,]/, 'delimiter'],
        [/[ \t\r\n]+/, '']
      ]
    }
  })
}
