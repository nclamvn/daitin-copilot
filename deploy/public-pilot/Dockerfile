# syntax=docker/dockerfile:1
FROM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS runtime
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gosu libgomp1 tini util-linux \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset=ubuntu-x64; sum=a57aa1817e135237b3b087a012ccfe17140e440dbe42f51dab1b9dc68499e7c4 ;; \
      arm64) asset=ubuntu-arm64; sum=4c544397fc4963b0013d23483172b27707631b356f3669a570892c9f8c8033d0 ;; \
      *) exit 1 ;; \
    esac; \
    curl -fLsS --retry 2 "https://github.com/ggml-org/llama.cpp/releases/download/b12230/llama-b12230-bin-${asset}.tar.gz" -o /tmp/llama.tar.gz; \
    printf '%s  %s\n' "$sum" /tmp/llama.tar.gz | sha256sum -c -; \
    mkdir -p /opt/llama; \
    tar -xzf /tmp/llama.tar.gz --strip-components=1 -C /opt/llama; \
    rm /tmp/llama.tar.gz; \
    LD_LIBRARY_PATH=/opt/llama /opt/llama/llama-server --version
WORKDIR /app
COPY app/ /app/
COPY seed/ /opt/seed/
COPY start.sh /usr/local/bin/start-pilot
ENTRYPOINT ["tini", "--", "/usr/local/bin/start-pilot"]

FROM runtime AS hosted
RUN mkdir -p /opt/pilot-model \
    && curl -fLsS --retry 2 --max-time 800 \
      'https://huggingface.co/lmstudio-community/Qwen3-4B-Instruct-2507-GGUF/resolve/4edb920b6f14e3b9284d4502a6485103d72cde05/Qwen3-4B-Instruct-2507-Q4_K_M.gguf' \
      -o /opt/pilot-model/model.gguf \
    && echo '8cdb57cbb880d313736a9bc4e3d3d2485f145b5e19cf33783746e753e82641fc  /opt/pilot-model/model.gguf' | sha256sum -c -
