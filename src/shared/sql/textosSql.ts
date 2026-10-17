// =============================================================================
// Textos del análisis de SQL que ve la persona: los motivos del modo solo lectura y de los formatos
// fijados, los avisos del editor (paréntesis, comillas, «;» que falta), el error de sintaxis, por
// qué no se explica una sentencia, los errores de editar filas y los comentarios de los scripts
// generados. Español e inglés juntos; se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../i18n.ts'

export const txSql = crearTextos(
  {
    ro: {
      prefijo: 'La conexión es de solo lectura: ',
      o: ' o ',
      y: ' y ',
      soloSePermite: (forma: string, lista: string, use: string) => `solo se permite ${forma}${lista}${use}.`,
      use: ' (y USE para cambiar de base)',
      pragma: 'solo se permiten los PRAGMA que leen (table_info, index_list, user_version…).',
      estaSentencia: 'esta sentencia',
      dml: (v: string) => `${v} modifica datos.`,
      ddl: (v: string) => `${v} cambia la estructura de la base de datos.`,
      plsql: 'un bloque PL/SQL puede escribir y no se puede comprobar antes de ejecutarlo.',
      rutina: (v: string) => `${v} ejecuta código que puede escribir.`,
      bloqueo: (v: string) => `${v} bloquea filas para modificarlas.`,
      tx: 'las transacciones las gestiona Tessera.',
      otra: (v: string) => `no se puede comprobar que ${v} solo lea.`
    },
    formato: {
      inicio: 'Tessera fija este formato',
      restablece: (verbo: string, inicio: string) =>
        `${inicio} (${verbo} también lo restablece); usa RESET con el parámetro que necesites.`,
      conRemedios: (inicio: string, lista: string, remedios: string) => `${inicio} (${lista}); ${remedios}.`,
      porDefecto: 'usa TO_CHAR para verlo con otro formato',
      remedios: {
        bytea_output: "usa encode(…, 'escape') para verlo de otra forma",
        standard_conforming_strings: "usa E'…' si necesitas escapes con la barra",
        dateformat: 'usa CONVERT o FORMAT para verlo con otro formato',
        language: 'usa FORMAT con su cultura para verlo en otro idioma',
        textsize: 'usa SUBSTRING para leer un valor largo por partes',
        implicit_transactions: 'usa el modo Manual de la consola para abrir la transacción',
        quoted_identifier: 'usa corchetes para los nombres y comillas simples para las cadenas',
        sql_mode: 'usa acentos graves para los nombres; los demás modos se pueden pedir en la propia sentencia (CAST, IGNORE)',
        juego: 'usa CONVERT(… USING juego) para leer un valor en otro juego de caracteres'
      } as Record<string, string>
    },
    avisos: {
      puntoYComaServidor: '¿Falta «;» al final de la línea anterior? Sin él, el servidor ejecuta las dos sentencias juntas.',
      puntoYComaJuntas: '¿Falta «;» al final de la línea anterior? Sin él, las dos sentencias se envían juntas.',
      loteRepetido:
        'Tessera no repite lotes: «GO n» no se admite y, tal cual, el servidor lo leería como parte de la sentencia y daría un error. Deja el GO solo (o repite el lote a mano).',
      faltaBarra: '¿Falta «/» tras el bloque PL/SQL? Sin ella, lo que sigue se envía dentro del bloque.',
      comentarioSinCerrar: 'Comentario sin cerrar.',
      identificadorSinCerrar: 'Identificador entre comillas sin cerrar.',
      dolaresSinCerrar: 'Cadena entre dólares sin cerrar.',
      cadenaSinCerrar: 'Cadena sin cerrar.',
      parentesisSobra: 'Este «)» no cierra ningún paréntesis.',
      parentesisSinCerrar: 'Paréntesis sin cerrar.'
    },
    sintaxis: {
      fuente: (motor: string) => `gramática de ${motor}, sin ejecutar`,
      cerca: (cerca: string) => `Error de sintaxis cerca de «${cerca}».`,
      incompleta: 'La sentencia está incompleta: se acaba antes de lo que pide la gramática.',
      hondo: (cerca: string) => `Anidamiento demasiado profundo cerca de «${cerca}».`,
      otro: (crudo: string) => `Error de sintaxis: ${crudo}`
    },
    explicar: {
      show: 'SHOW no tiene plan de ejecución.',
      yaExplain: 'La sentencia ya es un EXPLAIN: ejecútala tal cual para ver su salida.',
      yaShowplan: 'La sentencia ya pide su plan con SET SHOWPLAN: ejecútala tal cual, o quita el SET para explicarla.',
      soloConsultas: (verbo: string) =>
        `Solo se puede explicar una consulta o un INSERT, UPDATE, DELETE o MERGE (esto es ${verbo}).`,
      otraCosa: 'otra cosa'
    },
    dml: {
      ningunRowid: 'Ningún motor identifica las filas por su ROWID.',
      soloRowid: (donde: string) => `ROWID solo existe en ${donde}.`,
      claveNula: (columna: string) => `La clave de la fila tiene «${columna}» vacío (NULL): no se puede encontrar la fila.`,
      noTexto: (columna: string) => `El valor leído de «${columna}» no es texto: no se puede comprobar si la fila cambió.`,
      sinValores: 'La fila nueva no tiene ningún valor.',
      noEditable: 'Esta tabla no se puede editar.',
      claveRowid: 'La clave de la fila no cuadra con su ROWID.',
      sinClave: 'La tabla no tiene clave con la que encontrar la fila.',
      claveDistinta: 'La clave de la fila no cuadra con la clave de la tabla: vuelve a abrirla.',
      sinCambios: 'No hay ninguna celda cambiada en la fila.'
    },
    script: {
      sqlcmdVariable: '-- Un nombre lleva «$(», que sqlcmd tomaría por una variable: córrelo con sqlcmd -x.\n',
      rawGrande: (bytes: number, tope: number) =>
        `-- ${bytes} bytes no caben en una variable RAW de PL/SQL (tope ${tope}): ` +
        'esta fila fallará con ORA-06502, y no hay forma de insertarla con SQL.'
    }
  },
  {
    ro: {
      prefijo: 'The connection is read-only: ',
      o: ' or ',
      y: ' and ',
      soloSePermite: (forma: string, lista: string, use: string) => `only ${forma}${lista}${use} is allowed.`,
      use: ' (and USE to change database)',
      pragma: 'only the PRAGMAs that read are allowed (table_info, index_list, user_version…).',
      estaSentencia: 'this statement',
      dml: (v: string) => `${v} modifies data.`,
      ddl: (v: string) => `${v} changes the structure of the database.`,
      plsql: 'a PL/SQL block can write and cannot be checked before running it.',
      rutina: (v: string) => `${v} runs code that may write.`,
      bloqueo: (v: string) => `${v} locks rows to modify them.`,
      tx: 'transactions are managed by Tessera.',
      otra: (v: string) => `it cannot be checked that ${v} only reads.`
    },
    formato: {
      inicio: 'Tessera fixes this format',
      restablece: (verbo: string, inicio: string) =>
        `${inicio} (${verbo} also resets it); use RESET with the parameter you need.`,
      conRemedios: (inicio: string, lista: string, remedios: string) => `${inicio} (${lista}); ${remedios}.`,
      porDefecto: 'use TO_CHAR to see it in another format',
      remedios: {
        bytea_output: "use encode(…, 'escape') to see it another way",
        standard_conforming_strings: "use E'…' if you need backslash escapes",
        dateformat: 'use CONVERT or FORMAT to see it in another format',
        language: 'use FORMAT with its culture to see it in another language',
        textsize: 'use SUBSTRING to read a long value in parts',
        implicit_transactions: 'use the console’s Manual mode to open the transaction',
        quoted_identifier: 'use brackets for names and single quotes for strings',
        sql_mode: 'use backticks for names; the other modes can be requested in the statement itself (CAST, IGNORE)',
        juego: 'use CONVERT(… USING charset) to read a value in another character set'
      }
    },
    avisos: {
      puntoYComaServidor: 'Is a “;” missing at the end of the previous line? Without it, the server runs both statements together.',
      puntoYComaJuntas: 'Is a “;” missing at the end of the previous line? Without it, both statements are sent together.',
      loteRepetido:
        'Tessera does not repeat batches: “GO n” is not supported and, as is, the server would read it as part of the statement and raise an error. Leave GO on its own (or repeat the batch by hand).',
      faltaBarra: 'Is a “/” missing after the PL/SQL block? Without it, what follows is sent inside the block.',
      comentarioSinCerrar: 'Unclosed comment.',
      identificadorSinCerrar: 'Unclosed quoted identifier.',
      dolaresSinCerrar: 'Unclosed dollar-quoted string.',
      cadenaSinCerrar: 'Unclosed string.',
      parentesisSobra: 'This “)” does not close any parenthesis.',
      parentesisSinCerrar: 'Unclosed parenthesis.'
    },
    sintaxis: {
      fuente: (motor: string) => `${motor} grammar, not executed`,
      cerca: (cerca: string) => `Syntax error near “${cerca}”.`,
      incompleta: 'The statement is incomplete: it ends before what the grammar requires.',
      hondo: (cerca: string) => `Nesting too deep near “${cerca}”.`,
      otro: (crudo: string) => `Syntax error: ${crudo}`
    },
    explicar: {
      show: 'SHOW has no execution plan.',
      yaExplain: 'The statement is already an EXPLAIN: run it as is to see its output.',
      yaShowplan: 'The statement already asks for its plan with SET SHOWPLAN: run it as is, or remove the SET to explain it.',
      soloConsultas: (verbo: string) =>
        `Only a query or an INSERT, UPDATE, DELETE or MERGE can be explained (this is ${verbo}).`,
      otraCosa: 'something else'
    },
    dml: {
      ningunRowid: 'No engine identifies rows by ROWID.',
      soloRowid: (donde: string) => `ROWID only exists in ${donde}.`,
      claveNula: (columna: string) => `The row key has “${columna}” empty (NULL): the row cannot be found.`,
      noTexto: (columna: string) => `The value read from “${columna}” is not text: it cannot be checked whether the row changed.`,
      sinValores: 'The new row has no values.',
      noEditable: 'This table cannot be edited.',
      claveRowid: 'The row key does not match its ROWID.',
      sinClave: 'The table has no key to find the row with.',
      claveDistinta: 'The row key does not match the table key: open it again.',
      sinCambios: 'No cell has been changed in the row.'
    },
    script: {
      sqlcmdVariable: '-- A name contains “$(”, which sqlcmd would take for a variable: run it with sqlcmd -x.\n',
      rawGrande: (bytes: number, tope: number) =>
        `-- ${bytes} bytes do not fit in a PL/SQL RAW variable (limit ${tope}): ` +
        'this row will fail with ORA-06502, and there is no way to insert it with SQL.'
    }
  }
)
