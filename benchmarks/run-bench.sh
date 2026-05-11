#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "============================================"
echo "  TTS Engine Benchmark: Candle vs xn-ptts"
echo "============================================"
echo ""

# Build both in release mode
echo "Building candle benchmark..."
cd tts-bench-candle
cargo build --release 2>&1 | tail -3
echo ""

echo "Building xn-ptts benchmark..."
cd ../tts-bench-xn
cargo build --release 2>&1 | tail -3
echo ""

cd ..

echo "============================================"
echo "  Running benchmarks"
echo "============================================"
echo ""

echo ">>> Candle (babybirdprd/pocket-tts) <<<"
echo ""
./tts-bench-candle/target/release/bench-candle
echo ""
echo ""

echo ">>> xn-ptts (LaurentMazare/xn-ptts) <<<"
echo ""
./tts-bench-xn/target/release/bench-xn
echo ""
