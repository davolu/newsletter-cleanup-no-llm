# Newsletter cleanup (no LLM)

A small web app that helps you clear newsletter and promo mail out of a Gmail inbox. You press **Run now**. It finds likely bulk mail with ordinary Gmail signals, asks [Jev](https://docs.typesafe.ai/models) to pick one action, and then either leaves the message alone, archives it, or adds a label called `Unsubscribe?`.

It never deletes a message and it never moves one to the trash.

This is a one-mailbox app. One deployment, one Gmail account.

## What it does, and why

Inbox promo mail is repetitive. The useful decision is small: keep it, archive it, or flag it so you can unsubscribe later. That decision does not need a general chatbot, and it does not need a model that chooses which API to call.

A run does four things:

1. It looks at recent mail (the last 90 days, skipping spam, trash, and drafts) and keeps only messages with a deterministic Gmail signal: the Promotions category, a `List-Unsubscribe` header, or a bulk-sender header (`Precedence: bulk|list|junk`, `List-Id`, or `Feedback-ID`).
2. It sends Jev the sender, the subject, and a short snippet. Nothing else from the message. Jev must pick exactly one of **keep**, **archive**, or **label `Unsubscribe?`**. If the answer is anything else, the message stays in the inbox.
3. It applies the action through Gmail, only after you say so when suggest-only mode is on. Archive means “remove the Inbox label.” The label action adds `Unsubscribe?`. Both leave the message in the mailbox.
4. It shows each message’s decision and a cost meter built from the token counts Jev returned.

Senders on your **always keep** list skip Jev and stay in the inbox.

If a run gets close to the time budget you set, it stops, saves a cursor, and the next run continues from that spot. The screen tells you to raise the batch size, or to upgrade the hosting plan if the host is cutting the run off.

## Why this is not an LLM agent

Two paid APIs do the work, and the app calls both with ordinary functions.

**Composio is the Gmail connector.** It runs Google’s OAuth screen and stores the Gmail token. This app asks Composio to run a named Gmail action (`session.execute` with a fixed tool name such as `GMAIL_FETCH_EMAILS` or `GMAIL_ADD_LABEL_TO_EMAIL`). No model picks the tool. Delete and trash actions are not in the allow-list, and the code rejects them if something asks for one.

**Jev is the classifier.** Jev is a TypeSafe model that answers a fixed multiple-choice question and returns the choice plus a real input-token count and output-token count. It does not write the email, and it does not see the body. Output tokens are free. Input tokens are [$0.042 per million](https://docs.typesafe.ai/models).

Mail does leave the deployment: a sender, subject, and short snippet go to TypeSafe, and Gmail is read and labeled through Composio. The app does not keep message bodies.

## Beginner setup

You need three accounts. None of the secret values belong in git. `.env.example` lists the names.

1. **Composio key.** Sign in at [composio.dev](https://composio.dev), open Platform, choose the project, then Settings → API Keys. Create a project API key. That value is `COMPOSIO_API_KEY`. Composio’s managed Google login is what connects Gmail, so you do not create a Google Cloud app for the usual case. If Google says the app is blocked, Composio’s managed Gmail app is not allowed for that account. Their [Gmail guide](https://docs.composio.dev/toolkits/gmail) explains using your own Google OAuth client instead.
2. **TypeSafe key.** Create a key as described in the [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart) and set `TYPESAFE_API_KEY`. TypeSafe does not include free credits. Open Settings → Billing in the TypeSafe console and add a small prepaid balance before the first run. A zero balance comes back as HTTP 402 and nothing gets classified. See [how Jev is priced](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost).
3. **Upstash Redis.** Create a database on the [Upstash console](https://console.upstash.com/). Open the REST API section and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The free database is enough for one mailbox. Check [Upstash pricing](https://upstash.com/pricing) for the current free-tier cap rather than trusting an old number.
4. **Deploy** with one of the buttons below, and paste those values when the host asks. On Vercel, also set `CRON_SECRET` to a random string of letters and numbers, at least 16 characters.
5. Open the site, press **Connect Gmail**, and finish Google’s screen. Composio keeps the token.
6. Leave **Suggest only** on for the first run. Press **Run now**. Read the list. Press **Apply selected** or **Apply all suggestions** when you agree.

The form starts at a small batch (5), a cap of 15 messages a run, and a 20 second time budget. Those are defaults so a short free-tier function can finish and save its place. Change them in the form. They are not locked to a plan.

## Deploy

The same Next.js app runs on Netlify, Vercel, and Railway. Node.js 22.22.3 or newer is required.

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/davolu/newsletter-cleanup-no-llm)

`netlify.toml` has a `[template.environment]` block, so the deploy screen asks for `TYPESAFE_API_KEY`, `COMPOSIO_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `CRON_SECRET`. The scheduled function does not use `CRON_SECRET` (it calls the runner directly). Set it anyway if you also deploy the same repo to Vercel.

A scheduled function named `scheduled-cleanup` is set to `@hourly` (minute 0 of every hour, UTC). It runs on the published production deploy, not on deploy previews. Netlify scheduled functions stop after **30 seconds**. The default time budget is 20 seconds so this app can stop itself and save the cursor first. If you raise the budget above 30 seconds, Netlify can still kill the function, and a kill can happen before the cursor is saved. Keep the budget under 30 seconds on Netlify, or use Run now from the site (the site’s server function has its own, longer limit).

Hourly is the platform timer. If you pick **Daily** in the app, the hourly function still wakes up, sees that a day has not passed, and exits without reading Gmail.

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdavolu%2Fnewsletter-cleanup-no-llm&project-name=newsletter-cleanup-no-llm&repository-name=newsletter-cleanup-no-llm&env=TYPESAFE_API_KEY,COMPOSIO_API_KEY,UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN,CRON_SECRET&envDescription=TypeSafe%20API%20key%20%28add%20a%20prepaid%20balance%3B%20there%20are%20no%20free%20credits%29%2C%20Composio%20API%20key%2C%20Upstash%20Redis%20REST%20URL%20and%20token%2C%20and%20a%20random%20CRON_SECRET%20of%20letters%20and%20numbers%2C%2016%2B%20characters%2C%20so%20the%20hourly%20route%20is%20not%20public.&envLink=https%3A%2F%2Fgithub.com%2Fdavolu%2Fnewsletter-cleanup-no-llm%23environment-variables)

`vercel.json` uses the Vercel **Schedules** `schedules` key. It does not use the legacy `crons` key. The schedule is `0 * * * *` (hourly) with `"jitter": 15`, aimed at `POST /api/scheduled`.

On the Hobby plan, a schedule can run at most every 15 minutes, jitter is always 15 minutes, and the team gets **5,000 schedule runs per billing period**. An hourly job is inside that frequency rule. A daily choice in the app does not change the Vercel schedule: the route still wakes hourly, then exits until 20 hours have passed. Those exits count toward the 5,000 runs. Hobby functions can run up to **300 seconds**. `maxDuration` on the run, approve, and scheduled routes is set to 300 so a longer time budget is not cut off at a shorter platform default. The cleanup loop still stops at the time budget you save in the form. 300 seconds is a ceiling you can edit; it is not a behavior switch inside the cleanup loop.

Vercel sends `Authorization: Bearer <CRON_SECRET>` on that path. The route does nothing unless the header matches. Use letters and numbers only, with no spaces or line breaks.

### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/{TEMPLATE_CODE})

David will publish the Railway template. Until `{TEMPLATE_CODE}` is replaced, that button is a placeholder and will not deploy this repo.

When the template exists it should create two services from this repo:

- The web service uses `railway.toml`. It stays up and serves the site (`npm run start`).
- The cron service uses `railway.cron.toml`. Its start command is `npm run scheduled`, the cron is `15 * * * *` (15 minutes past every hour, more than 5 minutes apart), and the restart policy is `NEVER`. The process must exit. It does.

You can wire the same two services by hand: one service with start command `npm run start`, and a second service from the same repo with start command `npm run scheduled`, cron schedule `15 * * * *`, and no restart. The cron process checks the in-app schedule and exits immediately when that toggle is off.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Yes | Jev classification. Prepaid balance required. |
| `COMPOSIO_API_KEY` | Yes | Composio project key. Holds the Gmail connection. |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token. |
| `CRON_SECRET` | Yes on Vercel | Shared secret for `POST /api/scheduled`. Letters and numbers, 16 or more characters. |
| `TYPESAFE_MODEL` | No | Defaults to `jev-latest`. |
| `APP_ORIGIN` | No | Public site origin if the host does not send forwarded host headers. Used as the Gmail return URL. |

## Cost

Jev’s published price is **$0.042 per million input tokens**. Output tokens are free. There is no separate per-request fee. Source: [docs.typesafe.ai/models](https://docs.typesafe.ai/models).

The meter multiplies the input-token count Jev returned by that rate. If Jev does not return a token count for a call, that call is shown as zero tokens. The app does not guess a count.

The same input count and the same output count are also priced at OpenAI’s published standard rates for `gpt-4o-mini`: **$0.15 per million input tokens** and **$0.60 per million output tokens**. Source: the Standard pricing table on [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing) (row `gpt-4o-mini`, columns Input and Output). Both numbers live in `src/lib/pricing.ts` with those URLs in a comment. This is a price comparison of the counts Jev already returned. It is not a claim about how another model would have classified the mail.

Example arithmetic, not a forecast: 100,000 input tokens and 5,000 output tokens cost `100000 / 1000000 * 0.042` = **$0.0042** on Jev, because the output tokens are free. The same counts at the `gpt-4o-mini` rates are `100000 / 1000000 * 0.15` + `5000 / 1000000 * 0.60` = **$0.018**.

TypeSafe bills this from the prepaid balance. Composio, Upstash, and the host each have their own plans. A host’s free tier can still stop a function early; that is what the time budget and the cursor are for.

## Where state lives

State is in **Upstash Redis**, reached over HTTPS with `@upstash/redis`. That works from Netlify, Vercel, and Railway without a private network. The keys hold:

- settings (batch size, caps, schedule, always-keep senders)
- the Gmail page cursor
- ids of messages already considered, so a later run does not pay Jev again for the same message
- suggestions waiting for approval
- the latest result rows (sender, subject, short snippet, decision)
- run history (counts and token totals)

Reset scan clears the cursor, the handled ids, and the pending suggestions. It does not clear history, so the cost meter keeps the real totals.

## Schedule

The schedule toggle starts **off**. Manual **Run now** is the normal way to use the app.

Netlify, Vercel, and Railway still have a timer, because a host cannot turn its cron on and off from a checkbox in Redis. Each timer calls one entrypoint (`netlify/functions/scheduled-cleanup.mts`, `POST /api/scheduled`, or `npm run scheduled`). That entrypoint reads the toggle. When the toggle is off, it exits without calling Gmail or Jev. When the toggle is Daily, an hourly wake-up exits until 20 hours have passed since the last scheduled run.

## Safety

- The only Gmail writes are “remove the Inbox label” and “add the `Unsubscribe?` label.”
- Tool names that delete or trash mail are rejected before a request is sent.
- A label id has to look like a Gmail user label (`Label_…`) before it can be added. System labels such as `TRASH` are refused.
- Suggest-only is the default. Turn it off only when you want Run now to apply actions immediately.
- Secrets stay in the host’s environment. Do not commit a filled-in `.env` file.
- Server logs record counts, a stop/go reason, and redacted errors. They do not record API keys, message bodies, subjects, or addresses.
- The site URL is the control panel. Anyone who can open it can connect Gmail and run a cleanup. If that URL should not be public, turn on the host’s access control (Netlify password protection, Vercel deployment protection, or an equivalent Railway control).

## Run it locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Put the real keys in `.env.local`, which git ignores.

```bash
npm test
npm run scheduled
```

`npm test` does not call TypeSafe or Composio. `npm run scheduled` runs one schedule check and the process exits. It does no work while the in-app schedule is off.

## Tests

`npm test` covers candidate detection (Promotions, `List-Unsubscribe`, bulk-sender headers, ordinary mail, the always-keep list), classification parsing (the three actions, a refusal of any other action, real token counts, and a mocked Jev call that only receives sender, subject, and a short snippet), and the cost math against the published prices. Jev is mocked in tests only.

## Credit

David Oluyale, Agentic AI Hub. [youtube.com/@AgenticAIHub1](https://www.youtube.com/@AgenticAIHub1)

## License

MIT. See [LICENSE](LICENSE).
