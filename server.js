import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch'; // skip if Node 18+
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';


const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

dotenv.config();
// ================================
// Gemini API Email Template Endpoint
// ================================
app.post('/api/generate-template', async (req, res) => {
  const { prompt } = req.body;
  const geminiKey = process.env.Gemini_API
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
if (!geminiKey) return res.status(400).json({ error: 'Gemini API key not set on server' });

  const promptTemplate = `
Your task: Convert the following email into a professional HTML email body ONLY.

Strict rules:
- Only return HTML content of the email body.
- Do NOT include subject lines, CSS, tables, images, or any extra placeholders.
- Replace any recipient's name with {name}.
- Replace any company names with {company}.
- Bold key terms using <b> tags.
- Do NOT add, remove, or hallucinate content. Preserve the original meaning.
- Do NOT include anything else besides the HTML of the email body.

Email to convert:
`;

const fullPrompt = `${promptTemplate}\n${prompt}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
      }
    );

    const raw = await response.text();

    if (!response.ok) return res.status(response.status).json({ error: raw });

    const resultJson = JSON.parse(raw);
    const template = resultJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({ template });

  } catch (err) {
    console.error('Gemini request failed:', err);
    res.status(500).json({ error: 'Failed to generate template', details: err.message });
  }
});

// ================================
// Email Sending Endpoint (SMTP)
// ================================
app.post('/api/generate-emails', async (req, res) => {
  const { smtpUser, smtpPass, data, template, bcc , Subject} = req.body;

  if (!smtpUser || !smtpPass) return res.status(400).json({ error: 'SMTP credentials are required' });
  if (!data || !Array.isArray(data) || !template) return res.status(400).json({ error: 'Data and template are required' });

  // Create transporter dynamically per request
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com", // your SMTP host
    port: 587,
    secure: false, // STARTTLS
    auth: { user: smtpUser, pass: smtpPass }
  });

  try {
    await transporter.verify();
    console.log("🟢 Connected to SMTP server.");
  } catch (err) {
    console.error("❌ SMTP connection failed:", err);
    return res.status(500).json({ error: 'SMTP connection failed', details: err.message });
  }

  const results = [];

  for (let idx = 0; idx < data.length; idx++) {
    const row = data[idx];
    const recipient = row.email;
    const company = row.company || '';
    const name = row.name || '';

    if (!recipient) {
      console.log(`⚠️ Skipping index ${idx}: Missing email`);
      continue;
    }

    // Replace placeholders
    let htmlBody = template.replace(/\{name\}/g, name)
                           .replace(/\{email\}/g, recipient)
                           .replace(/\{company\}/g, company);

    const mailOptions = {
      from: smtpUser,
      to: recipient,
      bcc: bcc || undefined,
      subject: Subject,
      html: htmlBody
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent to ${recipient} (Index: ${idx})`);
      results.push({ email: recipient, status: 'sent' });

      // Random delay 8-15s
      await new Promise(resolve => setTimeout(resolve, 8000 + Math.random() * 7000));
    } catch (err) {
      console.log(`❌ Failed to send email to ${recipient} (Index: ${idx}): ${err.message}`);
      try {
        console.log(`🔄 Reconnecting for index ${idx}...`);
        await transporter.verify();
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${recipient} after reconnect (Index: ${idx})`);
        results.push({ email: recipient, status: 'sent_after_reconnect' });
      } catch (innerErr) {
        console.log(`❌ Still failed after reconnect at index ${idx}: ${innerErr.message}`);
        results.push({ email: recipient, status: 'failed', error: innerErr.message });
      }
    }
  }

  res.json({ sent: results.length, results });
});

// ================================
// Start Server
// ================================
app.use(express.static('public'));
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
