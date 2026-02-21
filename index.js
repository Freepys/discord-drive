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
app.use(express.json({ limit: '2gb' })); // Verhindert "Entity too large"
app.use(express.static('public'));

const upload = multer({ dest: 'temp/' });
const DB_PATH = path.join(__dirname, 'drive_db.json');

let driveData = { files: [], folders: [] };
if (fs.existsSync(DB_PATH)) {
    try { driveData = fs.readJsonSync(DB_PATH); } catch (e) { driveData = { files: [], folders: [] }; }
}

async function saveDB() { await fs.writeJson(DB_PATH, driveData); }

// Route: Alle Daten laden
app.get('/api/data', (req, res) => res.json(driveData));

// Route: Ordner erstellen (Discord Channel)
app.post('/api/folders', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Kein Name" });

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.create({
            name: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            type: ChannelType.GuildText
        });
        
        const newFolder = { id: channel.id, name: name };
        driveData.folders.push(newFolder);
        await saveDB();
        res.json(newFolder);
    } catch (err) {
        res.status(500).json({ error: "Bot fehlen Rechte: 'Manage Channels'" });
    }
});

// Route: Upload
app.post('/upload', upload.single('file'), async (req, res) => {
    const { folderId } = req.body;
    if (!req.file || !folderId) return res.status(400).send("Datei oder Ordner fehlt.");

    try {
        const channel = await client.channels.fetch(folderId);
        const buffer = await fs.readFile(req.file.path);
        const CHUNK_SIZE = 24 * 1024 * 1024; // 24MB
        const parts = [];

        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, i + CHUNK_SIZE);
            const attachment = new AttachmentBuilder(chunk, { name: `${req.file.originalname}.part${i}` });
            const msg = await channel.send({ files: [attachment] });
            parts.push(msg.attachments.first().url);
        }

        driveData.files.push({ name: req.file.originalname, folderId, parts });
        await saveDB();
        await fs.remove(req.file.path);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Route: Download
app.get('/download', async (req, res) => {
    const file = driveData.files.find(f => f.name === req.query.name);
    if (!file) return res.status(404).send("Nicht gefunden.");

    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    for (const url of file.parts) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        res.write(Buffer.from(response.data));
    }
    res.end();
});

client.login(TOKEN);
app.listen(PORT, () => console.log("System Online"));
