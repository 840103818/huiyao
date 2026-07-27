#!/usr/bin/env bash
set -euo pipefail

MIN_RUST_VERSION="1.95.0"
RUSTC_COMMAND="${HUIYAO_RUSTC:-rustc}"

if [[ "$RUSTC_COMMAND" == */* ]]; then
  RUSTC_AVAILABLE=false
  [[ -x "$RUSTC_COMMAND" ]] && RUSTC_AVAILABLE=true
elif command -v "$RUSTC_COMMAND" >/dev/null 2>&1; then
  RUSTC_AVAILABLE=true
else
  RUSTC_AVAILABLE=false
fi

if [[ "$RUSTC_AVAILABLE" != true ]]; then
  printf '错误：未找到 rustc。请安装 Rust %s 或以上版本。\n' "$MIN_RUST_VERSION" >&2
  exit 1
fi

CURRENT_RUST_VERSION="$("$RUSTC_COMMAND" --version | awk '{print $2}')"

node - "$CURRENT_RUST_VERSION" "$MIN_RUST_VERSION" <<'NODE'
const [current, minimum] = process.argv.slice(2);
const parts = (value) => value.split('.').map((part) => Number.parseInt(part, 10));
const currentParts = parts(current);
const minimumParts = parts(minimum);
let supported = true;
for (let index = 0; index < Math.max(currentParts.length, minimumParts.length); index += 1) {
  const currentPart = currentParts[index] ?? 0;
  const minimumPart = minimumParts[index] ?? 0;
  if (currentPart === minimumPart) continue;
  supported = currentPart > minimumPart;
  break;
}

if (!supported) {
  console.error(
    `错误：当前 Rust ${current}，绘钥需要 Rust ${minimum} 或以上。` +
      'rustup 用户请先运行：rustup update stable',
  );
  process.exit(1);
}
NODE
