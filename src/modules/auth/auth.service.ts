import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MediasService } from '@modules/medias/medias.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { PendingSignupModel } from '@schemas/pending-signup.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import {
  comparePassword,
  hashPassword,
} from '@common/crypto/password-hash.util';
import { Model } from 'mongoose';
import { App } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';
import { AuthSettingsService } from '@modules/auth-settings/auth-settings.service';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  AppleAuthDto,
  ChangePasswordDto,
  CheckAccountDto,
  Email2faConfirmDto,
  EmailVerificationDto,
  FacebookAuthDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  RegisterDto,
  Resend2faLoginDto,
  ResetPasswordDto,
  UpdateProfileDto,
  Verify2faLoginDto,
} from './dto/auth.dto';
import { LoginNotificationService } from './login-notification/login-notification.service';
import {
  type LoginAuthMethod,
  type LoginRequestContext,
} from './login-notification/login-request-context.util';
import {
  buildAuthOtpPlainText,
  buildAuthOtpWebDeepLink,
  emailOtpAutofillSnippet,
  mapOtpVariantToDeepLinkFlow,
  resolveOtpAutofillDomain,
  resolveOtpWebBaseUrl,
  type AuthOtpEmailVariant,
} from '@modules/mailer/auth-otp-email.util';
import { PartnerOnboardingEmailService } from '@modules/vendor-emails/partner-onboarding-email.service';
import { randomUUID } from 'crypto';
import { RefreshTokenStore } from './refresh-token.store';
import { OtpLinkTokenStore } from './otp-link-token.store';
import {
  issueOtpCode,
  isOtpExpired,
  verifyOtpCode,
} from './auth-otp.util';
import {
  isProductionNodeEnv,
  parseJwtDurationToSeconds,
} from './jwt-token.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly defaultRefreshExpiration = '30d';
  private static readonly ACCOUNT_DELETION_DELAY_DAYS = 30;
  private static readonly OTP_TTL_MINUTES = {
    signup: 30,
    activation: 30,
    passwordReset: 15,
    email2faEnable: 15,
    email2faLogin: 15,
  } as const;

  @InjectModel(UserModel.name)
  private readonly _usersModel: Model<UserModel>;

  @InjectModel(PendingSignupModel.name)
  private readonly _pendingSignupModel: Model<PendingSignupModel>;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(JwtService)
  private readonly _jwtService: JwtService;

  @Inject(MailerService)
  private readonly _mailer: MailerService;

  @Inject(EmailTemplateService)
  private readonly _emailTpl: EmailTemplateService;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject('FIREBASE_ADMIN')
  private readonly _firebaseApp: App;

  @Inject(LoyaltyService)
  private readonly _loyaltyService: LoyaltyService;

  @Inject(AuthSettingsService)
  private readonly _authSettings: AuthSettingsService;

  @Inject(LoginNotificationService)
  private readonly _loginNotification: LoginNotificationService;

  @Inject(PartnerOnboardingEmailService)
  private readonly _partnerOnboardingEmail: PartnerOnboardingEmailService;

  @Inject(RefreshTokenStore)
  private readonly _refreshTokenStore: RefreshTokenStore;

  @Inject(OtpLinkTokenStore)
  private readonly _otpLinkTokenStore: OtpLinkTokenStore;

  private otpLinkTtlSeconds(variant: AuthOtpEmailVariant): number {
    const minutes =
      variant === 'reset' || variant === '2fa' || variant === '2fa-login'
        ? AuthService.OTP_TTL_MINUTES.passwordReset
        : variant === 'signup' || variant === 'activation'
          ? AuthService.OTP_TTL_MINUTES.signup
          : AuthService.OTP_TTL_MINUTES.activation;
    return minutes * 60;
  }

  private async createOtpEmailDeepLink(
    email: string,
    code: string,
    variant: AuthOtpEmailVariant,
  ): Promise<string> {
    const flow = mapOtpVariantToDeepLinkFlow(variant);
    const token = await this._otpLinkTokenStore.issue(
      {
        email: email.trim().toLowerCase(),
        code: code.trim().toUpperCase(),
        flow,
      },
      this.otpLinkTtlSeconds(variant),
    );
    return buildAuthOtpWebDeepLink({
      webBaseUrl: resolveOtpWebBaseUrl(this._configService),
      token,
    });
  }

  async resolveOtpLink(tokenRaw: string) {
    const payload = await this._otpLinkTokenStore.consume(tokenRaw);
    if (!payload) {
      throw new NotFoundException('invalid_otp_link');
    }
    return {
      email: payload.email,
      code: payload.code,
      flow: payload.flow,
    };
  }

  /**
   * Inscription en deux temps : aucune ligne dans `users` tant que le code e-mail
   * n’est pas validé (`register/complete`), sauf si SMTP désactivé / compte test.
   */
  async registerStart(args: RegisterDto, ctx?: LoginRequestContext) {
    const { source } = args;
    if (source !== 'email') {
      throw new BadRequestException('unsupported_registration_source');
    }

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    const smtpConfigured = !!(smtpUser && smtpPass);
    const skipEmailVerification =
      this._configService.get<string>('SKIP_EMAIL_VERIFICATION') === 'true' ||
      !smtpConfigured;
    const isTestAccount =
      source === 'email' && args.email && args.email.includes('test');

    if (skipEmailVerification || isTestAccount) {
      const user = await this.registerCreateUserDirectly(args);
      const tokens = await this.deliverAuthTokens(user, ctx, 'register');
      return {
        step: 'done' as const,
        ...tokens,
        user,
      };
    }

    const email = args.email.trim().toLowerCase();
    const existing = await this._usersModel
      .findOne({ email: this._emailMatchExact(email) })
      .exec();
    if (existing) {
      throw new ConflictException('user_email_conflict');
    }

    await this._pendingSignupModel.deleteMany({ email }).exec();

    const issued = await issueOtpCode(
      6,
      AuthService.OTP_TTL_MINUTES.signup,
    );
    const passwordHash = await hashPassword(args.password);
    const userType = this._mapSignupRoleToUserType(args.signupRole);

    await this._pendingSignupModel.create({
      email,
      passwordHash,
      fullName: args.fullName.trim(),
      userType,
      verificationCode: issued.hash,
      expiresAt: issued.expiresAt,
    });

    try {
      await this._sendSignupVerificationEmail(
        email,
        args.fullName.trim(),
        issued.code,
      );
    } catch (err: unknown) {
      await this._pendingSignupModel.deleteMany({ email }).exec();
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[register/start] échec envoi e-mail : ${msg}`);
      throw new ServiceUnavailableException('email_send_failed');
    }

    return {
      step: 'verify_email' as const,
      message:
        'Un code de vérification a été envoyé à votre adresse. Saisissez-le pour finaliser la création du compte.',
      email,
    };
  }

  /** Finalise l’inscription : crée l’utilisateur en base (e-mail déjà vérifié). */
  async registerComplete(
    { email: emailRaw, code }: EmailVerificationDto,
    ctx?: LoginRequestContext,
  ) {
    const email = emailRaw.trim().toLowerCase();
    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (!pending) {
      throw new NotFoundException('invalid_or_expired_signup_code');
    }
    if (isOtpExpired(pending.expiresAt)) {
      await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('signup_code_expired');
    }
    if (!(await verifyOtpCode(code, pending.verificationCode))) {
      throw new BadRequestException('invalid_or_expired_signup_code');
    }

    let newUser: UserModel;
    try {
      newUser = await this._usersModel.create({
        email: pending.email,
        password: pending.passwordHash,
        fullName: pending.fullName,
        type: pending.userType,
        emailVerifiedAt: new Date(),
      });
    } catch (err: unknown) {
      const mongo = err as { code?: number };
      if (mongo.code === 11000) {
        await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
        throw new ConflictException('user_email_conflict');
      }
      throw err;
    }

    await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
    const user = await this.findUserById(newUser._id.toString());
    this.queueVendorOnboardingWelcome(user);
    return { ...(await this.deliverAuthTokens(newUser, ctx, 'register')), user };
  }

  async resendPendingSignupCode(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (!pending) {
      throw new NotFoundException('pending_signup_not_found');
    }
    if (isOtpExpired(pending.expiresAt)) {
      await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('signup_code_expired');
    }
    const issued = await issueOtpCode(
      6,
      AuthService.OTP_TTL_MINUTES.signup,
    );
    pending.verificationCode = issued.hash;
    pending.expiresAt = issued.expiresAt;
    await pending.save();
    await this._sendSignupVerificationEmail(email, pending.fullName, issued.code);
    return {
      ok: true as const,
      message: 'Un nouveau code a été envoyé.',
    };
  }

  private async buildVerificationEmailHtml(
    fullName: string,
    email: string,
    code: string,
    variant: AuthOtpEmailVariant,
  ): Promise<string> {
    const safeName = this._emailTpl.escapeHtml(fullName.trim() || 'Bonjour');
    const domain = resolveOtpAutofillDomain(this._configService);
    const webDeepLink = await this.createOtpEmailDeepLink(email, code, variant);
    const titles = {
      signup: 'Finalisez votre inscription',
      activation: 'Vérifiez votre courriel',
      reset: 'Réinitialisation de mot de passe',
      '2fa': 'Activation de la double authentification',
      '2fa-login': 'Vérification de connexion',
    };
    const intros = {
      signup:
        'Utilisez le code ci-dessous pour confirmer votre adresse et créer votre compte.',
      activation:
        'Voici votre code de vérification pour activer votre compte.',
      reset:
        'Voici votre code de réinitialisation. Ne le partagez avec personne.',
      '2fa':
        'Voici votre code pour activer la double authentification par e-mail sur votre compte.',
      '2fa-login':
        'Voici votre code pour finaliser votre connexion. Ne le partagez avec personne.',
    };
    const validity =
      variant === 'reset' ||
      variant === '2fa' ||
      variant === '2fa-login'
        ? 'Ce code est valable <strong>15 minutes</strong>.'
        : 'Ce code est valable <strong>30 minutes</strong>.';
    return [
      this._emailTpl.heading(titles[variant]),
      this._emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
      this._emailTpl.paragraph(intros[variant]),
      this._emailTpl.codeBox(code),
      emailOtpAutofillSnippet(domain, code),
      this._emailTpl.button('Ouvrir dans l’app', webDeepLink),
      this._emailTpl.paragraph(validity),
      this._emailTpl.muted(
        'Si vous n’avez pas demandé ce code, vous pouvez ignorer ce message en toute sécurité.',
      ),
    ].join('\n');
  }

  private async buildVerificationEmailText(
    email: string,
    code: string,
    variant: AuthOtpEmailVariant,
  ): Promise<string> {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const webDeepLink = await this.createOtpEmailDeepLink(email, code, variant);
    return buildAuthOtpPlainText({
      appName,
      code,
      variant,
      domain: resolveOtpAutofillDomain(this._configService),
      webDeepLink,
    });
  }

  private async _sendSignupVerificationEmail(
    toEmail: string,
    fullName: string,
    code: string,
  ) {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const subject = `Vérifiez votre courriel - ${appName}`;
    const html = await this.buildVerificationEmailHtml(
      fullName,
      toEmail,
      code,
      'signup',
    );
    const text = await this.buildVerificationEmailText(toEmail, code, 'signup');
    await this._mailer.sendSimple({
      to: toEmail,
      toName: fullName,
      subject,
      html,
      text,
    });
  }

  /**
   * Inscription publique (ex. app mobile sur `POST /auth/register`).
   * Pour `source === 'email'`, même flux que `register/start` : code envoyé,
   * compte créé seulement après `verify` ou `register/complete` (pas de ligne
   * `users` avant validation), sauf si SMTP désactivé / compte test.
   */
  async register(args: RegisterDto, ctx?: LoginRequestContext) {
    if (args.source === 'email') {
      return this.registerStart(args, ctx);
    }
    return this.registerCreateUserDirectly(args);
  }

  private async registerCreateUserDirectly(args: RegisterDto) {
    const { source, signupRole, ...rest } = args;
    const userType = this._mapSignupRoleToUserType(signupRole);
    this.logger.log(
      `[register] demande source=${source} email=${
        args.email ?? '—'
      } fullName=${args.fullName ?? '—'} signupRole=${
        signupRole ?? '—'
      } type=${userType}`,
    );

    const user = await this._usersModel.findOne({
      [source]: args[source],
    });
    if (user) {
      this.logger.warn(
        `[register] conflit user_${source}_conflict pour ${
          args.email ?? args[source]
        }`,
      );
      throw new ConflictException(`user_${source}_conflict`);
    }

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    const smtpConfigured = !!(smtpUser && smtpPass);
    const skipEmailVerification =
      this._configService.get<string>('SKIP_EMAIL_VERIFICATION') === 'true' ||
      !smtpConfigured;

    const isTestAccount =
      source === 'email' && rest.email && rest.email.includes('test');

    /** Compte vérifié tout de suite : pas d’SMTP / pas d’email à envoyer */
    const verifyImmediately = skipEmailVerification || isTestAccount;

    const activationIssued = verifyImmediately
      ? null
      : await issueOtpCode(6, AuthService.OTP_TTL_MINUTES.activation);

    this.logger.log(
      `[register] options skipEmailVerification=${skipEmailVerification} isTestAccount=${isTestAccount} verifyImmediately=${verifyImmediately} smtpConfigured=${smtpConfigured}`,
    );

    const dbName = this._usersModel.db?.name ?? '?';
    const collectionName =
      this._usersModel.collection?.collectionName ?? 'users';
    this.logger.log(
      `[register] cible MongoDB db="${dbName}" collection="${collectionName}"`,
    );

    const documentToInsert = {
      ...rest,
      type: userType,
      ...(verifyImmediately
        ? { emailVerifiedAt: new Date() }
        : {
            activationCode: activationIssued?.hash,
            activationCodeExpiresAt: activationIssued?.expiresAt,
          }),
    };
    this.logger.log(
      `[register] payload insert (mdp masqué) ${JSON.stringify({
        ...documentToInsert,
        password: '***',
      })}`,
    );

    let newUser: UserModel;
    try {
      newUser = await this._usersModel.create(documentToInsert);
    } catch (err: unknown) {
      const mongo = err as {
        code?: number;
        keyPattern?: Record<string, unknown>;
        keyValue?: Record<string, unknown>;
        message?: string;
      };
      this.logger.error(
        `[register] échec Mongoose create code=${
          mongo.code ?? 'n/a'
        } keyPattern=${JSON.stringify(
          mongo.keyPattern,
        )} keyValue=${JSON.stringify(mongo.keyValue)} message=${
          mongo.message ?? err
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      if (mongo.code === 11000) {
        throw new ConflictException(`user_${source}_conflict`);
      }
      throw err;
    }

    this.logger.log(
      `[register] utilisateur créé id=${newUser._id.toString()} email=${
        newUser.email
      } type=${newUser.type} emailVerifiedAt=${
        verifyImmediately
          ? newUser.emailVerifiedAt?.toISOString?.() ?? 'oui'
          : 'non'
      }`,
    );

    if (!verifyImmediately && activationIssued) {
      try {
        const appName =
          this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
        const subject = `Bienvenue sur ${appName}`;
        await this._mailer.sendSimple({
          to: args.email,
          toName: args.fullName,
          subject,
          html: await this.buildVerificationEmailHtml(
            args.fullName,
            args.email,
            activationIssued.code,
            'activation',
          ),
          text: await this.buildVerificationEmailText(
            args.email,
            activationIssued.code,
            'activation',
          ),
        });
        this.logger.log(
          `[register] email de vérification envoyé vers ${args.email}`,
        );
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'body' in err
            ? JSON.stringify((err as { body?: unknown }).body)
            : err instanceof Error
            ? err.message
            : String(err);
        this.logger.warn(`Échec envoi email d'inscription (SMTP) : ${detail}`);
        // En local, clé invalide / 401 « Unauthenticated » : on valide quand même le compte pour pouvoir se connecter
        if (process.env.NODE_ENV !== 'production') {
          await this._usersModel.findByIdAndUpdate(newUser._id, {
            $set: { emailVerifiedAt: new Date() },
            $unset: {
              activationCode: '',
              activationCodeExpiresAt: '',
            },
          });
          this.logger.log(
            `[register] compte auto-vérifié (non-production) id=${newUser._id.toString()}`,
          );
        }
      }
    }

    this.logger.log(`[register] terminé id=${newUser._id.toString()}`);
    this.queueVendorOnboardingWelcome(newUser);
    return this.findUserById(newUser._id.toString());
  }

  /**
   * Connexion / inscription Google : vérifie le jeton Firebase (provider Google),
   * puis trouve ou crée l’utilisateur Mongo (googleId = identifiant Google dans le jeton).
   */
  async authWithGoogle(args: GoogleAuthDto, ctx?: LoginRequestContext) {
    await this._authSettings.assertProviderEnabled('google');
    return this._authWithGoogle(args, UserTypeEnum.USER, ctx);
  }

  /** Variante dashboard/admin : création sociale par défaut en VENDOR. */
  async authWithGoogleAsVendor(args: GoogleAuthDto, ctx?: LoginRequestContext) {
    await this._authSettings.assertProviderEnabled('google');
    return this._authWithGoogle(args, UserTypeEnum.VENDOR, ctx);
  }

  private async _authWithGoogle(
    args: GoogleAuthDto,
    defaultTypeForNewUser: UserTypeEnum,
    ctx?: LoginRequestContext,
  ) {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this._firebaseApp).verifyIdToken(args.idToken);
    } catch (err) {
      this.logger.warn(`verifyIdToken Google: ${String(err)}`);
      throw new UnauthorizedException('invalid_google_token');
    }

    if (decoded.firebase?.sign_in_provider !== 'google.com') {
      throw new UnauthorizedException('invalid_google_token');
    }

    const googleId =
      decoded.firebase?.identities?.['google.com']?.[0] ?? decoded.sub;
    const emailRaw = decoded.email?.trim().toLowerCase();
    if (!emailRaw) {
      throw new BadRequestException('google_email_required');
    }

    const fullName =
      (typeof decoded.name === 'string' && decoded.name.trim()) ||
      emailRaw.split('@')[0] ||
      'Utilisateur';

    const pictureRaw = decoded.picture;
    const pictureFromGoogle =
      typeof pictureRaw === 'string' &&
      (pictureRaw.startsWith('https://') || pictureRaw.startsWith('http://'))
        ? pictureRaw.trim()
        : undefined;

    let user = await this._usersModel.findOne({ googleId }).exec();
    if (user) {
      if (pictureFromGoogle && !user.profileImage) {
        await this._usersModel
          .updateOne(
            { _id: user._id },
            { $set: { profileImage: pictureFromGoogle } },
          )
          .exec();
      }
      return await this.finishAuthenticatedLogin(
        String(user._id),
        ctx,
        'google',
      );
    }
    user = await this._usersModel.findOne({ email: emailRaw }).exec();
    if (user) {
      const setDoc: Record<string, unknown> = {
        googleId,
        emailVerifiedAt: new Date(),
      };
      if (pictureFromGoogle && !user.profileImage) {
        setDoc.profileImage = pictureFromGoogle;
      }
      await this._usersModel
        .updateOne({ _id: user._id }, { $set: setDoc })
        .exec();
      return await this.finishAuthenticatedLogin(
        String(user._id),
        ctx,
        'google',
      );
    }
    const newUser = await this._usersModel.create({
      email: emailRaw,
      fullName,
      googleId,
      type: defaultTypeForNewUser,
      password: `google_${googleId}_${Date.now()}`,
      emailVerifiedAt: new Date(),
      ...(pictureFromGoogle ? { profileImage: pictureFromGoogle } : {}),
    });
    this.queueVendorOnboardingWelcome(newUser);
    return {
      ...(await this.deliverAuthTokens(newUser, ctx, 'google')),
    };
  }

  /**
   * Connexion / inscription Apple : vérifie le jeton Firebase (provider Apple),
   * puis trouve ou crée l’utilisateur Mongo (appleId = identifiant Apple/Firebase).
   */
  async authWithApple(args: AppleAuthDto, ctx?: LoginRequestContext) {
    await this._authSettings.assertProviderEnabled('apple');
    return this._authWithApple(args, UserTypeEnum.USER, ctx);
  }

  /** Variante dashboard/admin : création sociale par défaut en VENDOR. */
  async authWithAppleAsVendor(args: AppleAuthDto, ctx?: LoginRequestContext) {
    await this._authSettings.assertProviderEnabled('apple');
    return this._authWithApple(args, UserTypeEnum.VENDOR, ctx);
  }

  private async _authWithApple(
    args: AppleAuthDto,
    defaultTypeForNewUser: UserTypeEnum,
    ctx?: LoginRequestContext,
  ) {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this._firebaseApp).verifyIdToken(args.idToken);
    } catch (err) {
      this.logger.warn(`verifyIdToken Apple: ${String(err)}`);
      throw new UnauthorizedException('invalid_apple_token');
    }

    if (decoded.firebase?.sign_in_provider !== 'apple.com') {
      throw new UnauthorizedException('invalid_apple_token');
    }

    const appleId =
      decoded.firebase?.identities?.['apple.com']?.[0] ?? decoded.sub;
    const emailRaw = decoded.email?.trim().toLowerCase();
    const fullName =
      (typeof decoded.name === 'string' && decoded.name.trim()) ||
      (emailRaw != null ? emailRaw.split('@')[0] : '') ||
      'Utilisateur';

    const pictureRaw = decoded.picture;
    const pictureFromApple =
      typeof pictureRaw === 'string' &&
      (pictureRaw.startsWith('https://') || pictureRaw.startsWith('http://'))
        ? pictureRaw.trim()
        : undefined;

    let user = await this._usersModel.findOne({ appleId }).exec();
    if (user) {
      if (pictureFromApple && !user.profileImage) {
        await this._usersModel
          .updateOne(
            { _id: user._id },
            { $set: { profileImage: pictureFromApple } },
          )
          .exec();
      }
      return await this.finishAuthenticatedLogin(
        String(user._id),
        ctx,
        'apple',
      );
    }

    if (emailRaw) {
      user = await this._usersModel.findOne({ email: emailRaw }).exec();
      if (user) {
        const setDoc: Record<string, unknown> = {
          appleId,
          emailVerifiedAt: new Date(),
        };
        if (pictureFromApple && !user.profileImage) {
          setDoc.profileImage = pictureFromApple;
        }
        await this._usersModel
          .updateOne({ _id: user._id }, { $set: setDoc })
          .exec();
        return await this.finishAuthenticatedLogin(
          String(user._id),
          ctx,
          'apple',
        );
      }
    }

    if (!emailRaw) {
      throw new BadRequestException('apple_email_required_first_login');
    }

    const newUser = await this._usersModel.create({
      email: emailRaw,
      fullName,
      appleId,
      type: defaultTypeForNewUser,
      password: `apple_${appleId}_${Date.now()}`,
      emailVerifiedAt: new Date(),
      ...(pictureFromApple ? { profileImage: pictureFromApple } : {}),
    });
    this.queueVendorOnboardingWelcome(newUser);
    return {
      ...(await this.deliverAuthTokens(newUser, ctx, 'apple')),
    };
  }

  /**
   * Connexion / inscription Facebook : vérifie le jeton Firebase (provider Facebook),
   * puis trouve ou crée l’utilisateur Mongo (facebookId = identifiant Facebook/Firebase).
   */
  async authWithFacebook(args: FacebookAuthDto, ctx?: LoginRequestContext) {
    await this._authSettings.assertProviderEnabled('facebook');
    return this._authWithFacebook(args, UserTypeEnum.USER, ctx);
  }

  /** Variante dashboard/admin : création sociale par défaut en VENDOR. */
  async authWithFacebookAsVendor(args: FacebookAuthDto, ctx?: LoginRequestContext) {
    await this._authSettings.assertProviderEnabled('facebook');
    return this._authWithFacebook(args, UserTypeEnum.VENDOR, ctx);
  }

  private async _authWithFacebook(
    args: FacebookAuthDto,
    defaultTypeForNewUser: UserTypeEnum,
    ctx?: LoginRequestContext,
  ) {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this._firebaseApp).verifyIdToken(args.idToken);
    } catch (err) {
      this.logger.warn(`verifyIdToken Facebook: ${String(err)}`);
      throw new UnauthorizedException('invalid_facebook_token');
    }

    if (decoded.firebase?.sign_in_provider !== 'facebook.com') {
      throw new UnauthorizedException('invalid_facebook_token');
    }

    const facebookId =
      decoded.firebase?.identities?.['facebook.com']?.[0] ?? decoded.sub;
    const emailRaw = decoded.email?.trim().toLowerCase();
    if (!emailRaw) {
      throw new BadRequestException('facebook_email_required');
    }

    const fullName =
      (typeof decoded.name === 'string' && decoded.name.trim()) ||
      emailRaw.split('@')[0] ||
      'Utilisateur';

    const pictureRaw = decoded.picture;
    const pictureFromFacebook =
      typeof pictureRaw === 'string' &&
      (pictureRaw.startsWith('https://') || pictureRaw.startsWith('http://'))
        ? pictureRaw.trim()
        : undefined;

    let user = await this._usersModel.findOne({ facebookId }).exec();
    if (user) {
      if (pictureFromFacebook && !user.profileImage) {
        await this._usersModel
          .updateOne(
            { _id: user._id },
            { $set: { profileImage: pictureFromFacebook } },
          )
          .exec();
      }
      return await this.finishAuthenticatedLogin(
        String(user._id),
        ctx,
        'facebook',
      );
    }

    user = await this._usersModel.findOne({ email: emailRaw }).exec();
    if (user) {
      const setDoc: Record<string, unknown> = {
        facebookId,
        emailVerifiedAt: new Date(),
      };
      if (pictureFromFacebook && !user.profileImage) {
        setDoc.profileImage = pictureFromFacebook;
      }
      await this._usersModel
        .updateOne({ _id: user._id }, { $set: setDoc })
        .exec();
      return await this.finishAuthenticatedLogin(
        String(user._id),
        ctx,
        'facebook',
      );
    }

    const newUser = await this._usersModel.create({
      email: emailRaw,
      fullName,
      facebookId,
      type: defaultTypeForNewUser,
      password: `facebook_${facebookId}_${Date.now()}`,
      emailVerifiedAt: new Date(),
      ...(pictureFromFacebook ? { profileImage: pictureFromFacebook } : {}),
    });
    this.queueVendorOnboardingWelcome(newUser);
    return {
      ...(await this.deliverAuthTokens(newUser, ctx, 'facebook')),
    };
  }

  async login(args: LoginDto, ctx?: LoginRequestContext) {
    const { source, ...rest } = args;
    const user = await this._usersModel
      .findOne({
        [source]: args[source],
      })
      .select(['+password', '+emailVerifiedAt'])
      .exec();

    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }

    if (!(await comparePassword(rest.password, user.password))) {
      throw new NotFoundException(`user_not_found`);
    }

    // TODO adjust verification based on source. For now, we only verify email

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(`email_not_verified`);
    }

    // TODO add user role(admin, user, etc) claims
    return await this.finishAuthenticatedLogin(
      String(user._id),
      ctx,
      'email_password',
    );
  }

  async verify2faLogin(args: Verify2faLoginDto, ctx?: LoginRequestContext) {
    const challengeToken = String(args.challengeToken ?? '').trim();
    if (!challengeToken) {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    type ChallengePayload = {
      sub?: unknown;
      typ?: unknown;
      method?: unknown;
    };
    let payload: ChallengePayload;
    try {
      payload = (await this._jwtService.verifyAsync(
        challengeToken,
      )) as ChallengePayload;
    } catch {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    if (payload.typ !== '2fa_login') {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    const userId = String(payload.sub ?? '').trim();
    if (!userId) {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    const codeNorm = args.code.trim().toUpperCase();
    const user = await this._usersModel
      .findById(userId)
      .select([
        '+email2faLoginCode',
        '+email2faLoginCodeExpiresAt',
      ])
      .exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.email2faEnabled !== true) {
      throw new BadRequestException('email_2fa_not_enabled');
    }
    if (
      !user.email2faLoginCode ||
      isOtpExpired(user.email2faLoginCodeExpiresAt) ||
      !(await verifyOtpCode(codeNorm, user.email2faLoginCode))
    ) {
      throw new BadRequestException('invalid_code');
    }
    await this._usersModel
      .findByIdAndUpdate(userId, {
        $unset: {
          email2faLoginCode: '',
          email2faLoginCodeExpiresAt: '',
        },
      })
      .exec();
    const methodRaw = String(payload.method ?? 'email_password');
    const method: LoginAuthMethod =
      methodRaw === 'google' ||
      methodRaw === 'apple' ||
      methodRaw === 'facebook' ||
      methodRaw === 'email_password'
        ? methodRaw
        : 'email_password';
    return await this.deliverAuthTokens(user, ctx, method);
  }

  async resend2faLogin(args: Resend2faLoginDto) {
    const challengeToken = String(args.challengeToken ?? '').trim();
    if (!challengeToken) {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    type ChallengePayload = { sub?: unknown; typ?: unknown; method?: unknown };
    let payload: ChallengePayload;
    try {
      payload = (await this._jwtService.verifyAsync(
        challengeToken,
      )) as ChallengePayload;
    } catch {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    if (payload.typ !== '2fa_login') {
      throw new UnauthorizedException('invalid_2fa_challenge');
    }
    const userId = String(payload.sub ?? '').trim();
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.email2faEnabled !== true) {
      throw new BadRequestException('email_2fa_not_enabled');
    }
    const methodRaw = String(payload.method ?? 'email_password');
    const method: LoginAuthMethod =
      methodRaw === 'google' ||
      methodRaw === 'apple' ||
      methodRaw === 'facebook' ||
      methodRaw === 'email_password'
        ? methodRaw
        : 'email_password';
    await this.begin2faLoginChallenge(user, method);
    return {
      ok: true,
      message:
        'Un nouveau code de vérification a été envoyé à votre adresse e-mail.',
    };
  }

  async refreshSession(refreshTokenRaw: string) {
    const refreshToken = String(refreshTokenRaw ?? '').trim();
    if (!refreshToken) {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const secret = this.getRefreshTokenSecret();
    type RefreshPayload = { sub?: unknown; typ?: unknown; jti?: unknown };
    let payload: RefreshPayload;
    try {
      payload = (await this._jwtService.verifyAsync(refreshToken, {
        secret,
      })) as RefreshPayload;
    } catch {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    if (payload?.typ !== 'refresh') {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const userId = String(payload?.sub ?? '').trim();
    if (!userId) {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const user = await this.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const jti = String(payload?.jti ?? '').trim();
    if (jti) {
      const ok = await this._refreshTokenStore.consume(jti, userId);
      if (!ok) {
        throw new UnauthorizedException('invalid_refresh_token');
      }
    }
    return this.issueAuthTokens(user);
  }

  async checkAccount(args: CheckAccountDto) {
    const filter =
      args.source === 'email'
        ? { email: this._emailMatchExact(args.email.trim().toLowerCase()) }
        : { [args.source]: args[args.source] };
    const user = await this._usersModel
      .findOne(filter)
      .select(['email', 'type', 'emailVerifiedAt'])
      .lean()
      .exec();
    if (!user) {
      return { exists: false as const };
    }
    return {
      exists: true as const,
      emailVerified: Boolean(user.emailVerifiedAt),
      type: user.type ?? null,
    };
  }

  async verifyEmail(
    { code: activationCode, email }: EmailVerificationDto,
    ctx?: LoginRequestContext,
  ) {
    const emailNorm = email.trim().toLowerCase();
    const codeNorm = activationCode.trim();

    const pendingUser = await this._usersModel
      .findOne({
        email: this._emailMatchExact(emailNorm),
        emailVerifiedAt: null,
      })
      .select(['+activationCode', '+activationCodeExpiresAt'])
      .exec();

    if (pendingUser) {
      if (isOtpExpired(pendingUser.activationCodeExpiresAt)) {
        throw new NotFoundException(`user_not_found`);
      }
      if (!(await verifyOtpCode(codeNorm, pendingUser.activationCode))) {
        throw new NotFoundException(`user_not_found`);
      }
      pendingUser.activationCode = undefined;
      pendingUser.activationCodeExpiresAt = undefined;
      pendingUser.emailVerifiedAt = new Date();
      await pendingUser.save();
      return pendingUser;
    }

    try {
      return await this.registerComplete(
        {
          email: emailNorm,
          code: codeNorm,
        },
        ctx,
      );
    } catch (err: unknown) {
      if (err instanceof ConflictException) {
        throw err;
      }
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw new NotFoundException(`user_not_found`);
      }
      throw err;
    }
  }

  async resendVerificationCode(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();

    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (pending) {
      return this.resendPendingSignupCode(email);
    }

    const issued = await issueOtpCode(6, AuthService.OTP_TTL_MINUTES.activation);
    const user = await this._usersModel
      .findOneAndUpdate(
        {
          email: this._emailMatchExact(email),
          emailVerifiedAt: null,
        },
        {
          emailVerifiedAt: null,
          activationCode: issued.hash,
          activationCodeExpiresAt: issued.expiresAt,
        },
        { new: true },
      )
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const subject = `Bienvenue sur ${appName}`;
    await this._mailer.sendSimple({
      to: email,
      toName: user.fullName,
      subject,
      html: await this.buildVerificationEmailHtml(
        user.fullName,
        email,
        issued.code,
        'activation',
      ),
      text: await this.buildVerificationEmailText(email, issued.code, 'activation'),
    });
    return { ok: true as const };
  }

  /**
   * Demande de réinitialisation : enregistre un code et envoie l’e-mail via SMTP.
   * Réponse identique si l’email est inconnu (pas d’énumération de comptes).
   */
  async forgotPassword({ email: emailRaw }: ForgotPasswordDto) {
    const email = emailRaw.trim().toLowerCase();
    const generic = {
      ok: true as const,
      message:
        'Si un compte existe pour cette adresse, un code vous a été envoyé par e-mail.',
    };

    const user = await this._usersModel
      .findOne({ email: this._emailMatchExact(email) })
      .exec();
    if (!user) {
      this.logger.log(`[forgot-password] aucun utilisateur pour ${email}`);
      return generic;
    }

    const issued = await issueOtpCode(
      6,
      AuthService.OTP_TTL_MINUTES.passwordReset,
    );
    await this._usersModel
      .findOneAndUpdate(
        { _id: user._id },
        {
          $set: {
            passwordResetCode: issued.hash,
            passwordResetCodeExpiresAt: issued.expiresAt,
          },
        },
        { new: true },
      )
      .exec();

    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const subject = `Réinitialisation de mot de passe - ${appName}`;
    const html = await this.buildVerificationEmailHtml(
      user.fullName,
      email,
      issued.code,
      'reset',
    );
    const text = await this.buildVerificationEmailText(email, issued.code, 'reset');

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    if (!smtpUser || !smtpPass) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `[forgot-password] SMTP non configuré — code non journalisé pour ${email}`,
        );
      } else {
        this.logger.warn(`[forgot-password] SMTP non configuré pour ${email}`);
      }
      return generic;
    }

    try {
      await this._mailer.sendSimple({
        to: user.email,
        toName: user.fullName,
        subject,
        html,
        text,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[forgot-password] échec SMTP : ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException('email_send_failed');
    }

    return generic;
  }

  async resetPassword({ email: emailRaw, code, password }: ResetPasswordDto) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this._usersModel
      .findOne({ email: this._emailMatchExact(email) })
      .select(['+passwordResetCode', '+passwordResetCodeExpiresAt'])
      .exec();

    if (
      !user?.passwordResetCode ||
      isOtpExpired(user.passwordResetCodeExpiresAt) ||
      !(await verifyOtpCode(code, user.passwordResetCode))
    ) {
      throw new BadRequestException('invalid_reset_code');
    }

    user.password = password;
    user.set('passwordResetCode', undefined);
    user.set('passwordResetCodeExpiresAt', undefined);
    await user.save();

    return { ok: true as const, message: 'Mot de passe mis à jour.' };
  }

  async findUserById(id: string) {
    return this._usersModel
      .findOne({ _id: id })
      .populate('addresses')
      .populate('stores')
      .populate('paymentMethods')
      .exec();
  }

  /** Score fidélité, catalogue actif et historique (config admin synchronisée). */
  async getMyRewards(userId: string) {
    return this._loyaltyService.getCustomerRewardsView(userId);
  }

  async updateProfile(userId: string, args: UpdateProfileDto) {
    const update: Partial<UserModel> = {};
    if (args.fullName != null) update.fullName = args.fullName;
    if (args.phoneNumber != null) update.phoneNumber = args.phoneNumber;
    if (args.appCountryCode != null) {
      const c = args.appCountryCode.trim().toUpperCase();
      if (!(await this._supportedCountries.isActiveCode(c))) {
        throw new BadRequestException('Ce pays n’est pas disponible.');
      }
      update.appCountryCode = c;
    }
    if (Object.keys(update).length === 0) {
      return this.findUserById(userId);
    }
    const user = await this._usersModel
      .findOneAndUpdate({ _id: userId }, update, { new: true })
      .populate('addresses')
      .populate('stores')
      .populate('paymentMethods')
      .exec();
    if (!user) throw new NotFoundException('user_not_found');
    return user;
  }

  /** Upload audio pour messages vocaux (chat). Retourne l’URL publique Firebase. */
  async uploadChatVoiceFile(
    userId: string,
    file: Express.Multer.File,
    user: UserModel,
  ): Promise<{ fileUrl: string; mimeType: string; sizeBytes: number }> {
    if (user._id.toString() !== userId) {
      throw new ForbiddenException('forbidden');
    }
    const existing = await this._usersModel.findOne({ _id: userId }).exec();
    if (!existing) throw new NotFoundException('user_not_found');
    const url = await this._mediasService.upload(
      file,
      user,
      `users/${userId}/chat-voice`,
    );
    if (!url) throw new BadRequestException('voice_upload_failed');
    return {
      fileUrl: url,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  }

  /** Images et pièces jointes pour le chat (Firebase Storage). */
  async uploadChatMediaFile(
    userId: string,
    file: Express.Multer.File,
    user: UserModel,
  ): Promise<{
    fileUrl: string;
    mimeType: string;
    sizeBytes: number;
    fileName: string;
  }> {
    if (user._id.toString() !== userId) {
      throw new ForbiddenException('forbidden');
    }
    const existing = await this._usersModel.findOne({ _id: userId }).exec();
    if (!existing) throw new NotFoundException('user_not_found');
    const url = await this._mediasService.upload(
      file,
      user,
      `users/${userId}/chat-media`,
    );
    if (!url) throw new BadRequestException('chat_media_upload_failed');
    return {
      fileUrl: url,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      fileName: file.originalname || 'file',
    };
  }

  async updateProfileImage(
    userId: string,
    file: Express.Multer.File,
    user: UserModel,
  ) {
    let url: string | undefined;
    try {
      const existing = await this._usersModel.findOne({ _id: userId }).exec();
      if (!existing) throw new NotFoundException('user_not_found');
      if (user._id.toString() !== userId) {
        throw new ForbiddenException('forbidden');
      }
      url = await this._mediasService.upload(
        file,
        user,
        `users/${userId}/profile`,
      );
      if (!url) throw new BadRequestException('image_upload_failed');
      // Libérer l’espace Firebase : supprimer l’ancienne photo après succès du nouvel upload
      if (existing.profileImage) {
        try {
          await this._mediasService.delete(existing.profileImage);
        } catch (_) {
          await this._mediasService.deleteFilesWithPrefixExcept(
            `users/${userId}/profile`,
            url,
          );
        }
      }
      await this._usersModel
        .updateOne({ _id: userId }, { profileImage: url })
        .exec();
      return this.findUserById(userId);
    } catch (e) {
      if (url) {
        try {
          await this._mediasService.delete(url);
        } catch (_) {}
      }
      throw e;
    }
  }

  /** Supprime la photo de profil (met profileImage à null et supprime le fichier sur Storage si possible). */
  async removeProfileImage(userId: string, user: UserModel) {
    if (user._id.toString() !== userId) {
      throw new ForbiddenException('forbidden');
    }
    const existing = await this._usersModel.findOne({ _id: userId }).exec();
    if (!existing) throw new NotFoundException('user_not_found');
    const previousUrl = existing.profileImage;
    if (previousUrl) {
      try {
        await this._mediasService.delete(previousUrl);
      } catch (_) {
        // URL obsolète ou fichier déjà supprimé
      }
    }
    // Dossier profil : supprime aussi d’éventuels fichiers orphelins (anciens uploads)
    await this._mediasService.deleteFilesWithPrefix(`users/${userId}/profile`);
    const updated = await this._usersModel
      .findByIdAndUpdate(
        userId,
        { $set: { profileImage: null } },
        { new: true },
      )
      .populate('addresses')
      .populate('stores')
      .populate('paymentMethods')
      .exec();
    if (!updated) throw new NotFoundException('user_not_found');
    return updated;
  }

  async findUserByEmail(email: string) {
    return this._usersModel.findOne({ email }).exec();
  }

  /**
   * Demande la suppression du compte :
   * - compte toujours accessible (connexion autorisée),
   * - tag de suppression actif,
   * - exécution définitive par cron après délai.
   */
  async requestAccountDeletion(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }

    const now = new Date();
    const existingRequestedAt =
      user.accountDeletionRequestedAt instanceof Date
        ? user.accountDeletionRequestedAt
        : null;
    const existingScheduledFor =
      user.accountDeletionScheduledFor instanceof Date
        ? user.accountDeletionScheduledFor
        : null;
    const scheduledFor = new Date(
      now.getTime() +
        AuthService.ACCOUNT_DELETION_DELAY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this._usersModel
      .updateOne(
        { _id: userId },
        {
          $set: {
            accountDeletionRequestedAt: existingRequestedAt ?? now,
            accountDeletionScheduledFor: existingScheduledFor ?? scheduledFor,
          },
        },
      )
      .exec();

    return {
      message: 'account_deletion_requested',
      requestedAt: (existingRequestedAt ?? now).toISOString(),
      scheduledFor: (existingScheduledFor ?? scheduledFor).toISOString(),
      daysUntilDeletion: AuthService.ACCOUNT_DELETION_DELAY_DAYS,
      canCancel: true,
    };
  }

  /** Annule une demande de suppression de compte en attente. */
  async cancelAccountDeletion(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    const hasPending =
      user.accountDeletionRequestedAt instanceof Date &&
      user.accountDeletionScheduledFor instanceof Date;
    if (!hasPending) {
      return { message: 'no_pending_account_deletion', deleted: false };
    }

    await this._usersModel
      .updateOne(
        { _id: userId },
        {
          $set: {
            accountDeletionRequestedAt: null,
            accountDeletionScheduledFor: null,
          },
        },
      )
      .exec();

    return { message: 'account_deletion_cancelled', deleted: false };
  }

  /** Statut courant de suppression planifiée pour l’utilisateur connecté. */
  async getAccountDeletionStatus(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }

    const requestedAt =
      user.accountDeletionRequestedAt instanceof Date
        ? user.accountDeletionRequestedAt
        : null;
    const scheduledFor =
      user.accountDeletionScheduledFor instanceof Date
        ? user.accountDeletionScheduledFor
        : null;
    const pending = !!requestedAt && !!scheduledFor;
    const remainingMs =
      pending && scheduledFor
        ? Math.max(0, scheduledFor.getTime() - Date.now())
        : 0;
    const remainingDays = pending
      ? Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
      : 0;

    return {
      pending,
      taggedDeleted: pending,
      requestedAt: requestedAt?.toISOString() ?? null,
      scheduledFor: scheduledFor?.toISOString() ?? null,
      remainingDays,
      canCancel: pending,
    };
  }

  /** Liste admin des demandes de suppression de comptes en attente. */
  async listAccountDeletionRequests(adminUserId: string) {
    const admin = await this._usersModel.findById(adminUserId).exec();
    if (!admin) throw new NotFoundException('user_not_found');
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }

    const rows = await this._usersModel
      .find({
        accountDeletionRequestedAt: { $ne: null },
        accountDeletionScheduledFor: { $ne: null },
      })
      .select(
        '_id fullName email type accountDeletionRequestedAt accountDeletionScheduledFor',
      )
      .sort({ accountDeletionScheduledFor: 1 })
      .lean()
      .exec();

    return rows.map((row) => {
      const requestedAt =
        row.accountDeletionRequestedAt instanceof Date
          ? row.accountDeletionRequestedAt
          : null;
      const scheduledFor =
        row.accountDeletionScheduledFor instanceof Date
          ? row.accountDeletionScheduledFor
          : null;
      const remainingDays =
        scheduledFor == null
          ? 0
          : Math.max(
              0,
              Math.ceil(
                (scheduledFor.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
              ),
            );
      return {
        userId: String(row._id),
        fullName: row.fullName ?? '',
        email: row.email ?? '',
        type: row.type ?? null,
        requestedAt: requestedAt?.toISOString() ?? null,
        scheduledFor: scheduledFor?.toISOString() ?? null,
        remainingDays,
        taggedDeleted: !!requestedAt && !!scheduledFor,
        canCancel: !!requestedAt && !!scheduledFor,
      };
    });
  }

  /** Action admin: annuler une demande de suppression pour un compte cible. */
  async adminCancelAccountDeletion(adminUserId: string, targetUserId: string) {
    const admin = await this._usersModel.findById(adminUserId).exec();
    if (!admin) throw new NotFoundException('user_not_found');
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    return this.cancelAccountDeletion(targetUserId);
  }

  /** Action admin: suppression définitive immédiate d’un compte cible. */
  async adminDeleteAccountNow(adminUserId: string, targetUserId: string) {
    const admin = await this._usersModel.findById(adminUserId).exec();
    if (!admin) throw new NotFoundException('user_not_found');
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this._hardDeleteAccount(targetUserId);
    return { message: 'account_deleted_now', deleted: true };
  }

  /** Exécution réelle (cron) des comptes arrivés à échéance. */
  async runScheduledAccountDeletionPass() {
    const now = new Date();
    const dueUsers = await this._usersModel
      .find({
        accountDeletionRequestedAt: { $ne: null },
        accountDeletionScheduledFor: { $ne: null, $lte: now },
      })
      .select('_id')
      .lean()
      .exec();

    if (!dueUsers.length) {
      return { scanned: 0, deleted: 0 };
    }

    let deleted = 0;
    for (const row of dueUsers) {
      const userId = String(row._id ?? '').trim();
      if (!userId) continue;
      try {
        await this._hardDeleteAccount(userId);
        deleted += 1;
      } catch (e) {
        this.logger.error(
          `[account-deletion-cron] suppression échouée user=${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return { scanned: dueUsers.length, deleted };
  }

  /** Suppression définitive et irréversible des données utilisateur. */
  private async _hardDeleteAccount(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      return;
    }
    if (user.profileImage) {
      try {
        await this._mediasService.delete(user.profileImage);
      } catch (_) {
        // ignore
      }
    }
    await this._mediasService.deleteFilesWithPrefix(`users/${userId}/profile`);
    await this._usersModel.deleteOne({ _id: userId }).exec();
  }

  async getSecuritySettings(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    const oauthLinked = Boolean(
      user.googleId?.trim() || user.appleId?.trim() || user.facebookId?.trim(),
    );
    return {
      email2faEnabled: user.email2faEnabled === true,
      canChangePassword: !oauthLinked,
      email: user.email,
    };
  }

  async changePassword(userId: string, args: ChangePasswordDto) {
    const user = await this._usersModel
      .findById(userId)
      .select(['+password'])
      .exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.googleId || user.appleId || user.facebookId) {
      throw new BadRequestException('oauth_account');
    }
    if (!(await comparePassword(args.currentPassword, user.password))) {
      throw new BadRequestException('invalid_current_password');
    }
    user.password = args.newPassword;
    user.set('passwordResetCode', undefined);
    user.set('passwordResetCodeExpiresAt', undefined);
    await user.save();
    return { ok: true, message: 'Mot de passe mis à jour.' };
  }

  async requestEmail2faEnable(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.email2faEnabled) {
      throw new BadRequestException('email_2fa_already_enabled');
    }
    const issued = await issueOtpCode(
      6,
      AuthService.OTP_TTL_MINUTES.email2faEnable,
    );
    await this._usersModel
      .findByIdAndUpdate(userId, {
        $set: {
          email2faEnableCode: issued.hash,
          email2faEnableCodeExpiresAt: issued.expiresAt,
        },
      })
      .exec();

    const email = user.email.trim().toLowerCase();
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const subject = `Activation 2FA - ${appName}`;
    const html = await this.buildVerificationEmailHtml(
      user.fullName,
      email,
      issued.code,
      '2fa',
    );
    const text = await this.buildVerificationEmailText(email, issued.code, '2fa');

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    if (!smtpUser || !smtpPass) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `[email-2fa] SMTP non configuré — code non journalisé pour ${email}`,
        );
      } else {
        throw new ServiceUnavailableException('email_not_configured');
      }
    } else {
      try {
        await this._mailer.sendSimple({
          to: email,
          toName: user.fullName,
          subject,
          html,
          text,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[email-2fa] échec SMTP : ${msg}`);
        throw new ServiceUnavailableException('email_send_failed');
      }
    }

    return {
      ok: true,
      message:
        'Un code de confirmation a été envoyé à votre adresse e-mail.',
    };
  }

  async confirmEmail2faEnable(userId: string, args: Email2faConfirmDto) {
    const codeNorm = args.code.trim().toUpperCase();
    const user = await this._usersModel
      .findById(userId)
      .select(['+email2faEnableCode', '+email2faEnableCodeExpiresAt'])
      .exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.email2faEnabled) {
      throw new BadRequestException('email_2fa_already_enabled');
    }
    if (
      !user.email2faEnableCode ||
      isOtpExpired(user.email2faEnableCodeExpiresAt) ||
      !(await verifyOtpCode(codeNorm, user.email2faEnableCode))
    ) {
      throw new BadRequestException('invalid_code');
    }
    await this._usersModel
      .findByIdAndUpdate(userId, {
        $set: { email2faEnabled: true },
        $unset: {
          email2faEnableCode: '',
          email2faEnableCodeExpiresAt: '',
        },
      })
      .exec();
    return { ok: true, email2faEnabled: true };
  }

  async disableEmail2fa(userId: string) {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.email2faEnabled !== true) {
      throw new BadRequestException('email_2fa_not_enabled');
    }
    await this._usersModel
      .findByIdAndUpdate(userId, {
        $set: { email2faEnabled: false },
        $unset: {
          email2faEnableCode: '',
          email2faEnableCodeExpiresAt: '',
          email2faLoginCode: '',
          email2faLoginCodeExpiresAt: '',
        },
      })
      .exec();
    return {
      ok: true,
      email2faEnabled: false,
      message: 'Double authentification par e-mail désactivée.',
    };
  }

  /** Rôles du formulaire d’inscription Dashboard → `UserModel.type` */
  private queueVendorOnboardingWelcome(user: {
    type?: UserTypeEnum;
    email?: string;
    fullName?: string;
  }): void {
    if (user.type !== UserTypeEnum.VENDOR) return;
    const email = String(user.email ?? '')
      .trim()
      .toLowerCase();
    if (!email) return;
    void this._partnerOnboardingEmail
      .notifyVendorOnboardingWelcome({
        email,
        name: String(user.fullName ?? '').trim() || email,
      })
      .catch((e) =>
        this.logger.warn(
          `vendor onboarding welcome email: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
  }

  private _mapSignupRoleToUserType(
    role?: RegisterDto['signupRole'],
  ): UserTypeEnum {
    switch (role) {
      case 'restaurant':
        return UserTypeEnum.VENDOR;
      case 'livreur':
        return UserTypeEnum.DELIVERY;
      case 'client':
      default:
        return UserTypeEnum.USER;
    }
  }

  private _emailMatchExact(email: string) {
    return buildCaseInsensitiveExactRegex(email);
  }

  private async finishAuthenticatedLogin(
    userId: string,
    ctx: LoginRequestContext | undefined,
    method: LoginAuthMethod,
  ): Promise<
    | { authToken: string; refreshToken: string }
    | {
        requiresTwoFactor: true;
        challengeToken: string;
        email: string;
        message: string;
      }
  > {
    const user = await this._usersModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    if (user.email2faEnabled !== true) {
      return await this.deliverAuthTokens(user, ctx, method);
    }
    return this.begin2faLoginChallenge(user, method);
  }

  private async begin2faLoginChallenge(
    user: Pick<UserModel, '_id' | 'email' | 'fullName'>,
    method: LoginAuthMethod,
  ): Promise<{
    requiresTwoFactor: true;
    challengeToken: string;
    email: string;
    message: string;
  }> {
    const issued = await issueOtpCode(
      6,
      AuthService.OTP_TTL_MINUTES.email2faLogin,
    );
    await this._usersModel
      .findByIdAndUpdate(user._id, {
        $set: {
          email2faLoginCode: issued.hash,
          email2faLoginCodeExpiresAt: issued.expiresAt,
        },
      })
      .exec();

    const email = user.email.trim().toLowerCase();
    await this._send2faLoginEmail(user.fullName, email, issued.code);

    const challengeToken = this._jwtService.sign(
      { sub: String(user._id), typ: '2fa_login', method },
      { expiresIn: '15m' },
    );

    return {
      requiresTwoFactor: true,
      challengeToken,
      email,
      message:
        'Un code de vérification a été envoyé à votre adresse e-mail.',
    };
  }

  private async _send2faLoginEmail(
    fullName: string,
    email: string,
    code: string,
  ): Promise<void> {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const subject = `Connexion sécurisée - ${appName}`;
    const html = await this.buildVerificationEmailHtml(
      fullName,
      email,
      code,
      '2fa-login',
    );
    const text = await this.buildVerificationEmailText(email, code, '2fa-login');

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    if (!smtpUser || !smtpPass) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `[2fa-login] SMTP non configuré — code non journalisé pour ${email}`,
        );
      } else {
        throw new ServiceUnavailableException('email_not_configured');
      }
      return;
    }
    try {
      await this._mailer.sendSimple({
        to: email,
        toName: fullName,
        subject,
        html,
        text,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[2fa-login] échec SMTP : ${msg}`);
      throw new ServiceUnavailableException('email_send_failed');
    }
  }

  private async deliverAuthTokens(
    user: Pick<UserModel, '_id' | 'email' | 'fullName' | 'type'>,
    ctx: LoginRequestContext | undefined,
    method: LoginAuthMethod,
  ): Promise<{ authToken: string; refreshToken: string }> {
    const tokens = await this.issueAuthTokens(user);
    if (ctx) {
      this._loginNotification.maybeNotifyLogin(user, ctx, method);
    }
    return tokens;
  }

  private async issueAuthTokens(
    user: Pick<UserModel, '_id' | 'type'>,
  ): Promise<{
    authToken: string;
    refreshToken: string;
  }> {
    const userId = String(user._id);
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const refreshExpiresIn = this.getRefreshTokenExpiration();
    const refreshTtlSec = parseJwtDurationToSeconds(refreshExpiresIn, 30 * 86_400);

    const authToken = this._jwtService.sign(
      {
        sub: userId,
        typ: 'access',
        type: user.type,
        jti: accessJti,
      },
      { expiresIn: this.getAccessTokenExpiration() },
    );
    const refreshToken = this._jwtService.sign(
      { sub: userId, typ: 'refresh', jti: refreshJti },
      {
        secret: this.getRefreshTokenSecret(),
        expiresIn: refreshExpiresIn,
      },
    );
    await this._refreshTokenStore.register(refreshJti, userId, refreshTtlSec);
    return { authToken, refreshToken };
  }

  private getAccessTokenExpiration(): string {
    const explicit = String(
      this._configService.get<string>('JWT_EXPIRATION') ?? '',
    ).trim();
    return explicit || '30m';
  }

  private getRefreshTokenSecret(): string {
    const explicit = String(
      this._configService.get<string>('JWT_REFRESH_SECRET') ?? '',
    ).trim();
    const accessSecret = String(
      this._configService.get<string>('JWT_SECRET') ?? '',
    ).trim();
    if (isProductionNodeEnv()) {
      if (!explicit) {
        this.logger.warn(
          'JWT_REFRESH_SECRET missing in production — set a distinct secret (H-03 / M-08)',
        );
      } else if (explicit === accessSecret) {
        this.logger.warn(
          'JWT_REFRESH_SECRET must differ from JWT_SECRET in production',
        );
      }
    }
    if (explicit) return explicit;
    if (accessSecret) return accessSecret;
    throw new UnauthorizedException('jwt_secret_not_configured');
  }

  private getRefreshTokenExpiration(): string {
    const explicit = String(
      this._configService.get<string>('JWT_REFRESH_EXPIRATION') ?? '',
    ).trim();
    return explicit || this.defaultRefreshExpiration;
  }
}
