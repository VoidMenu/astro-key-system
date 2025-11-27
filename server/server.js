// combined.js — FULLY FIXED & WORKING (November 2025)

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    ActivityType
} = require('discord.js');

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

const KEYS_FILE = path.join(__dirname, 'data', 'keys.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

async function initFiles() {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    if (!await fs.stat(KEYS_FILE).catch(() => false)) await fs.writeFile(KEYS_FILE, '[]');
    if (!await fs.stat(USERS_FILE).catch(() => false)) await fs.writeFile(USERS_FILE, '[]');
}

async function readKeys() { return JSON.parse(await fs.readFile(KEYS_FILE, 'utf8').catch(() => '[]')); }
async function writeKeys(k) { await fs.writeFile(KEYS_FILE, JSON.stringify(k, null, 2)); }
async function readUsers() { return JSON.parse(await fs.readFile(USERS_FILE, 'utf8').catch(() => '[]')); }
async function writeUsers(u) { await fs.writeFile(USERS_FILE, JSON.stringify(u, null, 2)); }

function generateKey() { return crypto.randomBytes(20).toString('hex'); }

// API Routes (unchanged — only admin token needed)
app.post('/api/validate', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        if (!key || !hwid) return res.status(400).json({ valid: false });

        const keys = await readKeys();
        const k = keys.find(x => x.key === key && !x.deleted);
        if (!k) return res.json({ valid: false, message: 'Invalid key' });
        if (k.expiresAt && new Date(k.expiresAt) < new Date()) return res.json({ valid: false, message: 'Expired' });

        if (k.used && k.hwid !== hwid) return res.json({ valid: false, message: 'Key in use' });

        if (!k.used) {
            k.used = true; k.hwid = hwid; k.usedAt = new Date().toISOString();
        }
        k.lastUsed = new Date().toISOString();
        await writeKeys(keys);

        res.json({ valid: true });
    } catch (e) { res.status(500).json({ valid: false }); }
});

app.post('/api/generate', async (req, res) => {
    if (req.body.adminToken !== process.env.ADMIN_TOKEN) return res.status(403).json({ success: false });
    const keys = await readKeys();
    const newKey = generateKey();
    keys.push({
        key: newKey,
        discordId: req.body.discordId,
        discordUsername: req.body.discordUsername,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        used: false,
        hwid: null,
        deleted: false
    });
    await writeKeys(keys);
    res.json({ success: true, key: newKey });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ============================================
// DISCORD BOT
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

const commands = [
    { name: 'setup', description: 'Admin → Open lifetime key panel' },
    { name: 'help', description: 'Show help' }
];

client.once('ready', async () => {
    console.log(`Bot ready as ${client.user.tag}`);
    client.user.setActivity('Lifetime Keys', { type: ActivityType.Watching });

    const rest = new REST().setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Commands registered');
});

function isAdmin(member) {
    return member.roles.cache.has(config.adminRoleId) || member.id === 'YOUR_OWNER_ID_IF_NEEDED';
}

async function generateLifetimeKey(discordId, username) {
    const keys = await readKeys();
    const newKey = generateKey();
    keys.push({
        key: newKey,
        discordId,
        discordUsername: username,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        used: false,
        hwid: null,
        usedAt: null,
        lastUsed: null,
        deleted: false
    });
    await writeKeys(keys);
    return newKey;
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    try {
        // ============= /setup =============
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: 'Only admins can use /setup', ephemeral: true });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('gen_key').setLabel('Generate Lifetime Key').setStyle(ButtonStyle.Success).setEmoji('🔑'),
                new ButtonBuilder().setCustomId('check_key').setLabel('Check My Key').setStyle(ButtonStyle.Primary).setEmoji('🔍'),
                new ButtonBuilder().setCustomId('delete_regen').setLabel('Delete & Regenerate').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
            );

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Astrø Lifetime Key Panel')
                .setDescription('• One lifetime key per user\n• Keys sent via DM instantly')
                .setFooter({ text: 'Keep your key private!' });

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // ============= Generate Key =============
        if (interaction.isButton() && interaction.customId === 'gen_key') {
            await interaction.deferReply({ ephemeral: true });

            const keys = await readKeys();
            const existing = keys.find(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (existing) {
                return interaction.editReply({ content: 'You already have a lifetime key!\nUse **Delete & Regenerate** if you lost it.', ephemeral: true });
            }

            const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);

            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Your Lifetime Key')
                        .addFields({ name: 'Key', value: `\`${newKey}\`` })
                        .setFooter({ text: 'Never expires • Do not share' })
                    ]
                });
                await interaction.editReply({ content: 'Lifetime key generated and sent to your DMs!', ephemeral: true });
            } catch {
                await interaction.editReply({ content: 'I couldn\'t DM you the key! Enable DMs from server members.', ephemeral: true });
            }
        }

        // ============= Check Key =============
        if (interaction.isButton() && interaction.customId === 'check_key') {
            await interaction.deferReply({ ephemeral: true });

            const keys = await readKeys();
            const key = keys.find(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (!key) return interaction.editReply({ content: 'You don\'t have a lifetime key.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Your Lifetime Key')
                .addFields(
                    { name: 'Key', value: `\`${key.key}\``, inline: false },
                    { name: 'Status', value: key.used ? 'Active (bound)' : 'Unused', inline: true },
                    { name: 'Last Used', value: key.lastUsed ? new Date(key.lastUsed).toLocaleString() : 'Never', inline: true }
                );

            await interaction.editReply({ embeds: [embed], ephemeral: true });
        }

        // ============= Delete & Regenerate =============
        if (interaction.isButton() && interaction.customId === 'delete_regen') {
            await interaction.deferReply({ ephemeral: true });

            const keys = await readKeys();
            const idx = keys.findIndex(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (idx === -1) return interaction.editReply({ content: 'No lifetime key to delete.', ephemeral: true });

            keys[idx].deleted = true;
            keys[idx].deletedAt = new Date().toISOString();
            await writeKeys(keys);

            const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);

            try {
                await interaction.user.send({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Old Key Revoked — New Key Issued')
                        .addFields({ name: 'New Key', value: `\`${newKey}\`` })
                        .setDescription('Your previous key is now invalid.')
                    ]
                });
                await interaction.editReply({ content: 'Old key deleted → New key sent to DMs!', ephemeral: true });
            } catch {
                await interaction.editReply({ content: 'Couldn\'t DM the new key — enable DMs!', ephemeral: true });
            }
        }

    } catch (error) {
        console.error('Interaction error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred — check console.', ephemeral: true }).catch(() => {});
        }
    }
});

// ============================================
// START
// ============================================
(async () => {
    await initFiles();
    app.listen(PORT, () => console.log(`API live on port ${PORT}`));
    client.login(config.token);
})();
