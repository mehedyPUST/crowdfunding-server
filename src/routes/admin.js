require('dotenv').config();
const express = require('express');
const { ObjectId } = require('mongodb');
const getDb = require('../db');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();

// Middleware: Admin only
const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Get all users
router.get('/users', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        const { role } = req.query;
        const filter = role ? { role } : {};
        const users = await db.collection('users').find(filter).toArray();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user role
router.patch('/users/:id/role', verifyToken, adminOnly, async (req, res) => {
    try {
        const { role } = req.body;
        if (!['supporter', 'creator', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const db = await getDb();
        await db.collection('users').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role } }
        );

        res.json({ message: 'Role updated' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete user
router.delete('/users/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pending campaigns
router.get('/campaigns/pending', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        const campaigns = await db.collection('campaigns').find({ status: 'pending' }).toArray();
        res.json(campaigns);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Approve campaign
router.patch('/campaigns/:id/approve', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection('campaigns').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'approved' } }
        );
        res.json({ message: 'Campaign approved' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reject campaign
router.patch('/campaigns/:id/reject', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection('campaigns').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'rejected' } }
        );
        res.json({ message: 'Campaign rejected' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete any campaign
router.delete('/campaigns/:id', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection('contributions').deleteMany({ campaignId: req.params.id });
        await db.collection('campaigns').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ message: 'Campaign deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pending withdrawals
router.get('/withdrawals/pending', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        const withdrawals = await db.collection('withdrawals').find({ status: 'pending' }).toArray();
        res.json(withdrawals);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Approve withdrawal (payment success)
router.patch('/withdrawals/:id/approve', verifyToken, adminOnly, async (req, res) => {
    try {
        const db = await getDb();
        const withdrawal = await db.collection('withdrawals').findOne({ _id: new ObjectId(req.params.id) });
        if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

        await db.collection('withdrawals').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'approved' } }
        );

        // Decrease creator's raised credits proportionally across campaigns
        const campaigns = await db.collection('campaigns').find({ creatorEmail: withdrawal.creatorEmail }).toArray();
        let remaining = withdrawal.withdrawalCredits;
        for (const camp of campaigns) {
            if (remaining <= 0) break;
            const deduct = Math.min(camp.raisedAmount || 0, remaining);
            await db.collection('campaigns').updateOne(
                { _id: camp._id },
                { $inc: { raisedAmount: -deduct } }
            );
            remaining -= deduct;
        }

        res.json({ message: 'Withdrawal approved' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;