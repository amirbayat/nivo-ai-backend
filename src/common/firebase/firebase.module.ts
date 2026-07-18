import { Module } from '@nestjs/common'
import { FirebaseAdminAppProvider } from './firebase-admin-app.provider'

@Module({
  providers: [FirebaseAdminAppProvider],
  exports: [FirebaseAdminAppProvider],
})
export class FirebaseModule {}
