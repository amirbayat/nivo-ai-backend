import { AiModelRegistryService } from './ai-model-registry.service';
export declare class TokenEstimatorService {
    private readonly modelRegistry;
    constructor(modelRegistry: AiModelRegistryService);
    estimateTokens(text: string, modelId: string): Promise<number>;
}
