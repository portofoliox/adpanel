const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setupverify')
        .setDescription('Setup verify channel')
        .addStringOption(option =>
            option.setName('channelname')
                .setDescription('Channel Name')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role for verification')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Embed Title')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Embed Description')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('footer')
                .setDescription('Embed Footer')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('image')
                .setDescription('Thumbnail Image URL (image in the top left)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Embed color (red, green, blue, or hex code)')
                .setRequired(false)
        ),
    async execute(interaction) {
        const channelName = interaction.options.getString('channelname');
        const role = interaction.options.getRole('role');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const footer = interaction.options.getString('footer');
        const image = interaction.options.getString('image') || '';
        const color = interaction.options.getString('color') || '#00ff00'; // Default color if none is provided

        const guild = interaction.guild;

        // Creează canalul
        const channel = await guild.channels.create({
            name: channelName,
            type: 0,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: ['SendMessages'],
                },
            ],
        });

        // Map common color names to hex codes
        const colors = {
            red: '#ff0000',
            green: '#00ff00',
            blue: '#0000ff',
        };

        // Verifică dacă este o culoare numită și o convertește în hex, altfel păstrează hexul direct
        const embedColor = colors[color.toLowerCase()] || color;

        // Creează embed-ul
        const verifyEmbed = new EmbedBuilder()
            .setColor(embedColor) // Setează culoarea embed-ului
            .setTitle(title)
            .setDescription(description);

        // Setează imaginea (thumbnail) dacă este furnizată
        if (image.trim() !== '') {
            verifyEmbed.setThumbnail(image); // Setează imaginea în colțul din stânga sus
        }

        // Setează footer-ul doar dacă este definit și nu este un string gol
        if (footer && footer.trim() !== '') {
            verifyEmbed.setFooter({ text: footer });
        }

        verifyEmbed.setTimestamp();

        // Creează butonul de verificare
        const verifyButton = new ButtonBuilder()
            .setCustomId(`verify_${role.id}`)
            .setLabel('Verify')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(verifyButton);

        // Trimite embed-ul și butonul
        await channel.send({ embeds: [verifyEmbed], components: [row] });

        // Răspunde la interacțiune
        await interaction.reply({ content: `Canalul ${channelName} a fost creat cu succes!`, ephemeral: true });
    },

    // Funcție care gestionează interacțiunile cu butonul
    async handleButtonInteraction(interaction) {
        const roleId = interaction.customId.split('_')[1]; // Extrage ID-ul rolului din customId
        const role = interaction.guild.roles.cache.get(roleId); // Obține rolul folosind ID-ul

        if (!role) {
            await interaction.reply({ content: ':x: Rolul specificat nu a fost găsit.', ephemeral: true });
            return;
        }

        try {
            // Amână răspunsul pentru a evita expirarea interacțiunii
            await interaction.deferReply({ ephemeral: true });

            if (!interaction.member.roles.cache.has(role.id)) {
                await interaction.member.roles.add(role);
                await interaction.editReply({ content: `:white_check_mark: Done verification > ${role.name}.` });
            } else {
                await interaction.editReply({ content: ':x: You already have this role' });
            }
        } catch (error) {
            console.error('Eroare în timpul interacțiunii cu butonul:', error);
            await interaction.editReply({ content: 'A apărut o eroare în timpul procesării interacțiunii.' });
        }
    },
};
