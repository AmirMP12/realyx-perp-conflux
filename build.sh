#!/bin/bash
set -ex

export NODE_ENV=development

echo "--- Building Backend ---"
cd backend
npm install
npm run build

echo "--- Building Frontend ---"
cd ../frontend
npm install
npm run build

echo "--- Done ---"
