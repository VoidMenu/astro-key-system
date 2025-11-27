// combined.js - Run both Server and Bot in one process
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActivityType } = require('discord.js');

// ============================================
// EXPRESS SERVER SETUP
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const KEYS_FILE = path.join(__dirname, 'data', 'keys.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Initialize data files
async function initializeDataFiles() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
        
        try {
            await fs.access(KEYS_FILE);
        } catch {
            await fs.writeFile(KEYS_FILE, JSON.stringify([], null, 2));
            console.log('✅ Created keys.json');
        }
        
        try {
            await fs.access(USERS_FILE);
        } catch {
            await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
            console.log('✅ Created users.json');
        }
    } catch (error) {
        console.error('❌ Error initializing data files:', error);
    }
}

async function readKeys() {
    try {
        const data = await fs.readFile(KEYS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading keys:', error);
        return [];
    }
}

async function writeKeys(keys) {
    try {
        await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
    } catch (error) {
        console.error('Error writing keys:', error);
    }
}

async function readUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading users:', error);
        return [];
    }
}

async function writeUsers(users) {
    try {
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('Error writing users:', error);
    }
}

function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

// ============================================
// API ROUTES
// ============================================

app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: 'Astrø Key System API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /health',
            validate: 'POST /api/validate',
            generate: 'POST /api/generate',
            reset: 'POST /api/reset',
            keyinfo: 'POST /api/keyinfo'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Astrø Key System Server Running',
        timestamp: new Date().toISOString()
    });
});

app.post('/api/validate', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        
        console.log(`📝 Validation request - Key: ${key?.substring(0, 8)}...`);
        
        if (!key) {
            return res.status(400).json({ 
                valid: false, 
                message: 'Key is required' 
            });
        }

        const keys = await readKeys();
        const keyData = keys.find(k => k.key === key);

        if (!keyData) {
            console.log(`❌ Key not found`);
            return res.json({ 
                valid: false, 
                message: 'Invalid key' 
            });
        }

        if (keyData.used && keyData.hwid !== hwid) {
            console.log(`❌ Key already in use by different HWID`);
            return res.json({ 
                valid: false, 
                message: 'Key already in use' 
            });
        }

        if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
            console.log(`❌ Key expired`);
            return res.json({ 
                valid: false, 
                message: 'Key expired' 
            });
        }

        if (!keyData.used) {
            keyData.used = true;
            keyData.usedAt = new Date().toISOString();
            keyData.hwid = hwid;
            keyData.lastUsed = new Date().toISOString();
            await writeKeys(keys);
            console.log(`✅ Key activated`);
        } else {
            keyData.lastUsed = new Date().toISOString();
            await writeKeys(keys);
            console.log(`✅ Key re-validated`);
        }

        res.json({ 
            valid: true, 
            message: 'Key validated successfully',
            expiresAt: keyData.expiresAt 
        });

    } catch (error) {
        console.error('❌ Validation error:', error);
        res.status(500).json({ 
            valid: false, 
            message: 'Server error' 
        });
    }
});

app.post('/api/generate', async (req, res) => {
    try {
        const { discordId, discordUsername, duration, adminToken } = req.body;

        console.log(`🔑 Key generation request from: ${discordUsername}`);

        if (adminToken !== process.env.ADMIN_TOKEN) {
            console.log(`❌ Unauthorized`);
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const keys = await readKeys();
        const users = await readUsers();

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

        console.log(`✅ Key generated: ${newKey.substring(0, 8)}...`);

        res.json({ 
            success: true, 
            key: newKey,
            expiresAt 
        });

    } catch (error) {
        console.error('❌ Generation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

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

        console.log(`✅ Key reset`);

        res.json({ 
            success: true, 
            message: 'Key reset successfully' 
        });

    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

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
        console.error('❌ Key info error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// ============================================
// DISCORD BOT SETUP
// ============================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const config = {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    serverUrl: `http://localhost:${PORT}`, // Use local server
    adminToken: process.env.ADMIN_TOKEN,
    buyerRoleId: process.env.BUYER_ROLE_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    embedColor: 0xA57FCB
};

const commands = [
    {
        name: 'generatekey',
        description: 'Generate a new key (Buyers only)',
        options: [{
            name: 'duration',
            description: 'Key duration in days (leave empty for lifetime)',
            type: 4,
            required: false
        }]
    },
    {
        name: 'resetkey',
        description: 'Reset a key HWID (Admins only)',
        options: [{
            name: 'key',
            description: 'The key to reset',
            type: 3,
            required: true
        }]
    },
    {
        name: 'keyinfo',
        description: 'Get information about a key (Admins only)',
        options: [{
            name: 'key',
            description: 'The key to check',
            type: 3,
            required: true
        }]
    },
    {
        name: 'help',
        description: 'Show available commands and information'
    }
];

async function registerCommands() {
    try {
        console.log('📝 Registering Discord commands...');
        const rest = new REST({ version: '10' }).setToken(config.token);
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        console.log('✅ Discord commands registered');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

function hasBuyerRole(member) {
    return member.roles.cache.has(config.buyerRoleId);
}

function hasAdminRole(member) {
    return member.roles.cache.has(config.adminRoleId);
}

client.once('ready', () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    client.user.setActivity('Astrø Menu Keys', { type: ActivityType.Watching });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, member } = interaction;

    try {
        if (commandName === 'generatekey') {
            if (!hasBuyerRole(member)) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Access Denied')
                    .setDescription('You need the Buyer role to generate keys!')
                    .setTimestamp();
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const duration = interaction.options.getInteger('duration');

            // Call local function directly (no HTTP request needed)
            const keyData = await generateKeyDirect(user.id, user.username, duration);

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('🔑 Key Generated Successfully!')
                .addFields(
                    { name: '🎟️ Key', value: `\`${keyData.key}\``, inline: false },
                    { name: '⏰ Duration', value: duration ? `${duration} days` : 'Lifetime', inline: true },
                    { name: '📅 Expires', value: keyData.expiresAt ? new Date(keyData.expiresAt).toLocaleDateString() : 'Never', inline: true }
                )
                .setFooter({ text: 'Keep your key private! • Astrø Menu' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
        else if (commandName === 'resetkey') {
            if (!hasAdminRole(member)) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Access Denied')
                    .setDescription('This command is only available to administrators!')
                    .setTimestamp();
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const key = interaction.options.getString('key');

            await resetKeyDirect(key);

            const embed = new EmbedBuilder()
                .setColor('#4CAF50')
                .setTitle('✅ Key Reset Successfully')
                .setDescription(`The key \`${key}\` has been reset and can be used again.`)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
        else if (commandName === 'keyinfo') {
            if (!hasAdminRole(member)) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Access Denied')
                    .setDescription('This command is only available to administrators!')
                    .setTimestamp();
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const key = interaction.options.getString('key');

            const keys = await readKeys();
            const keyData = keys.find(k => k.key === key);

            if (!keyData) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Error')
                    .setDescription('Key not found')
                    .setTimestamp();
                return await interaction.editReply({ embeds: [embed] });
            }

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('🔍 Key Information')
                .addFields(
                    { name: '🎟️ Key', value: `\`${keyData.key}\``, inline: false },
                    { name: '👤 Owner', value: keyData.discordUsername || 'Unknown', inline: true },
                    { name: '📊 Status', value: keyData.used ? '🔴 Used' : '🟢 Unused', inline: true },
                    { name: '📅 Created', value: new Date(keyData.createdAt).toLocaleString(), inline: true },
                    { name: '⏰ Expires', value: keyData.expiresAt ? new Date(keyData.expiresAt).toLocaleString() : 'Never', inline: true },
                    { name: '🖥️ HWID', value: keyData.hwid || 'Not bound', inline: true },
                    { name: '🕐 Last Used', value: keyData.lastUsed ? new Date(keyData.lastUsed).toLocaleString() : 'Never', inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
        else if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('📚 Astrø Key System - Help')
                .setDescription('Welcome to the Astrø Menu key system!')
                .addFields(
                    { name: '🔑 /generatekey', value: 'Generate a new key (Buyers only)', inline: false },
                    { name: '🔄 /resetkey', value: 'Reset a key\'s HWID (Admins only)', inline: false },
                    { name: '🔍 /keyinfo', value: 'View detailed key information (Admins only)', inline: false }
                )
                .setFooter({ text: 'Astrø Menu • discord.gg/sUcs6yTsJT' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    } catch (error) {
        console.error('Command execution error:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('❌ Error')
            .setDescription('An unexpected error occurred.')
            .setTimestamp();

        if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// Direct key generation (bypasses HTTP)
async function generateKeyDirect(discordId, discordUsername, duration) {
    const keys = await readKeys();
    const users = await readUsers();

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

    console.log(`✅ Key generated: ${newKey.substring(0, 8)}... for ${discordUsername}`);

    return keyData;
}

async function resetKeyDirect(key) {
    const keys = await readKeys();
    const keyData = keys.find(k => k.key === key);

    if (!keyData) {
        throw new Error('Key not found');
    }

    keyData.used = false;
    keyData.hwid = null;
    keyData.usedAt = null;
    await writeKeys(keys);

    console.log(`✅ Key reset: ${key.substring(0, 8)}...`);

    return true;
}

// ============================================
// START EVERYTHING
// ============================================

async function start() {
    try {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   🚀 Astrø Key System (Combined)      ║');
        console.log('╚════════════════════════════════════════╝');
        
        // Initialize data files
        await initializeDataFiles();
        
        // Start Express server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ API Server running on port ${PORT}`);
        });
        
        // Register and start Discord bot
        await registerCommands();
        await client.login(config.token);
        
        console.log('✅ All systems operational!');
    } catch (error) {
        console.error('❌ Startup error:', error);
        process.exit(1);
    }
}

start();
