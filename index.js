const { Client, GatewayIntentBits, ChannelType, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({ dest: 'temp/' });
const DB_PATH = path.join(__dirname, 'drive_db.json');

// Datenbank initialisieren
let driveData = { files: [], folders: [] };
if (fs.existsSync(DB_PATH)) {
    try { driveData = fs.readJsonSync(DB_PATH); } catch (e) { console.log("DB leer"); }
}

async function saveDB() {
    await fs.writeJson(DB_PATH, driveData);
}

// API: Alle Daten holen
app.get('/api/data', (req, res) => res.json(driveData));

// API: Ordner erstellen (Discord Channel)
app.post('/api/folders', async (req, res) => {
    const { name } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.create({
            name: name.toLowerCase().replace(/ /g, '-'),
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
        });
        
        const newFolder = { id: channel.id, name: name };
        driveData.folders.push(newFolder);
        await saveDB();
        res.json(newFolder);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Konnte Channel nicht erstellen. Bot-Rechte prüfen!" });
    }
});

// API: Upload
app.post('/upload', upload.single('file'), async (req, res) => {
    const { folderId } = req.body;
    const file = req.file;
    if (!file) return res.status(400).send("Keine Datei.");

    try {
        const channel = await client.channels.fetch(folderId);
        const buffer = await fs.readFile(file.path);
        const CHUNK_SIZE = 24 * 1024 * 1024; // ~24MB (Discord Limit)
        const parts = [];

        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, i + CHUNK_SIZE);
            const attachment = new AttachmentBuilder(chunk, { name: `${file.originalname}.p${i}` });
            const msg = await channel.send({ content: `Datei-Chunk für ${file.originalname}`, files: [attachment] });
            parts.push(msg.attachments.first().url);
        }

        driveData.files.push({ name: file.originalname, folderId, parts, size: file.size });
        await saveDB();
        await fs.remove(file.path);
        res.send("Upload erfolgreich!");
    } catch (err) {
        res.status(500).send("Fehler: " + err.message);
    }
});

// API: Download
app.get('/download', async (req, res) => {
    const file = driveData.files.find(f => f.name === req.query.name);
    if (!file) return res.status(404).send("Datei nicht gefunden.");

    try {
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        for (const url of file.parts) {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            res.write(Buffer.from(response.data));
        }
        res.end();
    } catch (e) { res.status(500).send("Download-Fehler."); }
});

client.once('ready', () => console.log("Bot ist online!"));
client.login(TOKEN);
app.listen(PORT);
