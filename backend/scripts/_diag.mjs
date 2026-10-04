import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
console.log('base:', mongoose.connection.name);
const roles = await db.collection('users').aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray();
console.log(roles);
const etabs = new Map((await db.collection('etablissements').find({}).project({ nom: 1, proprietaireId: 1 }).toArray()).map(e => [String(e._id), e]));
console.log('etablissements:', etabs.size);
for (const u of await db.collection('users').find({ email: /zineb|fouad|lamgh|nouzri/i }).toArray()) {
  console.log(u.role, u.email, u.etablissementIds?.map(id => `${id}=${etabs.get(String(id))?.nom ?? 'INEXISTANT'}`));
}
