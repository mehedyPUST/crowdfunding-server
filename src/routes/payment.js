const express = require('express');
require('dotenv').config();
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
            amount: pkg.price * 100,
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

// Create Stripe Checkout Session
router.post('/create-checkout', verifyToken, async (req, res) => {
    try {
        const { packageId } = req.body;
        const pkg = packages[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `${pkg.credits} Credits Package`,
                            description: `${pkg.credits} credits for CrowdFund platform`,
                        },
                        unit_amount: pkg.price * 100,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.CLIENT_URL}/dashboard/supporter/purchase-credit?session_id={CHECKOUT_SESSION_ID}&status=success`,
            cancel_url: `${process.env.CLIENT_URL}/dashboard/supporter/purchase-credit?status=cancelled`,
            metadata: {
                userEmail: req.user.email,
                packageId: packageId,
                credits: pkg.credits.toString(),
            },
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Checkout session error:', err);
        res.status(500).json({ error: 'Payment failed' });
    }
});

// Confirm payment & add credits
router.post('/confirm', verifyToken, async (req, res) => {
    try {
        const { paymentIntentId, packageId } = req.body;
        const pkg = packages[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        let paymentStatus = 'succeeded';
        let paymentId = paymentIntentId;

        // Check if it's a Checkout Session ID (starts with 'cs_')
        if (paymentIntentId && paymentIntentId.startsWith('cs_')) {
            const session = await stripe.checkout.sessions.retrieve(paymentIntentId);
            paymentStatus = session.payment_status;
            paymentId = session.payment_intent || paymentIntentId;
        } else if (paymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            paymentStatus = paymentIntent.status;
        } else {
            // Dummy payment fallback
            paymentStatus = 'succeeded';
            paymentId = 'dummy_' + Date.now();
        }

        if (paymentStatus !== 'succeeded' && paymentStatus !== 'paid') {
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
            paymentIntentId: paymentId,
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