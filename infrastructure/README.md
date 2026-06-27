# Realyx Infrastructure

Kubernetes manifests and monitoring for Realyx API, frontend, and observability.

## Layout

```
infrastructure/
├── README.md
├── kubernetes/          # K8s manifests (apply in order)
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── backend-secrets.yaml.example
│   ├── backend.yaml
│   ├── indexer.yaml
│   └── frontend.yaml
└── monitoring/
    ├── README.md
    ├── prometheus.yml           # Kubernetes scrape config
    ├── prometheus-docker.yml    # Docker Compose scrape config
    ├── alerts/
    │   └── trading-alerts.yml
    └── grafana/
        └── provisioning/        # datasource + dashboard providers
```

## Prerequisites

- `kubectl` configured for your cluster
- NGINX Ingress Controller (for Ingress)
- cert-manager (optional, for TLS)
- Images: `realyx/backend:latest`, `realyx/frontend:latest` available to the cluster

## Apply order

```bash
kubectl apply -f infrastructure/kubernetes/namespace.yaml
kubectl apply -f infrastructure/kubernetes/configmap.yaml
# Create secrets from example (edit and remove .example from filename):
# cp backend-secrets.yaml.example backend-secrets.yaml
kubectl apply -f infrastructure/kubernetes/backend-secrets.yaml
kubectl apply -f infrastructure/kubernetes/backend.yaml
kubectl apply -f infrastructure/kubernetes/indexer.yaml
kubectl apply -f infrastructure/kubernetes/frontend.yaml
```

Or apply the whole directory (ensure namespace and configmap before deployments):

```bash
kubectl apply -f infrastructure/kubernetes/
```

## Configuration

- **ConfigMap `backend-config`**: non-secret settings — `CHAIN_ID`, `PORT`, `WS_PORT`, `NODE_ENV`, `METRICS_PORT`, contract addresses, `CORS_ORIGINS`, and `DISABLE_INBAND_SYNC` (the API runs as a pure reader; the `indexer` Deployment owns ingestion).
- **Secret `backend-secrets`**: connection strings and bearer secrets — `POSTGRES_URL` (and optional `POSTGRES_READ_URL` replica), `CRON_SECRET`, `KEEPER_WEBHOOK_SECRET`, `DEBUG_SECRET`. Copy `backend-secrets.yaml.example` to `backend-secrets.yaml`, fill values, then apply. DB URLs live here (not the ConfigMap) because they carry credentials.
- **Indexer**: `indexer.yaml` runs `node dist/worker.js` as the single chain-ingestion writer to the primary Postgres. It shares the ConfigMap and Secret with the backend.
- **Ingress**: Single host `app.realyx.xyz` routes `/api` and `/ws` to the backend and `/` to the frontend. Ensure DNS and TLS for this host are configured; adjust it in `frontend.yaml` if you use a different domain.

## Monitoring

See [monitoring/README.md](monitoring/README.md) for Prometheus and alerting setup.
