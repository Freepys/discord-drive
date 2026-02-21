const { Client, GatewayIntentBits, ChannelType, AttachmentBuilder } = require('discord.js');
const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID; // Dein Server-ID
const PORT = process.env.PORT || 8080;

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const app = express();
// Erhöht das Limit für große Uploads
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'temp/' });
const DB_PATH = './drive_db.json';
let driveData = { files: [], folders: [] };

if (fs.existsSync(DB_PATH)) driveData = fs.readJsonSync(DB_PATH);

// --- DRIVE LOGIK ---

// Ordner erstellen = Discord Channel erstellen
app.post('/api/folders', async (req, res) => {
    const { name } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.create({
            name: name,
            type: ChannelType.GuildText,
        });
        
        const newFolder = { id: channel.id, name: name };
        driveData.folders.push(newFolder);
        await fs.writeJson(DB_PATH, driveData);
        res.json(newFolder);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Upload in spezifischen Ordner (Channel)
app.post('/upload', upload.single('file'), async (req, res) => {
    const { folderId } = req.body;
    const file = req.file;
    if (!file) return res.status(400).send("Keine Datei.");

    try {
        const channel = await client.channels.fetch(folderId || process.env.DEFAULT_CHANNEL);
        const buffer = await fs.readFile(file.path);
        const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB
        const parts = [];

        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, i + CHUNK_SIZE);
            const attachment = new AttachmentBuilder(chunk, { name: `${file.originalname}.p${i}` });
            const msg = await channel.send({ files: [attachment] });
            parts.push(msg.attachments.first().url);
        }

        driveData.files.push({ name: file.originalname, folderId, parts });
        await fs.writeJson(DB_PATH, driveData);
        await fs.remove(file.path);
        res.redirect('/');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/api/data', (req, res) => res.json(driveData));

app.get('/download', async (req, res) => {
    const file = driveData.files.find(f => f.name === req.query.name);
    if (!file) return res.status(404).send("Datei nicht gefunden.");

    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    for (const url of file.parts) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        res.write(Buffer.from(response.data));
    }
    res.end();
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`Drive bereit auf Port ${PORT}`));