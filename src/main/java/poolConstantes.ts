// =============================================================================
// Las CADENAS de un .class, sin JVM y sin descompilar. Módulo PURO. Existe para buscar texto en
// clases compiladas: descompilar para saber si una clase menciona algo cuesta cientos de ms y
// cientos de MB por clase, y el pool de constantes da la misma respuesta en microsegundos, porque
// ahí el formato guarda en claro los nombres de clase, método y campo, los descriptores y los
// literales. No lee métodos, campos ni bytecode. Lo usa `search/barrido.ts`.
// =============================================================================

/** Todo .class empieza por esto. Si no, no es una clase. */
const MAGIC = 0xcafebabe

/**
 * Bytes FIJOS que ocupa el cuerpo de cada tag del pool (sin contar el byte del
 * tag). `Utf8` (1) es variable y se trata aparte; los tags que no existen paran el
 * recorrido, porque a partir de ahí ya no se sabe dónde empieza la entrada
 * siguiente y seguir sería inventar.
 *
 * 15 (MethodHandle), 16 (MethodType), 17 (Dynamic), 18 (InvokeDynamic),
 * 19 (Module) y 20 (Package) son de Java 7+; hace falta conocerlos aunque no se
 * usen, o una clase moderna cortaría el recorrido a la primera.
 */
const TAM_TAG: Readonly<Record<number, number>> = {
  3: 4, // Integer
  4: 4, // Float
  5: 8, // Long    (+ ocupa DOS ranuras)
  6: 8, // Double  (+ ocupa DOS ranuras)
  7: 2, // Class
  8: 2, // String
  9: 4, // Fieldref
  10: 4, // Methodref
  11: 4, // InterfaceMethodref
  12: 4, // NameAndType
  15: 3, // MethodHandle
  16: 2, // MethodType
  17: 4, // Dynamic
  18: 4, // InvokeDynamic
  19: 2, // Module
  20: 2 // Package
}

/** El tag de una cadena. */
const TAG_UTF8 = 1

/**
 * Tope de cadenas por clase. Una clase generada (un stub de JAXB, un mapper) puede
 * traer decenas de miles; a partir de cierto punto no aportan y sí cuestan.
 */
const MAX_CADENAS = 20_000

/** ¿Estos bytes empiezan como un .class? Barato: solo mira el magic. */
export function pareceClase(bytes: Buffer): boolean {
  return bytes.length >= 10 && bytes.readUInt32BE(0) === MAGIC
}

/**
 * Las cadenas (`CONSTANT_Utf8_info`) del pool de constantes de una clase, en el
 * orden en que aparecen. Devuelve `[]` —nunca lanza— si los bytes no son una
 * clase, están truncados o traen un tag desconocido: en un barrido de miles de
 * archivos, una clase rara es lo normal y no puede tumbar la búsqueda.
 *
 * NOTA SOBRE LA CODIFICACIÓN: el formato usa "modified UTF-8", que difiere del
 * UTF-8 real en dos cosas — el NUL va como C0 80, y los caracteres fuera del BMP
 * van como un par de subrogados codificados por separado. Se decodifica como UTF-8
 * normal a propósito: para identificadores Java y rutas de paquete (que es el
 * 99,9 % de lo que hay aquí, todo ASCII) el resultado es idéntico, y montar un
 * decodificador propio para un literal con emojis no compensa.
 */
export function cadenasDeClase(bytes: Buffer): string[] {
  if (!pareceClase(bytes)) return []

  const fuera: string[] = []
  try {
    // magic(4) minor(2) major(2) constant_pool_count(2)
    const total = bytes.readUInt16BE(8)
    let pos = 10
    // El pool se indexa desde 1 y `constant_pool_count` es el índice MAYOR + 1, así
    // que hay `total - 1` entradas. Un pool vacío declara 1.
    let i = 1
    while (i < total) {
      if (pos >= bytes.length) return fuera
      const tag = bytes[pos]
      pos += 1

      if (tag === TAG_UTF8) {
        if (pos + 2 > bytes.length) return fuera
        const largo = bytes.readUInt16BE(pos)
        pos += 2
        if (pos + largo > bytes.length) return fuera
        if (fuera.length < MAX_CADENAS) fuera.push(bytes.toString('utf8', pos, pos + largo))
        pos += largo
        i += 1
        continue
      }

      const tam = TAM_TAG[tag]
      // Tag desconocido: se para. Seguir adivinando el tamaño desplazaría el resto
      // del recorrido y produciría cadenas basura, que es peor que no dar ninguna.
      if (tam === undefined) return fuera
      pos += tam

      // LA TRAMPA DEL FORMATO, y es la de manual: Long (5) y Double (6) ocupan DOS
      // ranuras del pool. La especificación lo llama "a poor choice" ella misma.
      // Sin este salto, todo lo que viene detrás se lee con un índice de más y el
      // recorrido se desincroniza justo en las clases que usan `long` — o sea, casi
      // todas las de acceso a datos.
      i += tag === 5 || tag === 6 ? 2 : 1
    }
  } catch {
    // Buffer corto en un readUInt: se devuelve lo que se llevaba leído.
    return fuera
  }
  return fuera
}

/**
 * La misma cadena en forma LEGIBLE, o `null` si no aporta una segunda forma.
 *
 * En el pool los nombres de clase van en forma INTERNA, con barras:
 * `com/ejemplo/comunes/StringUtils`. Quien busca casi nunca teclea eso — teclea
 * `com.ejemplo.comunes.StringUtils`, que es como se lee en un `import`, en un stack
 * trace y en el propio editor. Sin esta variante, buscar el nombre cualificado de
 * una clase no encontraría NADA teniéndola delante, que es el fallo más confuso
 * posible: el usuario concluiría que la búsqueda en .class no funciona.
 *
 * Solo se ofrece cuando hay barras y la cadena parece un nombre de tipo, para no
 * convertir cada literal con una barra (una ruta, una URL, un formato de fecha) en
 * una segunda cadena que buscar por partida doble.
 */
export function formaLegible(cadena: string): string | null {
  if (!cadena.includes('/')) return null
  // Descarta lo que claramente no es un nombre de tipo: rutas absolutas, URLs,
  // fechas y cualquier cosa con espacios.
  if (/[\s:?#]|^\//.test(cadena)) return null
  return cadena.replace(/\//g, '.')
}
