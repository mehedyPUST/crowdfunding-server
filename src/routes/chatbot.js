require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const systemPrompt = `You are a helpful assistant for CrowdFund, a crowdfunding platform. 
Keep answers short, friendly, and under 3 sentences.
Key info:
- Supporters get 50 free credits on signup, Creators get 20
- Credit packages: 100/$10, 300/$25, 800/$60, 1500/$110
- Creators withdraw at 20 credits = $1, minimum 200 credits
- Campaigns need admin approval before going live
- Contributions are reviewed by creators before being accepted`;

router.post('/', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
            ],
            model: 'llama-3.3-70b-versatile',
            max_tokens: 150,
            temperature: 0.7,
        });

        res.json({ reply: chatCompletion.choices[0]?.message?.content || 'Sorry, I could not process that.' });
    } catch (err) {
        console.error('Chatbot error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;