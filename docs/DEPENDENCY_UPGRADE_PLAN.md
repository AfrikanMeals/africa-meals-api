# Plan de mise à jour des dépendances (L-10)

**Date :** 17 juin 2026  
**Contexte :** NestJS v9, `apollo-server-express` v3 et packages associés sont en fin de vie. Aucune montée de version majeure dans ce ticket — planification uniquement.

---

## État actuel (API)

| Package | Version actuelle | Cible recommandée |
|---------|------------------|-------------------|
| `@nestjs/*` | ^9.0.0 | ^11.x (LTS actuelle) |
| `@nestjs/apollo` / `@nestjs/graphql` | ^10.2.1 | ^13.x (aligné Nest 11) |
| `apollo-server-express` | ^3.13.0 | **Retirer** → `@apollo/server` v4+ |
| `graphql` | ^16.13.2 | ^16.x (compatible) |
| `mongoose` / `@nestjs/mongoose` | ^8.4 / ^10.0 | Vérifier breaking changes Mongoose 8 |

---

## Phases proposées

### Phase 1 — Préparation (1 sprint)

1. Verrouiller la couverture de tests sur auth, billing, orders, GraphQL shop.
2. Activer `npm audit` en CI (✅ L-09).
3. Documenter tous les resolvers GraphQL et plugins Apollo utilisés.
4. Créer une branche `chore/nest11-upgrade` et environnement de staging dédié.

### Phase 2 — NestJS 9 → 10 (1 sprint)

1. `npx @nestjs/cli@10 update` + résolution des breaking changes Nest 10.
2. Vérifier `ScheduleModule`, `CacheModule`, guards JWT, Swagger.
3. Tests e2e + smoke mobile/admin.

### Phase 3 — NestJS 10 → 11 + Apollo Server 4 (2 sprints)

1. Remplacer `apollo-server-express` par `@apollo/server` + `@nestjs/apollo` v13.
2. Migrer la config GraphQL (`GraphQLModule.forRoot` → driver Apollo Server 4).
3. Adapter plugins (landing page, CSRF, format d’erreurs).
4. Valider subscriptions / scalars si utilisés.

### Phase 4 — Durcissement (0,5 sprint)

1. `npm audit fix` ciblé, Dependabot PRs mergées.
2. Mise à jour `firebase-functions` / Node runtime si nécessaire.
3. Déploiement canary API + monitoring erreurs 5xx / GraphQL.

---

## Risques

- **Apollo 3 → 4** : changement du serveur HTTP intégré ; retester uploads et contexte requête.
- **Nest 11** : décorateurs / injection ; vérifier modules dynamiques (`forRootAsync`).
- **Régression mobile** : aucun changement de contrat REST attendu ; valider GraphQL shop.

---

## Critères de succès

- Build + tests CI verts sur Nest 11 et Apollo Server 4.
- Aucune régression sur auth, checkout Stripe, webhooks, WS notify.
- `npm audit --audit-level=high` sans vulnérabilité non justifiée.

---

## Références

- [NestJS migration guide](https://docs.nestjs.com/migration-guide)
- [Apollo Server 4 migration](https://www.apollographql.com/docs/apollo-server/migration)
