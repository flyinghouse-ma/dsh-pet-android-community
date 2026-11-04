#!/usr/bin/env bash
# 生成（首次）并复用发布用 keystore，给壳 APK 签名。
#
#   ./scripts/sign.sh <未签名的.apk> [输出目录]
#
# 首次运行会让你设置 keystore 密码。**这个 .jks 必须长期保存**：
# 丢了它就无法给老用户发升级包（签名不同，只能卸载重装）。
set -euo pipefail

APK="${1:?用法: sign.sh <未签名的.apk> [输出目录]}"
OUT="${2:-apk}"
KEYSTORE="${PETFRAME_KEYSTORE:-$HOME/.dsh/petframe-release.jks}"
ALIAS="${PETFRAME_ALIAS:-petframe}"
SIGNER_JAR="$HOME/.dsh/tools/uber-apk-signer.jar"
SIGNER_URL="https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar"

command -v java >/dev/null || { echo "需要 JDK（keytool）"; exit 1; }
command -v jar  >/dev/null || true

mkdir -p "$OUT" "$(dirname "$KEYSTORE")" "$(dirname "$SIGNER_JAR")"

if [ ! -f "$KEYSTORE" ]; then
  echo "== 首次运行：创建 keystore $KEYSTORE"
  echo "   请设置一个密码，并记进密码管理器。丢了就无法升级老用户。"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 36500 \
    -dname "CN=dsh-pet-android community, OU=community, O=community, L=CN, ST=CN, C=CN"
fi

if [ ! -f "$SIGNER_JAR" ]; then
  echo "== 下载签名工具"
  curl -fL -o "$SIGNER_JAR" "$SIGNER_URL"
fi

echo "== 签名 $APK"
java -jar "$SIGNER_JAR" --apks "$APK" --allowResign --skipZipAlign --ks "$KEYSTORE" --ksAlias "$ALIAS" -o "$OUT"

echo
echo "完成。产物在 $OUT/"
echo "记得把 $KEYSTORE 备份到离线位置（U 盘/密码管理器附件）。"