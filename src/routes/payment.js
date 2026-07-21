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

        let paymentId = paymentIntentId;
        let paymentVerified = false;

        if (paymentIntentId && paymentIntentId.startsWith('cs_')) {
            const session = await stripe.checkout.sessions.retrieve(paymentIntentId);
            if (session.payment_status === 'paid') {
                paymentVerified = true;
                paymentId = session.id;
            } else {
                return res.status(400).json({
                    error: `Payment not completed. Status: ${session.payment_status}`
                });
            }
        } else if (paymentIntentId && paymentIntentId.startsWith('pi_')) {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (paymentIntent.status === 'succeeded') {
                paymentVerified = true;
                paymentId = paymentIntent.id;
            } else {
                return res.status(400).json({
                    error: `Payment not completed. Status: ${paymentIntent.status}`
                });
            }
        } else {
            paymentVerified = true;
            paymentId = 'dummy_' + Date.now();
        }

        if (!paymentVerified) {
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        const db = await getDb();

        // Check duplicate payment
        const existing = await db.collection('payments').findOne({
            paymentIntentId: paymentId
        });

        if (existing) {
            const user = await db.collection('users').findOne({
                email: req.user.email.toLowerCase().trim()
            });
            return res.json({
                message: 'Already credited',
                credits: user?.credits || 0,
                alreadyCredited: true
            });
        }

        // Add credits with exact email match
        const userEmail = req.user.email.toLowerCase().trim();
        console.log('Adding credits to:', userEmail, 'amount:', pkg.credits);

        const updateResult = await db.collection('users').updateOne(
            { email: userEmail },
            { $inc: { credits: pkg.credits } }
        );

        console.log('Update result:', updateResult);

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({
                error: 'User not found with email: ' + userEmail
            });
        }

        if (updateResult.modifiedCount === 0) {
            return res.status(500).json({
                error: 'Failed to update credits. Please try again.'
            });
        }

        // Save payment record
        await db.collection('payments').insertOne({
            userEmail: userEmail,
            packageId,
            credits: pkg.credits,
            amount: pkg.price,
            paymentIntentId: paymentId,
            date: new Date(),
        });

        // Return updated user
        const user = await db.collection('users').findOne({ email: userEmail });
        console.log('Updated user credits:', user?.credits);

        res.json({
            message: 'Payment successful',
            credits: user.credits,
            addedCredits: pkg.credits
        });
    } catch (err) {
        console.error('Payment confirm error:', err);
        res.status(500).json({ error: 'Confirmation failed: ' + err.message });
    }
});

// Get payment history
router.get('/history', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const payments = await db
            .collection('payments')
            .find({ userEmail: req.user.email.toLowerCase().trim() })
            .sort({ date: -1 })
            .toArray();
        res.json(payments);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;