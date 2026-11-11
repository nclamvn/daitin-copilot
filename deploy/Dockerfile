FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 daitin && useradd --uid 10001 --gid daitin --create-home daitin \
    && mkdir -p /opt/daitin/app /data && chown -R daitin:daitin /opt/daitin /data
WORKDIR /opt/daitin/app
COPY --chown=daitin:daitin . .
ENV PORT=4320 DAI_TIN_BIND=0.0.0.0 DAI_TIN_DATA_DIR=/data
USER daitin
EXPOSE 4320
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node distribution/health.mjs
CMD ["node", "distribution/start-web.mjs"]
