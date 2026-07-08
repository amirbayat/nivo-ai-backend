import { plainToInstance } from 'class-transformer'
import { IsInt, IsString, IsUrl, Min, validateSync } from 'class-validator'

class EnvironmentVariables {
  @IsString() DATABASE_URL: string
  @IsString() REDIS_URL: string

  @IsString() JWT_SECRET: string
  @IsString() JWT_EXPIRES_IN: string
  @IsString() JWT_REFRESH_SECRET: string
  @IsString() JWT_REFRESH_EXPIRES_IN: string

  @IsUrl({ require_tld: false }) LIARA_AI_BASE_URL: string
  @IsString() LIARA_API_KEY: string

  @IsString() ZARINPAL_MERCHANT_ID: string
  @IsString() KAVENEGAR_API_KEY: string

  @IsUrl({ require_tld: false }) APP_URL: string
  @IsUrl({ require_tld: false }) API_URL: string

  @IsInt() @Min(1) PORT: number = 3001
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  })
  const errors = validateSync(validated, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(errors.toString())
  }
  return validated
}
