// server.js - Key Authentication Server
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// File paths for data storage
const KEYS_FILE = path.join(__dirname, 'data', 'keys.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Initialize data files if they don't exist
async function initializeDataFiles() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
        
        try {
            await fs.access(KEYS_FILE);
        } catch {
            await fs.writeFile(KEYS_FILE, JSON.stringify([], null, 2));
        }
        
        try {
            await fs.access(USERS_FILE);
        } catch {
            await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
        }
    } catch (error) {
        console.error('Error initializing data files:', error);
    }
}

// Read keys from file
async function readKeys() {
    try {
        const data = await fs.readFile(KEYS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading keys:', error);
        return [];
    }
}

// Write keys to file
async function writeKeys(keys) {
    try {
        await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
    } catch (error) {
        console.error('Error writing keys:', error);
    }
}

// Read users from file
async function readUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading users:', error);
        return [];
    }
}

// Write users to file
async function writeUsers(users) {
    try {
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error writing users:', error);
    }
}

// Generate a random key
function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

// API Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Astrø Key System Server Running' });
});

// Validate a key (called by Unity client)
app.post('/api/validate', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        
        if (!key) {
            return res.status(400).json({ 
                valid: false, 
                message: 'Key is required' 
            });
        }

        const keys = await readKeys();
        const keyData = keys.find(k => k.key === key);

        if (!keyData) {
            return res.json({ 
                valid: false, 
                message: 'Invalid key' 
            });
        }

        // Check if key is already used
        if (keyData.used && keyData.hwid !== hwid) {
            return res.json({ 
                valid: false, 
                message: 'Key already in use' 
            });
        }

        // Check if key is expired
        if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
            return res.json({ 
                valid: false, 
                message: 'Key expired' 
            });
        }

        // Update key usage
        if (!keyData.used) {
            keyData.used = true;
            keyData.usedAt = new Date().toISOString();
            keyData.hwid = hwid;
            keyData.lastUsed = new Date().toISOString();
            await writeKeys(keys);
        } else {
            keyData.lastUsed = new Date().toISOString();
            await writeKeys(keys);
        }

        res.json({ 
            valid: true, 
            message: 'Key validated successfully',
            expiresAt: keyData.expiresAt 
        });

    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ 
            valid: false, 
            message: 'Server error' 
        });
    }
});

// Generate a new key (called by Discord bot)
app.post('/api/generate', async (req, res) => {
    try {
        const { discordId, discordUsername, duration, adminToken } = req.body;

        // Simple admin token verification (you should use environment variables)
        if (adminToken !== process.env.ADMIN_TOKEN) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const keys = await readKeys();
        const users = await readUsers();

        // Generate new key
        const newKey = generateKey();
        const expiresAt = duration ? 
            new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString() : 
            null;

        const keyData = {
            key: newKey,
            discordId,
            discordUsername,
            createdAt: new Date().toISOString(),
            expiresAt,
            used: false,
            hwid: null,
            usedAt: null,
            lastUsed: null
        };

        keys.push(keyData);
        await writeKeys(keys);

        // Update user data
        let user = users.find(u => u.discordId === discordId);
        if (user) {
            user.keys.push(newKey);
            user.lastKeyGenerated = new Date().toISOString();
        } else {
            users.push({
                discordId,
                discordUsername,
                keys: [newKey],
                joinedAt: new Date().toISOString(),
                lastKeyGenerated: new Date().toISOString()
            });
        }
        await writeUsers(users);

        res.json({ 
            success: true, 
            key: newKey,
            expiresAt 
        });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Reset a key (called by Discord bot for support)
app.post('/api/reset', async (req, res) => {
    try {
        const { key, adminToken } = req.body;

        if (adminToken !== process.env.ADMIN_TOKEN) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const keys = await readKeys();
        const keyData = keys.find(k => k.key === key);

        if (!keyData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Key not found' 
            });
        }

        keyData.used = false;
        keyData.hwid = null;
        keyData.usedAt = null;
        await writeKeys(keys);

        res.json({ 
            success: true, 
            message: 'Key reset successfully' 
        });

    } catch (error) {
        console.error('Reset error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get key info (for Discord bot)
app.post('/api/keyinfo', async (req, res) => {
    try {
        const { key, adminToken } = req.body;

        if (adminToken !== process.env.ADMIN_TOKEN) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const keys = await readKeys();
        const keyData = keys.find(k => k.key === key);

        if (!keyData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Key not found' 
            });
        }

        res.json({ 
            success: true, 
            data: keyData 
        });

    } catch (error) {
        console.error('Key info error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Start server
initializeDataFiles().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Astrø Key System Server running on port ${PORT}`);
        console.log(`📡 API endpoint: http://localhost:${PORT}`);
    });
});

module.exports = app;
