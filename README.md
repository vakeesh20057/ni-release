# NeuralInverse Community Edition

<div align="center">
	<img
		src="./src/vs/workbench/browser/parts/editor/media/neuralinverse_logo.png"
		alt="NeuralInverse"
		width="300"
		height="300"
	/>
</div>

NeuralInverse CE is a free, open-source AI-native IDE for developers who want powerful AI coding assistance without any cloud lock-in.

Bring your own LLM and get full AI chat, agentic coding, and Power Mode workflows - all running locally or against any provider you choose.

- 🌐 [Website](https://neuralinverse.com)
- 📧 [Contact](mailto:github@neuralinverse.com)
- 🏢 [Enterprise Edition](https://neuralinverse.com) - compliance, GRC, and legacy modernization for regulated industries


## Features

- **AI Chat**: Inline and sidebar chat with full codebase context

- **Power Mode**: Agentic coding workflows - plan, edit, and run multi-step tasks autonomously

- **Bring Your Own LLM**: Direct integration with Claude, GPT-4, Gemini, Ollama, Bedrock, and more - no middleman, your keys stay with you

- **Modernization Engine**: Legacy codebase migration tooling with discovery, planning, translation, and cutover phases - supports COBOL, PL/SQL, RPG, Natural, and more

- **Firmware Support**: Datasheet knowledge base and embedded development tooling

- **Multi-model**: Switch between providers and models per task


## What is not in CE

The following features are available in [NeuralInverse Enterprise](https://neuralinverse.com):

- neuralInverseChecks - real-time GRC and compliance enforcement (HIPAA, SOC2, FDA 21 CFR Part 11, ISO 26262, etc.)
- Checks Agent - AI agent with programmatic access to violations, rule explanations, and compliance reporting
- NeuralInverse auth and team collaboration features


## Credits

NeuralInverse CE is built on top of [Void](https://github.com/voideditor/void) - an open-source AI code editor. Void is itself forked from [VS Code](https://github.com/microsoft/vscode) by Microsoft. We are grateful to both projects and their contributors.


## Architecture

NeuralInverse CE is forked from [Void](https://github.com/voideditor/void), which itself is a fork of [VS Code](https://github.com/microsoft/vscode).

Key modules:
- `src/vs/workbench/contrib/void/` - AI agent and chat infrastructure
- `src/vs/workbench/contrib/powerMode/` - Power Mode agentic workflows
- `src/vs/workbench/contrib/neuralInverseModernisation/` - Legacy code modernization platform
- `src/vs/workbench/contrib/neuralInverseFirmware/` - Firmware datasheet knowledge base


## Building from source

```bash
npm install
npm run compile
```

See [HOW_TO_CONTRIBUTE.md](./HOW_TO_CONTRIBUTE.md) for full setup instructions including platform prerequisites and developer mode.


## License

Copyright 2025 Neural Inverse Inc. Licensed under the Apache License 2.0. See [License.txt](./License.txt) for details.


## Support

- Email: github@neuralinverse.com
- Website: https://neuralinverse.com
