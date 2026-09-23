# Jev Orchestrator

Jev Orchestrator reads the messages that come in to your business, and it writes the replies.

It connects to Gmail, Typeform, Slack, Discord and X through [Composio](https://composio.dev). A small model reads each message and puts it into one of six groups. Only the group that matches runs an agent, and that agent writes the reply. You read the reply and click send.

```
Gmail · Typeform · Slack · Discord · X
                 │
                 ▼
                Jev  ──►  ignore · faq · sales · support · escalate · unsure
                              │                        │
                              ▼                        ▼
                    one agent for each group        needs you
                    writes the reply                you approve or sort
```

## What is Jev

Jev is a model from [TypeSafe](https://docs.typesafe.ai), and it is their first System One model. A System One model makes fast decisions that software can use as they are. It writes no text, so you have nothing to parse.

You give Jev a state and some typed questions. It returns a typed answer for each question, a probability for every option, and a confidence value. Your own code reads those numbers and picks what happens next.

Jev answers three kinds of question.

| type | what it does |
| --- | --- |
| Choice | Picks one option from a list that you give it. |
| Score | Rates the state against a rubric. |
| Noul | Answers a true or false question, as a number from 0 to 1. |

A large language model can do this work too. You ask it for text, you read the text back, and you hope the shape is right. Jev skips those steps and hands the numbers straight to your code.

TypeSafe calls the method **atomic questions, composed in code**. You split a hard judgement into small questions, you ask them together, and you join the answers in your own logic. This app does that with three questions and three rules. One read costs about three hundredths of a cent and takes about half a second. The large model then runs only for a message that needs a reply.

## What is Composio

[Composio](https://composio.dev) connects the app to the places your messages live. It holds the accounts, it sends the events, and it runs the tools that post a reply.

You connect an account once in the browser, and Composio keeps the tokens. The triggers for Gmail, Typeform, Slack and Discord come over a subscription, so you need no public URL and no webhook.

A tool session holds the tools you name and nothing else. The FAQ agent gets one tool to reply in a mail thread. A wrong turn in the model still cannot touch your drive or your calendar. Composio has more than three hundred apps, and each one you add here is a few lines of code.

Read the [Composio docs](https://docs.composio.dev) to see the full list.

## What it can do

**It watches five places.** New mail in Gmail, new answers to a Typeform, new Slack messages, one Discord channel, and people who mention your handle on X. They all go through the same steps.

**It decides before it writes.** Jev reads each message in about half a second, and one read costs about three hundredths of a cent. Spam and machine notices stop there, so you pay for a large model only when a message needs an answer.

**It answers from your own words.** The agents read three Markdown files that you write. The FAQ agent can use only `faq.md`. If the answer is absent, it says so and it does not invent one. The support agent uses `support.md`. The sales agent gives your booking link, and it offers no discounts.

**It holds the risky ones.** Angry messages, refund fights, legal threats, security reports and questions from the press go to a group that always waits for a person. The agent adds one line that tells you why it waited. If Jev is unsure, the message waits too, and no agent writes anything.

**You clear the queue with clicks.** Each reply has a real send tool behind it, so **Send** puts the reply on the channel that the message came from. **Send all** approves the ordinary replies together, and it leaves the risky ones for you. For a message with no group, Jev offers its next best guess as one button.

**You can watch it work.** The browser shows a live chart. A dot moves along the line for each message, and counters go up on the boxes. Click a box to see what is behind it.

## How it works

**Jev reads the message once.** The app reaches Jev through OpenRouter at `/v1/systemone`. The state holds your business notes, your FAQ and the message. Jev gets three questions with it. One Choice picks the group, and two Nouls each come back as a number between 0 and 1.

| question | type | what it asks |
| --- | --- | --- |
| bucket | Choice | Which of the six groups does this message belong to? |
| faq_covers | Noul | Does the FAQ hold a direct answer to this? |
| needs_human | Noul | Is an automatic reply to this risky? |

**Your code makes the decisions.** Jev gives numbers, and three rules in `src/jev.js` turn those numbers into an outcome. The rules are code, so you can read them and change them.

| rule | result |
| --- | --- |
| The confidence is below the floor. | unsure |
| Jev said faq, and the FAQ does not cover it. | unsure |
| The risk is 70 percent or more. | escalate |

**Each agent gets one tool.** Every agent runs in a [Composio](https://docs.composio.dev) session that holds only the tool it needs. The FAQ agent can reply in a mail thread, and it can do nothing else. You choose the model for the agents in `jev.json`.

**The triggers come to you.** Gmail, Typeform, Slack and Discord send events over a Composio subscription, so you need no public URL and no webhook. X has no trigger, so the app asks X for new mentions every five minutes.

**There are two modes.** In `review` mode every reply waits for you. In `auto` mode the faq, sales and support replies go out at once, and the escalate and unsure ones still wait. If a channel has no way to post, the app writes the reply and keeps it for you.

**The sources live in one file.** `src/sources/index.js` holds the toolkits, the settings and the trigger for each source. The setup program, the HTTP API and the browser panels all read that one file.

**The state lives in three places.** `jev.json` holds the settings. `knowledge/` holds the words the agents may use, and you can edit those files in the browser or in an editor while the app runs. `.state/` holds the queue, the list of messages it has seen, and a log of every action. One process watches at a time, and a lock file keeps it that way, so two windows cannot answer the same message twice.

## Run it

```bash
npm install
npm run build
npx jev-orchestrator setup     # keys, your details, connect Gmail
npx jev-orchestrator           # opens http://127.0.0.1:4180
```

The setup program connects Gmail. You connect the other four in the browser. Click a source box, connect the account, fill in the settings and turn it on. The app picks it up at once.

You need two keys. The setup program asks for both and writes them to `.env`.

- `COMPOSIO_API_KEY` from [platform.composio.dev](https://platform.composio.dev) runs every connection.
- `OPENROUTER_API_KEY` from [openrouter.ai/keys](https://openrouter.ai/keys) runs Jev and the agents. Put a spend limit on it.

To try a message, type it in the box at the bottom. It goes through all the real steps, and nobody receives it. Press `Ctrl+Shift+D` to play a set of messages through every source. That also turns on a stand-in name, so your own name and address stay off the screen. Press it again to stop.

There are more commands. `start` runs without a browser and prints one line for each decision, and `--dry-run` sorts the messages and writes nothing. `inbox` approves replies in the terminal. `test "…"` tries one message, and `--from email|form|slack|discord|x` sets the channel. `status` shows what is connected. `mode auto|review` changes the mode.

## How to contribute

```bash
npm run dev        # Vite on :5173, hot reload, API goes to :4180
npm run build      # writes web/dist, which the server sends to the browser
npm run typecheck
```

Run `npx jev-orchestrator` in one terminal and `npm run dev` in another. The server code in `src/` is plain ESM, so restart it to load a change. The browser code reloads by itself.

| path | what it holds |
| --- | --- |
| `bin/jev-orchestrator.js` | the CLI, one case for each command |
| `src/jev.js` · `src/typesafe.js` | the questions for Jev, and the call that sends them |
| `src/agents.js` | the agents, their instructions, and the tool each one gets |
| `src/pipeline.js` | one message in, one decision out |
| `src/normalize.js` | every payload shape becomes one message shape |
| `src/sources/index.js` | the list of sources |
| `src/engine.js` | the trigger stream, the X polling, and the reconnect |
| `src/server.js` | the local HTTP server and the event stream |
| `web/src/store.ts` | events become counters, dots and log lines |
| `web/src/flow/` | the chart |
| `web/src/components/` | the top bar, the side panel, the queue and the message box |

**To add a source**, put an entry in `src/sources/index.js` with its toolkits, its settings and its trigger. Write a function in `src/normalize.js` that returns the standard message shape. Add the trigger name to `TRIGGER_SLUGS`. Add the send tool to `CHANNEL_TOOLS` in `src/composio.js`. Add a line to the router in `src/agents.js`, and add a box in `web/src/flow/graph.ts`. This takes about sixty lines.

**House style.** The server code is plain ESM and it needs no build step. The browser code is React, and it uses no `useEffect`. The store sits outside React, and components read it through `useSyncExternalStore`. The styles use Tailwind with [shadcn/ui](https://ui.shadcn.com) parts, [React Flow](https://reactflow.dev) for the chart, and [Radix Colors](https://www.radix-ui.com/colors) for the group colours. A comment should give the reason for the code below it. Use no em dashes in the code or in the words the agents write.

**Before you send a pull request**, run `npm run typecheck` and `npm run build`. Then try the path you changed. Use `npx jev-orchestrator test "…"` to see the group and the reply, or use the message box for the full path. If you changed the code that sends, try it against an address that you own.

## Known limits

X needs your own developer app, because Composio has no shared one. Discord can read a channel, and it can reply only if you also connect the Composio bot. The app handles three messages at a time, which suits an inbox with normal traffic.
