import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { TokenService } from './token.service';
import { PricingService } from './pricing.service';
export declare class UsageController {
    private readonly tokenService;
    private readonly pricingService;
    constructor(tokenService: TokenService, pricingService: PricingService);
    getToday(user: JwtPayload): Promise<{
        freeUsed: number;
        freeLimit: number;
        paidUsed: number;
        paidLimit: number;
    }>;
    getHistory(user: JwtPayload, month?: string): Promise<{
        date: string;
        freeTokensUsed: number;
        paidTokensUsed: number;
        requestsCount: number;
        costRial: number;
    }[]>;
    getBudget(user: JwtPayload): Promise<import("./pricing.service").BudgetStatus>;
}
