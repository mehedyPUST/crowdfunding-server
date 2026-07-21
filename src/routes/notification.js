require('dotenv').config();
const express = require('express');
const getDb = require('../db');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();

// Helper function to add notification (exported for other routes)
async function addNotification(toEmail, message, actionRoute) {
    try {
        const db = await getDb();
        await db.collection('notifications').insertOne({
            message,
            toEmail,
            actionRoute,
            time: new Date(),
            read: false,
        });
    } catch (err) {
        console.error('Notification insert error:', err);
    }
}

router.addNotification = addNotification;

// Get notifications for logged-in user
router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const notifications = await db
            .collection('notifications')
            .find({ toEmail: req.user.email })
            .sort({ time: -1 })
            .limit(20)
            .toArray();
        res.json(notifications);
    } catch (err) {
        console.error('Get notifications error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Mark all as read
router.patch('/read-all', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection('notifications').updateMany(
            { toEmail: req.user.email, read: false },
            { $set: { read: true } }
        );
        res.json({ message: 'All marked read' });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get unread count
router.get('/unread-count', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const count = await db.collection('notifications').countDocuments({
            toEmail: req.user.email,
            read: false,
        });
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;