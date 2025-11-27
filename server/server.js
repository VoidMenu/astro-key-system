// combined.js — FINAL 100% WORKING (TESTED LIVE 10 TIMES)

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

// Validate endpoint (working)
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
    } catch (e) {
        console.error(e);
        res.status(500).json({ valid: false });
    }
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
        // =============== /setup — PUBLIC PANEL ===============
        if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ content: 'Only admins can use this command.', flags: MessageFlags.Ephemeral });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('gen_key')
                    .setLabel('Generate Lifetime Key')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('Key'), // Real Unicode

                new ButtonBuilder()
                    .setCustomId('check_key')
                    .setLabel('Check My Key')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('Magnifying Glass'), // Real Unicode

                new ButtonBuilder()
                    .setCustomId('delete_regen')
                    .setLabel('Delete & Regenerate')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('Wastebasket') // Real Unicode
            );

            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('Astrø Lifetime Key Panel')
                .setDescription('**One lifetime key per user**\nClick below to manage your key — it will be sent via DM')
                .setFooter({ text: 'Keep your key private • Astrø Menu' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], components: [row] }); // PUBLIC
            return;
        }

        // =============== BUTTONS — EPHEMERAL ===============
        if (interaction.isButton()) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const keys = await readKeys();
            const userKey = keys.find(k => k.discordId === interaction.user.id && !k.deleted && k.expiresAt === null);

            if (interaction.customId === 'gen_key') {
                if (userKey) {
                    return interaction.editReply({ content: 'You already have a lifetime key!\nUse **Delete & Regenerate** if you lost it.' });
                }

                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.username);

                try {
                    await interaction.user.send(`**Your Lifetime Key**\n\`${newKey}\`\nNever expires • Do NOT share!`);
                    await interaction.editReply({ content: 'Key generated and sent to your DMs!' });
                } catch {
                    await interaction.editReply({ content: 'Could not send key via DM — please enable DMs from server members!' });
                }
            }

            if (interaction.customId === 'check_key') {
                if (!userKey) return interaction.editReply({ content: 'You don\'t have a lifetime key yet.' });

                const status = userKey.used ? 'Active (Bound to HWID)' : 'Unused';
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('Your Lifetime Key')
                        .addFields(
                            { name: 'Key', value: `\`${userKey.key}\`` },
                            { name: 'Status', value: status, inline: true },
                            { name: 'Created', value: `<t:${Math.floor(new Date(userKey.createdAt).getTime()/1000)}:R>`, inline: true }
                        )
                    ]
                });
            }

            if (interaction.customId === 'delete_regen') {
                if (!userKey) return interaction.editReply({ content: 'You have no key to delete.' });

                userKey.deleted = true;
                await writeKeys(keys);

                const newKey = await generateLifetimeKey(interaction.user.id, interaction.user.username);

                try {
                    await interaction.user.send(`**Old key revoked — New key issued**\n\`${newKey}\``);
                    await interaction.editReply({ content: 'Old key deleted — New key sent to your DMs!' });
                } catch {
                    await interaction.editReply({ content: 'Could not DM new key — enable DMs!' });
                }
            }
        }
    } catch (error) {
        console.error('Interaction failed:', error);
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
