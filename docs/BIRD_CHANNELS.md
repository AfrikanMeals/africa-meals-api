# Bird — SMS et WhatsApp (notifications Ads + vendeurs)

L’API utilise [Bird Channels API](https://docs.bird.com/api/channels-api) pour :

- **SMS** : notifications publicitaires (`AD_NOTIFICATION_SMS_ENABLED`) et SMS vendeurs (commandes, etc.)
- **WhatsApp** : notifications publicitaires (`AD_NOTIFICATION_WHATSAPP_ENABLED`)

Documentation Bird :

- [Envoyer des SMS](https://docs.bird.com/api/channels-api/supported-channels/programmable-sms/sending-sms-messages)
- [Envoyer des messages WhatsApp](https://docs.bird.com/api/channels-api/supported-channels/programmable-whatsapp/sending-whatsapp-messages)

## Prérequis Bird

1. Compte [Bird](https://bird.com) avec workspace actif.
2. **Canal SMS** programmable activé → noter l’**ID du canal**.
3. **Canal WhatsApp** activé et connecté à un numéro WABA → noter l’**ID du canal**.
4. **Access Key** avec droit d’envoi sur ces canaux ([autorisation API](https://docs.bird.com/api/api-access/api-authorization)).

Dans le dashboard Bird, repérez :

| Valeur | Où la trouver |
|--------|----------------|
| `BIRD_WORKSPACE_ID` | Paramètres du workspace / URL API |
| `BIRD_SMS_CHANNEL_ID` | Channels → canal SMS → ID (UUID) |
| `BIRD_WHATSAPP_CHANNEL_ID` | Channels → canal WhatsApp → ID (UUID) |
| `BIRD_ACCESS_KEY` | Developer / API keys → Access Key |

## Variables d’environnement

Copiez la section Bird de `.env.example` vers votre `.env` local.

### Credentials (obligatoires)

| Variable | Description |
|----------|-------------|
| `BIRD_ACCESS_KEY` | Token `AccessKey …` (sans le préfixe dans la variable) |
| `BIRD_WORKSPACE_ID` | UUID du workspace |
| `BIRD_SMS_CHANNEL_ID` | UUID du canal SMS |
| `BIRD_WHATSAPP_CHANNEL_ID` | UUID du canal WhatsApp |
| `BIRD_API_BASE_URL` | Optionnel, défaut `https://api.bird.com` |

### SMS — notifications Ads

| Variable | Description |
|----------|-------------|
| `AD_NOTIFICATION_SMS_ENABLED` | `true` pour activer l’envoi SMS ads |
| `AD_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE` | Indicatif si le numéro n’a pas de `+` (défaut `1` = CA/US) |

Les SMS **vendeurs** réutilisent la même config Bird (`BIRD_*` + canal SMS). Indicatif optionnel : `VENDOR_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE`.

### WhatsApp — notifications Ads

| Variable | Description |
|----------|-------------|
| `AD_NOTIFICATION_WHATSAPP_ENABLED` | `true` pour activer le canal |
| `AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE` | Indicatif par défaut (ex. `1`) |
| `AD_NOTIFICATION_WHATSAPP_SEND_MODE` | `template` (défaut, hors fenêtre 24 h) ou `text` (fenêtre client active) |

**Mode template** (recommandé pour les promos) :

| Variable | Description |
|----------|-------------|
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID` | UUID du projet template dans Bird Studio |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_VERSION` | Ex. `latest` |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_LANGUAGE` | Locale BCP-47, ex. `fr` |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PARAM_KEYS` | Clés séparées par des virgules, ordre : boutique, titre, message (défaut `store_name,title,message`) |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_BUTTON` | `true` si le template a un bouton URL dynamique |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PREFIX` | Préfixe fixe de l’URL ; le suffixe tracké est passé en paramètre |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PARAM_KEY` | Clé du paramètre suffixe URL (défaut `url_suffix`) |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_BODY_URL_PARAM` | `true` pour envoyer l’URL complète comme paramètre supplémentaire |

Les clés de `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PARAM_KEYS` doivent **correspondre exactement** aux paramètres définis dans le template Bird Studio.

## Production (Firebase Functions / Cloud Run)

Le fichier `.env` n’est **pas** déployé (`firebase.json` l’ignore). Utilisez **Secret Manager** ou les variables d’environnement du service.

### Secret Manager (recommandé)

```bash
cd africa-meals-api

firebase functions:secrets:set BIRD_ACCESS_KEY
firebase functions:secrets:set BIRD_WORKSPACE_ID
firebase functions:secrets:set BIRD_SMS_CHANNEL_ID
firebase functions:secrets:set BIRD_WHATSAPP_CHANNEL_ID

# Optionnel — template WhatsApp (variable d’env classique ou secret séparé)
firebase functions:secrets:set AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID
```

Ces quatre secrets Bird sont **déclarés dans `src/firebase-main.ts`** (`defineSecret` + `secrets: [...]`). Le déploiement Functions échoue si l’un d’eux est absent dans Secret Manager. En local, le fichier `.env` suffit (les secrets Firebase ne sont pas chargés par l’émulateur sauf configuration explicite).

Variables non sensibles (peuvent rester en params / env du service) :

```bash
AD_NOTIFICATION_SMS_ENABLED=true
AD_NOTIFICATION_WHATSAPP_ENABLED=true
AD_NOTIFICATION_WHATSAPP_SEND_MODE=template
AD_NOTIFICATION_WHATSAPP_TEMPLATE_VERSION=latest
AD_NOTIFICATION_WHATSAPP_TEMPLATE_LANGUAGE=fr
AD_NOTIFICATION_WHATSAPP_TEMPLATE_PARAM_KEYS=store_name,title,message
AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_BUTTON=true
AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PREFIX=https://api.wise-eat.com/ads/notifications/click/
API_PUBLIC_BASE_URL=https://api.wise-eat.com
```

### Cloud Run (`api`)

Même jeu de variables via la console GCP → Cloud Run → service `api` → **Variables et secrets**, ou :

```bash
gcloud run services update api \
  --region=europe-west1 \
  --set-secrets=BIRD_ACCESS_KEY=BIRD_ACCESS_KEY:latest,BIRD_WORKSPACE_ID=BIRD_WORKSPACE_ID:latest \
  --update-env-vars=AD_NOTIFICATION_SMS_ENABLED=true,AD_NOTIFICATION_WHATSAPP_ENABLED=true
```

Adaptez région et noms de secrets à votre projet.

## Migration depuis Twilio / Meta WhatsApp

| Ancien | Nouveau |
|--------|---------|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SERVICE_ID`, `TWILIO_PHONE_NUMBER` | `BIRD_ACCESS_KEY`, `BIRD_WORKSPACE_ID`, `BIRD_SMS_CHANNEL_ID` |
| `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | `BIRD_ACCESS_KEY`, `BIRD_WORKSPACE_ID`, `BIRD_WHATSAPP_CHANNEL_ID` |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_NAME` (Meta) | `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID` (Bird Studio) |

Après bascule :

1. Définir les secrets Bird en production.
2. Retirer les anciennes variables Twilio / Meta du service.
3. Redéployer l’API.
4. Vérifier les contrôles santé admin (voir ci‑dessous).

## Contrôles santé (admin)

Dans **Maintenance / intégrité système**, les checks suivants valident Bird sans envoyer de message :

| Clé | Rôle |
|-----|------|
| `bird-sms-api-status` | GET canal SMS Bird |
| `bird-whatsapp-api-status` | GET canal WhatsApp Bird |
| `ad-notification-channels-status` | Cohérence admin vs runtime (SMTP, FCM, Bird, Redis, cron) |

Statut `degraded` si les credentials sont absents mais le canal ads est désactivé — comportement normal.

## Template WhatsApp Bird Studio

1. Créer un template marketing dans Bird Studio (corps + bouton URL si besoin).
2. Faire approuver le template (Meta via Bird).
3. Noter le **project ID** du template → `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID`.
4. Aligner `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PARAM_KEYS` sur les noms de paramètres du template.

Exemple de mapping pour une promo WiseEat :

- `store_name` → nom de la boutique
- `title` → titre de la notification
- `message` → corps du message
- `url_suffix` → suffixe de l’URL trackée (si bouton URL)

## Format API (référence)

Endpoint commun :

```http
POST https://api.bird.com/workspaces/{workspaceId}/channels/{channelId}/messages
Authorization: AccessKey {BIRD_ACCESS_KEY}
Content-Type: application/json
```

SMS (texte) :

```json
{
  "receiver": {
    "contacts": [{
      "identifierKey": "phonenumber",
      "identifierValue": "+15145551234"
    }]
  },
  "body": {
    "type": "text",
    "text": { "text": "Votre message" }
  }
}
```

WhatsApp (template) :

```json
{
  "receiver": {
    "contacts": [{
      "identifierKey": "phonenumber",
      "identifierValue": "+15145551234"
    }]
  },
  "template": {
    "projectId": "uuid-du-template",
    "version": "latest",
    "locale": "fr",
    "parameters": [
      { "type": "string", "key": "store_name", "value": "Ma boutique" },
      { "type": "string", "key": "title", "value": "Promo du jour" },
      { "type": "string", "key": "message", "value": "−20 % sur les plats" }
    ]
  }
}
```

Réponse attendue : **HTTP 202** avec un `id` de message.

## Dépannage

| Symptôme | Piste |
|----------|--------|
| `Bird SMS incomplet` dans le health check | Vérifier `BIRD_ACCESS_KEY`, `BIRD_WORKSPACE_ID`, `BIRD_SMS_CHANNEL_ID` |
| `bird_sms_not_configured` (SMS vendeur) | Même config SMS ; le canal Bird SMS doit être actif |
| WhatsApp template refusé | Vérifier `projectId`, locale et clés des paramètres |
| Message WhatsApp hors fenêtre 24 h | Passer en `AD_NOTIFICATION_WHATSAPP_SEND_MODE=template` |
| Numéro invalide | Vérifier le format E.164 (`+` + indicatif) et `AD_NOTIFICATION_*_DEFAULT_COUNTRY_CODE` |
| 401 / 403 Bird | Access Key expirée ou droits insuffisants sur le workspace / canal |

Logs applicatifs : recherchez `BirdChannels` ou `Bird SMS ads` / `Bird WhatsApp ads` dans les logs Cloud Functions / Cloud Run.
