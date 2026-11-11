# Hakika

Hakika helps an owner approve construction purchases and release payments only after work is supported by evidence from the site. This demo uses fictional people and sample project data.

## Screenshots

These screenshots show the local demo experience. The project details view is marked as sample data, not a live project record.

![Hakika landing page](public/judge/readme-home.png)

![Project details with sample data](public/judge/project-details.png)

## Built with

- Next.js, React, TypeScript, and Tailwind CSS
- Neon Postgres and Vercel Blob
- PayPal sandbox and Twilio WhatsApp sandbox
- Bryntum Gantt

## Planned AI services

The planned AI integrations are **Amazon Nova on Amazon Bedrock** for quote/proof analysis and **Groq Whisper large-v3** for Swahili voice-note transcription. The current checked-in mock UI does not call these AI services yet.

## Local development

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` and add sandbox credentials only when testing integrations that require them. Mock API routes are marked with the `x-hakika-mock: 1` response header.

## Validation

```bash
npm run lint
npm run typecheck
npm test
```
