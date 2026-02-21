const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// --- KONFIGURATION ---
// Tipp: Nutze bei Render/Railway "Environment Variables" statt den Token hier reinzuschreiben!
const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PORT = process.env.PORT || 8080; 

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const app = express();
const upload = multer({ dest: 'temp/' });

// Datenbank-Ersatz (Lokale Datei)
const DB_PATH = path.join(__dirname, 'fileMap.json');
let fileMap = {};

// Datenbank laden falls vorhanden
if (fs.existsSync(DB_PATH)) {
    try {
        fileMap = fs.readJsonSync(DB_PATH);
    } catch (e) {
        fileMap = {};
    }
}

// Statische Dateien (dein public Ordner)
app.use(express.static(path.join(__dirname, 'public')));

// --- API ROUTES ---

// Liste aller Dateien für die Website
app.get('/api/files', (req, res) => {
    res.json(fileMap);
});

// Upload & Split Logik
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send("Keine Datei ausgewählt.");

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        const buffer = await fs.readFile(req.file.path);
        const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB Chunks
        const messageUrls = [];

        console.log(`Starte Upload für: ${req.file.originalname}`);

        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            const chunk = buffer.slice(i, i + CHUNK_SIZE);
            const attachment = new AttachmentBuilder(chunk, { name: `${req.file.originalname}.part${i}` });
            
            const message = await channel.send({
                content: `Teil ${Math.floor(i / CHUNK_SIZE) + 1} von ${req.file.originalname}`,
                files: [attachment]
            });
            messageUrls.push(message.attachments.first().url);
        }

        // In Map speichern und Datei schreiben
        fileMap[req.file.originalname] = messageUrls;
        await fs.writeJson(DB_PATH, fileMap);
        
        // Temporäre Datei löschen
        await fs.remove(req.file.path);

        res.send(`<h1>Erfolg!</h1><p>Datei ${req.file.originalname} wurde zerteilt und auf Discord gespeichert.</p><a href="/">Zurück zum Drive</a>`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Fehler beim Upload: " + err.message);
    }
});

// Download & Reassemble Logik
app.get('/download', async (req, res) => {
    const fileName = req.query.name;
    const urls = fileMap[fileName];

    if (!urls) return res.status(404).send("Datei nicht gefunden.");

    try {
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        
        for (const url of urls) {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            res.write(Buffer.from(response.data));
        }
        res.end();
    } catch (err) {
        res.status(500).send("Fehler beim Zusammenfügen der Datei.");
    }
});

// --- DISCORD BOT LOGIK ---

client.once('ready', () => {
    console.log(`Bot eingeloggt als ${client.user.tag}`);
    console.log(`Webserver läuft auf Port ${PORT}`);
});

// Überraschungs-Command !Test
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!test') {
        const surprise = [
            "🎉 **ÜBERRASCHUNG!** Dein Discord-Cloud-System funktioniert!",
            "💾 Deine Dateien werden sicher in Chunks auf diesem Server verwahrt.",
            "```\n    _    _  \n   (o)(o) \n  /      \\ \n /        \\ \n|          |  <-- Der Speicher-Wächter gratuliert!\n|  V    V  |\n \\________/ \n```"
        ].join('\n');
        
        await message.reply(surprise);
    }
});

client.login(TOKEN);
app.listen(PORT);