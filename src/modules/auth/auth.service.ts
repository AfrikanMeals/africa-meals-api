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
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { App } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';
import { AuthSettingsService } from '@modules/auth-settings/auth-settings.service';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  AppleAuthDto,
  CheckAccountDto,
  EmailVerificationDto,
  FacebookAuthDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly defaultRefreshExpiration = '30d';
  private static readonly ACCOUNT_DELETION_DELAY_DAYS = 30;

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

  /**
   * Inscription en deux temps : aucune ligne dans `users` tant que le code e-mail
   * n’est pas validé (`register/complete`), sauf si SMTP désactivé / compte test.
   */
  async registerStart(args: RegisterDto) {
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
      const tokens = this.issueAuthTokens(user._id.toString());
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

    const code = await this._generateVerificationCode(6);
    const passwordHash = await bcrypt.hash(args.password, 10);
    const userType = this._mapSignupRoleToUserType(args.signupRole);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this._pendingSignupModel.create({
      email,
      passwordHash,
      fullName: args.fullName.trim(),
      userType,
      verificationCode: code,
      expiresAt,
    });

    try {
      await this._sendSignupVerificationEmail(
        email,
        args.fullName.trim(),
        code,
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
  async registerComplete({ email: emailRaw, code }: EmailVerificationDto) {
    const email = emailRaw.trim().toLowerCase();
    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (!pending) {
      throw new NotFoundException('invalid_or_expired_signup_code');
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('signup_code_expired');
    }
    if (pending.verificationCode !== code.trim()) {
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
    return { ...this.issueAuthTokens(newUser._id.toString()), user };
  }

  async resendPendingSignupCode(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const pending = await this._pendingSignupModel.findOne({ email }).exec();
    if (!pending) {
      throw new NotFoundException('pending_signup_not_found');
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await this._pendingSignupModel.deleteOne({ _id: pending._id }).exec();
      throw new BadRequestException('signup_code_expired');
    }
    const code = await this._generateVerificationCode(6);
    pending.verificationCode = code;
    pending.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await pending.save();
    await this._sendSignupVerificationEmail(email, pending.fullName, code);
    return {
      ok: true as const,
      message: 'Un nouveau code a été envoyé.',
    };
  }

  private buildVerificationEmailHtml(
    fullName: string,
    code: string,
    variant: 'signup' | 'activation' | 'reset',
  ): string {
    const safeName = this._emailTpl.escapeHtml(fullName.trim() || 'Bonjour');
    const titles = {
      signup: 'Finalisez votre inscription',
      activation: 'Vérifiez votre courriel',
      reset: 'Réinitialisation de mot de passe',
    };
    const intros = {
      signup:
        'Utilisez le code ci-dessous pour confirmer votre adresse et créer votre compte.',
      activation:
        'Voici votre code de vérification pour activer votre compte.',
      reset:
        'Voici votre code de réinitialisation. Ne le partagez avec personne.',
    };
    const validity =
      variant === 'reset'
        ? 'Ce code est valable <strong>15 minutes</strong>.'
        : 'Ce code est valable <strong>30 minutes</strong>.';
    return [
      this._emailTpl.heading(titles[variant]),
      this._emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
      this._emailTpl.paragraph(intros[variant]),
      this._emailTpl.codeBox(code),
      this._emailTpl.paragraph(validity),
      this._emailTpl.muted(
        'Si vous n’avez pas demandé ce code, vous pouvez ignorer ce message en toute sécurité.',
      ),
    ].join('\n');
  }

  private async _sendSignupVerificationEmail(
    toEmail: string,
    fullName: string,
    code: string,
  ) {
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const subject = `Vérifiez votre courriel - ${appName}`;
    const html = this.buildVerificationEmailHtml(fullName, code, 'signup');
    const text = `Code d’inscription ${appName} : ${code} (30 min).`;
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
  async register(args: RegisterDto) {
    if (args.source === 'email') {
      return this.registerStart(args);
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

    const activationCode = verifyImmediately
      ? undefined
      : await this._generateVerificationCode(6);

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
        : { activationCode }),
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

    if (!verifyImmediately && activationCode) {
      try {
        const appName =
          this._configService.get<string>('APP_NAME') ?? 'African Meals';
        const subject = `Bienvenue sur ${appName}`;
        await this._mailer.sendSimple({
          to: args.email,
          toName: args.fullName,
          subject,
          html: this.buildVerificationEmailHtml(
            args.fullName,
            activationCode,
            'activation',
          ),
          text: `Code d’activation ${appName} : ${activationCode}`,
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
            $unset: { activationCode: '' },
          });
          this.logger.log(
            `[register] compte auto-vérifié (non-production) id=${newUser._id.toString()}`,
          );
        }
      }
    }

    this.logger.log(`[register] terminé id=${newUser._id.toString()}`);
    return this.findUserById(newUser._id.toString());
  }

  /**
   * Connexion / inscription Google : vérifie le jeton Firebase (provider Google),
   * puis trouve ou crée l’utilisateur Mongo (googleId = identifiant Google dans le jeton).
   */
  async authWithGoogle(args: GoogleAuthDto) {
    await this._authSettings.assertProviderEnabled('google');
    return this._authWithGoogle(args, UserTypeEnum.USER);
  }

  /** Variante dashboard/admin : création sociale par défaut en VENDOR. */
  async authWithGoogleAsVendor(args: GoogleAuthDto) {
    await this._authSettings.assertProviderEnabled('google');
    return this._authWithGoogle(args, UserTypeEnum.VENDOR);
  }

  private async _authWithGoogle(
    args: GoogleAuthDto,
    defaultTypeForNewUser: UserTypeEnum,
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
      return {
        ...this.issueAuthTokens(user._id.toString()),
      };
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
      return {
        ...this.issueAuthTokens(user._id.toString()),
      };
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
    return {
      ...this.issueAuthTokens(newUser._id.toString()),
    };
  }

  /**
   * Connexion / inscription Apple : vérifie le jeton Firebase (provider Apple),
   * puis trouve ou crée l’utilisateur Mongo (appleId = identifiant Apple/Firebase).
   */
  async authWithApple(args: AppleAuthDto) {
    await this._authSettings.assertProviderEnabled('apple');
    return this._authWithApple(args, UserTypeEnum.USER);
  }

  /** Variante dashboard/admin : création sociale par défaut en VENDOR. */
  async authWithAppleAsVendor(args: AppleAuthDto) {
    await this._authSettings.assertProviderEnabled('apple');
    return this._authWithApple(args, UserTypeEnum.VENDOR);
  }

  private async _authWithApple(
    args: AppleAuthDto,
    defaultTypeForNewUser: UserTypeEnum,
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
      return {
        ...this.issueAuthTokens(user._id.toString()),
      };
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
        return {
          ...this.issueAuthTokens(user._id.toString()),
        };
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
    return {
      ...this.issueAuthTokens(newUser._id.toString()),
    };
  }

  /**
   * Connexion / inscription Facebook : vérifie le jeton Firebase (provider Facebook),
   * puis trouve ou crée l’utilisateur Mongo (facebookId = identifiant Facebook/Firebase).
   */
  async authWithFacebook(args: FacebookAuthDto) {
    await this._authSettings.assertProviderEnabled('facebook');
    return this._authWithFacebook(args, UserTypeEnum.USER);
  }

  /** Variante dashboard/admin : création sociale par défaut en VENDOR. */
  async authWithFacebookAsVendor(args: FacebookAuthDto) {
    await this._authSettings.assertProviderEnabled('facebook');
    return this._authWithFacebook(args, UserTypeEnum.VENDOR);
  }

  private async _authWithFacebook(
    args: FacebookAuthDto,
    defaultTypeForNewUser: UserTypeEnum,
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
      return {
        ...this.issueAuthTokens(user._id.toString()),
      };
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
      return {
        ...this.issueAuthTokens(user._id.toString()),
      };
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
    return {
      ...this.issueAuthTokens(newUser._id.toString()),
    };
  }

  async login(args: LoginDto) {
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

    if (!(await bcrypt.compare(rest.password, user.password))) {
      throw new NotFoundException(`user_not_found`);
    }

    // TODO adjust verification based on source. For now, we only verify email

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(`email_not_verified`);
    }

    // TODO add user role(admin, user, etc) claims
    return {
      ...this.issueAuthTokens(user._id.toString()),
    };
  }

  async refreshSession(refreshTokenRaw: string) {
    const refreshToken = String(refreshTokenRaw ?? '').trim();
    if (!refreshToken) {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const secret = this.getRefreshTokenSecret();
    type RefreshPayload = { sub?: unknown; typ?: unknown };
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
    return this.issueAuthTokens(userId);
  }

  async checkAccount(args: CheckAccountDto) {
    const user = await this._usersModel
      .findOne({ [args.source]: args[args.source] })
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    return user;
  }

  async verifyEmail({ code: activationCode, email }: EmailVerificationDto) {
    const emailNorm = email.trim().toLowerCase();
    const codeNorm = activationCode.trim();

    const user = await this._usersModel
      .findOneAndUpdate(
        {
          activationCode: codeNorm,
          email: this._emailMatchExact(emailNorm),
          emailVerifiedAt: null,
        },
        { activationCode: null, emailVerifiedAt: new Date() },
        { new: true },
      )
      .exec();
    if (user) {
      return user;
    }

    try {
      const completed = await this.registerComplete({
        email: emailNorm,
        code: codeNorm,
      });
      return completed.user;
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

    const code = await this._generateVerificationCode(6);
    const user = await this._usersModel
      .findOneAndUpdate(
        {
          email: this._emailMatchExact(email),
          emailVerifiedAt: null,
        },
        {
          emailVerifiedAt: null,
          activationCode: code,
        },
        { new: true },
      )
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const subject = `Bienvenue sur ${appName}`;
    await this._mailer.sendSimple({
      to: email,
      toName: user.fullName,
      subject,
      html: this.buildVerificationEmailHtml(user.fullName, code, 'activation'),
      text: `Code d’activation ${appName} : ${code}`,
    });
    return user;
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

    const code = await this._generateVerificationCode(6);
    await this._usersModel
      .findOneAndUpdate(
        { _id: user._id },
        { $set: { passwordResetCode: code } },
        { new: true },
      )
      .exec();

    const appName =
      this._configService.get<string>('APP_NAME') ?? 'African Meals';
    const subject = `Réinitialisation de mot de passe - ${appName}`;
    const html = this.buildVerificationEmailHtml(
      user.fullName,
      code,
      'reset',
    );
    const text = `Code de réinitialisation : ${code}. Valide 15 min. - ${appName}`;

    const smtpUser = this._configService.get<string>('SMTP_USER')?.trim();
    const smtpPass =
      this._configService.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this._configService.get<string>('SMTP_PASS')?.trim();
    if (!smtpUser || !smtpPass) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `[forgot-password] SMTP non configuré — code pour ${email} : ${code}`,
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
      .select('+passwordResetCode')
      .exec();

    if (!user?.passwordResetCode || user.passwordResetCode !== code.trim()) {
      throw new BadRequestException('invalid_reset_code');
    }

    user.password = password;
    user.set('passwordResetCode', undefined);
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

  /** Rôles du formulaire d’inscription Dashboard → `UserModel.type` */
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
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private async _generateVerificationCode(length: number) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  private issueAuthTokens(userId: string): {
    authToken: string;
    refreshToken: string;
  } {
    const authToken = this._jwtService.sign({ sub: userId });
    const refreshToken = this._jwtService.sign(
      { sub: userId, typ: 'refresh' },
      {
        secret: this.getRefreshTokenSecret(),
        expiresIn: this.getRefreshTokenExpiration(),
      },
    );
    return { authToken, refreshToken };
  }

  private getRefreshTokenSecret(): string {
    const explicit = String(
      this._configService.get<string>('JWT_REFRESH_SECRET') ?? '',
    ).trim();
    if (explicit) return explicit;
    const accessSecret = String(
      this._configService.get<string>('JWT_SECRET') ?? '',
    ).trim();
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
