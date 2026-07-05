/* eslint-disable */
// Inspection dev : noms de champs réels + courses assignées / orphelines.
const { MongoClient } = require('mongodb');

const uri = `mongodb+srv://${encodeURIComponent('wise-eat')}:${encodeURIComponent(
  'astVVlNtC5ILfIbd',
)}@afrika-meals.y69qw4p.mongodb.net/african_meals_db?retryWrites=true&w=majority`;

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('african_meals_db');
  const orders = db.collection('orders');

  const sample = await orders.findOne(
    { assignedDeliveryUser: { $exists: true } },
    { projection: { assignedDeliveryUser: 1, assigned_delivery_user: 1, status: 1, shouldShip: 1, should_ship: 1 } },
  );
  console.log('--- Sample order with assignedDeliveryUser ---');
  console.log(JSON.stringify(sample, null, 2));

  const camelCount = await orders.countDocuments({ assignedDeliveryUser: { $exists: true } });
  const snakeCount = await orders.countDocuments({ assigned_delivery_user: { $exists: true } });
  console.log(`\nassignedDeliveryUser exists: ${camelCount}`);
  console.log(`assigned_delivery_user exists: ${snakeCount}`);

  const shippedWithAgent = await orders.countDocuments({
    assignedDeliveryUser: { $exists: true, $ne: null },
    status: 'shipped',
    shouldShip: true,
  });
  console.log(`\nSHIPPED + assignedDeliveryUser + shouldShip: ${shippedWithAgent}`);

  const orphaned = await orders
    .find({
      status: 'shipped',
      shouldShip: true,
      $or: [{ assignedDeliveryUser: { $exists: false } }, { assignedDeliveryUser: null }],
    })
    .project({ _id: 1, status: 1, createdAt: 1, updatedAt: 1 })
    .limit(50)
    .toArray();
  console.log(`\nOrphaned (SHIPPED, shouldShip, NO assignee): ${orphaned.length}`);
  for (const o of orphaned) {
    console.log(`  ${o._id}  updated=${o.updatedAt?.toISOString?.() ?? o.updatedAt}`);
  }

  await client.close();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
