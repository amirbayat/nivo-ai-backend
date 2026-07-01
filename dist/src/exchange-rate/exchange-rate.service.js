"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ExchangeRateService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeRateService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis_service_1 = require("../redis/redis.service");
const REDIS_KEY = 'exchange:usdt_rial';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const API_URL = 'https://api.tetherland.com/currencies';
const FALLBACK_RATE_KEY = 'USD_TO_RIAL';
let ExchangeRateService = ExchangeRateService_1 = class ExchangeRateService {
    redis;
    config;
    logger = new common_1.Logger(ExchangeRateService_1.name);
    fallbackRate;
    intervalId = null;
    constructor(redis, config) {
        this.redis = redis;
        this.config = config;
        this.fallbackRate = Number(this.config.get(FALLBACK_RATE_KEY, '900000'));
    }
    async onModuleInit() {
        await this.refresh();
        this.intervalId = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
    }
    onModuleDestroy() {
        if (this.intervalId)
            clearInterval(this.intervalId);
    }
    async getUsdtRial() {
        const cached = await this.redis.get(REDIS_KEY);
        if (cached)
            return Number(cached);
        return this.fallbackRate;
    }
    async refresh() {
        try {
            const res = await fetch(API_URL);
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const body = (await res.json());
            const price = body?.data?.currencies?.USDT?.price;
            if (!price || price <= 0)
                throw new Error('invalid price in response');
            await this.redis.set(REDIS_KEY, String(price), 'EX', 600);
            this.logger.log(`USDT/Rial updated: ${price.toLocaleString()}`);
        }
        catch (err) {
            this.logger.warn(`Exchange rate refresh failed — using cached/fallback. ${err instanceof Error ? err.message : err}`);
        }
    }
};
exports.ExchangeRateService = ExchangeRateService;
exports.ExchangeRateService = ExchangeRateService = ExchangeRateService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        config_1.ConfigService])
], ExchangeRateService);
//# sourceMappingURL=exchange-rate.service.js.map