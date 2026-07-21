require('dotenv').config();
const express = require('express');
const { ObjectId } = require('mongodb');
const getDb = require('../db');
const verifyToken = require('../middleware/verifyToken');
const notificationHelper = require('./notification');

const router = express.Router();

// Create contribution (supporter)
router.post('/', verifyToken, async (req, res) => {
    try {
        const { campaignId, campaignTitle, amount, creatorEmail, creatorName } = req.body;

        if (!campaignId || !amount || amount < 1) {
            return res.status(400).json({ error: 'Valid contribution amount required' });
        }

        const db = await getDb();

        const supporter = await db.collection('users').findOne({ email: req.user.email });
        if (!supporter || supporter.credits < amount) {
            return res.status(400).json({ error: 'Insufficient credits' });
        }

        await db.collection('users').updateOne(
            { email: req.user.email },
            { $inc: { credits: -Number(amount) } }
        );

        const contribution = {
            campaignId,
            campaignTitle,
            amount: Number(amount),
            contributorEmail: req.user.email,
            contributorName: req.user.name,
            creatorEmail,
            creatorName,
            status: 'pending',
            date: new Date(),
        };

        await db.collection('contributions').insertOne(contribution);

        // Notify creator
        await notificationHelper.addNotification(
            creatorEmail,
            `${req.user.name} contributed ${amount} credits to your campaign "${campaignTitle}"`,
            '/dashboard'
        );

        res.status(201).json({ message: 'Contribution submitted for review' });
    } catch (err) {
        console.error('Contribution error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get my contributions (supporter) with pagination
router.get('/my', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        const [contributions, total] = await Promise.all([
            db.collection('contributions')
                .find({ contributorEmail: req.user.email })
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('contributions').countDocuments({ contributorEmail: req.user.email }),
        ]);

        res.json({ contributions, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        console.error('My contributions error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pending contributions for creator
router.get('/pending', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const contributions = await db
            .collection('contributions')
            .find({ creatorEmail: req.user.email, status: 'pending' })
            .toArray();
        res.json(contributions);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Approve contribution (creator)
router.patch('/:id/approve', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const contrib = await db.collection('contributions').findOne({ _id: new ObjectId(req.params.id) });
        if (!contrib) return res.status(404).json({ error: 'Contribution not found' });

        await db.collection('contributions').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'approved' } }
        );

        await db.collection('campaigns').updateOne(
            { _id: new ObjectId(contrib.campaignId) },
            { $inc: { raisedAmount: contrib.amount } }
        );

        // Notify supporter
        await notificationHelper.addNotification(
            contrib.contributorEmail,
            `Your contribution of ${contrib.amount} credits to "${contrib.campaignTitle}" was approved by ${req.user.name}`,
            '/dashboard/my-contributions'
        );

        res.json({ message: 'Contribution approved' });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reject contribution (creator) - refund supporter
router.patch('/:id/reject', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const contrib = await db.collection('contributions').findOne({ _id: new ObjectId(req.params.id) });
        if (!contrib) return res.status(404).json({ error: 'Contribution not found' });

        await db.collection('contributions').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'rejected' } }
        );

        await db.collection('users').updateOne(
            { email: contrib.contributorEmail },
            { $inc: { credits: contrib.amount } }
        );

        // Notify supporter
        await notificationHelper.addNotification(
            contrib.contributorEmail,
            `Your contribution of ${contrib.amount} credits to "${contrib.campaignTitle}" was rejected by ${req.user.name}. Credits refunded.`,
            '/dashboard/my-contributions'
        );

        res.json({ message: 'Contribution rejected and refunded' });
    } catch (err) {
        console.error('Reject error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;