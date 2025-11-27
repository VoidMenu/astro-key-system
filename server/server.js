// combined.js — FINAL WORKING VERSION (Public Panel + No Errors)

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
    ActivityType,
    InteractionResponseType
} = require('discord.js');

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: '*' }));
app.use(express.json());

const KEYS_FILE = path.join(__dirname, 'data', 'keys.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

async function initFiles() {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    if (!await fs.stat(KEYS_FILE).catch(() => false)) await fs.writeFile(KEYS_FILE, '[]');
}

async function readKeys() { return JSON.parse(await fs.readFile(KEYS_FILE, 'utf8').catch(() => '[]')); }
async function writeKeys(k) { await fs.writeFile(KEYS_FILE, JSON.stringify(k, null, 2)); }

function generateKey() { return crypto.randomBytes(20).toString('hex'); }

// API Routes (minimal, only needed ones)
app.post('/api/validate', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        if (!key || !hwid) return res.status(400).json({ valid: false });

        const keys = await readKeys();
        const k = keys.find(x => x.key === key && !x.deleted);
        if (!k || (k.expiresAt && new Date(k.expiresAt) < new Date())) return res.json({ valid: false });

        if (k.used && k.hwid !== hwid) return res.json({ valid: false, message: 'Key in use' });

        if (!k.used) { k.used = true; k.hwid = hwid; k.usedAt = new Date().toISOString(); }
        k.lastUsed = new Date().toISOString();
        await writeKeys(keys);

        res.json({ valid: true });
    } catch { res.status(500).json({ valid: false }); }
});

app.use((req, res) => res.status(404).json({ error: '404' }));

// ============================================
// DISCORD BOT
// ============================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const config = {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    embedColor: 0xA57FCB
};

const commands = [
    { name: 'setup', description: 'Open the Lifetime Key Panel (Admin only)' }
];

client.once('ready', async () => {
    console.log(`Bot ready: ${client.user.tag}`);
    client.user.setActivity('Lifetime Keys', { type: ActivityType.Watching });

    const rest = new REST().setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Commands registered');
});

function isAdmin(member) {
    return member.roles.cache.has(config.adminRoleId);
}

async function generateLifetimeKey(userId, username) {
    const keys = await readKeys();
    const newKey = generateKey();
    keys.push({
        key: newKey,
        discordId: userId,
        discordUsername: username,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        used: false,
        hwid: null,
        deleted: false
    });
    await writeKeys(keys);
    return newKey;
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    try {
        // ==================== /setup (Public Panel) ====================
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: 'Only admins can use /setup', flags: 64 }); // ephemeral
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('gen_key')
                    .setLabel('Generate Lifetime Key')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('Key'), // Real emoji

                new ButtonBuilder()
                    .setCustomId('check_key')
                    .setLabel('Check My Key')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('Magnifying Glass'), // Real emoji

                new ButtonBuilder()
                    .setCustomId('delete_regen')
                    .setLabel('Delete & Regenerate')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('Wastebasket') // Real emoji
            );

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Astrø Lifetime Key Panel')
                .setDescription(`
                    Click the buttons below to manage your **lifetime key**

                    • Only **one lifetime key** per user
                    • Keys are sent via DM
                    • Use **Delete & Regenerate** if you lost your key
                `)
                .setFooter({ text: 'Astrø Menu • discord.gg/yourserver' })
                .setTimestamp();

            // PUBLIC MESSAGE — everyone can see
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // ==================== BUTTONS (Only work for the user who clicks) ====================
        if (interaction.isButton()) {
            await interaction.deferReply({ flags: 64 }); // ephemeral reply

            const keys = await readKeys();
            const userKey = keys.find(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (interaction.customId === 'gen_key') {
                if (userKey) {
                    return interaction.editReply({ content: 'You already have a lifetime key!\nUse **Delete & Regenerate** if lost.', flags: 64 });
                }

                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);

                try {
                    await interaction.user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setTitle('Your Lifetime Key')
                            .addFields({ name: 'Key', value: `\`${newKey}\`` })
                            .setFooter({ text: 'Never expires • Do not share!' })
                        ]
                    });
                    await interaction.editReply({ content: 'Lifetime key generated and sent to your DMs!', flags: 64 });
                } catch {
                    await interaction.editReply({ content: 'I couldn\'t DM you! Enable DMs from server members.', flags: 64 });
                }
            }

            if (interaction.customId === 'check_key') {
                if (!userKey) return interaction.editReply({ content: 'You don\'t have a lifetime key yet.', flags: 64 });

                const embed = new EmbedBuilder()
                    .setColor(config.embedColor)
                    .setTitle('Your Lifetime Key')
                    .addFields(
                        { name: 'Key', value: `\`${userKey.key}\``, inline: false },
                        { name: 'Status', value: userKey.used ? 'Active (Bound to HWID)' : 'Unused', inline: true },
                        { name: 'Last Used', value: userKey.lastUsed ? new Date(userKey.lastUsed).toLocaleString() : 'Never', inline: true }
                    );

                await interaction.editReply({ embeds: [embed], flags: 64 });
            }

            if (interaction.customId === 'delete_regen') {
                if (!userKey) return interaction.editReply({ content: 'You have no key to delete.', flags: 64 });

                // Delete old
                userKey.deleted = true;
                userKey.deletedAt = new Date().toISOString();
                await writeKeys(keys);

                // Generate new
                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);

                try {
                    await interaction.user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setTitle('Old Key Revoked — New Key Issued')
                            .addFields({ name: 'New Key', value: `\`${newKey}\`` })
                            .setDescription('Your old key is now invalid.')
                        ]
                    });
                    await interaction.editReply({ content: 'Old key deleted → New key sent to DMs!', flags: 64 });
                } catch {
                    await interaction.editReply({ content: 'Couldn\'t DM new key — enable DMs!', flags: 64 });
                }
            }
        }

    } catch (error) {
        console.error('Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Error occurred.', flags: 64 }).catch(() => {});
        }
    }
});

// ============================================
// START
// ============================================
(async () => {
    await initFiles();
    app.listen(PORT, () => console.log(`API running on ${PORT}`));
    await client.login(config.token);
})();
