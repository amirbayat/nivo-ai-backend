import { ConfigService } from '@nestjs/config';
export declare class SmsService {
    private readonly config;
    private readonly logger;
    private readonly api;
    private readonly template;
    private readonly devMode;
    constructor(config: ConfigService);
    sendOtp(receptor: string, code: string): Promise<void>;
    sendByTemplate(receptor: string, template: string, tokens?: {
        token?: string;
        token2?: string;
        token3?: string;
    }): Promise<void>;
}
