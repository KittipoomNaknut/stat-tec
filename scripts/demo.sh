#!/usr/bin/env bash
# The booth in one command (research 026).
#
#   ./scripts/demo.sh start           pose service + game + Chrome kiosk; closing Chrome
#                                     (Alt+F4) stops everything, so nothing is left running hot
#   ./scripts/demo.sh start --no-kiosk  services only (open http://127.0.0.1:8080 yourself)
#   ./scripts/demo.sh stop            stop whatever this script started
#   ./scripts/demo.sh status          what is running
#   ./scripts/demo.sh log             live log: health, problems (red), visits
#
# Logs: ~/.cache/stat-tec/logs (names and numbers only, never camera images).
# Extra pose-service flags: STAT_TEC_PERCEPTION_ARGS="--camera 2" ./scripts/demo.sh start
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${STAT_TEC_CACHE:-$HOME/.cache/stat-tec}"
RUN="$CACHE/run"
LOGS="$CACHE/logs"
APP_PORT=8080
POSE_PORT=8765
URL="http://127.0.0.1:$APP_PORT/"

say() { printf '\033[1m[demo]\033[0m %s\n' "$*"; }
fail() {
  printf '\033[31m[demo] %s\033[0m\n' "$*" >&2
  exit 1
}

listening() { ss -ltn 2>/dev/null | grep -q "127.0.0.1:$1 "; }

running() {
  local pid
  [[ -f "$RUN/$1.pid" ]] || return 1
  pid="$(cat "$RUN/$1.pid")"
  kill -0 "$pid" 2>/dev/null
}

wait_port() { # port seconds name logfile
  local i
  for ((i = 0; i < $2 * 2; i++)); do
    listening "$1" && return 0
    running "$3" || fail "$3 stopped while starting — see $4"
    sleep 0.5
  done
  fail "$3 did not start within $2 s — see $4"
}

# Own process group (setsid), so stop takes its children (uv → python, pnpm → node) too
launch() { # name logfile command...
  local name="$1" log="$2"
  shift 2
  setsid "$@" >>"$log" 2>&1 </dev/null &
  echo $! >"$RUN/$name.pid"
}

stop_one() {
  local name="$1" pid i
  [[ -f "$RUN/$name.pid" ]] || return 0
  pid="$(cat "$RUN/$name.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 20; i++)); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
    say "stopped $name"
  fi
  rm -f "$RUN/$name.pid"
}

build_if_changed() {
  local dist="$ROOT/app/dist/index.html"
  if [[ -f "$dist" ]] && [[ -z "$(find "$ROOT/app/src" "$ROOT/app/public" "$ROOT/app/index.html" \
    "$ROOT/content" -newer "$dist" -print -quit 2>/dev/null)" ]]; then
    return 0
  fi
  say "building the game (code changed since the last build)…"
  (cd "$ROOT/app" && pnpm build) >"$LOGS/build.log" 2>&1 || fail "build failed — see $LOGS/build.log"
}

cmd_start() {
  local kiosk=1
  [[ "${1:-}" == "--no-kiosk" ]] && kiosk=0
  mkdir -p "$RUN" "$LOGS"
  if running perception || running app; then
    fail "already running — ./scripts/demo.sh stop first (or status)"
  fi
  listening "$POSE_PORT" && fail "port $POSE_PORT is taken by something else (another pose service?)"
  listening "$APP_PORT" && fail "port $APP_PORT is taken by something else (docker web?)"

  build_if_changed

  say "starting the pose service (camera)…"
  launch perception "$LOGS/perception.log" \
    uv run --directory "$ROOT/perception-server" --extra gpu stat-tec-perception --log-dir "$LOGS" \
    ${STAT_TEC_PERCEPTION_ARGS:-}
  wait_port "$POSE_PORT" 90 perception "$LOGS/perception.log"

  say "serving the game on $URL…"
  # pnpm from inside app/: corepack picks the pnpm version from app/package.json
  (cd "$ROOT/app" && launch app "$LOGS/app.log" \
    pnpm exec vite preview --host 127.0.0.1 --port "$APP_PORT" --strictPort)
  wait_port "$APP_PORT" 30 app "$LOGS/app.log"

  if ((kiosk == 0)); then
    say "ready: open $URL · live log: ./scripts/demo.sh log · stop: ./scripts/demo.sh stop"
    return 0
  fi

  say "opening Chrome full screen — close it (Alt+F4) to stop everything"
  trap 'cmd_stop; exit 0' INT TERM
  # Its own profile: never touches the user's Chrome, tabs or logins
  google-chrome --kiosk --app="$URL" --user-data-dir="$CACHE/chrome" \
    --no-first-run --no-default-browser-check --noerrdialogs --disable-infobars \
    --disable-session-crashed-bubble --disable-features=Translate \
    --autoplay-policy=no-user-gesture-required >>"$LOGS/chrome.log" 2>&1 || true
  cmd_stop
}

cmd_stop() {
  stop_one app
  stop_one perception
  say "all stopped"
}

cmd_status() {
  local name port
  for name in perception app; do
    port=$([[ $name == perception ]] && echo "$POSE_PORT" || echo "$APP_PORT")
    if running "$name"; then
      say "$name: running (pid $(cat "$RUN/$name.pid"), port $port)"
    elif listening "$port"; then
      say "$name: port $port is in use, but not by this script"
    else
      say "$name: stopped"
    fi
  done
}

cmd_log() {
  exec uv run --directory "$ROOT/perception-server" --extra gpu stat-tec-log --log-dir "$LOGS"
}

case "${1:-}" in
start) cmd_start "${2:-}" ;;
stop) cmd_stop ;;
status) cmd_status ;;
log) cmd_log ;;
*)
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
