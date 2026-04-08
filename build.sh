#!/bin/bash
set -ex

echo "--- Building Backend ---"
cd backend
npm ci --legacy-peer-deps || npm install --legacy-peer-deps
npm run build

echo "--- Building Frontend ---"
cd ../frontend
npm ci --legacy-peer-deps || npm install --legacy-peer-deps
npm run build

echo "--- Done ---"
