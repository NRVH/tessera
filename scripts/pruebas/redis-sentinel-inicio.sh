#!/bin/sh
# =============================================================================
# Arranque DENTRO del contenedor pruebas-redis-sentinel (lo copia y lanza `redis.sh levantar-sentinel`):
# un maestro (6481), una réplica (6482) y tres sentinels (26481-26483) que vigilan «mimaestro».
# Todos en el mismo espacio de red y anunciándose como 127.0.0.1: así la dirección que los sentinels
# dan del maestro es la misma dentro del contenedor y desde el anfitrión (por los puertos publicados).
# Las claves llegan por el entorno (PW para Redis, SPW para los sentinels) y nunca se imprimen.
# =============================================================================
set -e
D=/datos
mkdir -p "$D"

if [ ! -f "$D/s26481.conf" ]; then
  for p in 26481 26482 26483; do
    f="$D/s$p.conf"
    printf 'port %s\n' "$p" > "$f"
    printf 'sentinel announce-ip 127.0.0.1\n' >> "$f"
    printf 'requirepass %s\n' "$SPW" >> "$f"
    printf 'sentinel sentinel-pass %s\n' "$SPW" >> "$f"
    printf 'sentinel monitor mimaestro 127.0.0.1 6481 2\n' >> "$f"
    printf 'sentinel auth-pass mimaestro %s\n' "$PW" >> "$f"
    printf 'sentinel down-after-milliseconds mimaestro 3000\n' >> "$f"
    printf 'sentinel failover-timeout mimaestro 10000\n' >> "$f"
  done
fi

nodo() {
  p="$1"; shift
  redis-server --port "$p" --requirepass "$PW" --masterauth "$PW" --replica-announce-ip 127.0.0.1 \
    --appendonly no --save '' --daemonize yes --logfile "$D/m$p.log" "$@"
}
# Tras un failover el maestro es otro: cada nodo vuelve con el papel que diga el sentinel, no con el de fábrica.
if [ -f "$D/arrancado" ]; then
  nodo 6481
  nodo 6482
else
  nodo 6481
  nodo 6482 --replicaof 127.0.0.1 6481
  touch "$D/arrancado"
fi
for p in 26481 26482 26483; do
  redis-sentinel "$D/s$p.conf" --daemonize yes --logfile "$D/s$p.log"
done
exec tail -f /dev/null
