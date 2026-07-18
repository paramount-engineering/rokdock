# AI Assistant for Roku Development (Gemini, Claude, Copilot, and Codex)

RokDock includes an opt-in AI assistant named **roBot**. It is a general-purpose, multi-turn chat that lives in the app alongside the terminal, devices, and tools, so it can answer questions in the context of your Roku development work. AI features are off until you configure a provider, and they are clearly labeled **Beta**.

## Enabling AI

AI is disabled until you both add (or auto-detect) a provider in **Settings > AI (Beta)** and set one as the **active** provider. roBot always uses the single active provider. The roBot panel and the terminal's "Ask roBot" action appear only once a provider is active. If none is active, neither is shown, even when providers are listed.

Setting the active provider differs by type:

- **HTTP providers** (Anthropic, Gemini, or OpenAI-compatible): adding your first one makes it active automatically.
- **CLI providers** (Claude Code, GitHub Copilot, Gemini CLI, Codex): these are auto-detected and appear in the list, but are never activated for you. You must click **Set active** on the one you want, even though it is already listed.

The active provider carries an **Active** badge in the provider list, and every other row shows a **Set active** button. If AI still seems unavailable after you have configured a provider, confirm that one is marked Active.

See [Settings > AI (Beta)](settings.md#ai-beta) for the full provider configuration reference, including the supported provider types, the redaction toggle, the Local flag, and Test Connection.

### Provider types

You can configure one or more providers and designate one as active:

- **HTTP providers** with a native adapter (Anthropic Claude, Google Gemini) or the **OpenAI-compatible** catch-all, each with a model name, an optional base URL, and an API key.
- **CLI providers** (Claude Code, GitHub Copilot, Gemini CLI, Codex), which drive an AI command-line tool already installed on your machine. A CLI provider is keyless and runs locally.

API keys are stored encrypted on your machine via the OS keychain and are never shown again after saving.

### Privacy and redaction

Each provider has a **Redact sensitive values** toggle, on by default. Redaction removes device IPs, names, and serial numbers from your prompt before it is sent. Mark a provider **Local** when it runs on your own machine (a localhost endpoint or a CLI tool). A local provider needs no key and nothing leaves the machine.

If you turn redaction off on a remote provider, RokDock shows a warning and requires you to acknowledge that prompts will be sent unredacted before you can save. The **Test** button on each provider shows a "what was sent (redacted)" preview alongside the result, so you can confirm exactly what leaves your machine.

## Connecting a provider

These are task-shaped views of the provider system above. Model names change over time, so treat them as examples and use whatever your account or local install exposes. Confirm base URLs against your provider's own documentation.

### Google Gemini

RokDock supports Gemini three ways, so you can use whichever you already have:

- **Native Gemini adapter.** Add a provider of type Gemini, enter a model (for example `gemini-2.5-flash`) and your API key, and leave Base URL blank.
- **Gemini CLI.** If the Gemini command-line tool is on your PATH, RokDock auto-detects it and lists it with no setup. It runs locally and needs no key.
- **OpenAI-compatible endpoint.** Point an OpenAI-compatible provider at `https://generativelanguage.googleapis.com/v1beta/openai/` with your key and a Gemini model.

### Anthropic Claude

- **Native Anthropic adapter.** Add a provider of type Anthropic (Claude), enter a model (for example `claude-opus-4-8`) and your key, and leave Base URL blank.
- **Claude Code CLI.** If Claude Code is on your PATH, it is auto-detected, runs locally, and needs no key.

### OpenAI and Codex

- **OpenAI (HTTP).** Add an OpenAI-compatible provider with Base URL `https://api.openai.com/v1`, your key, and a model such as `gpt-4o`.
- **Codex CLI.** If the Codex command-line tool is installed, RokDock auto-detects it and runs it locally against your account.

### GitHub Copilot

- **Copilot CLI.** If the GitHub Copilot command-line tool is on your PATH, it is auto-detected and keyless, and it uses your existing Copilot subscription.

### Other OpenAI-compatible services

The OpenAI-compatible type is the catch-all for any OpenAI-style HTTP endpoint. Set its Base URL and model, and add a key for hosted services:

- **OpenRouter.** Base URL `https://openrouter.ai/api/v1`, plus a model id from OpenRouter's catalog.
- **Azure OpenAI.** Base URL `https://<resource>.openai.azure.com/...` per your Azure deployment, with your deployment name as the model.

### Local models (Ollama, LM Studio)

Run a model entirely on your own machine and configure it as an OpenAI-compatible provider marked **Local** (no key, and nothing leaves the machine):

- **Ollama.** Base URL `http://localhost:11434/v1`, a model such as `llama3.1`.
- **LM Studio or another local server.** Use the URL the server prints (often `http://localhost:1234/v1`) and the model it reports.

Thin command wrappers like `ollama` or `llm` are not recognized as CLI providers. Reach a local model through the OpenAI-compatible endpoint above instead.

## The roBot Panel

![The roBot (Beta) panel: an assistant answer explaining a BrightScript node-field initialization warning, with Roku terms and a pkg: source path highlighted as links into the docs, plus the move, new-chat, and settings controls in the header and an "Ask roBot anything..." input](images/ai-chat-panel.png)
*The roBot panel docked in the left column. Roku terms in the answer are linked into the in-app docs.*

Once a provider is active, the roBot (Beta) panel appears as a collapsible section in the app. Use its header to expand or collapse it. The gear in the panel header opens **Settings > AI (Beta)** so you can switch the active provider or adjust its settings.

- **Ask a question.** Type in the input box and press `Enter` to send (`Shift+Enter` inserts a newline). Replies stream in live.
- **Stop.** While a reply is streaming, a stop button cancels it.
- **New chat.** The new-chat button clears the conversation and starts fresh.
- **Move the panel.** The panel can be docked on the left, in the middle (as a drawer in the terminal area), or on the right. Use the move button in the panel header to cycle through the positions.
- **Used docs.** When the assistant draws on the Roku developer documentation, the reply shows a "Used docs" list. Click a source to open that page in [Developer Docs](developer-docs.md).

## Ask roBot (from the Terminal)

Select text in a terminal tab and choose **Ask roBot (Beta)** from the selection toolbar. The selected text is sent to the assistant, which opens the roBot panel with an explanation. This is handy for decoding a stack trace, an unfamiliar debugger message, or a chunk of BrightScript output.

See [Terminal](terminal.md) for more on terminal selection and output.

## Related

- [Settings](settings.md#ai-beta) - configure AI providers, redaction, and Test Connection
- [Developer Docs](developer-docs.md) - the documentation the assistant can cite
- [Terminal](terminal.md) - the "Ask roBot" selection action
