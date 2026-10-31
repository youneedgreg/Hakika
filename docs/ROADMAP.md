# Hakika roadmap

**Who:** Greg owns everything behind the screen. Juliet owns everything judges see and hear.
**Our submit deadline:** Wed 11 Nov, 11:59pm Nairobi. Devpost closes Thu 12 Nov, 11:00pm; treat that as a buffer only.
**Last updated:** Sat 31 Oct 2026.

> **Status: proposed.** These dates still need agreeing between Greg and Juliet. They fit about 20 days of Greg's planned work and all of Juliet's remaining build into 11 days, so they are very tight. If a gate slips, use the [cut order](#if-a-gate-slips).

## Workflow

Solid arrows are the order of work inside a lane. Dotted arrows are hand-offs: the other person needs this before they can finish.

```mermaid
flowchart TB
  classDef done fill:#1f7a4d,stroke:#14532d,color:#ffffff
  classDef now fill:#b45309,stroke:#78350f,color:#ffffff
  classDef next fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef gate fill:#1e3a8a,stroke:#172554,color:#ffffff

  subgraph GREG["Greg: behind the screen"]
    direction TB
    G0["Done<br/>Shared types, mock routes,<br/>database, demo seed, state machines"]:::done
    G1["Merged, PR #3<br/>WhatsApp webhook, templates,<br/>Judge Mode simulate"]:::done
    G1B["Now<br/>Vercel variables, sandbox webhook,<br/>real phone test"]:::now
    G2["Tue 3 Nov<br/>Voice notes, Nova parsing,<br/>pricing engine"]:::next
    G3["Wed 4 Nov<br/>Owner summary,<br/>PayPal create and capture"]:::next
    G4["Thu 5 Nov<br/>PayPal webhooks, confirmations,<br/>proof requests and upload"]:::next
    G5["Fri 6 Nov<br/>Verification engine,<br/>Nova vision, holds"]:::next
    G6["Sat 7 Nov<br/>Milestones, labour payment,<br/>override"]:::next
    G7["Sun 8 Nov<br/>Ask Hakika,<br/>Judge Mode logic"]:::next
    G8["Mon 9 Nov<br/>Security pass, tests,<br/>AI eval numbers"]:::next
    G9["Tue 10 Nov<br/>README technical sections,<br/>QA fixes"]:::next
    G10["Wed 11 Nov<br/>Devpost technical sections,<br/>testing instructions"]:::next
    G0 --> G1 --> G1B --> G2 --> G3 --> G4 --> G5 --> G6 --> G7 --> G8 --> G9 --> G10
  end

  subgraph JULIET["Juliet: what judges see and hear"]
    direction TB
    J0["Done<br/>Design system components,<br/>app shell"]:::done
    J1["By Mon 2 Nov<br/>Template copy, price sheet,<br/>voice notes, code and site photos"]:::now
    J2["Tue 3 Nov<br/>Overview page,<br/>approval card, PayPal button"]:::next
    J3["Wed 4 Nov<br/>Bryntum Gantt<br/>on mock data"]:::next
    J4["Thu 5 Nov<br/>Approval card on real routes,<br/>money trail page"]:::next
    J5["Fri 6 Nov<br/>Proof capture page,<br/>proof review page"]:::next
    J6["Sat 7 Nov<br/>Gantt on real data,<br/>alerts and override dialog"]:::next
    J7["Sun 8 Nov<br/>Judge Mode interface,<br/>Ask panel, project details"]:::next
    J8["Mon 9 Nov<br/>Phone QA, landing page, README visuals,<br/>screen recordings from the evening"]:::next
    J9["Tue 10 Nov<br/>Rough cut, captions,<br/>final voiceover"]:::next
    J10["Wed 11 Nov<br/>Picture lock, YouTube Public,<br/>Devpost description"]:::next
    J0 --> J1 --> J2 --> J3 --> J4 --> J5 --> J6 --> J7 --> J8 --> J9 --> J10
  end

  subgraph BOTH["Together: gates"]
    direction TB
    B1{{"Gate 0, by Mon 2 Nov<br/>A real WhatsApp message is<br/>stored and answered"}}:::gate
    B2{{"Gate 1, Wed 4 Nov<br/>Quote becomes an approval card;<br/>approve in PayPal; shows Paid"}}:::gate
    B3{{"Gate 2, Sat 7 Nov<br/>Full money loop on the hosted demo,<br/>no database edits by hand"}}:::gate
    B4{{"Gate 3, Tue 10 Nov<br/>Dress rehearsal runs twice<br/>with no manual fixes"}}:::gate
    B5{{"Wed 11 Nov, 11:59pm<br/>Submit, then check<br/>every link logged out"}}:::gate
    B1 --> B2 --> B3 --> B4 --> B5
  end

  J1 -.->|prices, voice notes| G2
  J1 -.->|test photos| G5
  G3 -.->|payment routes| J4
  G4 -.->|proof routes| J5
  G5 -.->|verdicts, holds| J6
  G7 -.->|scenario runner| J7
  G8 -.->|working app to record| J8
  J8 -.->|bug list| G9

  G1B --> B1
  G3 --> B2
  J2 --> B2
  G6 --> B3
  J6 --> B3
  G9 --> B4
  J9 --> B4
  G10 --> B5
  J10 --> B5

  L1["Done"]:::done ~~~ L2["In progress"]:::now ~~~ L3["To do"]:::next ~~~ L4{{"Gate"}}:::gate
```

## Day by day

| Date | Greg | Juliet | Gate |
|---|---|---|---|
| **By Mon 2 Nov** | Now that PR #3 has merged: Vercel variables, sandbox webhook, real phone test | Send template copy (EN and SW), price sheet and quotes, Swahili voice notes, code photos and site photos | **Gate 0:** a real WhatsApp message is stored and answered with a template |
| **Tue 3 Nov** | Groq Whisper translation, Nova parsing and quote reading, pricing engine, daily USD/KES rate, at least 12 pricing tests | Overview page, approval card and PayPal button on mock data | A quote photo becomes a parsed request; pricing tests pass |
| **Wed 4 Nov** | Owner summary with number guard, PayPal create order (supplier as payee) and capture | Bryntum Gantt on mock data | **Gate 1:** quote to approval card, approve in PayPal sandbox, shows Paid |
| **Thu 5 Nov** | PayPal webhooks, WhatsApp confirmations, audit events, proof codes, single-use links, upload, WhatsApp pin fallback | Approval card on real routes, money trail page | Payments appear in the money trail; a phone proof is stored with code, location and time |
| **Fri 6 Nov** | Verification engine (dHash, duplicates, geofence, freshness, code), Nova vision checks, outcome rule, holds | Proof capture page (Android Chrome and iPhone Safari), proof review page | Test photos get the expected verdicts |
| **Sat 7 Nov** | Milestone flow, labour payment, fresh proof request, override with logged reason | Gantt on real data, alerts, override dialog, loading and error states | **Gate 2:** full money loop on the hosted demo with real phones |
| **Sun 8 Nov** | Ask Hakika (read-only tools), Judge Mode scenario runner, reset, labelled replay | Judge Mode interface, Ask panel, project details page | Someone new runs all 3 scenarios from Judge Mode alone |
| **Mon 9 Nov** | Prompt-injection tests, upload and rate limits, secrets check, tests at 80%+ on pricing, verification and state machines, AI eval numbers | Phone QA with a bug list to Greg, landing page, README visuals. Screen recordings start in the evening | Injection tests pass; working app ready to record |
| **Tue 10 Nov** | QA fixes, README technical sections. Bug fixes only from here | Rough cut under 3:00, captions, final voiceover | **Gate 3:** dress rehearsal runs twice with no manual fixes |
| **Wed 11 Nov** | Devpost technical sections, testing instructions with the sandbox buyer login, friend follows the README | Picture lock, YouTube Public, Devpost description | **Submit by 11:59pm**, then open every link logged out |
| **Thu 12 Nov** | Buffer only; fix only what is broken | Buffer only | Devpost closes at 11:00pm |
| **To Tue 15 Dec** | Keep the hosted demo, Judge Mode and sandbox accounts working. No migrations and nothing judges might be testing | Keep the Gantt working: check the Bryntum trial lasts past 15 Dec | Judging runs 1 to 15 Dec |

## How we work

```mermaid
flowchart LR
  A["Branch off main<br/>feat/, fix/ or docs/"] --> B["Build and test<br/>typecheck, lint, test, build"]
  B --> C["Open a PR<br/>what, why, how tested, limits"]
  C --> D{"The other person<br/>reviews within 12 hours"}
  D -->|changes asked| B
  D -->|approved| E["Merge to main"]
  E --> F["Vercel deploys"]
  F --> G["Check the next gate"]
```

- **The contract is `src/shared/types.ts`, `src/shared/api.ts` and the API routes.** Tell the other person before changing them.
- **Work against mock routes until the real one lands.** A route that is still mock data sends the `x-hakika-mock: 1` header.
- **At least three commits a day each,** using Conventional Commits, so the history shows the work inside the hackathon window.

## Rules that do not bend

- Code decides whether money can move. No model output can trigger a payment.
- Only the owner's PayPal approval moves money. The server computes every amount; the browser never sends a total.
- Messages to people on site are fixed English and Swahili templates. The model never writes to them.
- PayPal sandbox only. Hakika never holds funds.
- Only fictional people and demo photos go to the AI models.

## If a gate slips

Cut in this order: stretch items, suggested questions, override dialog polish, landing page.

Never cut payments, verification, the Gantt, Judge Mode or the video.
