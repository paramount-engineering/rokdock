# AI Chat (Beta)

RokDock includes an opt-in AI assistant. It is a general-purpose, multi-turn chat that lives in the app alongside the terminal, devices, and tools, so it can answer questions in the context of your Roku development work. AI features are off until you configure a provider, and they are clearly labeled **Beta**.

## Enabling AI

AI is disabled until you add at least one provider in **Settings > AI (Beta)**. Once a provider is configured, the AI Chat panel becomes available in the app and the "Explain this" action appears in the terminal.

See [Settings > AI (Beta)](settings.md#ai-beta) for the full provider configuration reference, including the supported provider types, the redaction toggle, the Local flag, and Test Connection.

### Provider types

You can configure one or more providers and designate one as active:

- **Anthropic (Claude)**, **Gemini**, and **OpenAI-compatible** HTTP providers, each with a model name, an optional base URL, and an API key.
- **CLI providers** (Claude, Copilot, Gemini, Codex), which drive an AI command-line tool already installed on your machine. A CLI provider is keyless and runs locally.

API keys are stored encrypted on your machine via the OS keychain and are never shown again after saving.

### Provider configuration reference

The fields you fill in depend on the provider type. The in-tab placeholders give a hint, and the values below are a fuller reference. Model names change over time, so treat the models as examples and use whatever your account or local install exposes. Confirm base URLs against your provider's own documentation.

| Provider type | Base URL | Example model |
|---|---|---|
| Anthropic (Claude) | not needed (native) | `claude-opus-4-8` |
| Gemini | not needed (native) | `gemini-2.5-flash` |
| OpenAI (via OpenAI-compatible) | `https://api.openai.com/v1` | `gpt-4o` |
| OpenRouter (via OpenAI-compatible) | `https://openrouter.ai/api/v1` | a model id from OpenRouter's catalog |
| Gemini via its OpenAI-compatible endpoint | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` |
| Azure OpenAI (via OpenAI-compatible) | `https://<resource>.openai.azure.com/...` (per your Azure deployment) | your deployment name |
| Ollama (local, via OpenAI-compatible) | `http://localhost:11434/v1` | `llama3.1` |
| LM Studio or another local server (via OpenAI-compatible) | the server's printed URL (often `http://localhost:1234/v1`) | the model the server reports |

Notes:

- **Anthropic** and **Gemini** have native adapters: pick the type, enter a model and key, and leave Base URL blank.
- The **OpenAI-compatible** type is the catch-all for any OpenAI-style HTTP endpoint. Set its Base URL and model. Hosted services (OpenAI, OpenRouter, Azure) need a key. Local servers (Ollama, LM Studio) usually do not, so mark the profile **Local**.
- A **local** model (Ollama, LM Studio) reached over its HTTP endpoint is configured as an OpenAI-compatible provider marked Local. This is separate from a recognized **CLI** provider.
- **Recognized CLIs** (Claude Code, GitHub Copilot, Gemini CLI, Codex) are auto-detected when installed on your PATH and appear in the provider list with no setup. You only optionally set a model; RokDock builds the CLI invocation for you. Thin command wrappers like `ollama` or `llm` are not recognized as CLIs. Reach a local model through the OpenAI-compatible endpoint above instead.

### Privacy and redaction

Each provider has a **Redact sensitive values** toggle, on by default. Redaction removes device IPs, names, and serial numbers from your prompt before it is sent. Mark a provider **Local** when it runs on your own machine (a localhost endpoint or a CLI tool); a local provider needs no key and nothing leaves the machine.

If you turn redaction off on a remote provider, RokDock shows a warning and requires you to acknowledge that prompts will be sent unredacted before you can save. The **Test** button on each provider shows a "what was sent (redacted)" preview alongside the result, so you can confirm exactly what leaves your machine.

## The AI Chat Panel

![The AI Chat (Beta) panel showing a question ("what is a SceneGraph roSGScreen?") and the assistant's answer, with Roku terms linkified into the docs, plus the move and new-chat controls and an "Ask anything..." input](images/ai-chat-panel.png)
*The AI Chat panel docked in the left column. Roku terms in the answer are linked into the in-app docs.*

Once a provider is configured, the AI Chat (Beta) panel appears as a collapsible section in the app. Use its header to expand or collapse it.

- **Ask a question.** Type in the input box and press `Enter` to send (`Shift+Enter` inserts a newline). Replies stream in live.
- **Stop.** While a reply is streaming, a stop button cancels it.
- **New chat.** The new-chat button clears the conversation and starts fresh.
- **Move the panel.** The panel can be docked on the left, in the middle (as a drawer in the terminal area), or on the right. Use the move button in the panel header to cycle through the positions.
- **Used docs.** When the assistant draws on the Roku developer documentation, the reply shows a "Used docs" list. Click a source to open that page in [Developer Docs](developer-docs.md).

## Explain This (from the Terminal)

Select text in a terminal tab and choose **Explain this (Beta)** from the selection toolbar. The selected text is sent to the assistant, which opens the AI Chat panel with an explanation. This is handy for decoding a stack trace, an unfamiliar debugger message, or a chunk of BrightScript output.

See [Terminal](terminal.md) for more on terminal selection and output.

## Related

- [Settings](settings.md#ai-beta) - configure AI providers, redaction, and Test Connection
- [Developer Docs](developer-docs.md) - the documentation the assistant can cite
- [Terminal](terminal.md) - the "Explain this" selection action
