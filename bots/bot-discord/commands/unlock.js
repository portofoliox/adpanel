const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks the chat or the channel for a specific role.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('chat')
                .setDescription('Unlocks the chat for the selected role.')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Select the role to unlock for sending messages.')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('channel')
                .setDescription('Unlocks the entire channel for the selected role.')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Select the role to unlock for viewing the channel.')
                        .setRequired(true)
                )
        ),
    async execute(interaction) {
        const subCommand = interaction.options.getSubcommand();
        const selectedRole = interaction.options.getRole('role');

        try {
            if (subCommand === 'chat') {
                await interaction.channel.permissionOverwrites.edit(selectedRole, {
                    SendMessages: true,
                });

                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🔓 Chat Unlocked')
                    .setDescription(`The chat has been unlocked for everyone with the **${selectedRole.name}** role.`)
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            } else if (subCommand === 'channel') {
                await interaction.channel.permissionOverwrites.edit(selectedRole, {
                    ViewChannel: true,
                });

                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🔓 Channel Unlocked')
                    .setDescription(`The channel has been unlocked for everyone with the **${selectedRole.name}** role.`)
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'There was an error unlocking the chat or channel.', ephemeral: true });
        }
    },
};
