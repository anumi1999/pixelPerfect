#!/usr/bin/env bash
# Starts Muse Glimmer (Meta open weights) locally with an OpenAI-compatible API at http://127.0.0.1:8080/v1
# Needs: llama.cpp release b10353 or newer, and ~24 GB of free GPU / unified memory (32 GB Mac recommended).
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-$HOME/models/muse-glimmer}"
MODEL_FILE="Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf"
CONTEXT="${CONTEXT:-32768}"   # smaller than the 131072 maximum, to save memory

if ! command -v llama-server >/dev/null; then
  echo "llama-server not found. On a Mac: brew install llama.cpp" >&2
  exit 1
fi
echo "llama.cpp version:"; llama-server --version 2>&1 | head -n 2 || true
echo "(Muse Glimmer needs build b10353 or newer; older builds fail with: unknown model architecture 'muse-glimmer')"

if [ ! -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "Downloading $MODEL_FILE (~17 GB) to $MODEL_DIR ..."
  mkdir -p "$MODEL_DIR"
  if command -v hf >/dev/null; then
    hf download meta-models/Muse-Glimmer-30B-GGUF "$MODEL_FILE" --local-dir "$MODEL_DIR"
  elif command -v huggingface-cli >/dev/null; then
    huggingface-cli download meta-models/Muse-Glimmer-30B-GGUF "$MODEL_FILE" --local-dir "$MODEL_DIR"
  else
    echo "Install the Hugging Face CLI first: pip install -U huggingface_hub" >&2
    exit 1
  fi
fi

# --jinja is required for tool calling (llama.cpp picks the tool-call parser from the model's template).
exec llama-server \
  -m "$MODEL_DIR/$MODEL_FILE" \
  -a muse-glimmer \
  -c "$CONTEXT" -np 1 \
  --host 127.0.0.1 --port 8080 \
  --jinja
