# Cloud Run — service `api` (africa-meals-api)

| Paramètre     | Valeur par défaut (script) |
|---------------|----------------------------|
| Mémoire       | **1 GiB**                  |
| CPU           | **2** vCPU                 |
| Max instances | **4** (variable `MAX_INSTANCES`) |

## Erreur `CpuAllocPerProjectRegion requested: 40000 allowed: 20000`

- **20 000 mCPU** = **20 vCPU** au total pour le **projet dans la région** (tous les services Cloud Run : `api`, `ws`, jobs, **Cloud Functions Gen2**, etc.).
- **40 000 mCPU** correspond souvent à **20 instances × 2 vCPU** quelque part dans la région (pas seulement sur `api` après réduction du max).

### Que faire

1. **Voir qui consomme le quota** (somme indicative CPU × max) :

   ```bash
   python3 scripts/cloud-run-regional-cpu-footprint.py europe-west1 afrikanmeals
   ```

2. **Baisser le max d’un autre service** (souvent **`ws`**) puis relancer la mise à jour `api` :

   ```bash
   CAP_WS_MAX=8 ./scripts/update-cloud-run-api-resources.sh
   ```

   Ou manuellement :

   ```bash
   gcloud run services update ws --region=europe-west1 --max-instances=8
   ```

   Le dépôt **`africa-meals-ws`** fixe désormais `--max-instances 8` et `--cpu 1` dans `deploy.sh` pour les prochains déploiements de `ws`.

3. **Augmenter le quota** : [Cloud Run quotas — CpuAllocPerProjectRegion](https://cloud.google.com/run/quotas).

## Script `scripts/update-cloud-run-api-resources.sh`

- Affiche l’empreinte régionale (sauf si `SKIP_FOOTPRINT=1`).
- Option **`CAP_WS_MAX=N`** : réduit d’abord le plafond du service **`ws`**.
- Mise à jour **`api`** en **3 commandes** (`max-instances` seul → pause → mémoire → CPU + max) : sinon GCP peut valider **2 vCPU × ancien max (ex. 20)** et refuser avec **40 000 mCPU**.
- Variable **`SLEEP_BETWEEN_STEPS`** (défaut `5`) : pause entre les étapes pour la propagation du `maxScale`.

```bash
./scripts/update-cloud-run-api-resources.sh
CAP_WS_MAX=8 MAX_INSTANCES=4 ./scripts/update-cloud-run-api-resources.sh
```

Variables : `SERVICE`, `WS_SERVICE`, `REGION`, `PROJECT`, `MEMORY`, `CPU`, `MAX_INSTANCES`, `CAP_WS_MAX`, `SKIP_FOOTPRINT`, `SLEEP_BETWEEN_STEPS`.

## Console Google Cloud

Même logique : vérifier les **autres** services de la région, baisser leurs max si besoin, puis **1 GiB**, **2** CPU et un **max d’instances** bas pour `api`.
