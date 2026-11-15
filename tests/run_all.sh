#!/bin/sh
# テスト一式をまとめて実行する。使い方（リポジトリの直下で）:  sh tests/run_all.sh
# すべて Mac の中だけで動く（本物のGAS・スプレッドシートには接続しない）。Node.js だけで動く。
cd "$(dirname "$0")/.." || exit 1
fail=0
run() { name=$1; shift; out=$(node "$@" 2>&1); code=$?; echo "$name: $(echo "$out" | tail -1)"; if [ $code -ne 0 ]; then fail=1; echo "$out" | grep -v "  OK  " | head -30; fi; }
run "GAS（合言葉・保存と受信・削除記録の合算）" tests/gas_test.js
run "通しテスト（PC役＋スマホ役＋GAS）        " tests/e2e_test.js
[ $fail -eq 0 ] && echo "すべてOK" || echo "NGがあります"
exit $fail
