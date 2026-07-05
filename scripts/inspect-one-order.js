/* eslint-disable */
require('dotenv').config();
const { MongoClient } = require('mongodb');

function buildUri() {
  const direct = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (direct) return direct;
  const host = (process.env.DB_HOST || '').trim();
  const user = (process.env.DB_USERNAME || '').trim();
  const pass = (process.env.DB_PASSWORD || '').trim();
  const db = (process.env.DB_DATABASE || '').trim();
  const dbPath = db ? `/${encodeURIComponent(db)}` : '';
  return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(
    pass,
  )}@${host}${dbPath}?retryWrites=true&w=majority`;
}

(async () => {
  const dbName = (process.env.DB_DATABASE || 'african_meals_db').trim();
  const client = new MongoClient(buildUri(), { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const orders = client.db(dbName).collection('orders');

  const assigned = await orders
    .find({ assignedDeliveryUser: { $exists: true, $ne: null } })
    .project({
      _id: 1,
      status: 1,
      shouldShip: 1,
      assignedDeliveryUser: 1,
      'deliveryAddressSnapshot.location': 1,
      'deliveryAddressSnapshot.address': 1,
      updatedAt: 1,
    })
    .toArray();
  console.log('--- Commandes avec livreur assigné ---');
  for (const o of assigned) {
    const loc = o.deliveryAddressSnapshot?.location;
    console.log(
      `${o._id} status=${o.status} shouldShip=${o.shouldShip} ` +
        `agent=${o.assignedDeliveryUser} destLoc=${loc ? JSON.stringify(loc) : 'ABSENT'}`,
    );
  }

  await client.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
