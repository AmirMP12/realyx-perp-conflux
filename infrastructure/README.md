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
│   └── frontend.yaml
└── monitoring/
    ├── README.md
    ├── prometheus.yml
    └── alerts/
        └── trading-alerts.yml
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
kubectl apply -f infrastructure/kubernetes/frontend.yaml
```

Or apply the whole directory (ensure namespace and configmap before deployments):

```bash
kubectl apply -f infrastructure/kubernetes/
```

## Configuration

- **ConfigMap `backend-config`**: `POSTGRES_URL`, `CHAIN_ID`, `PORT`, `WS_PORT`, `NODE_ENV`, `METRICS_PORT`. Update `POSTGRES_URL` to your deployed database indexer endpoint.
- **Secret `backend-secrets`**: Copy `backend-secrets.yaml.example` to `backend-secrets.yaml`, fill values, then apply. Omit or leave placeholders if not used.
- **Ingress**: Hosts are `realyx` and `api.realyx`. Change in `frontend.yaml` to match your domains.

## Monitoring

See [monitoring/README.md](monitoring/README.md) for Prometheus and alerting setup.
