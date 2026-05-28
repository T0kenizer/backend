import { ConfigService } from '@modules/config/config.service';
import { UsersService } from '@modules/users/users.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly usersService: UsersService,
    configService: ConfigService,
  ) {
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      state: true,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const email = profile.emails?.find((e) => e.verified)?.value;
      if (!email)
        return done(
          new UnauthorizedException('Google account has no verified email'),
        );

      const user = await this.usersService.findOrCreateFromGoogle({
        googleId: profile.id,
        email,
        displayName: profile.displayName,
        avatarUrl: profile.photos?.[0]?.value,
      });

      done(null, user);
    } catch (error) {
      done(error);
    }
  }
}
