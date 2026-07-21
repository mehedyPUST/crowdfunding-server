const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ========== CORS ==========
const allowedOrigins = [process.env.CLIENT_URL].filter(Boolean);
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
}));
app.use(express.json());

// ========== ROUTES ==========
app.use('/api/auth', require('./routes/auth'));
app.use('/api/campaigns', require('./routes/campaign'));
app.use('/api/withdrawals', require('./routes/withdrawal'));
app.use('/api/contributions', require('./routes/contribution'));
app.use('/api/payments', require('./routes/payment'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notification'));
app.use('/api/chatbot', require('./routes/chatbot'));

// ========== HEALTH CHECK ==========
app.get('/', (req, res) => {
    res.json({ message: 'Crowdfunding API is running' });
});

// ========== 404 ==========
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

module.exports = app;