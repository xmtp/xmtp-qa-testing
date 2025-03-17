# 🤖 Test bot

A lightweight toolkit for app developers to test messaging functionality against XMTP bots.

### Prerequisites

- Node.js (20.18.0)
- Yarn

### Installation

```bash
git clone https://github.com/xmtp/xmtp-qa-testing
cd xmtp-qa-testing
yarn install
# Run the bot
yarn bot:test
```

## 💬 Available Commands

| Command                | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `gm`                   | Returns gm to your message                                   |
| `/create [5]`          | Creates a test group with simulated users and conversation   |
| `/rename [name]`       | Rename the current group                                     |
| `/add [name]`          | Add the name of a worker to the group                        |
| `/remove [name]`       | Remove the name of a worker from the group                   |
| `/groups`              | List all active groups                                       |
| `/members`             | List all members in the current group                        |
| `/broadcast [message]` | Broadcast a message to all participants in the current group |
| `/leave`               | Leave the current group                                      |
| `/info`                | Get info about the current group                             |
| `/workers`             | List all available workers                                   |
| `/blast [message]`     | Blast a message to all participants in the current group     |
| `/me`                  | Get info about the current worker                            |

## ⚙️ Environment Configuration

Create a `.env` file with the following configuration:

```bash
LOGGING_LEVEL="off" # off, error, warn, info, debug, trace
XMTP_ENV="dev" # dev, production
OPENAI_API_KEY="sk-proj-..." # OpenAI API key
```

## 🧪 Considerations

- If a worker does not exist, its keys are created.
- If worker exists uses the existing env file keys and .data folder
- If the data folder doesnt exist, it creates one
- Workers prefixed with "random" have keys that are stored only in memory.

### Resources

- **Local:** Work in local network with [dev section](/dev/)
- **Workers:** Predefined workers like `bob`, `alice`, `randomguy` with [workers](/workers/)
- **Helpers:** Utility functions in the [helpers section](/helpers/)
- **Scripts:** Automation scripts in the [scripts section](/scripts/)
