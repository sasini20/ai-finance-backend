const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch((err) => console.log('Database connection failed:', err));

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_this';

// --- User Schema & Model ---
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// --- Transaction Schema & Model ---
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- Auth Middleware to Protect Routes ---
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token.' });
    req.user = user;
    next();
  });
};

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'All fields are required' });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Initialize Gemini AI ---
let ai = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
    console.log('Gemini AI initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Gemini AI:', error.message);
  }
}

const categorizeByRules = (title) => {
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('salary') || lowerTitle.includes('income') || lowerTitle.includes('wage') || lowerTitle.includes('bonus')) {
    return { category: 'Salary', type: 'income' };
  }
  if (lowerTitle.includes('food') || lowerTitle.includes('grocery') || lowerTitle.includes('restaurant') || lowerTitle.includes('meal')) {
    return { category: 'Food', type: 'expense' };
  }
  if (lowerTitle.includes('transport') || lowerTitle.includes('uber') || lowerTitle.includes('taxi') || lowerTitle.includes('bus') || lowerTitle.includes('fuel')) {
    return { category: 'Transport', type: 'expense' };
  }
  if (lowerTitle.includes('entertainment') || lowerTitle.includes('movie') || lowerTitle.includes('game') || lowerTitle.includes('netflix')) {
    return { category: 'Entertainment', type: 'expense' };
  }
  if (lowerTitle.includes('utility') || lowerTitle.includes('electric') || lowerTitle.includes('water') || lowerTitle.includes('internet')) {
    return { category: 'Utilities', type: 'expense' };
  }
  return { category: 'Other', type: 'expense' };
};

// AI Smart Categorization Route (Protected)
app.post('/api/ai-categorize', verifyToken, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    if (!ai) {
      return res.json(categorizeByRules(title));
    }

    const prompt = `Analyze this transaction title: "${title}".
    Classify it into one of these categories: Food, Transport, Salary, Entertainment, Utilities, Shopping, Health, Other.
    Also determine if it is 'income' or 'expense'.
    Return ONLY a valid JSON object in this exact format without any markdown formatting: {"category": "...", "type": "..."}`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });

    let text = response.text().trim();
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    res.json(JSON.parse(text));
  } catch (error) {
    res.json(categorizeByRules(req.body.title));
  }
});

// --- Protected Transaction Routes ---
app.get('/api/transactions', verifyToken, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.userId }).sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', verifyToken, async (req, res) => {
  try {
    const newTx = new Transaction({ ...req.body, userId: req.user.userId });
    const saved = await newTx.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', verifyToken, async (runReq, res) => {
  try {
    await Transaction.findOneAndDelete({ _id: runReq.params.id, userId: runReq.user.userId });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));