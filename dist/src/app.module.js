"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const env_validation_1 = require("./config/env.validation");
const prisma_module_1 = require("./prisma/prisma.module");
const redis_module_1 = require("./redis/redis.module");
const auth_module_1 = require("./modules/auth/auth.module");
const usage_module_1 = require("./modules/usage/usage.module");
const plans_module_1 = require("./modules/plans/plans.module");
const conversations_module_1 = require("./modules/conversations/conversations.module");
const chat_module_1 = require("./modules/chat/chat.module");
const payments_module_1 = require("./modules/payments/payments.module");
const subscriptions_module_1 = require("./modules/subscriptions/subscriptions.module");
const admin_module_1 = require("./modules/admin/admin.module");
const users_module_1 = require("./modules/users/users.module");
const feedback_module_1 = require("./modules/feedback/feedback.module");
const tickets_module_1 = require("./modules/tickets/tickets.module");
const queue_module_1 = require("./queue/queue.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true, validate: env_validation_1.validate }),
            prisma_module_1.PrismaModule,
            redis_module_1.RedisModule,
            queue_module_1.QueueModule,
            auth_module_1.AuthModule,
            usage_module_1.UsageModule,
            plans_module_1.PlansModule,
            conversations_module_1.ConversationsModule,
            chat_module_1.ChatModule,
            payments_module_1.PaymentsModule,
            subscriptions_module_1.SubscriptionsModule,
            admin_module_1.AdminModule,
            users_module_1.UsersModule,
            feedback_module_1.FeedbackModule,
            tickets_module_1.TicketsModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map