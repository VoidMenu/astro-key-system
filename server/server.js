// combined.js — FINAL PUBLIC PANEL VERSION (November 2025)

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
    MessageFlags
} = require('discord.js');

// ============================================
// EXPRESS + DATA
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: '*' }));
app.use(express.json());

const KEYS_FILE = path.join(__dirname, 'data', 'keys.json');

async function init() {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    if (!await fs.stat(KEYS_FILE).catch(() => false)) await fs.writeFile(KEYS_FILE, '[]');
}
async function readKeys() { return JSON.parse(await fs.readFile(KEYS_FILE, 'utf8').catch(() => '[]')); }
async function writeKeys(k) { await fs.writeFile(KEYS_FILE, JSON.stringify(k, null, 2)); }
function generateKey() { return crypto.randomBytes(20).toString('hex'); }

// Minimal validate route (you already have this working)
app.post('/api/validate', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        if (!key || !hwid) return res.status(400).json({ valid: false });

        const keys = await readKeys();
        const k = keys.find(x => x.key === key && !x.deleted);
        if (!k) return res.json({ valid: false });

        if (k.used && k.hwid !== hwid) return res.json({ valid: false, message: 'Key in use' });

        if (!k.used) { k.used = true; k.hwid = hwid; k.usedAt = new Date().toISOString(); }
        k.lastUsed = new Date().toISOString();
        await writeKeys(keys);

        res.json({ valid: true });
    } catch { res.status(500).json({ valid: false }); }
});

app.listen(PORT, () => console.log(`API running on port ${PORT}`));

// ============================================
// DISCORD BOT
// ============================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const config = {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    embedColor: 0xA57FCB
};

client.once('ready', async () => {
    console.log(`Bot online: ${client.user.tag}`);
    client.user.setActivity('Lifetime Keys', { type: ActivityType.Watching });

    const rest = new REST().setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
        body: [{ name: 'setup', description: 'Open the Lifetime Key Panel (Admin only)' }]
    });
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
        // ==================== /setup → PUBLIC PANEL ====================
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: 'Only admins can use /setup', flags: MessageFlags.Ephemeral });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('gen_key')
                    .setLabel('Generate Lifetime Key')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('Key'),

                new ButtonBuilder()
                    .setCustomId('check_key')
                    .setLabel('Check My Key')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('Magnifying Glass'),

                new ButtonBuilder()
                    .setCustomId('delete_regen')
                    .setLabel('Delete & Regenerate')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('Wastebasket')
            );

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Astrø Lifetime Key Panel')
                .setDescription(`
                    Click below to manage your **lifetime key**

                    • Only **one key per user**
                    • Keys are sent via DM
                    • Lost your key? Use **Delete & Regenerate**
                `)
                .setFooter({ text: 'Astrø Menu • Keep your key private' })
                .setTimestamp();

            // THIS IS PUBLIC — NO EPHEMERAL!
            await interaction.reply({ embeds: [embed], components: [row] });
            return;
        }

        // ==================== BUTTONS → EPHEMERAL RESPONSES ONLY ====================
        if (interaction.isButton()) {
            // All replies are EPHEMERAL (only the user sees)
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const keys = await readKeys();
            const userKey = keys.find(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (interaction.customId === 'gen_key') {
                if (userKey) {
                    return interaction.editReply({ content: 'You already have a lifetime key!\nUse **Delete & Regenerate** if you lost it.' });
                }

                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);

                try {
                    await interaction.user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setTitle('Your Lifetime Key')
                            .addFields({ name: 'Key', value: `\`${newKey}\`` })
                            .setFooter({ text: 'Never expires • Do NOT share' })
                        ]
                    });
                    await interaction.editReply({ content: 'Key generated and sent to your DMs!' });
                } catch {
                    await interaction.editReply({ content: 'Could not DM you! Enable DMs from server members.' });
                }
            }

            if (interaction.customId === 'check_key') {
                if (!userKey) return interaction.editReply({ content: 'You don\'t have a lifetime key yet.' });

                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Your Lifetime Key')
                        .addFields(
                            { name: 'Key', value: `\`${userKey.key}\`` },
                            { name: 'Status', value: userKey.used ? 'Active (Bound)' : 'Unused', inline: true },
                            { name: 'Last Used', value: userKey.lastUsed ? new Date(userKey.lastUsed).toLocaleString() : 'Never', inline: true }
                        )
                    ]
                });
            }

            if (interaction.customId === 'delete_regen') {
                if (!userKey) return interaction.editReply({ content: 'You have no key to delete.' });

                userKey.deleted = true;
                userKey.deletedAt = new Date().toISOString();
                await writeKeys(keys);

                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);

                try {
                    await interaction.user.send({
                        embeds: [new EmbedBuilder()
                            .setColor(config.embedColor)
                            .setTitle('Old Key Revoked — New Key Issued')
                            .addFields({ name: 'New Key', value: `\`${newKey}\`` })
                            .setDescription('Your old key is now permanently invalid.')
                        ]
                    });
                    await interaction.editReply({ content: 'Old key deleted — New key sent to your DMs!' });
                } catch {
                    await interaction.editReply({ content: 'Couldn\'t send new key via DM — enable DMs!' });
                }
            }
        }
    } catch (error) {
        console.error('Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

// ============================================
// START
// ============================================
(async () => {
    await init();
    await client.login(config.token);
})();
