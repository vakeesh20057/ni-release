# Model Management

Local LLM model management for NeuralInverse CE.

## Architecture

- `types.ts` - Type definitions and interfaces
- `service.ts` - Service interface (`IModelManagementService`)
- `serviceImpl.ts` - Service implementation with DI registration
- `index.ts` - Public API barrel exports

## Features

- **Discovery**: Browse available models from Ollama library
- **Installation**: Pull models with progress tracking
- **Management**: List, delete installed models
- **Testing**: Test models with performance metrics
- **Health**: Monitor provider status
- **Recommendations**: Use-case-specific model suggestions

## Usage

```typescript
import { IModelManagementService } from 'vs/workbench/contrib/neuralInverse/common/modelManagement';

// Inject via DI
constructor(@IModelManagementService private readonly modelService: IModelManagementService) {}

// Browse models
const models = await this.modelService.browseModels('ollama');

// Pull a model
await this.modelService.pullModel('ollama', 'qwen2.5-coder:32b');

// Listen to progress
this.modelService.onPullProgress(progress => {
  console.log(progress.percentage);
});
```

## Integration Points

- **Onboarding**: Initial model setup flow
- **Settings**: Model configuration UI
- **Agent Dashboard**: Model health monitoring
