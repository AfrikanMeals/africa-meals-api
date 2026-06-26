# Projection de champs (sparse fieldsets)

Réduction des payloads JSON via query params sur **toutes les routes HTTP REST** (sauf GraphQL).

## Paramètres

| Param | Alias legacy | Rôle |
|-------|--------------|------|
| `fields` | `includeFields` | Whitelist de champs |
| `include` | `includeFields` | Idem `fields` (union si les deux sont présents) |
| `exclude` | `excludeField`, `excludeFields` | Blacklist |
| `fieldsRoot` | — | Scope explicite pour listes paginées |

## Exemples

```http
GET /api/auth/me?fields=id,fullName,email,phoneNumber
GET /api/search?fields=id,title,price&fieldsRoot=items&searchContent=products
GET /api/orders?fields=status,totalPrice,store.name,items[].label
GET /api/admin/users?fields=id,fullName,email,type&exclude=metadata
```

## Syntaxe des chemins

- `id`, `user.name` — champs plats ou imbriqués
- `user.address[].city` — projection sur chaque élément d’un tableau
- `user.address[](city,long)` — plusieurs champs par élément de tableau
- `user.*.yearBirth` — wildcard sur un segment

## Enveloppes paginées

Réponse `{ items: [...], total, page }` + `?fields=id,name` :

- **Auto-envelope** : si `id`/`name` ne sont pas à la racine, la projection s’applique à chaque élément de `items` (ou `data` / `results` / `records`).
- Les métadonnées `total`, `page`, `limit`, `take`, `skip`, `nextCursor`, `totalPages`, `hasMore` sont conservées.
- `fieldsRoot=items` force le scope sans heuristique.

## Sécurité

Une **denylist serveur** retire toujours : `password`, `passwordHash`, `refreshToken`, `stripeSecret`, `__v`, etc. — même si demandés dans `fields`.

## GraphQL

Les requêtes `/graphql` ne sont **pas** filtrées par ce mécanisme.

## Cache

Les réponses GET filtrées sur routes catalogue peuvent être mises en cache (`fieldProjection` module) — voir réglages cache admin.
