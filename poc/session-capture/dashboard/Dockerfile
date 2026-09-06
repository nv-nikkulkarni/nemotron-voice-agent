# Self-contained session-capture dashboard — runs anywhere Docker runs, no cluster.
# Downloads a session's tar from NGC (REST API + your API key), extracts it, and
# serves the log / transcript / audio visualizer. Pure Python stdlib, no pip deps.
#
#   docker build -t session-dashboard poc/session-capture/dashboard
#   docker run --rm -e NGC_API_KEY=<your-ngc-key> -p 7870:8090 session-dashboard
#   open http://localhost:7870
FROM python:3.12-slim
# ca-certificates so urllib can verify TLS to authn/api.ngc.nvidia.com
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.py index.html ./
ENV PORT=8090 CACHE_DIR=/tmp/dashboard-cache
EXPOSE 8090
# NGC_API_KEY must be provided at runtime (the server refuses to start without it).
CMD ["python", "server.py"]
