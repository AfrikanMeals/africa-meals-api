/* eslint-disable */
/*
 * Diagnostic livreur (DEV) : vérifie les noms de champs réels, les courses
 * actives et les commandes orphelines (SHIPPED sans livreur assigné).
 *
 * Usage :
 *   node scripts/inspect-delivery-fields.js            # rapport seul
 *   node scripts/inspect-delivery-fields.js --fix      # remet les orphelines en "approved"
 *
 * Lit la config Mongo depuis .env (DB_HOST / DB_USERNAME / DB_PASSWORD / DB_DATABASE
 * ou MONGODB_URI).
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

function buildUri() {
  const direct = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (direct) return direct;
  const host = (process.env.DB_HOST || '').trim();
  const user = (process.env.DB_USERNAME || '').trim();
  const pass = (process.env.DB_PASSWORD || '').trim();
  const db = (process.env.DB_DATABASE || '').trim();
  if (!host || !user || !pass) {
    throw new Error('Config Mongo manquante (.env DB_HOST/DB_USERNAME/DB_PASSWORD)');
  }
  const dbPath = db ? `/${encodeURIComponent(db)}` : '';
  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(
    pass,
  )}@${host}${dbPath}?retryWrites=true&w=majority`;
}

(async () => {
  const fix = process.argv.includes('--fix');
  const dbName = (process.env.DB_DATABASE || 'african_meals_db').trim();
  const client = new MongoClient(buildUri(), { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const orders = client.db(dbName).collection('orders');

  const camel = await orders.countDocuments({ assignedDeliveryUser: { $exists: true } });
  const snake = await orders.countDocuments({ assigned_delivery_user: { $exists: true } });
  console.log(`assignedDeliveryUser exists: ${camel}`);
  console.log(`assigned_delivery_user exists: ${snake} (doit être 0)`);

  const activeShipped = await orders.countDocuments({
    assignedDeliveryUser: { $exists: true, $ne: null },
    status: 'shipped',
    shouldShip: true,
  });
  console.log(`\nCourses actives (SHIPPED + livreur + shouldShip): ${activeShipped}`);

  const orphanFilter = {
    status: 'shipped',
    shouldShip: true,
    $or: [{ assignedDeliveryUser: { $exists: false } }, { assignedDeliveryUser: null }],
  };
  const orphaned = await orders
    .find(orphanFilter)
    .project({ _id: 1, updatedAt: 1, store: 1 })
    .toArray();
  console.log(`\nOrphelines (SHIPPED, shouldShip, sans livreur): ${orphaned.length}`);
  for (const o of orphaned) {
    console.log(`  ${o._id} updated=${o.updatedAt?.toISOString?.() ?? o.updatedAt}`);
  }

  // Incohérence inverse : livreur assigné mais commande NON expédiée (limbo).
  const limboFilter = {
    shouldShip: true,
    assignedDeliveryUser: { $exists: true, $ne: null },
    status: { $ne: 'shipped' },
  };
  const limbo = await orders
    .find(limboFilter)
    .project({ _id: 1, status: 1, assignedDeliveryUser: 1 })
    .toArray();
  console.log(`\nLimbo (livreur assigné + status ≠ shipped): ${limbo.length}`);
  for (const o of limbo) {
    console.log(`  ${o._id} status=${o.status} agent=${o.assignedDeliveryUser}`);
  }

  if (fix) {
    if (orphaned.length > 0) {
      const res = await orders.updateMany(orphanFilter, {
        $set: { status: 'approved' },
      });
      console.log(`\n[FIX] ${res.modifiedCount} orpheline(s) → "approved".`);
    }
    if (limbo.length > 0) {
      const res = await orders.updateMany(limboFilter, {
        $unset: { assignedDeliveryUser: '' },
      });
      console.log(
        `[FIX] ${res.modifiedCount} limbo → livreur retiré (redevient assignable).`,
      );
    }
  } else if (orphaned.length > 0 || limbo.length > 0) {
    console.log('\nAstuce : relancer avec --fix pour normaliser ces commandes.');
  }

  await client.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
