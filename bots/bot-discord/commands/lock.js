const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks the chat or the channel for a specific role.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('chat')
                .setDescription('Locks the chat for the selected role.')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Select the role to block from sending messages.')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('channel')
                .setDescription('Locks the entire channel for the selected role.')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Select the role to block from viewing the channel.')
                        .setRequired(true)
                )
        ),
    async execute(interaction) {
        const subCommand = interaction.options.getSubcommand();
        const selectedRole = interaction.options.getRole('role');

        try {
            if (subCommand === 'chat') {
                await interaction.channel.permissionOverwrites.edit(selectedRole, {
                    SendMessages: false,
                });

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔒 Chat Locked')
                    .setDescription(`The chat has been locked for everyone with the **${selectedRole.name}** role.`)
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            } else if (subCommand === 'channel') {
                await interaction.channel.permissionOverwrites.edit(selectedRole, {
                    ViewChannel: false,
                });

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔒 Channel Locked')
                    .setDescription(`The channel has been locked for everyone with the **${selectedRole.name}** role.`)
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'There was an error applying the lock.', ephemeral: true });
        }
    },
};
