const { Client, GatewayIntentBits, REST, Routes, Collection, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.js');

// Creează clientul Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildIntegrations,
    ],
});

// Creează o colecție pentru comenzi
client.commands = new Collection();

// Încarcă toate fișierele de comenzi din folderul commands
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// Pregătește comenzile pentru înregistrare
const commands = client.commands.map(command => command.data.toJSON());

// Când botul este gata
client.once('ready', async () => {
    console.log(`Botul este online ca ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log('Încerc să înregistrez comenzile slash...');
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        console.log('Comenzile slash au fost înregistrate cu succes!');
    } catch (error) {
        console.error('Eroare la înregistrarea comenzilor:', error);
    }
});

// Funcție care gestionează interacțiunile cu butonul de Verify
async function handleVerifyButtonInteraction(interaction) {
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
        console.error('Eroare în timpul interacțiunii cu butonul Verify:', error);
        await interaction.editReply({ content: 'A apărut o eroare în timpul procesării interacțiunii.' });
    }
}

// Funcție care gestionează interacțiunile cu butonul de ticket
async function handleTicketButtonInteraction(interaction) {
    if (interaction.customId === 'create_ticket') {
        const user = interaction.user;

        // Creează un canal de ticket pentru utilizator
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${user.username}`,
            type: 0, // Text channel
            permissionOverwrites: [
                {
                    id: interaction.guild.roles.everyone, // Blochează vizualizarea canalului pentru toată lumea
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: user.id, // Permite utilizatorului să vadă și să trimită mesaje în canal
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: interaction.guild.roles.cache.find(role => role.permissions.has(PermissionsBitField.Flags.Administrator)).id, // Permite administratorilor
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
            ],
        });

        // Trimite un embed cu un buton de "Close Ticket"
        const ticketEmbed = new EmbedBuilder()
            .setColor('#ffcc00')
            .setTitle(`Ticket for ${user.username}`)
            .setDescription('The ticket has been created, a staff member will answer\n you as soon as possible. Tell your problem here...');

        const closeButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(closeButton);

        await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });
        await interaction.reply({ content: `✅ Your ticket has been created > ${ticketChannel.name}`, ephemeral: true });
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
            content: `:wave: Recently you closed a ticket, here is your transcript:`,
            files: [transcriptPath],
        });

        // Șterge canalul ticketului
        await ticketChannel.delete();

        // Șterge fișierul transcriptului de pe server
        fs.unlinkSync(transcriptPath);
    }
}

// Gestionarea interacțiunilor
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) {
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'A apărut o eroare la executarea comenzii.', ephemeral: true });
            }
        }
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('verify_')) {
            await handleVerifyButtonInteraction(interaction); // Redirecționăm interacțiunile cu butonul de Verify
        } else {
            await handleTicketButtonInteraction(interaction); // Redirecționăm interacțiunile cu butoanele pentru ticket
        }
    }
});

// Autentifică botul folosind token-ul din config.js
client.login(config.token);
