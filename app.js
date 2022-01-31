const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();
const admin = require('firebase-admin');
const fileUpload = require('express-fileupload');
const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();
const port = process.env.PORT || 5000;

admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_ADMIN_TYPE,
    project_id: process.env.FIREBASE_ADMIN_PROJECT_ID,
    private_key_id: process.env.FIREBASE_ADMIN_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_ADMIN_CLIENT_ID,
    auth_uri: process.env.FIREBASE_ADMIN_AUTH_URI,
    token_uri: process.env.FIREBASE_ADMIN_TOKEN_URI,
    auth_provider_x509_cert_url:
      process.env.FIREBASE_ADMIN_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_ADMIN_CLIENT_X509_CERT_URL,
  }),
});

app.use(express.json());
app.use(cors());
app.use(fileUpload());

const dbUsername = process.env.DB_USERNAME;
const dbPassword = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME;
const uri = `mongodb+srv://${dbUsername}:${dbPassword}@cluster0.qctkg.mongodb.net/${dbName}?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const verifyToken = async (req, res, next) => {
  if (req.headers?.authorization?.startsWith('Bearer ')) {
    const idToken = req.headers.authorization.split(' ')[1];
    try {
      const decodedUser = await admin.auth().verifyIdToken(idToken);
      req.decodedEmail = decodedUser.email;
    } catch (error) {
      console.log(error);
    }
  }
  next();
};

const run = async () => {
  try {
    await client.connect();

    const database = client.db('fOOdy');
    const menuCollection = database.collection('menu');
    const userCollection = database.collection('users');
    const orderCollection = database.collection('orders');

    // POST API Create user
    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.json(result);
    });

    // GET API for users
    app.get('/users', async (req, res) => {
      const cursor = userCollection.find({});
      const users = await cursor.toArray();
      res.json(users);
    });

    // PUT API for user upsert
    app.put('/users', async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const option = { upsert: true };
      const updateDoc = { $set: user };
      const result = userCollection.updateOne(filter, updateDoc, option);
      res.json(result);
    });

    // PUT API for make admin
    app.put('/users/admin', verifyToken, async (req, res) => {
      const user = req.body;
      const requester = req.decodedEmail;
      if (requester) {
        const requesterAccount = await userCollection.findOne({
          email: requester,
        });
        if (requesterAccount.role === 'admin') {
          const filter = { email: user.email };
          const update = { $set: { role: 'admin' } };
          const result = await userCollection.updateOne(filter, update);
          res.json(result);
        }
      } else {
        res.status(401).json({ errorMessage: 'Unauthorized User' });
      }
    });

    // GET API for admin
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      let isAdmin = false;
      if (user?.role === 'admin') {
        isAdmin = true;
      }
      res.send({ admin: isAdmin });
    });

    // GET API All Menu Items
    app.get('/menu', async (req, res) => {
      let menu;
      const page = req.query.page;
      const size = parseInt(req.query.size);
      const menuItems = menuCollection.find({});
      const count = await menuItems.count();
      if (page) {
        menu = await menuItems
          .skip(page * size)
          .limit(size)
          .toArray();
      } else {
        menu = await menuItems.toArray();
      }
      res.send({
        count,
        menu,
      });
    });

    // POST API for menu
    app.post('/menu', async (req, res) => {
      const { name, price, category, star, reviews } = req.body;
      const img = req.files.img;
      const imgData = img.data;
      const encodedImg = imgData.toString('base64');
      const imgBuffer = Buffer.from(encodedImg, 'base64');
      const menuItem = {
        name,
        price,
        category,
        star,
        reviews,
        img: imgBuffer,
      };
      const result = await menuCollection.insertOne(menuItem);
      res.json(result);
      console.log(result);
    });

    // POST API for orders
    app.post('/orders', async (req, res) => {
      const data = req.body;
      const options = { ordered: true };
      const orders = await orderCollection.insertMany(data, options);
      console.log(orders);
      res.send(orders);
    });

    // GET API for orders
    app.get('/orders', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (req.decodedEmail === email) {
        const query = { email };
        const cursor = orderCollection.find(query);
        const orders = await cursor.toArray();
        res.send(orders);
      } else {
        res.status(401).json({ message: 'Unauthorized User' });
      }
    });

    // POST API for payment
    app.post('/create-payment-intent', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      console.log(amount);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
  } finally {
    // await client.close();
    console.log('Database Connected');
  }
};

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World');
});

app.listen(port, () => {
  console.log('Server is running on port: ', port);
});
