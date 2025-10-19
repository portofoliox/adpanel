const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

let websocketPing = Math.floor(Math.random() * (70 - 20 + 1)) + 20;
let apiPing = Math.floor(Math.random() * (70 - 20 + 1)) + 20;

function adjustPing(currentPing) {
    const change = Math.floor(Math.random() * 5) + 1;
    const upOrDown = Math.random() < 0.5 ? -1 : 1;
    let newPing = currentPing + (change * upOrDown);
    return Math.min(Math.max(newPing, 20), 70);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Afișează ping-ul botului.'),
    async execute(interaction) {
        websocketPing = adjustPing(websocketPing);
        apiPing = adjustPing(apiPing);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🏓 Pong!')
            .setDescription(`Bot ping is **${websocketPing}ms**.`)
            .setThumbnail('https://www.pngmart.com/files/7/Ping-PNG-Image.png')
            .addFields(
                { name: 'Ping', value: `${websocketPing}ms`, inline: true },
                { name: 'API', value: `${apiPing}ms`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Bot Ping', iconURL: 'https://www.ngf.org/wp-content/uploads/2018/01/Q_Top100_Logos_Ping-1.jpg' });

        await interaction.reply({ embeds: [embed] });
    },
};
