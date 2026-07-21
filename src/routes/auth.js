require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const getDb = require('../db');

const router = express.Router();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// ----- REGISTER -----
router.post('/register', async (req, res) => {
    try {
        const { name, email, photoURL, password, role } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: 'All fields required: name, email, password, role' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        if (!['supporter', 'creator'].includes(role)) {
            return res.status(400).json({ error: 'Role must be supporter or creator' });
        }

        const db = await getDb();
        const users = db.collection('users');

        const existing = await users.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const credits = role === 'supporter' ? 50 : 20;

        const newUser = {
            name,
            email: email.toLowerCase(),
            photoURL: photoURL || '',
            password: hashedPassword,
            role,
            credits,
            createdAt: new Date(),
        };

        await users.insertOne(newUser);

        const token = jwt.sign(
            { email: newUser.email, role: newUser.role, name: newUser.name },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Registration successful',
            token,
            user: {
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                credits: newUser.credits,
                photoURL: newUser.photoURL,
            },
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----- LOGIN -----
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const db = await getDb();
        const user = await db.collection('users').findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { email: user.email, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
                credits: user.credits,
                photoURL: user.photoURL,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----- GOOGLE SIGN-IN -----
router.post('/google-login', async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({ error: 'Google credential required' });
        }

        const client = new OAuth2Client(GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, picture } = payload;

        if (!email) {
            return res.status(400).json({ error: 'Unable to verify Google account' });
        }

        const db = await getDb();
        const users = db.collection('users');
        let user = await users.findOne({ email: email.toLowerCase() });

        if (!user) {
            const newUser = {
                name: name || 'User',
                email: email.toLowerCase(),
                photoURL: picture || '',
                password: '',
                role: 'supporter',
                credits: 50,
                createdAt: new Date(),
            };
            await users.insertOne(newUser);
            user = newUser;
        }

        const token = jwt.sign(
            { email: user.email, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Google sign-in successful',
            token,
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
                credits: user.credits,
                photoURL: user.photoURL,
            },
        });
    } catch (err) {
        console.error('Google login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----- GET ALL USERS (ADMIN) -----
router.get('/users', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Access denied' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const db = await getDb();
        const { role } = req.query;
        const filter = role ? { role } : {};
        const users = await db.collection('users').find(filter).project({ password: 0 }).toArray();

        res.json(users);
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;