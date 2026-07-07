import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    sendOtp(dto: SendOtpDto): Promise<{
        message: string;
    }>;
    verifyOtp(dto: VerifyOtpDto): Promise<{
        user: {
            id: string;
            phone: string;
            role: import("@prisma/client").$Enums.Role;
            name: string | null;
        };
        waitlisted: {
            message: string;
            queuePosition: number;
        } | null;
        accessToken: string;
        refreshToken: string;
    }>;
    refresh(dto: RefreshTokenDto): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    logout(auth: string, dto: RefreshTokenDto): Promise<void>;
    getMe(user: JwtPayload): Promise<{
        subscription: {
            plan: {
                name: string;
                dailyFreeTokens: number;
                monthlyTotalTokens: number;
                allowedModels: import("@prisma/client/runtime/client").JsonValue;
            };
            status: import("@prisma/client").$Enums.SubscriptionStatus;
            periodEnd: Date;
        } | null;
        name: string | null;
        id: string;
        createdAt: Date;
        phone: string;
        role: import("@prisma/client").$Enums.Role;
    } | null>;
}
