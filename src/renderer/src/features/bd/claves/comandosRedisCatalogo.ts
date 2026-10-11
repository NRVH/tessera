// =============================================================================
// El catálogo de comandos de Redis que ofrece el autocompletado de su consola: cada comando con su
// sintaxis, para enseñarla junto al nombre. Datos puros (no preguntan al servidor: un usuario sin permiso
// de `COMMAND` también completa) y sin DOM; los consume `autocompletadoClaves.ts`. Los comandos
// que el servidor no conozca (versión, módulo) se escriben igual: completar no es validar.
// =============================================================================

/** `NOMBRE|sintaxis`, uno por línea; un nombre de dos palabras (`CONFIG GET`) es un subcomando. */
const TABLA_BASICA = `
APPEND|key value
BITCOUNT|key [start end [BYTE|BIT]]
BITOP|AND|OR|XOR|NOT destkey key [key ...]
BITPOS|key bit [start [end [BYTE|BIT]]]
BLMOVE|source destination LEFT|RIGHT LEFT|RIGHT timeout
BLPOP|key [key ...] timeout
BRPOP|key [key ...] timeout
COPY|source destination [DB destination-db] [REPLACE]
DBSIZE|
DECR|key
DECRBY|key decrement
DEL|key [key ...]
DUMP|key
ECHO|message
EXISTS|key [key ...]
EXPIRE|key seconds [NX|XX|GT|LT]
EXPIREAT|key unix-time-seconds [NX|XX|GT|LT]
EXPIRETIME|key
FLUSHALL|[ASYNC|SYNC]
FLUSHDB|[ASYNC|SYNC]
GEOADD|key [NX|XX] [CH] longitude latitude member [longitude latitude member ...]
GEODIST|key member1 member2 [M|KM|FT|MI]
GEOPOS|key member [member ...]
GEOSEARCH|key FROMMEMBER member|FROMLONLAT lon lat BYRADIUS radius M|KM|FT|MI|BYBOX w h M|KM|FT|MI [ASC|DESC] [COUNT n]
GET|key
GETDEL|key
GETEX|key [EX seconds|PX ms|EXAT ts|PXAT ts|PERSIST]
GETRANGE|key start end
GETSET|key value
HDEL|key field [field ...]
HEXISTS|key field
HGET|key field
HGETALL|key
HINCRBY|key field increment
HINCRBYFLOAT|key field increment
HKEYS|key
HLEN|key
HMGET|key field [field ...]
HMSET|key field value [field value ...]
HRANDFIELD|key [count [WITHVALUES]]
HSCAN|key cursor [MATCH pattern] [COUNT count]
HSET|key field value [field value ...]
HSETNX|key field value
HSTRLEN|key field
HVALS|key
INCR|key
INCRBY|key increment
INCRBYFLOAT|key increment
INFO|[section]
KEYS|pattern
LINDEX|key index
LINSERT|key BEFORE|AFTER pivot element
LLEN|key
LMOVE|source destination LEFT|RIGHT LEFT|RIGHT
LPOP|key [count]
LPOS|key element [RANK rank] [COUNT n] [MAXLEN len]
LPUSH|key element [element ...]
LPUSHX|key element [element ...]
LRANGE|key start stop
LREM|key count element
LSET|key index element
LTRIM|key start stop
MEMORY USAGE|key [SAMPLES count]
MGET|key [key ...]
MOVE|key db
MSET|key value [key value ...]
MSETNX|key value [key value ...]
OBJECT ENCODING|key
OBJECT FREQ|key
OBJECT IDLETIME|key
PERSIST|key
PEXPIRE|key milliseconds [NX|XX|GT|LT]
PEXPIREAT|key unix-time-milliseconds [NX|XX|GT|LT]
PEXPIRETIME|key
PFADD|key [element ...]
PFCOUNT|key [key ...]
PFMERGE|destkey [sourcekey ...]
PING|[message]
PSETEX|key milliseconds value
PTTL|key
PUBLISH|channel message
RANDOMKEY|
RENAME|key newkey
RENAMENX|key newkey
RESTORE|key ttl serialized-value [REPLACE] [ABSTTL]
RPOP|key [count]
RPOPLPUSH|source destination
RPUSH|key element [element ...]
RPUSHX|key element [element ...]
SADD|key member [member ...]
SCAN|cursor [MATCH pattern] [COUNT count] [TYPE type]
SCARD|key
SDIFF|key [key ...]
SDIFFSTORE|destination key [key ...]
SELECT|index
SET|key value [NX|XX] [GET] [EX seconds|PX ms|EXAT ts|PXAT ts|KEEPTTL]
SETEX|key seconds value
SETNX|key value
SETRANGE|key offset value
SINTER|key [key ...]
SINTERCARD|numkeys key [key ...] [LIMIT limit]
SINTERSTORE|destination key [key ...]
SISMEMBER|key member
SMEMBERS|key
SMISMEMBER|key member [member ...]
SMOVE|source destination member
SORT|key [BY pattern] [LIMIT offset count] [GET pattern ...] [ASC|DESC] [ALPHA] [STORE destination]
SPOP|key [count]
SRANDMEMBER|key [count]
SREM|key member [member ...]
SSCAN|key cursor [MATCH pattern] [COUNT count]
STRLEN|key
SUBSTR|key start end
SUNION|key [key ...]
SUNIONSTORE|destination key [key ...]
TIME|
TOUCH|key [key ...]
TTL|key
TYPE|key
UNLINK|key [key ...]
XACK|key group id [id ...]
XADD|key [NOMKSTREAM] [MAXLEN|MINID [=|~] threshold] *|id field value [field value ...]
XAUTOCLAIM|key group consumer min-idle-time start [COUNT count]
XCLAIM|key group consumer min-idle-time id [id ...]
XDEL|key id [id ...]
XGROUP CREATE|key group id|$ [MKSTREAM]
XGROUP DESTROY|key group
XINFO GROUPS|key
XINFO STREAM|key [FULL]
XLEN|key
XPENDING|key group [[IDLE min-idle-time] start end count [consumer]]
XRANGE|key start end [COUNT count]
XREAD|[COUNT count] [BLOCK ms] STREAMS key [key ...] id [id ...]
XREADGROUP|GROUP group consumer [COUNT count] [BLOCK ms] [NOACK] STREAMS key [key ...] id [id ...]
XREVRANGE|key end start [COUNT count]
XTRIM|key MAXLEN|MINID [=|~] threshold [LIMIT count]
ZADD|key [NX|XX] [GT|LT] [CH] [INCR] score member [score member ...]
ZCARD|key
ZCOUNT|key min max
ZDIFF|numkeys key [key ...] [WITHSCORES]
ZINCRBY|key increment member
ZINTER|numkeys key [key ...] [WITHSCORES]
ZLEXCOUNT|key min max
ZMSCORE|key member [member ...]
ZPOPMAX|key [count]
ZPOPMIN|key [count]
ZRANGE|key start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]
ZRANGEBYSCORE|key min max [WITHSCORES] [LIMIT offset count]
ZRANK|key member [WITHSCORE]
ZREM|key member [member ...]
ZREMRANGEBYRANK|key start stop
ZREMRANGEBYSCORE|key min max
ZREVRANGE|key start stop [WITHSCORES]
ZREVRANK|key member [WITHSCORE]
ZSCAN|key cursor [MATCH pattern] [COUNT count]
ZSCORE|key member
ZUNION|numkeys key [key ...] [WITHSCORES]
ZUNIONSTORE|destination numkeys key [key ...] [WEIGHTS weight ...] [AGGREGATE SUM|MIN|MAX]
JSON.ARRAPPEND|key path value [value ...]
JSON.DEL|key [path]
JSON.GET|key [path ...]
JSON.OBJKEYS|key [path]
JSON.SET|key path value [NX|XX]
JSON.TYPE|key [path]
`

export interface ComandoRedis {
  /** `GET`, `CONFIG GET`… */
  nombre: string
  /** El resto de la sintaxis; vacío si el comando no lleva argumentos. */
  sintaxis: string
}

function leerTabla(tabla: string): ComandoRedis[] {
  return tabla
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => {
      const i = l.indexOf('|')
      return { nombre: l.slice(0, i), sintaxis: l.slice(i + 1) }
    })
}

/** Los comandos con su sintaxis, en el orden alfabético de la tabla. */
export const COMANDOS_REDIS: readonly ComandoRedis[] = leerTabla(TABLA_BASICA)
