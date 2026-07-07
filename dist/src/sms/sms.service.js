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
var SmsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fa_1 = require("../i18n/fa");
const Kavenegar = require('kavenegar');
let SmsService = SmsService_1 = class SmsService {
    config;
    logger = new common_1.Logger(SmsService_1.name);
    api;
    template;
    devMode;
    constructor(config) {
        this.config = config;
        const apiKey = this.config.get('KAVENEGAR_API_KEY', '');
        this.template = this.config.get('KAVENEGAR_TEMPLATE', 'registerverify');
        this.devMode = this.config.get('SEND_SMS', 'false') !== 'true';
        if (!this.devMode) {
            this.api = Kavenegar.KavenegarApi({ apikey: apiKey });
        }
    }
    async sendOtp(receptor, code) {
        if (this.devMode) {
            this.logger.warn(`🔑 OTP ══════════════════ ${receptor}  →  ${code} ══════════════════`);
            return;
        }
        await new Promise((resolve, reject) => {
            this.api.VerifyLookup({ receptor, token: code, template: this.template }, (response, status) => {
                if (status === 200) {
                    this.logger.log(`OTP sent to ${receptor}`);
                    resolve();
                }
                else {
                    this.logger.error(`Kavenegar error — status: ${status}`, response);
                    reject(new common_1.InternalServerErrorException(fa_1.fa.sms.sendFailed));
                }
            });
        });
    }
    async sendByTemplate(receptor, template, tokens = {}) {
        if (this.devMode) {
            this.logger.warn(`📩 SMS (template=${template}) ══ ${receptor} → ${JSON.stringify(tokens)}`);
            return;
        }
        await new Promise((resolve, reject) => {
            this.api.VerifyLookup({ receptor, template, ...tokens }, (response, status) => {
                if (status === 200) {
                    this.logger.log(`SMS (${template}) sent to ${receptor}`);
                    resolve();
                }
                else {
                    this.logger.error(`Kavenegar error — status: ${status}`, response);
                    reject(new common_1.InternalServerErrorException(fa_1.fa.sms.sendFailed));
                }
            });
        });
    }
};
exports.SmsService = SmsService;
exports.SmsService = SmsService = SmsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SmsService);
//# sourceMappingURL=sms.service.js.map