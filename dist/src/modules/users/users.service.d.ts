import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    updateMe(userId: string, dto: UpdateUserDto): Promise<{
        message: "پروفایل با موفقیت به‌روز شد";
        user: {
            name: string | null;
            id: string;
            phone: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
}
