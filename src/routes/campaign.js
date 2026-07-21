const express = require('express');
const getDb = require('../db');
const verifyToken = require('../middleware/verifyToken');
const { ObjectId } = require('mongodb');
const router = express.Router();

// Add campaign (creator only)
router.post('/', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'creator') {
            return res.status(403).json({ error: 'Only creators can create campaigns' });
        }

        const { title, story, category, fundingGoal, minContribution, deadline, rewardInfo, image } = req.body;

        if (!title || !story || !category || !fundingGoal || !deadline) {
            return res.status(400).json({ error: 'All required fields must be filled' });
        }

        const db = await getDb();
        const campaign = {
            title,
            story,
            category,
            fundingGoal: Number(fundingGoal),
            minContribution: Number(minContribution) || 1,
            deadline: new Date(deadline),
            rewardInfo: rewardInfo || '',
            image: image || '',
            creatorEmail: req.user.email,
            creatorName: req.user.name,
            status: 'pending',
            raisedAmount: 0,
            createdAt: new Date(),
        };

        const result = await db.collection('campaigns').insertOne(campaign);

        res.status(201).json({
            message: 'Campaign submitted for approval',
            campaignId: result.insertedId,
        });
    } catch (err) {
        console.error('Campaign create error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get my campaigns (creator)
router.get('/my', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'creator') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const db = await getDb();
        const campaigns = await db
            .collection('campaigns')
            .find({ creatorEmail: req.user.email })
            .sort({ deadline: -1 })
            .toArray();

        res.json(campaigns);
    } catch (err) {
        console.error('My campaigns error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update campaign
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id), creatorEmail: req.user.email });

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        const { title, story, rewardInfo } = req.body;
        await db.collection('campaigns').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { title, story, rewardInfo } }
        );

        res.json({ message: 'Campaign updated' });
    } catch (err) {
        console.error('Update campaign error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get approved campaigns (for supporters to explore)
router.get('/', async (req, res) => {
    try {
        const db = await getDb();
        const now = new Date();
        const campaigns = await db
            .collection('campaigns')
            .find({ status: 'approved', deadline: { $gt: now } })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(campaigns);
    } catch (err) {
        console.error('Explore campaigns error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get single campaign
router.get('/:id', async (req, res) => {
    try {
        const db = await getDb();
        const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        res.json(campaign);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Delete campaign
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const db = await getDb();
        const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id), creatorEmail: req.user.email });

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Refund approved contributors
        const contributions = await db.collection('contributions').find({ campaignId: req.params.id, status: 'approved' }).toArray();
        for (const contrib of contributions) {
            await db.collection('users').updateOne(
                { email: contrib.contributorEmail },
                { $inc: { credits: contrib.amount } }
            );
        }

        // Delete contributions
        await db.collection('contributions').deleteMany({ campaignId: req.params.id });
        // Delete campaign
        await db.collection('campaigns').deleteOne({ _id: new ObjectId(req.params.id) });

        res.json({ message: 'Campaign deleted and contributors refunded' });
    } catch (err) {
        console.error('Delete campaign error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;