# Configuration de l'envoi d'emails (Gmail SMTP)

L'API utilise **Nodemailer** avec **Gmail SMTP** pour envoyer les emails (vérification de compte, réinitialisation de mot de passe, etc.).

## 1. Prérequis

- Un compte **Gmail**
- **Authentification à deux facteurs (2FA)** activée sur ce compte (obligatoire pour utiliser un mot de passe d'application)

## 2. Créer un mot de passe d'application Gmail

Gmail n'accepte plus les mots de passe classiques pour les applications tierces. Il faut générer un **mot de passe d'application** :

1. Allez sur votre compte Google : [https://myaccount.google.com/](https://myaccount.google.com/)
2. **Sécurité** → **Validation en deux étapes** : assurez-vous qu’elle est **activée**.
3. **Sécurité** → **Mots de passe des applications** (ou cherchez "App passwords").
4. Sélectionnez **Application** : « Courrier » (ou « Autre » si vous préférez, avec un nom comme « Africa Meals API »).
5. Sélectionnez **Appareil** : « Autre » et tapez par exemple « Africa Meals API ».
6. Cliquez sur **Générer**.
7. **Copiez le mot de passe affiché** (16 caractères, sans espaces). Vous en aurez besoin pour le `.env`.

## 3. Variables d'environnement

Dans le fichier **`.env`** à la racine du projet, ajoutez ou modifiez :

```env
# --- Email (Gmail SMTP) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-adresse@gmail.com
SMTP_APP_PASSWORD=xxxx xxxx xxxx xxxx
SMTP_FROM=votre-adresse@gmail.com
APP_NAME=African Meals
SUPPORT_EMAIL=support@votredomaine.com
```

| Variable | Description | Exemple |
|----------|-------------|--------|
| `SMTP_HOST` | Serveur SMTP (Gmail par défaut) | `smtp.gmail.com` |
| `SMTP_PORT` | Port : 587 (TLS) ou 465 (SSL) | `587` |
| `SMTP_USER` | Votre adresse Gmail complète | `monapp@gmail.com` |
| `SMTP_APP_PASSWORD` | Mot de passe d’application (16 caractères) | `abcd efgh ijkl mnop` |
| `SMTP_FROM` | Adresse affichée comme expéditeur (souvent = SMTP_USER) | `monapp@gmail.com` |
| `APP_NAME` | Nom de l’application (utilisé dans les e-mails) | `African Meals` |
| `SUPPORT_EMAIL` | Email de support (affiché en bas des e-mails) | `support@...` |
| `EMAIL_LOGO_URL` | URL absolue du logo (header) | `https://…/logo.png` |
| `EMAIL_WEBSITE_URL` ou `PUBLIC_WEB_URL` | Lien « Visiter le site » (footer) | `https://…` |
| `EMAIL_BRAND_PRIMARY` | Couleur principale (brun) | `#392800` |
| `EMAIL_BRAND_ACCENT` | Couleur d’accent (or) | `#aa6900` |

Sans `EMAIL_LOGO_URL`, l’API tente `{PUBLIC_WEB_URL ou FRONTEND_URL}/logo.png`.

### Anciennes variables (à retirer)

Vous pouvez **supprimer** les anciennes variables liées à MailerSend si vous ne les utilisez plus :

- `MAILER_API_KEY`
- `MAILER_SENDER`
- `ACCOUNT_VERIFICATION_TEMPLATE_ID`
- `PASSWORD_RESET_TEMPLATE_ID`

## 4. Vérifier l’envoi

1. Installer les dépendances :  
   `npm install` (ou `yarn`)

2. Démarrer l’API :  
   `npm run start:dev`

3. Tester l’envoi via l’endpoint de test :
   - **Swagger** : `POST /mailer/test-email` avec un body `{ "to": "votre@email.com" }`
   - **cURL** :
     ```bash
     curl -X POST http://localhost:9000/mailer/test-email \
       -H "Content-Type: application/json" \
       -d '{"to": "votre@email.com"}'
     ```

Si la configuration est correcte, vous recevrez un email de test.

## 5. Dépannage

### « Invalid login » ou « Username and Password not accepted »

- Vérifiez que la **2FA** est bien activée sur le compte Gmail.
- Utilisez bien un **mot de passe d’application**, pas le mot de passe normal du compte.
- Vérifiez qu’il n’y a **pas d’espace** dans `SMTP_APP_PASSWORD` (ou gardez les espaces tels qu’affichés par Google).

### « Connection timeout » ou erreurs réseau

- Vérifiez que le port **587** (ou 465) n’est pas bloqué par un pare-feu ou votre hébergeur.
- En production, certains hébergeurs bloquent le port 587 ; dans ce cas, testez le port **465** et mettez `SMTP_PORT=465`.

### Gmail bloque l’application

- Allez dans [https://myaccount.google.com/lesssecureapps](https://myaccount.google.com/lesssecureapps) : avec la 2FA, vous devez utiliser un **mot de passe d’application**, pas « applications moins sécurisées ».
- Si le compte est un **compte Google Workspace**, l’admin peut restreindre l’accès SMTP ; vérifiez les paramètres d’administration.

## 6. Résumé des e-mails envoyés par l’API

| Cas | Méthode | Contenu |
|-----|--------|--------|
| Inscription / vérification | `sendSimple()` | Code OTP + en-tête / pied de page brandés |
| Mot de passe oublié | `sendSimple()` | Code de réinitialisation (mise en page commune) |
| Bannières, campagnes, remboursements, etc. | `sendSimple()` | Corps HTML + enveloppe automatique |
| Test | `sendSimple()` | Email de test via `POST /mailer/test-email` |

Tous les e-mails `sendSimple()` sont enveloppés par le module `email-layout` (header logo, dégradé marque, footer support). Pour désactiver l’enveloppe sur un envoi ponctuel, préfixer le HTML avec `<!-- email-layout:skip -->`.

Tous ces e-mails passent par le même transport Gmail SMTP configuré dans `.env`.
