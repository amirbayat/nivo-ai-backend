import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    updateMe(user: JwtPayload, dto: UpdateUserDto): Promise<{
        message: "پروفایل با موفقیت به‌روز شد";
        user: {
            name: string | null;
            id: string;
            phone: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
}
