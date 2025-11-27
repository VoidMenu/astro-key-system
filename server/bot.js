// bot.js - Discord Bot for Key Generation
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActivityType } = require('discord.js');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Configuration - gets from environment variables
const config = {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    adminToken: process.env.ADMIN_TOKEN,
    buyerRoleId: process.env.BUYER_ROLE_ID,
    adminRoleId: process.env.ADMIN_ROLE_ID,
    embedColor: 0xA57FCB // Purple color matching your theme
};

// Commands definition
const commands = [
    {
        name: 'generatekey',
        description: 'Generate a new key (Buyers only)',
        options: [
            {
                name: 'duration',
                description: 'Key duration in days (leave empty for lifetime)',
                type: 4, // INTEGER
                required: false
            }
        ]
    },
    {
        name: 'resetkey',
        description: 'Reset a key HWID (Admins only)',
        options: [
            {
                name: 'key',
                description: 'The key to reset',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'keyinfo',
        description: 'Get information about a key (Admins only)',
        options: [
            {
                name: 'key',
                description: 'The key to check',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'help',
        description: 'Show available commands and information'
    }
];

// Register slash commands
async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');
        
        const rest = new REST({ version: '10' }).setToken(config.token);
        
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Helper function to check if user has buyer role
function hasBuyerRole(member) {
    return member.roles.cache.has(config.buyerRoleId);
}

// Helper function to check if user has admin role
function hasAdminRole(member) {
    return member.roles.cache.has(config.adminRoleId);
}

// Bot ready event
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🤖 Bot is ready and listening for commands!`);
    console.log(`📡 Server URL: ${config.serverUrl}`);
    
    client.user.setActivity('Astrø Menu Keys', { type: ActivityType.Watching });
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, member } = interaction;

    try {
        // /generatekey command
        if (commandName === 'generatekey') {
            if (!hasBuyerRole(member)) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Access Denied')
                    .setDescription('You need the Buyer role to generate keys!')
                    .setFooter({ text: 'Astrø Key System' })
                    .setTimestamp();
                
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const duration = interaction.options.getInteger('duration');

            try {
                const response = await axios.post(`${config.serverUrl}/api/generate`, {
                    discordId: user.id,
                    discordUsername: user.username,
                    duration: duration,
                    adminToken: config.adminToken
                });

                if (response.data.success) {
                    const embed = new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setTitle('🔑 Key Generated Successfully!')
                        .setDescription(`Your new key has been generated.`)
                        .addFields(
                            { name: '🎟️ Key', value: `\`${response.data.key}\``, inline: false },
                            { 
                                name: '⏰ Duration', 
                                value: duration ? `${duration} days` : 'Lifetime', 
                                inline: true 
                            },
                            { 
                                name: '📅 Expires', 
                                value: response.data.expiresAt ? 
                                    new Date(response.data.expiresAt).toLocaleDateString() : 
                                    'Never', 
                                inline: true 
                            }
                        )
                        .setFooter({ text: 'Keep your key private! • Astrø Menu' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    throw new Error(response.data.message);
                }
            } catch (error) {
                console.error('Key generation error:', error);
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Error')
                    .setDescription('Failed to generate key. Please contact an administrator.')
                    .setFooter({ text: 'Astrø Key System' })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            }
        }

        // /resetkey command
        else if (commandName === 'resetkey') {
            if (!hasAdminRole(member)) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Access Denied')
                    .setDescription('This command is only available to administrators!')
                    .setFooter({ text: 'Astrø Key System' })
                    .setTimestamp();
                
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const key = interaction.options.getString('key');

            try {
                const response = await axios.post(`${config.serverUrl}/api/reset`, {
                    key: key,
                    adminToken: config.adminToken
                });

                if (response.data.success) {
                    const embed = new EmbedBuilder()
                        .setColor('#4CAF50')
                        .setTitle('✅ Key Reset Successfully')
                        .setDescription(`The key \`${key}\` has been reset and can be used again.`)
                        .setFooter({ text: 'Astrø Key System' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    throw new Error(response.data.message);
                }
            } catch (error) {
                console.error('Key reset error:', error);
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Error')
                    .setDescription(error.response?.data?.message || 'Failed to reset key.')
                    .setFooter({ text: 'Astrø Key System' })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            }
        }

        // /keyinfo command
        else if (commandName === 'keyinfo') {
            if (!hasAdminRole(member)) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Access Denied')
                    .setDescription('This command is only available to administrators!')
                    .setFooter({ text: 'Astrø Key System' })
                    .setTimestamp();
                
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const key = interaction.options.getString('key');

            try {
                const response = await axios.post(`${config.serverUrl}/api/keyinfo`, {
                    key: key,
                    adminToken: config.adminToken
                });

                if (response.data.success) {
                    const keyData = response.data.data;
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
                        .setFooter({ text: 'Astrø Key System' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    throw new Error(response.data.message);
                }
            } catch (error) {
                console.error('Key info error:', error);
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('❌ Error')
                    .setDescription(error.response?.data?.message || 'Failed to get key information.')
                    .setFooter({ text: 'Astrø Key System' })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            }
        }

        // /help command
        else if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle('📚 Astrø Key System - Help')
                .setDescription('Welcome to the Astrø Menu key system!')
                .addFields(
                    { 
                        name: '🔑 /generatekey', 
                        value: 'Generate a new key (Buyers only)\nOptional: Specify duration in days', 
                        inline: false 
                    },
                    { 
                        name: '🔄 /resetkey', 
                        value: 'Reset a key\'s HWID (Admins only)', 
                        inline: false 
                    },
                    { 
                        name: '🔍 /keyinfo', 
                        value: 'View detailed key information (Admins only)', 
                        inline: false 
                    },
                    { 
                        name: '💬 Support', 
                        value: 'Need help? Contact an administrator in the server!', 
                        inline: false 
                    }
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
            .setDescription('An unexpected error occurred. Please try again later.')
            .setFooter({ text: 'Astrø Key System' })
            .setTimestamp();

        if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// Handle bot errors
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login and register commands
console.log('🚀 Starting Astrø Key Bot...');
registerCommands().then(() => {
    client.login(config.token).catch(error => {
        console.error('Failed to login:', error);
        process.exit(1);
    });
});
