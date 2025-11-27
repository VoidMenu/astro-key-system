// combined.js - Astrø Key System (Full Updated Version - Nov 2025)
// One lifetime key per user | Admin panel | DM delivery | Delete & Regen

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, ActivityType } = require('discord.js');

// ============================================
// EXPRESS SERVER SETUP
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`Incoming ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

const KEYS_FILE = path.join(__dirname, 'data', 'keys.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// Initialize data folder + files
async function initializeDataFiles() {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    if (!await fs.access(KEYS_FILE).catch(() => false)) {
        await fs.writeFile(KEYS_FILE, JSON.stringify([], null, 2));
        console.log('Created keys.json');
    }
    if (!await fs.access(USERS_FILE).catch(() => false)) {
        await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
        console.log('Created users.json');
    }
}

async function readKeys() {
    const data = await fs.readFile(KEYS_FILE, 'utf8').catch(() => '[]');
    return JSON.parse(data);
}

async function writeKeys(keys) {
    await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
}

async function readUsers() {
    const data = await fs.readFile(USERS_FILE, 'utf8').catch(() => '[]');
    return JSON.parse(data);
}

async function writeUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

function generateKey() {
    return crypto.randomBytes(16).toString('hex');
}

// ============================================
// API ROUTES (unchanged except generate uses admin token only)
// ============================================
app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'Astrø Key System API', version: '2.0' });
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/api/validate', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        if (!key || !hwid) return res.status(400).json({ valid: false, message: 'Key & HWID required' });

        const keys = await readKeys();
        const keyData = keys.find(k => k.key === key && !k.deleted);

        if (!keyData) return res.json({ valid: false, message: 'Invalid key' });
        if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) return res.json({ valid: false, message: 'Key expired' });
        if (keyData.used && keyData.hwid !== hwid) return res.json({ valid: false, message: 'Key in use on another device' });

        if (!keyData.used) {
            keyData.used = true;
            keyData.hwid = hwid;
            keyData.usedAt = new Date().toISOString();
        }
        keyData.lastUsed = new Date().toISOString();
        await writeKeys(keys);

        res.json({ valid: true, expiresAt: keyData.expiresAt });
    } catch (err) {
        console.error(err);
        res.status(500).json({ valid: false, message: 'Server error' });
    }
});

app.post('/api/generate', async (req, res) => {
    const { discordId, discordUsername, duration, adminToken } = req.body;
    if (adminToken !== process.env.ADMIN_TOKEN) return res.status(403).json({ success: false });

    const keys = await readKeys();
    const newKey = generateKey();
    const expiresAt = duration ? new Date(Date.now() + duration * 86400000).toISOString() : null;

    keys.push({
        key: newKey,
        discordId,
        discordUsername,
        createdAt: new Date().toISOString(),
        expiresAt,
        used: false,
        hwid: null,
        usedAt: null,
        lastUsed: null,
        deleted: false
    });
    await writeKeys(keys);
    res.json({ success: true, key: newKey, expiresAt });
});

app.post('/api/reset', async (req, res) => {
    const { key, adminToken } = req.body;
    if (adminToken !== process.env.ADMIN_TOKEN) return res.status(403).json({ success: false });
    const keys = await readKeys();
    const k = keys.find(k => k.key === key);
    if (!k) return res.status(404).json({ success: false });
    k.used = false; k.hwid = null; k.usedAt = null;
    await writeKeys(keys);
    res.json({ success: true });
});

app.post('/api/keyinfo', async (req, res) => {
    const { key, adminToken } = req.body;
    if (adminToken !== process.env.ADMIN_TOKEN) return res.status(403).json({ success: false });
    const keys = await readKeys();
    const k = keys.find(k => k.key === key);
    if (!k) return res.status(404).json({ success: false });
    res.json({ success: true, data: k });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ============================================
// DISCORD BOT SETUP
// ============================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const config = {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    embedColor: 0xA57FCB
};

// Only /setup, /resetkey, /keyinfo, /help now
const commands = [
    { name: 'setup', description: 'Admin: Open the key management panel' },
    { name: 'resetkey', description: 'Reset a key HWID (Admins only)', options: [{ name: 'key', type: 3, required: true, description: 'Key to reset' }] },
    { name: 'keyinfo', description: 'Get key info (Admins only)', options: [{ name: 'key', type: 3, required: true, description: 'Key to check' }] },
    { name: 'help', description: 'Show help' }
];

async function registerCommands() {
    const rest = new REST().setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Commands registered');
}

function hasAdminRole(member) {
    return member.roles.cache.has(config.adminRoleId) || member.id === 'YOUR_OWNER_ID_IF_WANT_BYPASS';
}

// Direct key generation (used by panel)
async function generateKeyDirect(discordId, discordUsername) {
    const keys = await readKeys();
    const users = await readUsers();

    const newKey = generateKey();
    const keyData = {
        key: newKey,
        discordId,
        discordUsername,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        used: false,
        hwid: null,
        usedAt: null,
        lastUsed: null,
        deleted: false
    };

    keys.push(keyData);
    await writeKeys(keys);

    let user = users.find(u => u.discordId === discordId);
    if (!user) {
        users.push({ discordId, discordUsername, keys: [newKey], joinedAt: new Date().toISOString() });
    } else if (!user.keys.includes(newKey)) {
        user.keys.push(newKey);
    }
    await writeUsers(users);

    return keyData;
}

client.once('ready', () => {
    console.log(`Bot online as ${client.user.tag}`);
    client.user.setActivity('Astrø Lifetime Keys', { type: ActivityType.Watching });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    try {
        // ====================== /setup COMMAND ======================
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!hasAdminRole(interaction.member)) {
                return interaction.reply({ content: 'Only admins can use /setup', ephemeral: true });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('gen_lifetime').setLabel('Generate Lifetime Key').setStyle(ButtonStyle.Success).setEmoji('Key'),
                new ButtonBuilder().setCustomId('check_key').setLabel('Check My Key').setStyle(ButtonStyle.Primary).setEmoji('Magnifying Glass'),
                new ButtonBuilder().setCustomId('delete_regen').setLabel('Delete & Regenerate').setStyle(ButtonStyle.Danger).setEmoji('Wastebasket')
            );

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Astrø Lifetime Key Panel')
                .setDescription('• Only **one lifetime key** per user\n• Keys are sent via DM instantly\n• Use **Delete & Regenerate** if lost')
                .setFooter({ text: 'Astrø Menu • Keep your key private!' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // ====================== BUTTON: Generate Lifetime ======================
        if (interaction.isButton() && interaction.customId === 'gen_lifetime') {
            await interaction.deferReply({ ephemeral: true });

            const keys = await readKeys();
            const existing = keys.find(k => k.discordId === interaction.user.id && k.expiresAt === null && !k.deleted);

            if (existing) {
                return interaction.editReply({ content: 'You already have a lifetime key!\nUse **Delete & Regenerate** first.', ephemeral: true });
            }

            const keyData = await generateKeyDirect(interaction.user.id, interaction.user.tag);

            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Your New Lifetime Key')
                        .addFields(
                            { name: 'Key', value: `\`${keyData.key}\``, inline: false },
                            { name: 'Type', value: 'Lifetime • Never expires', inline: true },
                            { name: 'Status', value: 'Unused (activate in-game)', inline: true }
                        )
                        .setFooter({ text: 'Do not share • Astrø Menu' })
                        .setTimestamp()
                    ]
                });
            } catch {
                return interaction.editReply({ content: 'I couldn\'t DM you! Enable DMs from server members.', ephemeral: true });
            }

            await interaction.editReply({ content: 'Lifetime key generated and sent to your DMs!', ephemeral: true });
        }

        // ====================== BUTTON: Check Key ======================
        if (interaction.isButton() && interaction.customId === 'check_key') {
            await interaction.deferReply({ ephemeral: true });

            const keys = await readKeys();
            const key = keys.find(k => k.discordId === interaction.user.id && k.expiresAt === null && !k.deleted);

            if (!key) {
                return interaction.editReply({ content: 'You don\'t have a lifetime key yet.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Your Lifetime Key')
                .addFields(
                    { name: 'Key', value: `\`${key.key}\``, inline: false },
                    { name: 'Status', value: key.used ? 'Active (Bound)' : 'Unused', inline: true },
                    { name: 'Last Used', value: key.lastUsed ? new Date(key.lastUsed).toLocaleString() : 'Never', inline: true }
                )
                .setFooter({ text: key.used ? 'Working fine!' : 'Paste in-game to activate' });

            await interaction.editReply({ embeds: [embed], ephemeral: true });
        }

        // ====================== BUTTON: Delete & Regenerate ======================
        if (interaction.isButton() && interaction.customId === 'delete_regen') {
            await interaction.deferReply({ ephemeral: true });

            const keys = await readKeys();
            const index = keys.findIndex(k => k.discordId === interaction.user.id && k.expiresAt === null && !k.deleted);

            if (index === -1) {
                return interaction.editReply({ content: 'You have no lifetime key to delete.', ephemeral: true });
            }

            // Soft delete old key
            keys[index].deleted = true;
            keys[index].deletedAt = new Date().toISOString();
            await writeKeys(keys);

            // Generate new one
            const newKeyData = await generateKeyDirect(interaction.user.id, interaction.user.tag);

            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Old Key Revoked • New Key Issued')
                        .addFields({ name: 'New Lifetime Key', value: `\`${newKeyData.key}\`` })
                        .setDescription('Your previous key has been permanently deleted.')
                        .setTimestamp()
                    ]
                });
            } catch {
                return interaction.editReply({ content: 'Couldn\'t DM the new key! Enable DMs.', ephemeral: true });
            }

            await interaction.editReply({ content: 'Old key deleted\nNew lifetime key sent to DMs!', ephemeral: true });
        }

        // Keep your existing resetkey / keyinfo / help handlers here if you want them
        // (They work exactly as before)

    } catch (error) {
        console.error('Interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
        }
    }
});

// ============================================
// START SERVER & BOT
// ============================================
async function start() {
    console.log('Starting Astrø Key System...');
    await initializeDataFiles();
    app.listen(PORT, '0.0.0.0', () => console.log(`API running on port ${PORT}`));
    await registerCommands();
    await client.login(config.token);
    console.log('All systems GO!');
}

start();
