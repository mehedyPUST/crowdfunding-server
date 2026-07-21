const express = require('express');
const getDb = require('../db');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();

// Request withdrawal (creator only)
router.post('/', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'creator') {
            return res.status(403).json({ error: 'Only creators can withdraw' });
        }

        const { withdrawalCredits, withdrawalAmount, paymentSystem, accountNumber } = req.body;

        if (!withdrawalCredits || !withdrawalAmount || !paymentSystem || !accountNumber) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const db = await getDb();

        // Calculate total raised credits from all approved campaigns
        const campaigns = await db
            .collection('campaigns')
            .find({ creatorEmail: req.user.email, status: 'approved' })
            .toArray();

        const totalRaised = campaigns.reduce((sum, c) => sum + (c.raisedAmount || 0), 0);

        if (totalRaised < 200) {
            return res.status(400).json({ error: 'Minimum 200 credits required to withdraw' });
        }

        if (Number(withdrawalCredits) > totalRaised) {
            return res.status(400).json({ error: 'Insufficient raised credits' });
        }

        const withdrawal = {
            creatorEmail: req.user.email,
            creatorName: req.user.name,
            withdrawalCredits: Number(withdrawalCredits),
            withdrawalAmount: Number(withdrawalAmount),
            paymentSystem,
            accountNumber,
            status: 'pending',
            requestDate: new Date(),
        };

        await db.collection('withdrawals').insertOne(withdrawal);

        res.status(201).json({ message: 'Withdrawal request submitted' });
    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get my withdrawals (creator)
router.get('/my', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const withdrawals = await db
            .collection('withdrawals')
            .find({ creatorEmail: req.user.email })
            .sort({ requestDate: -1 })
            .toArray();

        res.json(withdrawals);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;