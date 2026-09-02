const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch((err) => console.log('Database connection failed:', err));

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  date: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Initialize Gemini AI
let ai = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
    console.log('Gemini AI initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Gemini AI:', error.message);
  }
} else {
  console.warn('GEMINI_API_KEY not found in environment variables');
}

// Simple rule-based categorization as fallback
const categorizeByRules = (title) => {
  const lowerTitle = title.toLowerCase();
  
  // Income patterns
  if (lowerTitle.includes('salary') || lowerTitle.includes('income') || lowerTitle.includes('wage') || lowerTitle.includes('bonus')) {
    return { category: 'Salary', type: 'income' };
  }
  
  // Expense patterns
  if (lowerTitle.includes('food') || lowerTitle.includes('grocery') || lowerTitle.includes('restaurant') || lowerTitle.includes('meal')) {
    return { category: 'Food', type: 'expense' };
  }
  if (lowerTitle.includes('transport') || lowerTitle.includes('uber') || lowerTitle.includes('taxi') || lowerTitle.includes('bus') || lowerTitle.includes('fuel') || lowerTitle.includes('gas')) {
    return { category: 'Transport', type: 'expense' };
  }
  if (lowerTitle.includes('entertainment') || lowerTitle.includes('movie') || lowerTitle.includes('game') || lowerTitle.includes('netflix') || lowerTitle.includes('spotify')) {
    return { category: 'Entertainment', type: 'expense' };
  }
  if (lowerTitle.includes('utility') || lowerTitle.includes('electric') || lowerTitle.includes('water') || lowerTitle.includes('internet') || lowerTitle.includes('phone')) {
    return { category: 'Utilities', type: 'expense' };
  }
  if (lowerTitle.includes('shop') || lowerTitle.includes('mall') || lowerTitle.includes('amazon') || lowerTitle.includes('clothes')) {
    return { category: 'Shopping', type: 'expense' };
  }
  if (lowerTitle.includes('health') || lowerTitle.includes('doctor') || lowerTitle.includes('medicine') || lowerTitle.includes('pharmacy') || lowerTitle.includes('hospital')) {
    return { category: 'Health', type: 'expense' };
  }
  
  return { category: 'Other', type: 'expense' };
};

// AI Smart Categorization Route
app.post('/api/ai-categorize', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    // If AI is not available, use rule-based fallback
    if (!ai) {
      console.log('AI not available, using rule-based categorization');
      const result = categorizeByRules(title);
      return res.json(result);
    }

    const prompt = `Analyze this transaction title: "${title}".
    Classify it into one of these categories: Food, Transport, Salary, Entertainment, Utilities, Shopping, Health, Other.
    Also determine if it is 'income' or 'expense'.
    Return ONLY a valid JSON object in this exact format without any markdown formatting: {"category": "...", "type": "..."}`;

    // Fix: Use the correct @google/genai syntax for generating content
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    let text = response.text().trim();
    // Clean up markdown code blocks if present
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(text);
    res.json(result);
  } catch (error) {
    console.error('AI Error:', error.message);
    console.error('Full error:', error);
    
    // Fallback to rule-based categorization on error
    console.log('AI failed, using rule-based fallback');
    const fallbackResult = categorizeByRules(req.body.title);
    res.json(fallbackResult);
  }
});

// Get all transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add transaction
app.post('/api/transactions', async (req, res) => {
  try {
    const newTx = new Transaction(req.body);
    const saved = await newTx.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete transaction
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));