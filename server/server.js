// combined.js — FINAL VERSION — NO EMOJIS — WORKS 100%

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
    try { await fs.access(KEYS_FILE); } catch { await fs.writeFile(KEYS_FILE, '[]'); }
}
async function readKeys() { return JSON.parse(await fs.readFile(KEYS_FILE, 'utf8')); }
async function writeKeys(keys) { await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2)); }
function generateKey() { return crypto.randomBytes(20).toString('hex'); }

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

app.listen(PORT, () => console.log(`API running on ${PORT}`));

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
        body: [{ name: 'setup', description: 'Open Lifetime Key Panel (Admin only)' }]
    });
    console.log('Commands registered');
});

function isAdmin(member) {
    return member?.roles.cache.has(config.adminRoleId);
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
    try {
        // /setup — PUBLIC PANEL
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: 'Only admins can use this.', flags: MessageFlags.Ephemeral });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('gen_key')
                    .setLabel('Generate Lifetime Key')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('check_key')
                    .setLabel('Check My Key')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId('delete_regen')
                    .setLabel('Delete & Regenerate')
                    .setStyle(ButtonStyle.Danger)
            );

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Astrø Lifetime Key Panel')
                .setDescription('One lifetime key per user\nKey will be sent to your DMs')
                .setFooter({ text: 'Keep your key private' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], components: [row] }); // PUBLIC
            return;
        }

        // BUTTONS — EPHEMERAL REPLIES
        if (interaction.isButton()) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const keys = await readKeys();
            const userKey = keys.find(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (interaction.customId === 'gen_key') {
                if (userKey) return interaction.editReply({ content: 'You already have a key! Use Delete & Regenerate if lost.' });

                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);
                try {
                    await interaction.user.send(`**Your Lifetime Key**\n\`${newKey}\`\nNever expires • Do NOT share`);
                    await interaction.editReply({ content: 'Key sent to your DMs!' });
                } catch {
                    await interaction.editReply({ content: 'Cannot DM you — enable DMs from server members!' });
                }
            }

            if (interaction.customId === 'check_key') {
                if (!userKey) return interaction.editReply({ content: 'You don\'t have a key yet.' });
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Your Lifetime Key')
                        .addFields(
                            { name: 'Key', value: `\`${userKey.key}\`` },
                            { name: 'Status', value: userKey.used ? 'Active' : 'Unused', inline: true }
                        )
                    ]
                });
            }

            if (interaction.customId === 'delete_regen') {
                if (!userKey) return interaction.editReply({ content: 'No key to delete.' });
                userKey.deleted = true;
                await writeKeys(keys);
                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.tag);
                try {
                    await interaction.user.send(`**New Key Issued**\n\`${newKey}\`\nOld key revoked`);
                    await interaction.editReply({ content: 'Old key deleted — New key sent to DMs!' });
                } catch {
                    await interaction.editReply({ content: 'Couldn\'t send new key — enable DMs!' });
                }
            }
        }
    } catch (error) {
        console.error('Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Error.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

(async () => {
    await init();
    await client.login(config.token);
})();
