const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.DB_URI;

let client;
let clientPromise;

if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
    const client = await clientPromise;
    return client.db(); // ডিফল্ট DB URI-তে যেটা আছে (crowdfunding)
}

module.exports = getDb;