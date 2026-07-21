const express = require('express');
const getDb = require('../db');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const packages = {
    '100': { credits: 100, price: 10 },
    '300': { credits: 300, price: 25 },
    '800': { credits: 800, price: 60 },
    '1500': { credits: 1500, price: 110 },
};

// Create Stripe Payment Intent
router.post('/create-intent', verifyToken, async (req, res) => {
    try {
        const { packageId } = req.body;
        const pkg = packages[packageId];

        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const paymentIntent = await stripe.paymentIntents.create({
            amount: pkg.price * 100, // cents
            currency: 'usd',
            metadata: {
                userEmail: req.user.email,
                credits: pkg.credits,
            },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        console.error('Payment intent error:', err);
        res.status(500).json({ error: 'Payment failed' });
    }
});

// Confirm payment & add credits
router.post('/confirm', verifyToken, async (req, res) => {
    try {
        const { paymentIntentId, packageId } = req.body;
        const pkg = packages[packageId];

        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        // Verify payment with Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ error: 'Payment not completed' });
        }

        const db = await getDb();

        // Add credits to user
        await db.collection('users').updateOne(
            { email: req.user.email },
            { $inc: { credits: pkg.credits } }
        );

        // Save payment record
        await db.collection('payments').insertOne({
            userEmail: req.user.email,
            packageId,
            credits: pkg.credits,
            amount: pkg.price,
            paymentIntentId,
            date: new Date(),
        });

        // Return updated credits
        const user = await db.collection('users').findOne({ email: req.user.email });
        res.json({ message: 'Payment successful', credits: user.credits });
    } catch (err) {
        console.error('Payment confirm error:', err);
        res.status(500).json({ error: 'Confirmation failed' });
    }
});

// Get payment history
router.get('/history', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const payments = await db
            .collection('payments')
            .find({ userEmail: req.user.email })
            .sort({ date: -1 })
            .toArray();
        res.json(payments);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;