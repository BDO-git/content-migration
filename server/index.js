const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Directories
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const EXTRACT_DIR = path.join(__dirname, '../extraction');

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(EXTRACT_DIR)) fs.mkdirSync(EXTRACT_DIR);

const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'AEM Migration Tool API is running' });
});

// Serve Frontend Build
app.use(express.static(path.join(__dirname, '../client/dist')));

// SPA Fallback
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
