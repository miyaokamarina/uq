#!/usr/bin/env bash

tsc
babel ./target --out-dir ./dist --source-maps
mv ./target/index.d.ts ./dist/index.d.ts
rm -rf ./target
