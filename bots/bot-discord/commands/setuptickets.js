const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setuptickets')
        .setDescription('Setup ticket system')
        .addStringOption(option =>
            option.setName('channelname')
                .setDescription('Ticket Channel Name')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Embed Title for Ticket Creation')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Embed Description for Ticket Creation')
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
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const footer = interaction.options.getString('footer');
        const image = interaction.options.getString('image') || '';
        const color = interaction.options.getString('color') || '#00ff00'; // Default color if none is provided

        const guild = interaction.guild;

        // Creează canalul principal pentru tickete
        const channel = await guild.channels.create({
            name: channelName,
            type: 0, // Text channel
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.user.id, // Permisiuni doar pentru cel care configurează
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
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

        // Creează embed-ul pentru deschiderea tichetelor
        const ticketEmbed = new EmbedBuilder()
            .setColor(embedColor) // Setează culoarea embed-ului
            .setTitle(title)
            .setDescription(description);

        // Setează imaginea (thumbnail) dacă este furnizată
        if (image.trim() !== '') {
            ticketEmbed.setThumbnail(image); // Setează imaginea în colțul din stânga sus
        }

        // Setează footer-ul doar dacă este definit și nu este un string gol
        if (footer && footer.trim() !== '') {
            ticketEmbed.setFooter({ text: footer });
        }

        ticketEmbed.setTimestamp();

        // Creează butonul de creare a tichetului
        const createTicketButton = new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel('Create Ticket')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(createTicketButton);

        // Trimite embed-ul și butonul pentru a crea tichete
        await channel.send({ embeds: [ticketEmbed], components: [row] });

        // Răspunde la interacțiune
        await interaction.reply({ content: `Canalul de tickete ${channelName} a fost creat cu succes!`, ephemeral: true });
    },

    // Funcție care gestionează interacțiunile cu butonul pentru a crea un ticket
    async handleButtonInteraction(interaction) {
        if (interaction.customId === 'create_ticket') {
            const user = interaction.user;

            // Creează un canal de ticket pentru utilizator
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${user.username}`,
                type: 0, // Text channel
                permissionOverwrites: [
                    {
                        id: interaction.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: user.id,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                    },
                    {
                        id: interaction.guild.roles.cache.find(role => role.name === 'Admin').id, // Admin role (înlocuiește cu rolul tău de admin)
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                    },
                ],
            });

            // Trimite un embed cu un buton de "Close Ticket"
            const ticketEmbed = new EmbedBuilder()
                .setColor('#ffcc00')
                .setTitle(`Ticket for ${user.username}`)
                .setDescription('Un administrator te va contacta în curând.\nApasă butonul de mai jos pentru a închide tichetul.')
                .setTimestamp();

            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(closeButton);

            await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });
            await interaction.reply({ content: `Ticketul tău a fost creat: ${ticketChannel.name}`, ephemeral: true });
        } else if (interaction.customId === 'close_ticket') {
            // Închide ticketul și trimite transcriptul
            const ticketChannel = interaction.channel;

            // Creează transcriptul ca un fișier text
            const messages = await ticketChannel.messages.fetch();
            const transcript = messages.map(m => `${m.author.tag}: ${m.content}`).reverse().join('\n');
            const transcriptPath = path.join(__dirname, `transcript-${interaction.channel.name}.txt`);

            fs.writeFileSync(transcriptPath, transcript);

            // Trimite transcriptul utilizatorului
            await interaction.user.send({
                content: `Iată transcriptul tichetului tău:`,
                files: [transcriptPath],
            });

            // Șterge canalul ticketului
            await ticketChannel.delete();

            // Șterge fișierul transcriptului de pe server
            fs.unlinkSync(transcriptPath);
        }
    },
};
