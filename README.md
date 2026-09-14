# Jarvis

A local Windows assistant with a browser interface, optional AI chat, English/Arabic voice input, speech output, persistent memory, tasks, reminders, text-file tools, and reviewed app/website launches.

## Start on Windows

1. [Download ZIP](https://github.com/ieZaky/Jarvis/archive/refs/heads/main.zip) and extract it.
2. Install [Python 3.11+](https://www.python.org/downloads/windows/). Select **Add Python to PATH**.
3. Double-click **start.bat**. Keep the console window open.
4. Jarvis opens in your browser. Chrome or Edge is recommended for microphone support.
5. Try **/help**, or connect an AI provider in **Settings**.

No Python packages are required. Linux/macOS: run `python3 jarvis.py` (Windows app launching is unavailable).

The interface connects to a real local service on your computer. This is an initial implementation, not an unrestricted autonomous computer operator.

## AI setup

**OpenAI:** Select OpenAI in Settings, enter a chat model with tool support (default: gpt-4.1-mini), and paste your API key. Save and send a message. The key stays in server memory, never on disk or in API responses. Re-enter it after restart, or supply the OPENAI_API_KEY environment variable. You need API access and quota for the selected model; the app does not use your ChatGPT login. Never commit keys to this public repository.

Recent chat, saved memories, and requested tool results (including file contents) are sent to OpenAI when using this provider.

**Ollama:** Install [Ollama](https://ollama.com/), start it, and install a model with tool support, for example by running **ollama pull qwen3:8b**. Select Ollama in Settings and enter the exact installed model name. Jarvis connects only to http://127.0.0.1:11434/v1/chat/completions. Speed and tool reliability depend on your model and PC.

**Local commands:** No AI or key needed. This is deterministic command handling, not simulated AI. Slash commands also work when AI is selected.

## Commands

| Command | Result |
|---|---|
| /help | Show command help |
| /time | Local date/time |
| /calc (15 + 5) * 3 | Arithmetic |
| /remember I prefer concise answers | Save memory |
| /memories | List saved memories |
| /memories concise | Search memory |
| /task Review test cases | Add task |
| /tasks | List open tasks |
| /done 1 | Complete task 1 |
| /remind 10m Take a break | Reminder; m/h/d units |
| /files | List workspace files |
| /read notes.txt | Read a UTF-8 text file |
| /open https://github.com | Queue browser launch |
| /search Selenium tutorials | Queue Google search page |
| /app calculator | Queue Calculator; also notepad/explorer |

To create a new file, use a pipe separator:
```text
/write notes.txt | Hello from Jarvis
```

With AI enabled, try “Remember that I prefer Egyptian Arabic,” “Write a test plan to plan.txt,” or “Remind me tomorrow at 9 AM to review regression.” Review the saved task time.

## Voice

Click the microphone, speak, review the transcript, and send. Enable **Speak replies** for browser text-to-speech. Select English or Arabic.

Voice requires browser support and microphone permission. Recognition may send audio to your browser vendor and require internet, even with Ollama. There is push-to-talk, not an always-listening wake word. Voice is never auto-submitted. Typing remains available if voice fails.

## Data and reminders

Data lives in **%USERPROFILE%\\.jarvis** on Windows, or **~/.jarvis** elsewhere:

- jarvis.db: chat, memories, tasks, and action history.
- settings.json: provider and model only.
- workspace/: the only directory file tools can access.

Reminders are checked every five seconds while the interface is open and the server runs. Enable browser notifications for desktop alerts. Background tabs may delay alerts. Overdue tasks appear on return; Jarvis does not wake a sleeping PC or notify while closed. The task form schedules at minute precision. Recurring unattended jobs are not included.

The interface displays the latest 100 messages, 100 memories, 200 tasks, and 100 launch actions; older records remain in SQLite. AI receives the latest 20 chat messages and 30 memories.

Back up this directory to preserve your data. Local data is not encrypted at rest. To reset, stop Jarvis and move/remove this directory yourself.

## What actions can do

- App/website requests appear in **Activity** and execute only after **Approve**. Repeated clicks cannot execute an action twice.
- Browser launch success means the browser accepted the request, not that the page loaded.
- Search opens a search page; Jarvis cannot read results or perform live research.
- Calculator, Notepad, and Explorer are the only supported apps. No arbitrary shell execution.
- Read UTF-8 text files up to 100 KB; create new files up to 20,000 characters. Existing files are never overwritten.
- Requested memory/task changes and new workspace files execute directly.
- The server binds to 127.0.0.1 only. A random launch token establishes an HttpOnly SameSite cookie; Host and Origin checks protect requests.
- No email sending, account connections, purchases, autonomous job applications, mouse/keyboard control, or browser click/type automation are implemented.
- AI can make mistakes. Inspect generated files and task dates.

## Troubleshooting

**Python not found:** install Python 3.11+ with PATH enabled.

**Session expired:** reopen the full launch URL printed in the console. The token changes after each restart.

**Port in use:** close the other instance or set JARVIS_PORT to another port.

**No AI response:** check model name, key/access/quota, or start Ollama and install the model. Failures appear in chat. Requests are not automatically retried, to avoid duplicated actions.

**Microphone unavailable:** try Chrome/Edge and grant local-site microphone permission.

**Cannot read Documents:** copy the relevant text file into the workspace shown in Settings.

## Development and checks

```text
python -m unittest discover -s tests -p "test_*.py" -v
```

GitHub Actions runs Python/HTTP tests on Windows and Linux, JavaScript syntax checks, and Chromium UI workflows. Playwright is a development-only dependency. Check [Actions](https://github.com/ieZaky/Jarvis/actions) for actual results.

Tests use temporary data and mocked AI/PC launches. They verify persistence, tool roundtrips, HTTP protection, file boundaries, approval handling, and interface workflows. They do not verify real credentials, installed models, microphone, notification delivery, or physical app launches.

Protocol references: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

## Source layout

- jarvis.py: service, SQLite, tools, AI integration.
- web/: interface, no CDN dependencies.
- start.bat: Windows launcher.
- tests/: Python and browser tests.
- .github/workflows/checks.yml: automated checks.
